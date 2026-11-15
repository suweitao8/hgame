# HGame 2D Art & Audio Asset Pipeline Guide

This guide documents HGame's editor-free, AI-first asset workflows for 2D grid sprites, dynamic ground shadows, spatial audio, and multi-variant sound effects.

## 1. 2D Art Grid Batching & Dynamic Ground Shadows

### Generation Tiers
Generate square (`1:1`) images with a **pure white `#FFFFFF` background (`--bg white`, recommended default to eliminate green spill on character soles/edges)**, or transparent alpha / `#00FF00` green chroma-key, and **zero ground shadow** in the prompt so shadows are not baked into tilt/bounce animations:

| Grid Tier | Script Option | Max Export Size | Typical Assets |
|---|---|---|---|
| `3x3` (9-cell) | `--grid 3` | `341 px` | UI icons, cards, relics, small minions |
| `2x2` (4-cell) | `--grid 2` | `512 px` | Playable heroes, NPCs, medium/large enemies |
| `1x1` (Single) | `--grid 1` | `768 px` (actors) / `1280 px` (backgrounds) | Giant bosses, stage/combat backgrounds |

### Automated Batch Processing (`scripts/process-assets.mjs`)

```bash
npm run process:assets -- --input raw-sheet.png --grid 3 --bg white --mode actor --out-dir assets/actors --names hero,slime,bat
```

What the pipeline performs (zero native dependencies, pure Node `node:zlib` PNG codec):
1. Uniformly splits `1x1`, `2x2`, or `3x3` cells row-major.
2. Removes backgrounds cleanly (`transparent` noise threshold, `green` `#00FF00` chroma-key + edge despill preserving interior greens, or `white` corner/perimeter BFS flood-fill preserving dark-outlined interior white eye highlights).
3. Strips faint dark sole fringes in `'actor'` mode, tight-crops empty padding, downscales with premultiplied bilinear filtering to respect the tier cap without upscaling, and leaves actor sprites shadow-free by default (`--bake-shadow` opts in to static baking).

### Runtime Dynamic Ground Shadows & Grid Sheets

Enable `groundShadow: true` (or `{ widthRatio, heightRatio, alpha, tuckRatio, jumpScale }`) on `Sprite2D` inside `createCanvas2DAdapter`:

- The shadow is drawn at the character's rest foot plane **before** `sprite.offsetY`, `sprite.rotation`, and `hitFlash` run.
- Tilting during a run wobble does not tilt the shadow off the floor; jumping (`offsetY < 0`) shrinks and softens the shadow; `hitFlash` flashes only the character silhouette, never the ground shadow.
- Load packed grid sheets at runtime via `SpriteSheet.fromGrid(image, { columns: 3, rows: 3, inset: 1 })`.

## 2. Audio Format, Spatialization & Multi-Variant Cues

### Format Decision: Preprocessed `.mp3` vs `.ogg`
Web HTML5 games built with HGame standardize on preprocessed **`.mp3`** (mono for SFX / stereo for BGM) rather than `.ogg`-only assets:
- `.mp3` decodes across 100% of desktop browsers, Android, iOS Safari, and embedded `WKWebView` environments (many Apple WebKit versions lack native Ogg Vorbis support).
- Converting downloaded website MP3s to OGG adds lossy re-encoding artifacts without fixing loop/latency issues on its own.
- Instead, HGame fixes MP3 encoder-padding delay and loop seams cleanly:
  1. `scripts/process-audio.mjs` measures decoded PCM samples, rejects outlier-duration/silent takes from a 4-candidate generation batch, keeps the 2-4 most consistent variants, trims leading/trailing silence, aligns loudness to the group median, clamps outlier tails cleanly, and outputs mono (`24 kHz`, `96 kbps`) SFX or stereo (`44.1 kHz`, `128 kbps`) BGM `.mp3` files.
  2. At runtime, `analyzeAudioBuffer()` inspects decoded `AudioBuffer` PCM data so `play()` skips leading silence padding on one-shots and binds `source.loopStart` / `source.loopEnd` inside the active waveform for gapless loops.

