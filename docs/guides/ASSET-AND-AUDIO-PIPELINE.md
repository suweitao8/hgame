# HGame 2D Art & Audio Asset Pipeline Guide

This guide documents HGame's editor-free, AI-first asset workflows for 2D grid sprites, dynamic ground shadows, spatial audio, and multi-variant sound effects.

## 1. 2D Art Grid Batching & Dynamic Ground Shadows

> **Image Generation Policy:** Generate all 2D art, character concepts, turnaround sheets, and sprite grids using the active LLM/Agent host's built-in image generation tool (e.g., Codex `imagegen`, Antigravity `image-generator`). **Do not use local ComfyUI workflows for 2D image generation** — local ComfyUI is reserved strictly for 3D mesh generation from approved images.

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
2. **Image-to-3D GLB (Trellis2-GGUF)** — defaults `--faces 10000` for real-time WebGL budgets, or `--quality high` (`High_Quality_GGUF`, 50 steps + `MeshRefiner` + `SmoothNormals`, default `400000` tris); 2:1 front+side sheets auto-crop the front half via `--panel auto|left|right|full`:
   ```bash
   npm run process:model3d -- generate --input ref.png --faces 10000 --out raw.glb
   npm run process:model3d -- generate --input sheet.png --quality high --out hq_raw.glb
   ```
3. **Orientation Inspection & Blender Pose Normalization** — required before UltraTex `alignment=front` and before game import (`-Y_blender` / `+Z_gltf` forward, `+Z_blender` / `+Y_gltf` up, `min_z = 0` ground origin, ASCII paths only; inspect `qa` first since `High_Quality_GGUF` may already be upright):
   ```bash
   npm run process:model3d -- inspect raw.glb --out-dir qa_6view
   npm run process:model3d -- normalize raw.glb --rx -90 --origin ground --out norm.glb --qa-dir qa_norm
   ```
4. **PBR Re-Texturing (UltraTex LowVRAM GGUF) + Multi-View QA Render** — use `--quality high` (`padding=4`, `steps=6`, `extra_steps=4`, `texture_size=4096`) and `--ref-panel auto|left|right|full` for dual-view sheets:
   ```bash
   npm run process:model3d -- texture --mesh norm.glb --ref ref.png --quality high --out final.glb --pbr-dir pbr --qa-dir qa_utx
   ```


### 4.1 固定低显存角色建模流水线（12GB GPU，单角色全流程 ~5–6 分钟）

为兼顾 12GB 显存稳定性、简洁低耗风格与游戏运行时性能，且不在 WebAsset 建模阶段区分主角/NPC，所有角色统一按以下 5 步及顶点数红线执行：

| 档位 | --preset | 目标四边面 (--target-quads) | 顶点硬上限 | 贴图尺寸 | 适用范围 |
|---|---|---:|---:|---:|---|
| **统一角色低模（默认，含绑定 + `Run`）** | low（兼容 general/player） | 1,750 四边面 | **≤ 3,000 顶点**（含 glTF UV 分裂后） | 1024×1024 PBR | 全部 WebAsset / 游戏角色（默认自带骨骼+`Run` 循环） |
| **高模烘焙母版** | high | 16,000 四边面 | ~24k 顶点 | 2048×2048 PBR | 展示预览 / 法线与颜色烘焙源 |

**实测耗时明细（RTX 4070 12GB，带 `--reserve-vram 4.8`，2026-11-18「丑橘」实测全套 `335.6s` + 自动绑定动画 `~3s` ≈ 5 分 39 秒）**：
1. **单视图 AI 3D 生模**（ComfyUI `TRELLIS.2-4B GGUF Q4_K_M`、`euler` 12步、`max_num_tokens=20480`）：约 **4.2 – 7.5 分钟**（显存余量充足时「丑橘」实测 `251.7s`；桌面/编辑器占显存多时约 7.5 分钟）。
2. **Blender 姿态归一化 `normalize`**：约 **1–2 秒**。
3. **高模四边面重建 + Auto Unwrap + 2K 烘焙 `remesh-bake`**（可选，仅主角或需展示高模时跑）：约 **1 – 2 分钟**。
4. **统一角色低模重拓扑 + UV + 1K PBR 烘焙 + 自动绑定 & 默认 `Run` 动画**：`remesh-bake --preset low --rig-run`（`generate --remesh --low-out` 默认已自动开启 `--rig-run`，加 `--no-rig` 可关闭），合计约 **28–48 秒**（其中自动绑定+`Run` 动画约 **~3 秒**）。
5. **WebAsset 上传 + 多视角与 `Run` 播放检查**：约 **5–10 秒**。
- **单角色全流程总耗时**：**仅出低模（含 UV+贴图+绑定+`Run`）约 5 分钟**（显存偏紧时约 8 分钟）；**高模 + 低模（含绑定+`Run`）全套约 `5.6 分钟`**（显存偏紧时约 `9–10 分钟`）。

**标准固定命令**：
```bash
# 1. 一条命令出全套（ComfyUI 生模 -> 归一化 -> 高模 + 统一 ≤3000 顶点低模+UV+贴图+绑定+Run）：
node scripts/process-model3d.mjs generate --input <front.png> --out <char_high.glb> \
  --quality high --normalize --origin ground --target-height 1.0 \
  --remesh --low-out <char_low.glb> --preset low

# 2. 对已有高模直接烘焙统一标准低模（≤3000 顶点）并附带绑定 + Run 动画：
node scripts/process-model3d.mjs remesh-bake --input <norm_high.glb> --out <low.glb> --preset low --rig-run

# 3. 对已有低模单独补充自动绑定 + 默认 Run 动画：
node scripts/process-model3d.mjs rig-run --input <low.glb> --out <low_run.glb> --qa-dir <qa_run_dir>
```

- ⚠️ **避坑固定规则**：
  - ComfyUI 必须带 `--reserve-vram 4.8` 启动（可写入本地 ComfyUI 启动脚本或 CLI 参数），勿跑 `pipeline_type="512"` 的纹理 GGUF（会产生彩色噪点）。
  - AI 概念图不使用 `--multiview`（非严格正交会导致额头凸起/耳朵撕裂），也不再默认跑 8–10 分钟的 UltraTex 重绘。
  - 自动绑定使用 UE/Anim58 命名的 23 根主骨骼；检测到身后斗篷或尾巴时，会额外生成 `cape_01-03`（父骨骼 `spine_03`）或 `tail_01-03`（父骨骼 `pelvis`）。这些区域的权重只分配给对应骨链，不再被腿或手臂骨骼拉伸。斗篷和尾巴的轻微摆动会烘焙进默认 `Run`；套用 Anim58 动作时，它们会刚性跟随父骨骼。
