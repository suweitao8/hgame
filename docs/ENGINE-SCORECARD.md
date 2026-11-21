# HGame 引擎评分机制（v3 · 真实端到端闭环标准）

**评分标准 v3（5 大维度 / 17 项能力 · 总分 100）：经 Phases 1–5 真链路闭环重构与 `1280×720` Chromium WebGL2 实测验证，HGame 最新实得分从 `60.7 / 100` 提升至 `73.6 / 100`，对照 Unity 6.6（6000.6.10f1）URP Web `88.5 / 100`（真实差距从 −27.8 收窄至 −14.9，诚实保留尚未补齐的工业级差距）。**

> 注：此前在 `17ea707` 给出过 `87.9 / 100` 的复评分数，但经逐行代码审计发现多项“写了模块/能编译但主路径仍在空转或用原型充数”的严重虚高（如 `P1 stepAsync` 主线程照跑、`S3 ConvolverNode` 无 Voice 输入、贴花仅平面 Quad、CSM 为 3 盏全亮度光叠加、`N1` 用 JSON diff）。v3 设立**第四条反虚高铁律**彻底杜绝账面自嗨。

> 编辑器可视化 GUI、发行商渠道 SDK、商店资产市场不在引擎运行时得分内（编辑器故意由 AI 声明式工作流替代），但**运行时直接支撑游戏开发的 5 大技术底座**全部纳入评分：架构与资产（18）、图形渲染（30）、性能与硬件（24）、核心运行时子系统（20）、多人与确定性网络（8）。

---

## v3 评分防虚高四大铁律（Hard Caps）

在 v2 的三项铁律之外，v3 新增最关键的第四条**端到端真链路铁律**：
1. **未接默认管线封顶 `<= 7 分`**：能力仅在独立 Helper 中，未进入 `Application` / `createThreeAdapter` / `createPostPipeline3D` / 默认 Profile 主路径，最高 `7 / 10`。
2. **仅 Node Mock 缺真机/高规模实证封顶 `<= 8 分`**：只有 `320×180` 最小冒烟测试、未经过复杂负载（千级实例/曲面接缝/真 WebGL2/Web Audio）验证，最高 `8 / 10`。
3. **关键工业特性缺失封顶**：缺核心能力（如深度重建投影贴花、骨骼缩放重定向/FABRIK、二进制增量包）不可按同档给分。
4. **“空壳挂载 / 假异步 / 无真实信号输入”零加分铁律**：创建了节点但无上游输入（如 `ConvolverNode` 没有 Voice Send）、`stepAsync` 仍主线程跑完算法、只触发距离回调但未切换实际纹理资源等情形，**按未实现计分，严禁加分**。

### 0–10 分分档说明

| 分数 | 工程含义 |
| ---: | --- |
| 0–2 | 缺失，或仅停留在原型片段，尚未接通主运行入口。 |
| 3–4 | 具备基础 API，但仅覆盖单一窄路径，常规游戏必须大量手写胶水代码。 |
| 5–6 | **可用级**：核心能力已跑通主路径并有单元测试，但缺少进阶生产特性或仅覆盖部分子场景。 |
| 7–8 | **生产可用级**：进阶能力完善且多路径对齐；受“未默认接线”或“仅 Node Mock 验证”封顶最高 `8`。 |
| 9–10 | **商业工业级**：默认主路径全链路打通、无显著功能短板，并在真机 WebGL2/WebGPU 环境经过渲染/性能实证。 |

---

## v2 逐项判定标准（17 项细则）