### Batch Audio Curation (`scripts/process-audio.mjs`)

Requires `ffmpeg` on `PATH`:

```bash
npm run process:audio -- --cue rifle_shot --inputs take1.mp3,take2.mp3,take3.mp3,take4.mp3 --out-dir assets/audio/sfx
```

### Runtime 3D/2D Spatial Audio & Anti-Repetition Cues

```js
// Sync Web Audio listener from Three.js camera or Camera2D every frame
audio.updateListenerFromCamera(camera);

// Register 2-4 curated variants (loudness normalized, outlier tails aligned, zero back-to-back repeats)
audio.registerCue('rifle_shot', [buf1, buf2, buf3], {
  bus: 'spatial',
  pitchJitter: 0.02,
  gainJitter: 0.04,
  maxConcurrent: 4,
});

// 3D HRTF left/right ear binaural playback with distance attenuation
const handle = await audio.playCue('rifle_shot', {
  position: { x: -6, y: 1.5, z: -4 }, // left ear
  refDistance: 2,
});
handle?.setPosition({ x: 6, y: 1.5, z: -4 }); // moves smoothly to right ear

// 2D survivor/platformer stereo panning + distance falloff
await audio.playCue('hit_sfx', {
  position2D: { x: enemy.x, y: enemy.y },
  panRange: 480,
});
```

Master output passes through a built-in `DynamicsCompressorNode` (`threshold: -10 dB`, `ratio: 6:1`) across `sfx`, `spatial`, `music`, and `ambience` buses, preventing clipping even during dense multi-enemy combat.

## 3. Zero-Asset Procedural Audio (`playSynth` & `createBgm`)

When a game ships without external `.mp3` audio packs, use HGame's built-in WebAudio synthesizers directly on `app.services.audio`:

```js
audio.playSynth('hit', { volume: 0.75, pitchJitter: 0.08 }); // 10 presets: hit|slash|shoot|explosion|pickup|powerup|click|hurt|laser|jump
const bgm = audio.createBgm({ mood: 'dungeon', intensity: 0.4 }); // 6 moods: dungeon|cyber|boss|chill|adventure|victory
bgm.start();
bgm.setIntensity(0.9);
```

## 4. Local 3D AI Modeling, Pose Normalization & UltraTex PBR (`scripts/process-model3d.mjs`)

HGame connects to a local ComfyUI (`Trellis2-GGUF` + `UltraTex LowVRAM GGUF`) and headless Blender pipeline configured via gitignored `.hgame.local.json` (see `.hgame.local.example.json`) or `HGAME_MODEL3D_DIR` / `HGAME_MODEL3D_COMFY_URL` / `HGAME_MODEL3D_COMFY_DIR` / `HGAME_MODEL3D_BLENDER` env vars.

1. **Preflight check**:
   ```bash
   npm run process:model3d -- doctor
   ```
2. **Image-to-3D GLB (Trellis2-GGUF)** — defaults `--faces 10000` for real-time WebGL budgets:
   ```bash
   npm run process:model3d -- generate --input ref.png --faces 10000 --out raw.glb
   ```
3. **Orientation Inspection & Blender Pose Normalization** — required before UltraTex `alignment=front` and before game import (`-Y_blender` / `+Z_gltf` forward, `+Z_blender` / `+Y_gltf` up, `min_z = 0` ground origin, ASCII paths only):
   ```bash
   npm run process:model3d -- inspect raw.glb --out-dir qa_6view
   npm run process:model3d -- normalize raw.glb --rx -90 --origin ground --out norm.glb --qa-dir qa_norm
   ```
4. **PBR Re-Texturing (UltraTex LowVRAM GGUF) + Multi-View QA Render**:
   ```bash
   npm run process:model3d -- texture --mesh norm.glb --ref ref.png --out final.glb --pbr-dir pbr --qa-dir qa_utx
   ```

