# HGame 引擎评分机制（v2 · 全栈对照与防虚高标准）

**评分标准 v2（5 大维度 / 17 项能力 · 总分 100）：当前 HGame `65950a6` 实得分 `67.0 / 100`，对照 Unity 6.6 URP Web `87.5 / 100`（差距 −20.5）、Godot 4.7.2 Web `76.7 / 100`（差距 −9.7）。**

本页评估 HGame **浏览器可运行游戏引擎底座**的工程深度与生态完整性，不再仅局限于“是否有某个独立工具函数或单元测试”。v1 标准（11 项，已归档至文末）曾因覆盖面过窄与缺少封顶约束而在 `8d3d6b9` 给出过 **100.0 / 100** 的乐观满分；v2 将标准拉回真实商业 Web 引擎坐标系，重点面向 **Unity 6.6（6000.6.10f1）URP Web** 与 **Godot 4.7.2 Web** 做横向对标与缺陷曝光。

> 编辑器可视化 GUI、发行商渠道 SDK、商店资产市场不在引擎运行时得分内（编辑器故意由 AI 声明式工作流替代），但**运行时直接支撑游戏开发的 5 大技术底座**全部纳入评分：架构与资产（18）、图形渲染（30）、性能与硬件（24）、核心运行时子系统（20）、多人与确定性网络（8）。

---

## 为什么 v2 取代 v1（v1 的 4 大盲区复盘）

1. **子系统覆盖不全**：v1 只看调度、渲染与帧诊断 11 项，完全漏评**物理约束与查询深度**（关节/Ragdoll/Sweep）、**骨骼动画系统**（Blend Tree/IK/Root Motion）、**音频 DSP 管线**（混响/滤波器/多普勒/长音频流式解码）、**Shader 材质组合生态**（Node/Surface Graph、Decal 贴花、SRP-Batcher 等效合批）以及**联网状态同步/预测协调**。
2. **“独立 Helper + 单元测试通过” ≠ “默认主渲染/运行路径已打通”**：例如 v1 中 `gpu-indirect3d.js` 虽实现 WGSL/MultiDraw 剔除接口，但尚未接入默认 `createThreeAdapter` 主绘制；`render-graph.js` 仅串联自定义 HDR Pass，内置阴影/AO/Bloom 仍由 `pipeline.js` 硬编码调度；`worker-sim.js` 尚未接入默认 Rapier 物理或 `SwarmSimulation`。
3. **缺少真机实测门禁与性能下限封顶**：v1 多数高级项仅靠 Node.js Mock 断言通过（未测量浏览器真实 WebGL2/WebGPU 帧时间 P95/P99、PSO 着色器首次编译卡顿、峰值显存/VRAM 驻留与渲染画面截图对比）。
4. **对 Unity / Godot 判定不对称**：v1 把 Unity WebGL/WebGPU 多项成熟能力标为 `?` 扣分，却对 HGame 的新写单测直接给满格 `✓`。v2 要求**同口径、同严度**评判。

---

## v2 评分规则与防虚高约束（Hard Caps）

1. **5 大维度与权重（总计 100 分）**：
   - **A · 架构与资产底座（18 分）**：`A1` 调度与生命周期（6）、`A2` 渲染图与可扩展管线（6）、`A3` 资产流送、压缩与驻留治理（6）
   - **R · 图形渲染与视觉管线（30 分）**：`R1` 2D 渲染、光照与混排（6）、`R2` 3D 光照、阴影与 GI（7）、`R3` 材质、Shader 组合与粒子/贴花（6）、`R4` 时间域抗锯齿、上采样与后处理（6）、`R5` 几何、LOD 与大世界远景（5）
   - **P · 性能架构与硬件利用（24 分）**：`P1` 多线程与 CPU 仿真并行（6）、`P2` GPU 驱动提交与 WebGPU 能力（7）、`P3` 帧预算、PSO 暖机与内存治理（6）、`P4` 跨后端真机性能剖析与诊断（5）
   - **S · 核心运行时子系统（20 分）**：`S1` 物理、关节与空间查询（6）、`S2` 骨骼动画、混合树与 IK（6）、`S3` 空间音频与动态 DSP 混音（4）、`S4` 运行时 UI、输入与无障碍底座（4）
   - **N · 联机与确定性底座（8 分）**：`N1` 联机传输、预测回滚与状态同步底座（8）
