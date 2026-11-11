// GPU color processing for the preview: source frame -> sharpen -> 3D LUT -> vignette.
// The LUT is the same table the export writes to a .cube file (see color.ts).
import type { ColorGrade } from '@shared/types'
import { LUT_SIZE, buildLut, hasPointOps, lutKey } from './color'

const VS = `#version 300 es
in vec2 pos;
out vec2 uv;
void main() {
  uv = vec2(pos.x * 0.5 + 0.5, 0.5 - pos.y * 0.5);
  gl_Position = vec4(pos, 0.0, 1.0);
}`

const FS = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 uv;
out vec4 outColor;
uniform sampler2D src;
uniform sampler3D lut;
uniform bool useLut;
uniform float lutSize;
uniform vec2 texel;
uniform float sharpen;
uniform float vignette;
void main() {
  vec4 c = texture(src, uv);
  if (sharpen > 0.0) {
    vec3 n = texture(src, uv + vec2(texel.x, 0.0)).rgb + texture(src, uv - vec2(texel.x, 0.0)).rgb
           + texture(src, uv + vec2(0.0, texel.y)).rgb + texture(src, uv - vec2(0.0, texel.y)).rgb;
    c.rgb = clamp(c.rgb + sharpen * (c.rgb - n * 0.25), 0.0, 1.0);
  }
  if (useLut) {
    vec3 p = c.rgb * ((lutSize - 1.0) / lutSize) + 0.5 / lutSize;
    c.rgb = texture(lut, p).rgb;
  }
  if (vignette > 0.0) {
    vec2 d = (uv - 0.5) * 2.0;
    float t = clamp((length(d) / 1.41421356 - 0.35) / 0.65, 0.0, 1.0);
    c.rgb *= 1.0 - vignette * 0.85 * (t * t * (3.0 - 2.0 * t));
  }
  outColor = c;
}`

export class ColorProcessor {
  readonly canvas: HTMLCanvasElement
  private gl: WebGL2RenderingContext
  private prog: WebGLProgram
  private srcTex: WebGLTexture
  private lutTex: WebGLTexture
  private currentLut = ''
  private loc: Record<string, WebGLUniformLocation | null> = {}

  constructor() {
    this.canvas = document.createElement('canvas')
    const gl = this.canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false })
    if (!gl) throw new Error('WebGL2 is not available')
    this.gl = gl
    const sh = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error')
      return s
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS))
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link error')
    this.prog = prog
    gl.useProgram(prog)
    for (const n of ['src', 'lut', 'useLut', 'lutSize', 'texel', 'sharpen', 'vignette']) this.loc[n] = gl.getUniformLocation(prog, n)

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const pos = gl.getAttribLocation(prog, 'pos')
    gl.enableVertexAttribArray(pos)
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0)

    this.srcTex = gl.createTexture()!
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    this.lutTex = gl.createTexture()!
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.CLAMP_TO_EDGE)

    gl.uniform1i(this.loc.src, 0)
    gl.uniform1i(this.loc.lut, 1)
  }

  /**
   * Run the grade over a frame and return the canvas holding the result (valid until the next call).
   * `w`/`h` is the processing size (usually the size the frame is drawn at).
   */
  process(source: TexImageSource, w: number, h: number, grade: ColorGrade): HTMLCanvasElement {
    const gl = this.gl
    w = Math.max(1, Math.round(w))
    h = Math.max(1, Math.round(h))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    gl.viewport(0, 0, w, h)
    gl.useProgram(this.prog)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    const sw = (source as HTMLVideoElement).videoWidth || (source as HTMLImageElement).naturalWidth || (source as HTMLCanvasElement).width || w
    const shh = (source as HTMLVideoElement).videoHeight || (source as HTMLImageElement).naturalHeight || (source as HTMLCanvasElement).height || h

    let useLut = false
    if (hasPointOps(grade)) {
      const key = lutKey(grade)
      if (key === this.currentLut) useLut = true
      else {
        const lut = buildLut(grade)
        if (lut) {
          gl.activeTexture(gl.TEXTURE1)
          gl.bindTexture(gl.TEXTURE_3D, this.lutTex)
          gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
          gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, LUT_SIZE, LUT_SIZE, LUT_SIZE, 0, gl.RGB, gl.FLOAT, lut)
          this.currentLut = key
          useLut = true
        }
      }
    }
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex)
    gl.uniform1i(this.loc.useLut, useLut ? 1 : 0)
    gl.uniform1f(this.loc.lutSize, LUT_SIZE)
    gl.uniform2f(this.loc.texel, 1 / sw, 1 / shh)
    gl.uniform1f(this.loc.sharpen, (grade.adjust.sharpen / 100) * 1.5)
    gl.uniform1f(this.loc.vignette, grade.adjust.vignette / 100)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    return this.canvas
  }
}

let shared: ColorProcessor | null = null
let failed = false

export function colorProcessor(): ColorProcessor | null {
  if (!shared && !failed) {
    try {
      shared = new ColorProcessor()
    } catch (e) {
      failed = true
      console.error('Color processing disabled:', e)
    }
  }
  return shared
}
