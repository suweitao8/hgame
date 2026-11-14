# 4.11 美术切图去背管线 + 3D HRTF 空间音效与多变种防连重 Cue

> 子系统速查(AI Agent 用)。完整 API 签名见 `docs/api/API-INDEX.json`。

- **美术管线（[ASSET-AND-AUDIO-PIPELINE.md](./ASSET-AND-AUDIO-PIPELINE.md)）**：
  - 支持 AI 生成的 **单图（`--grid 1`）、四宫格（`--grid 2`）、九宫格（`--grid 3`）** PNG。
  - **默认不烘焙地面阴影**（会自动清理角色脚底微弱阴影边），由运行时 `Sprite2D.groundShadow = true` 或 `SpriteCrowd2D` 算法实时绘制贴地阴影，避免视觉缩放/浮空穿帮。
- **音频格式评估（MP3 vs OGG）**：
  - 网站下载多为 MP3。iOS Safari 对原生 OGG 支持受限，因此 HGame 统一使用 **高质量单声道 SFX MP3（`24 kHz` `96k`）/ 立体声 BGM MP3（`44.1 kHz` `128k`）**，并在解码/预处理时由 `scripts/process-audio.mjs` + `analyzeAudioBuffer` 自动裁掉 MP3 编码首尾几十毫秒静音帧，兼顾 100% 跨平台兼容与无缝循环。
- **4 变种挑选与空间音效 API**：
  - `process-audio.mjs` 从每次生成的 4 个变种里自动踢掉空白/异常时长，保留最一致的 2~4 个，统一响度并对齐尾音上限。
  - 运行时 `app.services.audio`（启用 `'audio'` 特性后由 `app.installFeatures()` 挂载，或使用 `app.platform.audio`）提供：
    - 四条独立总线：`sfx` / `spatial` / `music` / `ambience` + 主总线动态防爆音限幅压缩器。
    - **`registerCue` / `playCue`**：2–4 变种防连续重复（跳步轮转）+ 微幅音高/音量抖动 + 并发上限。
    - **3D HRTF 左右耳空间声像**：传 `position: { x, y, z }` 并每帧调用 `audio.updateListenerFromCamera(camera)`；2D 游戏传 `position2D: { x, y }` 或通过返回 `handle.setPosition(...)` 实时追踪移动声源。
    - **声学遮挡与混音快照**：`setOcclusionProbe` 墙后低通发闷、`registerSnapshot` / `applySnapshot`（菜单/水下/濒死状态平滑切混音）。

```js
const audio = app.services.audio; // 或 app.platform.audio
const buffers = await Promise.all([
  audio.decode(await fetch('./assets/audio/sfx/shot_01.mp3').then(r => r.arrayBuffer())),
  audio.decode(await fetch('./assets/audio/sfx/shot_02.mp3').then(r => r.arrayBuffer())),
  audio.decode(await fetch('./assets/audio/sfx/shot_03.mp3').then(r => r.arrayBuffer())),
]);
audio.registerCue('rifle_shot', { variants: buffers, bus: 'spatial', hrtf: true, maxConcurrent: 4 });

// 3D 中每帧同步听者（相机）位置与朝向，产生真实左右耳方位感：
audio.updateListenerFromCamera(renderer.camera);
const shot = await audio.playCue('rifle_shot', { position: { x: -6, y: 1.5, z: 2 } });
shot?.setPosition({ x: -5, y: 1.5, z: 2 }); // 声音随物体移动
```