| 编号 | 评分项（权重） | 基础 6 分 | 进阶 7–8 分 | 工业级 9–10 分 |
| --- | --- | --- | --- | --- |
| A1 | 调度与生命周期（6） | 固定步、逐帧插值与场景切换入口齐全，所有者清理顺序明确。 | 可扩展阶段优先级与钩子；场景取消、异常归因与回滚有确定语义。 | 支持热点/长任务自动预算切片不丢帧，真机多场景频繁切换零泄漏与确定性时序验证。 |
| A2 | 渲染图与扩展管线（6） | 相机/视口可挂载自定义全屏或后处理阶段并隔离多视口状态。 | 声明纹理读写契约与目标复用，兼容回退路径明确。 | **全管线**（含几何、阴影、AO、GI、后处理）由同一 Render Graph 编译器按寿命自动分配别名并剔除死 Pass，支持 Render-Pass 分块与真机验证。 |
| A3 | 资产流送、压缩与驻留（6） | 运行时异步加载/释放模型、纹理、音频与缓存复用。 | 支持 Meshopt/KTX2 解码、请求取消全链路传播、引用驻留统计与按预算回收。 | 具备基于视距/Mip 的纹理渐进流送、Bundle 分包按需卸载、断网重试与真机显存硬上限守恒。 |
| R1 | 2D 渲染、光照与混排（6） | 精灵/图块/文字层级排序与混合裁剪正确，批处理可用。 | 支持多后端（Canvas2D/WebGL2D/Pixi）、2D 点光源/阴影遮挡/法线及画质保留策略。 | 具备 2D 实时全局照明近似、任意多边形/瓦片动态阴影与材质批合，且在真机浏览器经过端到端像素验证。 |
| R2 | 3D 光照、阴影与 GI（7） | PBR 材质、平行光级联/单张阴影、多实时光源可用。 | 具备软阴影（PCF/PCSS/贴图拟合）、聚簇多光源、SSGI/SSR 与多块流送烘焙 SH 探针。 | 稳定级联阴影防闪烁（CSM/PCSS）、全场景反射探针实时混合、多光影自适应缓存与 WebGL2/WebGPU 真机像素基准通过。 |
| R3 | 材质、Shader 组合与特效/贴花（6） | 内置 Standard/Toon 等材质与基础 3D 粒子/拖尾系统。 | 可自定义全屏/表面 Shader 注入、材质属性块、GPU 曲线粒子、3D 网格粒子与折射扭曲。 | 具备节点/声明式多变体统一材质管线、静态批/SRP-Batcher 等效常量缓冲合批与完整**贴花（Decals）/体积雾**及真机基准。 |
| R4 | 时间域抗锯齿、上采样与后处理（6） | 色调映射（ACES/AgX/Filmic）、Bloom、FXAA 与基础缩放可用。 | 支持多通道运动向量（刚体/实例/骨骼）、TAA 深度防重影、内部分辨率时间域上采样与自动曝光。 | 支持真机 GPU 时间基准下稳定 STP/FSR2 级亚像素重建、自适应锐化及透明/粒子边缘反应式防拖影。 |
| R5 | 几何、LOD 与大世界远景（5） | 网格与动画渲染、Meshopt 压缩与基础距裁剪可用。 | 支持分级 LOD 滞回、简化几何/Bone-VAT/Impostor、世界分块 HLOD 与浮动原点。 | 支持实时平滑 Crossfade Dither、流式网格流/虚拟几何集群LOD（或硬件实例化无缝切档）与大规模场景真机实测。 |
| P1 | 多线程与 CPU 仿真并行（6） | 确定性固定步更新、定长预算与密集场景 SoA 内存布局可用。 | 重负载支持可选 Worker 队列与确定性合并提交；寻路/AI 具备背压与取消。 | 默认将 Rapier 物理步进、复杂寻路、骨骼姿态与群体更新原生运行于 Worker/WASM 线程（带非跨源隔离回退），实机零主线程卡顿。 |
| P2 | GPU 驱动提交与 WebGPU 能力（7） | 基础合批、`InstancedMesh` 与脏区矩阵增量上传。 | 具备紧凑 16B 实例化、GPU 群体计算与可选 WebGPU 间接剔除脚本/WGSL 骨架。 | **默认主渲染器**在支持 WebGPU 时原生启用 Compute 视锥/Hi-Z 遮挡剔除与 `drawIndexedIndirect` + GPU 蒙皮合批（并在浏览器实证吞吐量）。 |
| P3 | 帧预算、PSO 暖机与内存治理（6） | 质量档切换、渲染分辨率缩放与空闲目标清理可用。 | 跨 2D/3D 的分类型预算控制器与基于帧耗时/内存信号的自适应降级。 | 具备**启动着色器/PSO 预编译暖机队列**防首帧卡顿、严格纹理/缓冲显存上限及真机 P95/P99 帧时间长稳验收。 |
| P4 | 跨后端真机性能剖析与诊断（5） | 可导出帧时间、绘制次数、实体/三角形计数与基础报错快照。 | 2D/3D 统一诊断结构、WebGL 上传字节统计、`timestamp-query` Pass 计时与来源标注。 | 内置可视化/headless 火焰图与 Allocator/GC 零分配审计，真机浏览器下持续 60s 压测产生真实 GPU/CPU/VRAM 回归基线。 |
| S1 | 物理、关节与空间查询（6） | Rapier 2D/3D 确定性刚体、基础碰撞体、Trigger 与射线检测。 | 角色控制器（坡度/台阶/防卡）、CCD 连续防穿透与重叠查询。 | 完整**约束与关节系统（Hinge/Spring/Fixed/Cone）、多形状扫掠（Sweep/Shapecast）**、物理材质合并与多层级碰撞矩阵/布娃娃联动。 |
| S2 | 骨骼动画、混合树与 IK（6） | 2D 帧序列播放与 3D `AnimationMixer` 剪辑播放、覆盖层与根运动裁剪。 | 克隆骨架独立播放、骨骼附件挂载与跨 LOD 动画时间/双层混合元信息交接。 | 原生**有限状态机 + 1D/2D Blend Tree、动画关键帧事件曲线、通用 Two-Bone/FABRIK IK 与惯性过渡（Inertialization）**。 |
| S3 | 空间音频与动态 DSP 混音（4） | 多总线音量控制、限幅器、3D HRTF/2D 声像与多变体Cue/0-KB 合成器。 | 支持快照淡入淡出、语音复音淘汰、遮挡衰减系数与程序化情绪自适应 BGM。 | 完整 Web Audio **DSP 效果链（卷积混响 IR/实时参数均衡/压缩/低通与环境声区混合）、真实多普勒频移及长音轨流式解码**。 |
| S4 | 运行时 UI、输入与无障碍底座（4） | 界面栈、虚拟列表、多端输入抽象（触控/键鼠/手柄）与国际化。 | 动效弹簧导演、红点系统、分屏聚焦框与 2D/3D 空间内嵌 UI 绑定器。 | 支持声明式 Flexbox/Grid 运行时布局引擎、SDF/MSDF 无损矢量文字渲染、动态按键重映射保存与屏幕阅读器/焦点无障碍完整支持。 |
| N1 | 联机传输、预测回滚与状态同步（8） | `network/` 房态与锁步/确认帧调度基础及确定性 RNG/校验和。 | 具备固定步回滚输入预测队列、环形状态快照槽位与重算状态钩子（`rollback-frames`）。 | **与运行时实体/物理原生打通的 Snapshot Delta 位压缩、客户端预测 + 服务端回溯纠偏（Server Rewind）、丢包内插缓冲区与真实弱网压测**。 |