2. **三项防虚高封顶铁律（违反任一条即触发硬封顶）**：
   - **未接默认管线封顶 `<= 7 分`**：能力仅存在于独立工具模块、未接入 `Application` / `createThreeAdapter` / `createPostPipeline3D` / 默认 Profile 主循环并默认可用时，该项最高 `7 / 10`。
   - **仅 Mock 单测、缺浏览器真机实测封顶 `<= 8 分`**：无真机 WebGL2/WebGPU 像素对比、真实 GPU 时间或真机基准数据支撑时，最高 `8 / 10`（只有经真实 WebGPU/WebGL2 浏览器闭环验证的成熟管线才可进入 `9–10`）。
   - **关键子能力结构性缺失封顶**：若某项内的核心工业特性明显缺失（例如动画系统无 2D 混合树/IK/状态机、物理缺少关节/Sweep 投射、音频缺动态环境混响与流式 Ogg/Opus、3D 缺少 Shader/Material 统一抽象与贴花/SSAO-WebGPU 并行提交），最高不超过对应档位（见单表判定）。
3. **计分公式**：`加权分 = 单项分 × 权重 ÷ 10`；`总分 = 17 项加权分之和`；`对 Unity 差距贡献 = (Unity 单项分 − HGame 单项分) × 权重 ÷ 10`（正值表示 HGame 落后的权重分）。

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

## 当前主流引擎深度对照 · 2026-11-21（v2 口径）

- **HGame**：评估基准 `65950a6`，逐模块审查 [assets/runtime/](../assets/runtime/)（Canvas2D / WebGL2D / Pixi / Three WebGL2 / Rapier 0.21.0 / `network/`）。
- **Unity 6.6（6000.6.10f1）URP Web**：以官方 WebGL 2（默认）及 WebGPU 可选生产后端、SRP Batcher、APV、STP/TAA、Shader Graph、Physics/PhysX、Mecanim Animator、AudioMixer/DSP、Netcode for GameObjects/Entities + Input System 为据。
- **Godot 4.7.2 Web**：以 Wasm + WebGL 2 Compatibility 导出为主基准（注明 Multithreading 跨源隔离与 Compatibility 特性限制），评估 SceneTree、MultiMesh、LightmapGI、AnimationTree、AudioEffect、ENet/WebRTC MultiplayerSynchronizer。

| 引擎 | A 架构 / 18 | R 渲染 / 30 | P 性能 / 24 | S 子系统 / 20 | N 联机 / 8 | 真实分 / 100 | 相对 Unity 6.6 差距 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **HGame** (`65950a6`) | 13.8 | 21.5 | 15.5 | 11.4 | 4.8 | **67.0** | **−20.5** |
| **Godot 4.7.2 Web** | 13.2 | 23.3 | 16.8 | 17.0 | 6.4 | **76.7** | **−10.8** |
| **Unity 6.6 URP Web** | 16.2 | 27.0 | 19.9 | 18.0 | 6.4 | **87.5** | 基准（0.0） |

### 逐项能力对比、证据与缺陷定位

