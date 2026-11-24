# HGame 评分明细（v5.2 · 2026-11-24）

总分 **87.3 / 100**；对比 Unity 80.0、Cocos 71.3、Godot 64.6。

> 计分：条目得分点数 = 权重 × 条目分 / 10。HGame 条目分上限 = min(证据等级上限, 默认路径? 8 + 2×清单满足数/适用数 : 7)。竞品分为定性评估，见 `competitorBasis`。

## 维度分

| 维度 | 得分/权重 | 得分率 | Unity | Cocos | Godot |
| --- | ---: | ---: | ---: | ---: | ---: |
| A 架构与资产 | 16.2/18 | 90.0% | 90.0% | 81.7% | 66.7% |
| R 图形渲染 | 25.9/30 | 86.2% | 82.2% | 78.2% | 65.0% |
| P 性能与硬件 | 20.5/24 | 85.2% | 73.1% | 66.0% | 52.9% |
| S 核心运行时子系统 | 17.6/20 | 88.0% | 80.0% | 72.5% | 76.0% |
| N 多人与确定性网络 | 7.2/8 | 90.0% | 70.0% | 35.0% | 65.0% |

## 逐项明细（按丢分从多到少）

### P1 多线程与 CPU 仿真并行（权重 6）— 8.0/10，丢 1.20 分
- **为什么是这个分**：证据 C3（C2 + 工业级清单部分满足，上限 9）；清单 2/3 满足；默认路径 是；理论上限 9.0。worker-sim.js 异步卸载流场/NavMesh 寻路，worker-physics.js 在无 COOP/COEP 依赖下实现 Rapier Worker 步进与确定性 inline 回退。
- **对比**：Unity 5.5（+2.5）、Cocos 5.0、Godot 6.0。
- **证据**：assets/runtime/sim/worker-sim.js，assets/runtime/world/swarm-ecs.js，assets/runtime/physics/worker-physics.js；基准 tests/browser-worker-physics.mjs
- **如何改进**：补齐清单「骨骼姿态更新原生多线程并行」（现状：暂缓（animator3d.js 在主线程计算骨骼姿态；按精简清单挂起））；短板：暂缓：骨骼姿态多线程挂起，当前仍在主线程计算。

### A1 调度与生命周期（权重 6）— 8.5/10，丢 0.90 分
- **为什么是这个分**：证据 C3（C2 + 工业级清单部分满足，上限 9）；清单 2/3 满足；默认路径 是；理论上限 9.0。已实现固定步插值、mountAdditive/unmountAdditive 子场景及 SceneManager.hotReload 原子回滚控制，并在浏览器完成多场景切换零泄漏与 60s 压测。
- **对比**：Unity 9.0（-0.5）、Cocos 8.0、Godot 8.5。
- **证据**：assets/runtime/core/application.js，assets/runtime/core/scene.js；基准 tests/browser-engine-v3-commercial-benchmark.mjs
- **如何改进**：补齐清单「热点/长任务自动预算切片不丢帧」（现状：暂缓（work-budget.js 仅提供手动时间片助手，Application 未自动切片；按精简清单挂起））；短板：暂缓：Application 级长任务自动预算切片挂起。

### A3 资产流送、压缩与驻留（权重 6）— 8.5/10，丢 0.90 分
- **为什么是这个分**：证据 C3（C2 + 工业级清单部分满足，上限 9）；清单 3/3 满足，豁免 1；默认路径 是；理论上限 9.0。支持运行时 KTX2 解码、Mip 渐进流送、VRAM 守卫、50MB 配额审计、P0/P1/P2 渐进启动及远程 Bundle 分包/SHA-256 校验与指数退避重试（remote-bundle.js）。
- **对比**：Unity 9.0（-0.5）、Cocos 8.5、Godot 6.5。
- **证据**：assets/runtime/integrations/ktx2.js，assets/runtime/platform/asset-catalog.js，assets/runtime/platform/remote-bundle.js；基准 tests/browser-engine-v3-commercial-benchmark.mjs
- **如何改进**：清单已全满足，升到 C4 需有独立实测基准或真机数据证明（上限 10）

### R1 2D 渲染、光照与混排（权重 6）— 8.5/10，丢 0.90 分
- **为什么是这个分**：证据 C3（C2 + 工业级清单部分满足，上限 9）；清单 3/3 满足，豁免 1；默认路径 是；理论上限 9.0。具备 Canvas2D/WebGL2D 多后端、AutoTile、128 条 2D 遮挡阴影与自研 Skeleton2D（FK + 2-Bone IK）。
- **对比**：Unity 8.0（+0.5）、Cocos 9.0、Godot 9.0。
- **证据**：assets/runtime/integrations/canvas2d.js，assets/runtime/integrations/webgl2d.js，assets/runtime/integrations/post2d.js，assets/runtime/animation/skeleton2d.js；基准 tests/browser-mobile-portrait-benchmark.mjs
- **如何改进**：清单已全满足，升到 C4 需有独立实测基准或真机数据证明（上限 10）