---

## 当前主流引擎深度对照 · 2026-11-22（v3 Phases 1–5 闭环复评）

- **HGame（v3 复评 · `941e748`+）**：完成 Phases 1–5 端到端链路闭环，经 `npm run check:all`（`452` 项核心测试 + `network/`）与 `tests/browser-engine-v3-commercial-benchmark.mjs`（`1280×720` 无头 Chromium WebGL2 + 真 Web Audio DSP：`glError=0`、`csmIntensities=[2,0,0]`、`indirectDispatched=2000 -> indirectVisible=1000` `webgl2-multidraw`、`projDecalsRendered=1`、`warmupCompiled=5/warmupFailed=0`、`reactiveMeshCount=1`、`graphExec` 6 阶段全命中、`p50Ms=1.2ms`、`dspWiredZones=1`、`uiNonBlack=15988`、`uiButtonClicks=1`、`netDeltaErr=0`）实证。
- **HGame（`29a67c8` v3 初审基线）**：`60.7 / 100`（按逐项权重精确合计为 `60.3 / 100`，相对 Unity −27.8）。
- **Unity 6.6（6000.6.10f1）URP Web**：以官方 WebGL 2（默认）及 WebGPU 生产后端、SRP Batcher、APV、DBuffer Decals、CSM + Shadow Atlas、Mecanim（含 Humanoid Retargeting）、PhysX、AudioMixer DSP、UI Toolkit + TextMeshPro + Netcode 为据。