| 编号 | 项（权） | HGame | Unity 6.6 | Godot 4.7.2 | 相对 Unity 差距 | HGame 现状证据与结构性缺陷（为什么扣分） | Unity 6.6 对比与可借鉴点 |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| A1 | 调度与生命周期（6） | **8** | **9** | **8** | +0.6 | [application.js](../assets/runtime/core/application.js) 拥有固定步、phase hooks、阶段归因与场景取消。**不足**：缺少重负载自动预算分片调度集成与浏览器真机长稳切换基准，依规则封顶 8。 | Unity PlayerLoop 支持显式插入系统，Editor/Profiler 可追踪每帧执行与协程生命周期。 |
| A2 | 渲染图与扩展管线（6） | **7** | **9** | **6** | +1.2 | [render-graph.js](../assets/runtime/integrations/post3d/render-graph.js) 仅编排自定义 HDR Pass，而 [pipeline.js](../assets/runtime/integrations/post3d/pipeline.js) 中的阴影、AO、GI、Bloom 仍为固定控制流硬编码。依**未全管线默认接入**原则封顶 7。 | Unity 6 URP 默认全面启用 Render Graph（Raster/Compute/Unsafe Pass 统一追踪、死 Pass 自动剔除、RenderPass 合并）。 |
| A3 | 资产流送、压缩与驻留（6） | **8** | **9** | **8** | +0.6 | [asset-catalog.js](../assets/runtime/platform/asset-catalog.js) 与 [model-loader.js](../assets/profiles/3d/model-loader.js) 支持 KTX2/Meshopt、取消传播及驻留统计。**不足**：缺纹理按距离/Mipmap 渐进流送，缺真机显存压测验证，封顶 8。 | Unity Web 支持 Addressables 异步包体、资产引用计数卸载、WebGL Mipmap 预算与渐进加载。 |
| R1 | 2D 渲染、光照与混排（6） | **8** | **9** | **9** | +0.6 | [post2d.js](../assets/runtime/integrations/post2d.js)、[canvas2d.js](../assets/runtime/integrations/canvas2d.js) 与 [webgl2d.js](../assets/runtime/integrations/webgl2d.js) 已支持点光、32 条线段遮挡阴影与质量档。**不足**：仅线段遮挡非任意凸多边形/瓦片地图通用投射，且未经过真机 WebGL2 像素回归基准，封顶 8。 | Unity URP 2D Renderer 具备 Light2D（Freeform/Sprite/Parametric）、ShadowCaster2D 组合与 2D Shader Graph 完整管线。 |
| R2 | 3D 光照、阴影与 GI（7） | **7** | **9** | **7** | +1.4 | [lighting3d.js](../assets/runtime/integrations/lighting3d.js) + [shadow3d.js](../assets/runtime/integrations/shadow3d.js) 有单平行光、聚簇灯光及流送 SH 探针管理。**不足**：缺真正的多级稳定 CSM（Cascaded Shadow Maps）、缺少运行时实时融合的多局部反射探针（IBL Probe Blending）及多源聚光灯级联软影。 | Unity URP 原生支持 4 级稳定 CSM + 软阴影、APV 流送、多反射探针Box-Projection 混合与 Forward+ 聚簇。 |
| R3 | 材质、Shader 与特效/贴花（6） | **6** | **9** | **8** | +1.8 | [vfx/](../assets/runtime/vfx/)（图集/曲线/网格/丝带/物理反弹）和 [world-aligned-material.js](../assets/runtime/integrations/world-aligned-material.js) 表现突出。**关键短板**：依赖原生 Three `onBeforeCompile` 字符串拼接打补丁而非统一变体编译器；**完全缺失延迟/前向贴花系统（Decals）与通用着色器材质球抽象**，无 SRP-Batcher 等效常量合批。 | Unity URP 具备 Shader Graph + SRP Batcher（大幅降低同 Shader 不同材质 SetPass 成本）+ Decal Renderer Feature + 体积/粒子一体化。 |
| R4 | TAA、上采样与后处理（6） | **7** | **9** | **7** | +1.2 | [temporal-aa.js](../assets/runtime/integrations/post3d/temporal-aa.js) + [pipeline.js](../assets/runtime/integrations/post3d/pipeline.js) 已打通内部缩放与骨骼/实例运动向量。**不足**：半透明物体、Skinned 边缘与粒子的反应式掩码（Reactive Mask）粗糙，且未接入真机 WebGPU/WebGL2 视觉鬼影测试，封顶 7。 | Unity URP 提供成熟 TAA 与 WebGPU 原生 STP 时间域上采样器，并与相机堆叠和后处理体积深度绑定。 |
| R5 | 几何、LOD 与大世界远景（5） | **8** | **9** | **8** | +0.5 | [bone-vat.js](../assets/runtime/integrations/model3d/bone-vat.js) + [lod.js](../assets/runtime/integrations/model3d/lod.js) + [open-world.js](../assets/runtime/world/open-world.js) 在大规模 Bone-VAT 群体方面极强。**不足**：静态大场景网格缺平滑 Crossfade Dither 切档与运行时自动网格流式简化。 | Unity LOD Group 支持内置 Cross-Fade 抖动平滑过渡、MeshLOD / SpeedTree 集成与大世界场景叠加。 |
| P1 | 多线程与 CPU 仿真并行（6） | **6** | **8** | **7** | +1.2 | [worker-sim.js](../assets/runtime/sim/worker-sim.js) 仅是独立工具，**未接管默认 Rapier 物理世界步进、[swarm-ecs.js](../assets/runtime/world/swarm-ecs.js) 或骨骼姿态计算**。重度物理/导航仍在主线程执行。 | Unity Web 可选 C# Job System（Web 上 Burst 支持并发/SIMD 优化部分算法），Godot Web 导出支持跨源隔离 WorkerThreadPool。 |
| P2 | GPU 驱动提交与 WebGPU 能力（7） | **6** | **9** | **7** | +2.1 | [three.js](../assets/runtime/integrations/three.js) 仍完全走 WebGL2 CPU `renderer.render()`，[gpu-indirect3d.js](../assets/runtime/integrations/gpu-indirect3d.js) **尚未接入默认 Three/WebGPU 主适配器**，也无真机 `THREE.WebGPURenderer` 渲染路径打通。 | Unity 6.6 Web 已正式脱离实验性支持 WebGPU（Production），Compute Shader + `GraphicsBuffer` + Indirect 绘制与 GPU 遮挡剔除均可端到端运行。 |
| P3 | 帧预算、PSO 暖机与内存治理（6） | **7** | **8** | **7** | +0.6 | [quality3d.js](../assets/runtime/integrations/quality3d.js) 与 [render-budget-2d.js](../assets/runtime/integrations/render-budget-2d.js) 具备降级与缓存清理。**关键缺失**：无**着色器/PSO 预编译暖机管线**（3D 游戏首现新材质/特效在 WebGL2 ANGLE/D3D 下会卡顿数十至数百毫秒），且无真机长稳显存基线。 | Unity 提供 `ShaderVariantCollection.WarmUp()`、Graphics State Collection 预暖与明确的 WebGL 内存池控制。 |
| P4 | 跨后端性能剖析与诊断（5） | **7** | **8** | **7** | +0.5 | [render-diagnostics.js](../assets/runtime/integrations/quality3d/render-diagnostics.js) 与 [render-diagnostics-2d.js](../assets/runtime/integrations/render-diagnostics-2d.js) 字段对齐度很高。**不足**：停留在 Mock/JS 计数器校验，缺少浏览器真机 Chrome Tracing / GPU 火焰图、GC/内存分配速率监测与真机回归对比基线。 | Unity Profiler 支持连接实机 WebGL/WebGPU 浏览器采集帧时间线、内存快照与 Draw Call 详细归因。 |
| S1 | 物理、关节与空间查询（6） | **6** | **9** | **8** | +1.8 | [rapier-world.js](../assets/runtime/physics/rapier-world.js) 接入了确定性 Rapier 2D/3D、角色控制器、CCD、Sensor 与 `castRay`。**严重短板**：底层 Rapier 虽然支持，但引擎封装层**缺失任何物理关节（Revolute/Prismatic/Ball/Fixed/SpringJoint）、缺失 `shapecast`（球/盒体扫掠）、缺失碰撞分层过滤表与布娃娃（Ragdoll）对接**。 | Unity PhysX/Physics2D 提供完备关节体系、全形状 Cast/Overlap 空间查询、Layer Collision Matrix、物理材质摩擦弹性合并规则与布娃娃向导。 |
| S2 | 骨骼动画、混合树与 IK（6） | **5** | **9** | **9** | +2.4 | **核心短板之一**：[player.js](../assets/runtime/animation/player.js) 仅有 2D 帧序号播放；[model3d/helpers.js](../assets/runtime/integrations/model3d/helpers.js) 仅对 Three `AnimationMixer` 做了剪辑交叉淡入和简单 Overlay。**缺失状态机、1D/2D Blend Tree、动画事件轨道、Foot/Hand IK（Two-Bone / FABRIK）与骨骼遮罩混合编辑契约**。 | Unity Mecanim（Animator StateMachine + 1D/2D Blend Trees + Avatar Mask + Layer + IK Pass + AnimationEvent）与 Godot `AnimationTree` 均远超 HGame。 |
| S3 | 空间音频与动态 DSP 混音（4） | **6** | **9** | **8** | +1.2 | [audio.js](../assets/runtime/platform/audio.js) 已具备多总线、HRTF 3D、变体抽取、快照和 0-KB 合成 BGM。**不足**：缺少实时 **DSP 效果器（Convolver 卷积混响声区、可调参均衡器 EQ、环境低通实时遮挡滤波）**、无基于相对速度的真实多普勒频移计算，长 BGM 仍以整段 `decodeAudioData` 驻留内存。 | Unity AudioMixer 支持全套 DSP（Reverb/Lowpass/Compressor/Ducking）、Snapshot 混音、Reverb Zone 与 Streaming 解码。 |
| S4 | 运行时 UI、输入与无障碍（4） | **6** | **9** | **9** | +1.2 | [ui/](../assets/runtime/ui/) 与 [touch-controls.js](../assets/runtime/integrations/touch-controls.js) 对 H5 轻量 HUD 极其敏捷。**不足**：依赖外部 DOM 排版或零散 Canvas 坐标，缺少跨渲染后端的内置 **Flexbox/Grid 运行时布局引擎、MSDF/SDF 清晰字体图集渲染、手柄热插拔键位重映射持久化及屏幕阅读器支持**。 | Unity UI Toolkit（类 CSS Flexbox 运行时排版 + USS 样式）+ TextMeshPro（SDF 高清字效）+ Input System（Action Map/Rebinding）完备。 |
| N1 | 联机、预测回滚与状态同步（8） | **6** | **8** | **8** | +1.6 | [rollback-frames.js](../assets/runtime/lockstep/rollback-frames.js) 与 [network/](../network/) 提供了房间生命周期、确认帧及回滚帧驱动器。**不足**：规则与状态快照读写完全交由业务手工编写；**缺乏组件级声明式状态同步（NetworkVariable/Replicated）、Bitpack 增量压缩、延迟补偿时间回溯（Lag Compensation）与真实网络丢包抖动测试**。 | Unity Netcode for GameObjects / Entities 与 Godot `MultiplayerSynchronizer` 提供声明式状态同步、自动插值平滑、RPC 与增量快照传输。 |