### R3 材质、Shader 与贴花（权重 6）— 8.5/10，丢 0.90 分
- **为什么是这个分**：证据 C3（C2 + 工业级清单部分满足，上限 9）；清单 4/4 满足；默认路径 是；理论上限 9.0。支持 defineMaterialVariants3D 声明式 Keyword 多变体与 customProgramCacheKey 复用/预热、WebGL2 std140 UBO 批合、GLSL3 深度重建 OBB 投影贴花与高度/体积雾。
- **对比**：Unity 8.5（+0.0）、Cocos 8.0、Godot 6.5。
- **证据**：assets/runtime/integrations/decal3d.js，assets/runtime/integrations/material-graph3d.js，assets/runtime/integrations/three.js；基准 tests/browser-engine-v3-commercial-benchmark.mjs
- **如何改进**：清单已全满足，升到 C4 需有独立实测基准或真机数据证明（上限 10）；短板：WebGL2 侧为按需编译与 ProgramCacheKey 复用，尚无离线 Shader 变体预剥离管线

### R4 TAA、上采样与后处理（权重 6）— 8.5/10，丢 0.90 分
- **为什么是这个分**：证据 C3（C2 + 工业级清单部分满足，上限 9）；清单 3/3 满足，豁免 1；默认路径 是；理论上限 9.0。具备 5-tap FSR1 RCAS 锐化、reactiveMaskRT TAA、LUT/高度雾及可扩展 GLSL3 全屏 HDR 后处理管线，桌面零 GL 报错。
- **对比**：Unity 8.0（+0.5）、Cocos 7.5、Godot 5.0。
- **证据**：assets/runtime/integrations/post3d/pipeline.js，assets/runtime/integrations/post3d/temporal-aa.js，assets/runtime/integrations/post3d/shaders.js；基准 tests/browser-mobile-portrait-benchmark.mjs，tests/browser-engine-v3-commercial-benchmark.mjs
- **如何改进**：清单已全满足，升到 C4 需有独立实测基准或真机数据证明（上限 10）

### P3 帧预算、PSO 暖机与内存治理（权重 6）— 8.5/10，丢 0.90 分
- **为什么是这个分**：证据 C3（C2 + 工业级清单部分满足，上限 9）；清单 3/3 满足，豁免 1；默认路径 是；理论上限 9.0。mobilePortrait 模式一键接通 DPR 封顶、DRS 动态分辨率、VRAM 守卫与分帧 Warmup，并在浏览器通过 60s 压测。
- **对比**：Unity 7.5（+1.0）、Cocos 8.0、Godot 5.5。
- **证据**：assets/runtime/integrations/three.js，assets/runtime/integrations/quality3d.js，assets/runtime/platform/asset-catalog.js；基准 tests/browser-mobile-portrait-benchmark.mjs
- **如何改进**：清单已全满足，升到 C4 需有独立实测基准或真机数据证明（上限 10）

### S1 物理、关节与空间查询（权重 6）— 8.5/10，丢 0.90 分
- **为什么是这个分**：证据 C3（C2 + 工业级清单部分满足，上限 9）；清单 3/3 满足，豁免 2；默认路径 是；理论上限 9.0。前后端同源 pinned Rapier 0.21.0 2D/3D 确定性刚体、5 类关节、Sweep/Overlap 与 16 层碰撞矩阵。
- **对比**：Unity 8.5（+0.0）、Cocos 7.5、Godot 7.5。
- **证据**：assets/runtime/physics/rapier-world.js，assets/runtime/physics/rapier3d.js；基准 tests/deterministic-physics.test.mjs，tests/physics-joints-and-queries.test.mjs，tests/browser-worker-physics.mjs
- **如何改进**：清单已全满足，升到 C4 需有独立实测基准或真机数据证明（上限 10）

### S2 骨骼动画、混合树与 IK（权重 6）— 8.5/10，丢 0.90 分
- **为什么是这个分**：证据 C3（C2 + 工业级清单部分满足，上限 9）；清单 3/3 满足，豁免 1；默认路径 是；理论上限 9.0。支持状态机、1D/2D 混合树、Two-Bone/LookAt/FABRIK IK、RootMotion、MorphTarget、SpringBone、惯性过渡及跨骨架动画重定向（retarget3d.js）。
- **对比**：Unity 9.5（-1.0）、Cocos 8.0、Godot 8.5。
- **证据**：assets/runtime/animation/animator3d.js，assets/runtime/animation/retarget3d.js；基准 tests/browser-engine-v3-commercial-benchmark.mjs
- **如何改进**：清单已全满足，升到 C4 需有独立实测基准或真机数据证明（上限 10）