| 引擎 | A 架构 / 18 | R 渲染 / 30 | P 性能 / 24 | S 子系统 / 20 | N 联机 / 8 | 真实分 / 100 | 相对 Unity 6.6 差距 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **HGame**（`29a67c8` v3 基线） | **12.0** | **18.4** | **14.3** | **12.0** | **4.0** | **60.7** | **−27.8** |
| **HGame（Phases 1–5 复评）** | **13.5** | **22.3** | **16.9** | **14.9** | **6.0** | **73.6** | **−14.9** |
| **Unity 6.6 URP Web** | **16.2** | **27.0** | **20.8** | **17.7** | **6.8** | **88.5** | 基准（0.0） |

> 注：P 维度复评精确加权和为 `16.85`（总和 `73.55`，表内四舍五入展示 `16.9` 与 `73.6`）。

### 逐项能力客观评分与剩余真实缺口（v3 复评）

| 编号 | 项（权） | 基线 | 复评 | Unity 6.6 | 差距 | 已落地的真链路证明 & 诚实保留的工业缺口 |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| A1 | 调度与生命周期（6） | 7.5 | **7.5** | **9.0** | −0.90 | 固定步/phase hooks/取消语义扎实；仍缺异步叠加场景流式加载与序列化热重载。 |
| A2 | 渲染图与扩展管线（6） | 6.0 | **7.5** | **9.0** | −0.90 | **Phase 3 补齐**：`post3d/pipeline.js` 后处理主链改为 `compileRenderGraph` + `executeRenderGraph` 驱动并输出 6 阶段执行记录；Three.js 不透明/阴影几何 Pass 仍在图外（受铁律封顶，未给 9+）。 |
| A3 | 资产流送与驻留（6） | 6.5 | **7.5** | **9.0** | −0.90 | **Phase 4 补齐**：`bindTextureMipStreaming` 真切换 `texture.image`/各向异性过滤与 `needsUpdate`；缺大场景流式显存高压自动淘汰浏览器长稳实测。 |
| R1 | 2D 渲染、光照与混排（6） | 7.0 | **7.0** | **9.0** | −1.20 | 多后端+点光+多边形线段遮挡实用；遮挡线段硬上限 32 条，缺 2D 骨骼蒙皮/规则瓦片/自定义精灵 Shader。 |
| R2 | 3D 光照、阴影与 GI（7） | 5.5 | **8.0** | **9.0** | −0.70 | **Phase 3 补齐**：CSM 改为单亮主光 `[2,0,0]` + `1.08` 级联重叠 + `applyToMaterial` GLSL 分段采样，双反射探针接入 `injectBoxProjectedBlending` 盒投影混合；缺 PCSS 与烘焙 APV L2 探针体积工具链。 |
| R3 | 材质、Shader 与贴花（6） | 5.0 | **7.5** | **9.0** | −0.90 | **Phase 3 补齐**：`decal3d.js` 新增 GLSL3 `mode:'projected'` 深度重构屏幕空间 OBB 贴花并在球面实证投影；缺延迟 DBuffer 法线/粗糙度合批写入与等效 SRP Batcher 常量合批。 |
| R4 | TAA、上采样与后处理（6） | 6.5 | **7.5** | **9.0** | −0.90 | **Phase 3 补齐**：`pipeline.js` 为 `hgameReactive` 透明/粒子对象真实渲染 `reactiveMaskRT` 喂入 `temporalAa.resolve`；缺 STP/FSR2 级亚像素抖动高频植被 1080p 基准。 |
| R5 | 几何、LOD 与大世界远景（5） | 7.0 | **7.0** | **9.0** | −1.00 | Bone-VAT 16B 群体领先；缺运行时静态简化/Dither 自动驱动与 PVS/GPU 植被系统。 |
| P1 | 多线程与 CPU 仿真并行（6） | 4.5 | **6.5** | **7.5** | −0.60 | **Phase 1 补齐**：`worker-sim.js` 实现真 `'flow-field'` 与 `'swarm-separate'` 核，`SwarmSimulation.stepAsync` 异步卸载并跳过主线程重复计算；Rapier WASM 与 NavMesh A* 仍跑在主线程。 |
| P2 | GPU 驱动提交与 WebGPU（7） | 5.0 | **7.5** | **9.0** | −1.05 | **Phase 4 补齐**：`createIndirectInstancedBatch3D` 实现真视锥裁剪压缩并提交 `THREE.InstancedMesh`（2000 裁剪至 1000 可见）；仍缺真实 Chromium Dawn WebGPU Compute/Hi-Z CI 验收。 |
| P3 | 帧预算、PSO 与内存（6） | 7.0 | **7.0** | **8.5** | −0.90 | `shaderWarmup`（5 编译/0 失败）与预算控帧经过 `1280×720` 验证；缺 IndexedDB 着色器持久化缓存与显存硬观测。 |
| P4 | 跨后端性能剖析（5） | 7.0 | **7.0** | **9.0** | −1.00 | Chrome Trace（175 事件）与 P50/P95 经过 `1280×720` 实测；缺可视化实时 Profiler 与 GC 分配采样。 |
| S1 | 物理与空间查询（6） | 7.0 | **7.0** | **9.0** | −1.20 | 确定性 Rapier 2D/3D + 关节/Cast/Overlap/分层矩阵扎实；缺布料、载具、Featherstone 与凹面拆分。 |
| S2 | 骨骼动画、混合树与 IK（6） | 5.5 | **7.5** | **9.5** | −1.20 | **Phase 4 补齐**：新增多骨骼 `solveFabrikIK`（含极向量）、`extractRootMotion`、`blendMorphTargets`，并在 `1280×720` 真 `SkinnedMesh` 上实测通过；缺 Humanoid 骨骼重定向与惯性混合。 |
| S3 | 空间音频与动态 DSP（4） | 6.0 | **8.0** | **8.5** | −0.20 | **Phase 1 补齐**：打通 `voice -> reverbSendGain -> ConvolverNode -> busTarget` 真实混响链（支持解锁后自动重连）与 3 段参数 EQ；缺动态压限器侧链与可编程 DSP 插件图。 |
| S4 | 运行时 UI、输入与无障碍（4） | 6.0 | **7.5** | **9.0** | −0.60 | **Phase 4 补齐**：新增 `createCanvasUiRenderer`，真正基于 Flexbox 布局渲染轮廓字/滑条/进度条/裁剪滚动列表并响应点击；缺预烘焙多通道 MSDF 位图字集与富文本输入控件。 |
| N1 | 联机、预测与状态同步（8） | 5.0 | **7.5** | **8.5** | −0.80 | **Phase 2 补齐**：以递归 `valuesEqual` 替代 JSON diff，新增 `0x48 0x47` 量化定点数二进制增量包编解码（体积 <25% JSON）及 `createSceneReplicator` 在 15% 丢包+抖动下零误差收敛；缺 WebRTC 不可靠 DataChannel 与大规模空间 AOI 兴趣剪裁。 |