---

## 与 Unity 6.6 对比的核心不足与优先改进路线

按对 Unity 6.6 差距贡献（加权分）从高到低排序：

| 优先级 | 编号 | 对 Unity 差距 | 核心短板与可执行抓手 |
| --- | --- | ---: | --- |
| **P0** | **S2** | **+2.4** | **动画体系过薄**：为 `model3d/` 补充纯代码/声明式 `AnimationStateMachine`、`1D/2D BlendTree`、骨骼分层遮罩、`AnimationEvent` 帧事件回调与轻量 `Two-Bone IK`（脚部贴地 / 手部瞄准）。 |
| **P0** | **P2** | **+2.1** | **WebGPU 路径未进主适配器**：将 `gpu-indirect3d.js` 真正接入 `createThreeAdapter` / `WebGPURenderer` 可选生产通道，打通原生 Indirect 剔除 + GPU 蒙皮合批并在无头 Chromium WebGPU 跑通真机基准。 |
| **P0** | **R3** | **+1.8** | **缺材质合批与贴花**：减少 `onBeforeCompile` 字符串注入脆弱性，建立统一 Shader 变体参数与常量缓冲复用规范，并在 `integrations/` 新增基于深度重建的 3D 屏幕空间/前向簇贴花（Decals）。 |
| **P0** | **S1** | **+1.8** | **物理接口未释放 Rapier 能力**：在 `physics/rapier-world.js` 暴露关节（Revolute / Fixed / Spring / Ball）、形状扫掠 `castShape`、分层碰撞掩码矩阵与基于骨骼的简易物理布娃娃切换。 |
| **P1** | **N1** | **+1.6** | **联机缺声明式同步与预测融合**：在 `network/` 新增组件级增量序列化、实体内插平滑缓冲与权威状态纠偏（Reconciliation），衔接 `rollback-frames.js` 并增加丢包/高延迟自动化对抗测试。 |
| **P1** | **R2 / R4 / A2** | **+3.8 合计** | **真机闭环与管线深水区**：把内置阴影（增加级联 CSM）、AO、GI 与后处理全部迁入 `render-graph.js` 统一管理；TAA 补齐半透明 Reactive Mask；并建立 Chromium WebGL2/WebGPU 真实像素 + GPU 耗时基准回归门禁。 |
| **P2** | **P1 / P3 / S3 / S4** | **+4.2 合计** | **工业打磨**：增加着色器 **PSO 预编译暖机** 队列消除首帧卡顿；为 `audio.js` 增加 `ConvolverNode` 环境混响、实时遮挡低通滤波与多普勒频移；探索 Rapier + Swarm ECS 的可选 Worker 后台步进；UI 增加 MSDF 字体与按键映射存储。 |