### N1 联机传输、预测回滚与状态同步（权重 8）— 9.0/10，丢 0.80 分
- **为什么是这个分**：证据 C3（C2 + 工业级清单部分满足，上限 9）；清单 4/4 满足；默认路径 是；理论上限 9.0。0x48 0x47 二进制 Delta 同步、createSceneReplicator 回滚预测、服务端 AOI 过滤，以及 WebRTC DataChannel 双通道（ordered:false/maxRetransmits:0 不可靠低延迟 + ordered:true 可靠控制 + WebSocket 透明降级）已全量闭环。
- **对比**：Unity 7.0（+2.0）、Cocos 3.5、Godot 6.5。
- **证据**：assets/runtime/lockstep/state-sync.js，assets/runtime/lockstep/webrtc-transport.js，network/；基准 tests/browser-engine-v3-commercial-benchmark.mjs
- **如何改进**：清单已全满足，升到 C4 需有独立实测基准或真机数据证明（上限 10）；短板：WebRTC DataChannel 传输适配器已提供双通道与信令抽象，服务端需按部署环境配置 TURN 中继以覆盖对称 NAT

### R5 几何、LOD 与大世界远景（权重 5）— 8.5/10，丢 0.75 分
- **为什么是这个分**：证据 C3（C2 + 工业级清单部分满足，上限 9）；清单 3/4 满足；默认路径 是；理论上限 9.0。提供 16B Bone-VAT 万级群体、静态合批（24->1）、Int8/Uint16 顶点量化（实测省 21.27%）、Hi-Z 与浮动原点。
- **对比**：Unity 8.0（+0.5）、Cocos 7.0、Godot 6.0。
- **证据**：assets/runtime/integrations/culling3d.js，assets/runtime/integrations/model3d.js；基准 tests/browser-mobile-portrait-benchmark.mjs
- **如何改进**：补齐清单「全材质统一平滑 Crossfade Dither LOD 过渡」（现状：暂缓（仅滞回切档与代理切换，缺统一 Dither Crossfade；按精简清单挂起，等实际画面出现跳变再评估））；短板：暂缓：全材质统一的平滑 Crossfade Dither LOD 过渡挂起，等实际画面出现跳变再评估。

### P4 跨后端真机性能剖析与诊断（权重 5）— 8.5/10，丢 0.75 分
- **为什么是这个分**：证据 C3（C2 + 工业级清单部分满足，上限 9）；清单 3/3 满足，豁免 1；默认路径 是；理论上限 9.0。具备 Chrome Trace、LiveProfilerOverlay、Zero-GC 门禁及 GPU 资源快照 Diff 泄漏检测。
- **对比**：Unity 9.0（-0.5）、Cocos 7.0、Godot 6.0。
- **证据**：assets/runtime/integrations/quality3d/render-diagnostics.js，assets/runtime/sim/zero-gc-audit.js；基准 tests/browser-mobile-portrait-benchmark.mjs
- **如何改进**：清单已全满足，升到 C4 需有独立实测基准或真机数据证明（上限 10）

### R2 3D 光照、阴影与 GI（权重 7）— 9.0/10，丢 0.70 分
- **为什么是这个分**：证据 C4（工业级清单全部满足，上限 10）；清单 4/4 满足；默认路径 是；理论上限 10.0。已打通 CSM/PCSS、Shadow Atlas、双探针 SH 混合、实时 SSGI/SSR，以及内置 UV2 展开与 WebGL2 GPU 太阳/点光/聚光+半球 AO+1-bounce 漫反射间接光溢色+多轮接缝膨胀 Lightmap 烘焙管线。
- **对比**：Unity 8.5（+0.5）、Cocos 7.5、Godot 6.0。
- **证据**：assets/runtime/integrations/shadow3d.js，assets/runtime/integrations/lighting3d.js，assets/runtime/integrations/post3d/pipeline.js，assets/runtime/integrations/lightmap-bake3d.js；基准 tests/browser-engine-v3-commercial-benchmark.mjs，tests/browser-lightmap-bake.mjs
- **如何改进**：短板：当前为 1-bounce 漫反射间接光烘焙，暂缺多反弹路径追踪与实时动态光照贴图混合