---

## v3 商业级对齐演进记录（Phases 1–5 已落地）

按审计暴露的核心缺口已完成 Phases 1–5 端到端链路闭环（仍按第四条铁律保留真缺口不注水）：
1. **Phase 1（`2c98dfb` · S3 / P1）**：打通 `voice -> reverbSendGain -> ConvolverNode -> busTarget` 真实音频混响链 + 3 段参数 EQ（`platform/audio/`）；`worker-sim.js` 实现真实 `'flow-field'` 与 `'swarm-separate'` 核并在 `SwarmSimulation.stepAsync` 跳过主线程重复计算。
2. **Phase 2（`2962c14` · N1）**：以递归 `valuesEqual` 取代 JSON diff，实现 `0x48 0x47` 二进制 Delta 编解码（`encodeDeltaBinary`/`decodeDeltaBinary`）与 `createSceneReplicator`（`lockstep/state-sync.js`），通过 15% 丢包+抖动收敛测试。
3. **Phase 3（`0f8af62` · R3 / R2 / R4 / A2）**：实现 GLSL3 深度重建屏幕空间 OBB 投影贴花（`decal3d.js`）；修复 CSM 多光叠加为单亮主光 + `csm.applyToMaterial` 级联 GLSL 采样（`shadow3d.js`）及双探针盒投影混合（`lighting3d.js`）；实现 `reactiveMaskRT` 与 `executeRenderGraph` 驱动后处理（`post3d/pipeline.js`）。
4. **Phase 4（`10b4e8f` · P2 / S2 / S4 / A3）**：实现 `createIndirectInstancedBatch3D` 真实视锥裁剪矩阵压缩提交（`gpu-indirect3d.js`）；实现 `solveFabrikIK` + `extractRootMotion` + `blendMorphTargets`（`animation/animator3d.js`）；实现原生 `createCanvasUiRenderer`（`ui/canvas-widgets.js`）；实现 `bindTextureMipStreaming` 真实纹理与 Mip 切换绑定（`platform/asset-catalog.js`）。
5. **Phase 5（`941e748` · `1280×720` 商业级真机基准）**：交付 `tests/browser-engine-v3-commercial-benchmark.mjs`（真 `SkinnedMesh` + Morph + FABRIK、`2000 -> 1000` 间接裁剪实例、曲面深度投影贴花、CSM `[2,0,0]`、Reactive TAA、Render Graph、Web Audio DSP、Canvas Flexbox UI 与 15% 丢包联机实测），并修复 `adapter.getCascadedShadowMap(scene)` 延迟创建与销毁保护（`integrations/three.js`）。
6. **Phase 6（本档复评）**：实测得分从 `60.7 / 100` 升至 **`73.6 / 100`**（vs Unity 6.6 URP Web `88.5 / 100`）；后续若继续缩小 `−14.9` 差距，重点攻克主线程 Rapier/A* Worker 化、WebGPU Compute/Hi-Z 实机 CI、Humanoid Retargeting、SRP 等效静态合批与 WebRTC 不可靠通道。