### HGame 相比 Unity Web 的真实优势（不妄自菲薄）

即便总分在全面标准下为 `67.0` vs `87.5`，HGame 在 **HTML5 / AI-Native 轻量游戏场景** 中拥有 Unity 6.6 Web 难以比拟的结构优势（不计入通用底座加分，但决定了选型优势）：
1. **极轻首包与秒开冷启动**：纯 ESM 运行时零重型 20–50MB Mono/.NET/Unity WASM 运行时开销（仅物理开启时加载 pinned Rapier WASM），对微信/B站小游戏及广告落地页更友好。
2. **十万级同屏群体与轻量 VAT**：`FlatCombatECS` + `createGpuSwarmWebGL2` + 16B `Bone-VAT` 方案针对割草/群战高度特化，比 Unity WebGL 默认 GameObject/SkinnedMesh 方案开销低数个量级。
3. **跨前后端确定性物理与 AI 原生验收流**：双端同源确定性 Rapier 0.21.0 + `scripts/accept.mjs` / `snapshot.mjs` / `autoplay` 零 GUI 全文本 AI 自测闭环，是 AI Agent 独立造游最高效的生产力底座。

---

## 历史版本演进归档（v1 口径 · 仅供参考对比）

> 注：以下为 2026-11-19 ~ 2026-11-21 采用 v1（11 项窄范围、无真机与子系统封顶规则）时的历史评分轨迹，完整代码与提交已留档，后续不再按 v1 口径新增评分：
> - **v1 基线（2026-11-19 · `ead9005`）**：`73.8 / 100`（A `17.4/25` + P `30.4/40` + R `26.0/35`）。
> - **v1 复评一（2026-11-21 · `8f126d9`）**：`90.0 / 100`（A `22.5/25` + P `36.0/40` + R `31.5/35`，对应 `A1..R4` 均达到 9/10）。
> - **v1 复评二（2026-11-21 · `8d3d6b9`）**：`100.0 / 100`（A `25.0/25` + P `40.0/40` + R `35.0/35`；提交 `9a2a2bc`、`12ef0c0`、`8d3d6b9` 补齐阶段归因、Render Graph API、glTF 依赖取消、`createSimWorkerRunner`、`createGpuIndirectCuller3D`、2D 预算/诊断、2D 遮挡阴影/法线质量档、流送 SH 探针、骨骼 TAA 与时间域上采样、`aCrowdY` 与 `createRepresentationBudget3D`）。
