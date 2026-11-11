// GPU transitions (two layers -> one) and video effects (one frame -> one frame).
// Used by the compositor for both the preview and the export, so results are identical.
import type { EffectType, TransitionType } from '@shared/types'
import { EFFECTS, TRANSITIONS } from '@shared/types'

const VS = `#version 300 es
in vec2 pos;
out vec2 uv;
void main() {
  uv = vec2(pos.x * 0.5 + 0.5, 0.5 - pos.y * 0.5);
  gl_Position = vec4(pos, 0.0, 1.0);
}`

const COMMON = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 outColor;
uniform vec2 res;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
vec4 inside(sampler2D t, vec2 p) { return (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) ? vec4(0.0) : texture(t, p); }
vec4 blur9(sampler2D t, vec2 p, float r) {
  vec4 s = vec4(0.0);
  float w = 0.0;
  for (int i = -3; i <= 3; i++) for (int j = -3; j <= 3; j++) {
    vec2 o = vec2(float(i), float(j));
    float k = exp(-dot(o, o) / 8.0);
    s += texture(t, p + o * r / 3.0 / res) * k;
    w += k;
  }
  return s / w;
}
`

const TRANSITION_FS = `${COMMON}
uniform sampler2D A;
uniform sampler2D B;
uniform float p;
uniform int kind;
vec2 rot(vec2 q, float a) { q -= 0.5; q.x *= res.x / res.y; q = mat2(cos(a), -sin(a), sin(a), cos(a)) * q; q.x /= res.x / res.y; return q + 0.5; }
void main() {
  float e = p * p * (3.0 - 2.0 * p);
  vec4 a = texture(A, uv);
  vec4 b = texture(B, uv);
  vec4 c;
  if (kind == ${TRANSITIONS.indexOf('dissolve')}) c = mix(a, b, e);
  else if (kind == ${TRANSITIONS.indexOf('dipBlack')} || kind == ${TRANSITIONS.indexOf('dipWhite')}) {
    vec4 col = kind == ${TRANSITIONS.indexOf('dipBlack')} ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(1.0);
    c = p < 0.5 ? mix(a, col, smoothstep(0.0, 0.5, p)) : mix(col, b, smoothstep(0.5, 1.0, p));
  }
  else if (kind == ${TRANSITIONS.indexOf('pushLeft')}) c = uv.x < 1.0 - e ? texture(A, uv + vec2(e, 0.0)) : texture(B, uv - vec2(1.0 - e, 0.0));
  else if (kind == ${TRANSITIONS.indexOf('pushRight')}) c = uv.x > e ? texture(A, uv - vec2(e, 0.0)) : texture(B, uv + vec2(1.0 - e, 0.0));
  else if (kind == ${TRANSITIONS.indexOf('pushUp')}) c = uv.y < 1.0 - e ? texture(A, uv + vec2(0.0, e)) : texture(B, uv - vec2(0.0, 1.0 - e));
  else if (kind == ${TRANSITIONS.indexOf('pushDown')}) c = uv.y > e ? texture(A, uv - vec2(0.0, e)) : texture(B, uv + vec2(0.0, 1.0 - e));
  else if (kind == ${TRANSITIONS.indexOf('wipeLeft')}) c = mix(a, b, smoothstep(1.0 - e - 0.02, 1.0 - e + 0.02, uv.x * 1.04 - 0.02));
  else if (kind == ${TRANSITIONS.indexOf('wipeRight')}) c = mix(b, a, smoothstep(e - 0.02, e + 0.02, uv.x * 1.04 - 0.02));
  else if (kind == ${TRANSITIONS.indexOf('wipeUp')}) c = mix(a, b, smoothstep(1.0 - e - 0.02, 1.0 - e + 0.02, uv.y * 1.04 - 0.02));
  else if (kind == ${TRANSITIONS.indexOf('wipeDown')}) c = mix(b, a, smoothstep(e - 0.02, e + 0.02, uv.y * 1.04 - 0.02));
  else if (kind == ${TRANSITIONS.indexOf('zoom')}) {
    vec4 za = texture(A, (uv - 0.5) / (1.0 + e * 0.6) + 0.5);
    vec4 zb = texture(B, (uv - 0.5) / (1.4 - e * 0.4) + 0.5);
    c = mix(za, zb, smoothstep(0.35, 0.65, p));
  }
  else if (kind == ${TRANSITIONS.indexOf('blur')}) {
    float r = sin(p * 3.14159265) * 28.0;
    c = mix(blur9(A, uv, r), blur9(B, uv, r), smoothstep(0.3, 0.7, p));
  }
  else if (kind == ${TRANSITIONS.indexOf('circle')}) {
    vec2 d = (uv - 0.5) * vec2(res.x / res.y, 1.0);
    float maxR = length(vec2(res.x / res.y, 1.0)) * 0.5;
    c = mix(a, b, 1.0 - smoothstep(e * maxR - 0.01, e * maxR + 0.01, length(d)));
  }
  else {
    // spin: A turns away and shrinks, B turns in and grows
    float s = p < 0.5 ? 1.0 - p : p;
    float ang = (p < 0.5 ? p : p - 1.0) * 3.14159265;
    vec2 q = (rot(uv, ang) - 0.5) / s + 0.5;
    c = p < 0.5 ? inside(A, q) : inside(B, q);
  }
  outColor = c;
}`

const EFFECT_FS = `${COMMON}
uniform sampler2D src;
uniform float t;
uniform float amount;
uniform int kind;
void main() {
  vec2 q = uv;
  vec4 c;
  float fr = floor(t * 30.0);
  if (kind == ${EFFECTS.indexOf('blur')}) c = blur9(src, q, amount * 30.0);
  else if (kind == ${EFFECTS.indexOf('shake')}) {
    vec2 off = vec2(hash(vec2(fr, 1.0)) - 0.5, hash(vec2(fr, 2.0)) - 0.5) * amount * 0.05;
    c = texture(src, (q - 0.5) / (1.0 + amount * 0.06) + 0.5 + off);
  }
  else if (kind == ${EFFECTS.indexOf('glitch')}) {
    float block = floor(t * 12.0);
    float row = floor(q.y * 24.0);
    float on = step(1.0 - amount * 0.5, hash(vec2(row, block)));
    float shift = (hash(vec2(row * 3.1, block)) - 0.5) * 0.12 * amount * on;
    float split = 0.008 * amount;
    c = vec4(texture(src, q + vec2(shift + split, 0.0)).r, texture(src, q + vec2(shift, 0.0)).g, texture(src, q + vec2(shift - split, 0.0)).b, 1.0);
  }
  else if (kind == ${EFFECTS.indexOf('flash')}) {
    float pulse = pow(max(0.0, 1.0 - fract(t * 1.25) * 3.0), 2.0);
    c = mix(texture(src, q), vec4(1.0), pulse * amount);
  }
  else if (kind == ${EFFECTS.indexOf('vhs')}) {
    float wob = (hash(vec2(floor(q.y * 120.0), fr)) - 0.5) * 0.004 * amount;
    vec2 p2 = q + vec2(wob + sin(q.y * 40.0 + t * 3.0) * 0.0015 * amount, 0.0);
    c = vec4(texture(src, p2 + vec2(0.004 * amount, 0.0)).r, texture(src, p2).g, texture(src, p2 - vec2(0.004 * amount, 0.0)).b, 1.0);
    c.rgb *= 1.0 - 0.18 * amount * step(0.5, fract(q.y * res.y / 4.0));
    c.rgb += (hash(q * res + fr) - 0.5) * 0.12 * amount;
    c.rgb = mix(c.rgb, c.rgb * vec3(1.05, 0.98, 1.08), amount);
  }
  else if (kind == ${EFFECTS.indexOf('grain')}) {
    c = texture(src, q);
    c.rgb += (hash(q * res + fr * 7.0) - 0.5) * 0.25 * amount;
  }
  else if (kind == ${EFFECTS.indexOf('rgbSplit')}) {
    float o = amount * 0.012 * (1.0 + 0.5 * sin(t * 6.0));
    c = vec4(texture(src, q + vec2(o, 0.0)).r, texture(src, q).g, texture(src, q - vec2(o, 0.0)).b, texture(src, q).a);
  }
  else if (kind == ${EFFECTS.indexOf('mirror')}) c = texture(src, vec2(q.x < 0.5 ? q.x : 1.0 - q.x, q.y));
  else if (kind == ${EFFECTS.indexOf('zoomPulse')}) {
    float s = 1.0 + amount * 0.12 * (0.5 + 0.5 * sin(t * 6.2831853 * 1.5));
    c = texture(src, (q - 0.5) / s + 0.5);
  }
  else {
    vec2 b = vec2(4.0 + amount * 44.0) / res;
    c = texture(src, (floor(q / b) + 0.5) * b);
  }
  outColor = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
}`

class Gl {
  canvas = document.createElement('canvas')
  gl: WebGL2RenderingContext
  private progs = new Map<string, { prog: WebGLProgram; loc: Record<string, WebGLUniformLocation | null> }>()
  private tex: WebGLTexture[] = []

  constructor() {
    const gl = this.canvas.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false })
    if (!gl) throw new Error('WebGL2 is not available')
    this.gl = gl
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    for (let i = 0; i < 2; i++) {
      const t = gl.createTexture()!
      gl.activeTexture(gl.TEXTURE0 + i)
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      this.tex.push(t)
    }
  }

  use(name: string, fs: string, uniforms: string[]): Record<string, WebGLUniformLocation | null> {
    const gl = this.gl
    let p = this.progs.get(name)
    if (!p) {
      const sh = (type: number, src: string): WebGLShader => {
        const s = gl.createShader(type)!
        gl.shaderSource(s, src)
        gl.compileShader(s)
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error')
        return s
      }
      const prog = gl.createProgram()!
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS))
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs))
      gl.linkProgram(prog)
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link error')
      const loc: Record<string, WebGLUniformLocation | null> = {}
      for (const u of ['res', ...uniforms]) loc[u] = gl.getUniformLocation(prog, u)
      p = { prog, loc }
      this.progs.set(name, p)
    }
    gl.useProgram(p.prog)
    const pos = gl.getAttribLocation(p.prog, 'pos')
    gl.enableVertexAttribArray(pos)
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0)
    return p.loc
  }

  upload(unit: number, src: TexImageSource): void {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, this.tex[unit])
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)
  }

  run(w: number, h: number, loc: Record<string, WebGLUniformLocation | null>): HTMLCanvasElement {
    const gl = this.gl
    gl.uniform2f(loc.res, w, h)
    gl.viewport(0, 0, w, h)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    return this.canvas
  }

  size(w: number, h: number): void {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
  }
}

let gl: Gl | null = null
const getGl = (): Gl => (gl ??= new Gl())

/** Blend layer A (outgoing) into B (incoming). `p` = 0..1. Returns a canvas valid until the next call. */
export function renderTransition(a: TexImageSource, b: TexImageSource, w: number, h: number, type: TransitionType, p: number): HTMLCanvasElement {
  const g = getGl()
  g.size(w, h)
  const loc = g.use('transition', TRANSITION_FS, ['A', 'B', 'p', 'kind'])
  g.upload(0, a)
  g.upload(1, b)
  g.gl.uniform1i(loc.A, 0)
  g.gl.uniform1i(loc.B, 1)
  g.gl.uniform1f(loc.p, Math.min(1, Math.max(0, p)))
  g.gl.uniform1i(loc.kind, TRANSITIONS.indexOf(type))
  return g.run(w, h, loc)
}

/** Apply a video effect to a whole frame. `t` = seconds since the effect started. */
export function renderEffect(src: TexImageSource, w: number, h: number, type: EffectType, amount: number, t: number): HTMLCanvasElement {
  const g = getGl()
  g.size(w, h)
  const loc = g.use('effect', EFFECT_FS, ['src', 't', 'amount', 'kind'])
  g.upload(0, src)
  g.gl.uniform1i(loc.src, 0)
  g.gl.uniform1f(loc.t, t)
  g.gl.uniform1f(loc.amount, Math.min(1, Math.max(0, amount)))
  g.gl.uniform1i(loc.kind, EFFECTS.indexOf(type))
  return g.run(w, h, loc)
}