### P2 GPU 驱动提交与 WebGPU 能力（权重 7）— 9.0/10，丢 0.70 分
- **为什么是这个分**：证据 C3（C2 + 工业级清单部分满足，上限 9）；清单 3/3 满足，豁免 1；默认路径 是；理论上限 9.0。注册间接实例批次后，Three 适配器可读取 WebGPU 异步剔除结果。相机运动预测覆盖近远裁剪面，旧结果失效时按当前视锥在 CPU 剔除。RTX 4070 上的 36 帧转动和急转测试复用了 GPU 结果，未观察到可见实例遗漏。
- **对比**：Unity 7.5（+1.5）、Cocos 6.5、Godot 4.0。
- **证据**：assets/runtime/integrations/gpu-indirect3d.js，assets/runtime/integrations/three.js；基准 tests/browser-webgpu-compute-benchmark.mjs，tests/browser-adapter-gpu-cull.mjs，tests/gpu-cull-lag-guard.test.mjs
- **如何改进**：清单已全满足，升到 C4 需有独立实测基准或真机数据证明（上限 10）；短板：GPU 回读为异步。相机急转、非刚体视图变化及批次包围体变化时，使用当前视锥在 CPU 剔除。移动 GPU 吞吐仍待实测。

### S4 运行时 UI、输入与无障碍底座（权重 4）— 9.0/10，丢 0.40 分
- **为什么是这个分**：证据 C3（C2 + 工业级清单部分满足，上限 9）；清单 4/4 满足，豁免 1；默认路径 是；理论上限 9.0。具备 Canvas 富文本、滚动裁剪、IME、稳定的 ARIA 镜像和动态重映射持久化。Chromium 已验证镜像更新与重排保留原生焦点，以及动作菜单的选中卡与手柄确认一致。
- **对比**：Unity 8.0（+1.0）、Cocos 8.5、Godot 8.5。
- **证据**：assets/runtime/ui/canvas-widgets.js，assets/runtime/ui/thumb-arc.js，assets/runtime/kit/game-shell-dom.js，assets/runtime/platform/input/router.js，assets/runtime/ui/flex-layout.js；基准 tests/browser-mobile-portrait-benchmark.mjs，tests/browser-ui-s4.mjs，tests/browser-api-recipes.mjs
- **如何改进**：清单已全满足，升到 C4 需有独立实测基准或真机数据证明（上限 10）；短板：DOM 与 Canvas 焦点同步已通过 Chromium 验证；真实屏幕阅读器和移动浏览器仍待验收。

### S3 空间音频与动态 DSP 混音（权重 4）— 9.5/10，丢 0.20 分
- **为什么是这个分**：证据 C4（工业级清单全部满足，上限 10）；清单 4/4 满足，豁免 1；默认路径 是；理论上限 10.0。原生 Web Audio 真实混响发送链（ConvolverNode）、3 段参数 EQ、采样级 duckBus 包络与 0-KB 合成器。长 BGM 与 URL 语音变体通过媒体元素进入现有混音总线。
- **对比**：Unity 5.0（+4.5）、Cocos 4.5、Godot 5.5。
- **证据**：assets/runtime/platform/audio.js，assets/runtime/platform/audio/voice.js，assets/runtime/platform/audio/bgm-player.js；基准 tests/browser-bgm-streaming.mjs，tests/browser-voice-streaming.mjs，tests/browser-engine-v3-commercial-benchmark.mjs
- **如何改进**：短板：长 BGM 和语音流送已通过 Chromium 实测。移动 Safari、Android 和 Toy 宿主仍待真机覆盖。

### A2 渲染图与扩展管线（权重 6）— 10.0/10，丢 0.00 分
- **为什么是这个分**：证据 C4（工业级清单全部满足，上限 10）；清单 4/4 满足；默认路径 是；理论上限 10.0。createThreeAdapter 默认启用 renderGraph=true。主场景色彩与深度、投影贴花合成、AO/GI/SSR、完整 Bloom 金字塔和 LDR 中间目标使用物理资源池。RTX 4070 上，1080p 场景交替切换内部渲染比例时，7 次绘制使用的主场景目标从 7 套降至 2 套。4× MSAA 与半分辨率 TAA 同时开启时，投影贴花仍正确进入最终画面。
- **对比**：Unity 9.0（+1.0）、Cocos 8.0、Godot 5.0。
- **证据**：assets/runtime/integrations/post3d/render-graph.js，assets/runtime/integrations/post3d/pipeline.js，assets/runtime/integrations/three.js；基准 tests/browser-bloom-pool.mjs，tests/browser-fullscreen-shader-pass.mjs，tests/browser-packages.mjs，tests/browser-mobile-portrait-benchmark.mjs，tests/browser-engine-v3-commercial-benchmark.mjs
- **如何改进**：短板：默认 HDR 渲染图已覆盖清单全部路径。禁用 HDR 或缺少可采样深度时，使用表面贴花。