### HGame 相比 Unity Web 的真实优势（不妄自菲薄）

即便在通用商业对齐标准下现分为 `73.6` vs `88.5`（差距 `−14.9`），HGame 在 **HTML5 / AI-Native 轻量游戏场景** 中拥有 Unity 6.6 Web 难以比拟的结构优势（不计入通用底座加分，但决定了选型优势）：
1. **极轻首包与秒开冷启动**：纯 ESM 运行时零重型 20–50MB Mono/.NET/Unity WASM 运行时开销（仅物理开启时加载 pinned Rapier WASM），对微信/B站小游戏及广告落地页更友好。
2. **十万级同屏群体与轻量 VAT**：`FlatCombatECS` + `createGpuSwarmWebGL2` + 16B `Bone-VAT` 方案针对割草/群战高度特化，比 Unity WebGL 默认 GameObject/SkinnedMesh 方案开销低数个量级。
3. **跨前后端确定性物理与 AI 原生验收流**：双端同源确定性 Rapier 0.21.0 + `scripts/accept.mjs` / `snapshot.mjs` / `autoplay` 零 GUI 全文本 AI 自测闭环，是 AI Agent 独立造游最高效的生产力底座。

---

## 历史版本演进归档（v1 口径 · 仅供参考对比）

> 注：以下为 2026-11-19 ~ 2026-11-21 采用 v1（11 项窄范围、无真机与子系统封顶规则）时的历史评分轨迹，完整代码与提交已留档，后续不再按 v1 口径新增评分：
> - **v1 基线（2026-11-19 · `ead9005`）**：`73.8 / 100`（A `17.4/25` + P `30.4/40` + R `26.0/35`）。
> - **v1 复评一（2026-11-21 · `8f126d9`）**：`90.0 / 100`（A `22.5/25` + P `36.0/40` + R `31.5/35`，对应 `A1..R4` 均达到 9/10）。
> - **v1 复评二（2026-11-21 · `8d3d6b9`）**：`100.0 / 100`（A `25.0/25` + P `40.0/40` + R `35.0/35`；提交 `9a2a2bc`、`12ef0c0`、`8d3d6b9` 补齐阶段归因、Render Graph API、glTF 依赖取消、`createSimWorkerRunner`、`createGpuIndirectCuller3D`、2D 预算/诊断、2D 遮挡阴影/法线质量档、流送 SH 探针、骨骼 TAA 与时间域上采样、`aCrowdY` 与 `createRepresentationBudget3D`）。
