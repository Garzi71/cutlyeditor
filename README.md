# Cutly

Free desktop video editor for Windows. Everything runs locally, no paywalls.

## Install

Download `Cutly-Setup-x.y.z.exe` from [Releases](https://github.com/Garzi71/cutlyeditor/releases/latest) and run it. FFmpeg is included. The app checks for updates on start.

## Features

- **Editing:** multi-track timeline, split, trim, snapping, undo/redo, keyframes, speed ramps, reverse
- **Text & captions:** text styles, bundled fonts, automatic captions (Whisper, offline) with 12 animated caption templates
- **Color:** auto color, color match, HSL, curves, 20 filters, `.cube` LUTs, adjustment layers
- **Effects:** 15 transitions, 10 video effects, in/out animations
- **AI tools:** background removal, noise reduction, silence removal
- **Templates:** built-in project templates, save and share your own (`.cutlytemplate`)
- **Player:** snapping guides, aspect ratio switch, TikTok / Reels / Shorts preview, safe zones
- **Export:** MP4 (H.264 / H.265), NVIDIA GPU or CPU, presets for TikTok, Reels, Shorts, YouTube, Instagram, X

AI models (speech recognition, background removal) are downloaded on first use.

## Development

Requires Node.js.

```bash
npm install
```

```bash
npm run dev
```

Build a local installer (FFmpeg must be in `resources/ffmpeg`, see `scripts/fetch-ffmpeg.ps1`):

```bash
npm run dist
```

## Release

Commit all changes, then run `npm run release` (patch) or `npm run release:minor`. GitHub Actions builds the installer and publishes it to Releases.

## Shortcuts

| Action | Key |
|---|---|
| Play / pause | Space |
| Split | S or Ctrl+B |
| Delete | Delete |
| Duplicate | Ctrl+D |
| Undo / redo | Ctrl+Z / Ctrl+Y |
| Frame step | ← → (Shift = 1 s) |
| Save | Ctrl+S |
| Export | Ctrl+E |
