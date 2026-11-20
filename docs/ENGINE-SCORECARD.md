# HGame 引擎评分机制

**评分标准 v1，基线 73.8／100，目标 90.0／100。**

这张表衡量引擎底座的能力和覆盖范围。架构占 25 分，性能设计占 40 分，渲染占 35 分。评估以浏览器本地运行、可通过代码或数据接入的 2D/3D 路径为准。成品游戏品质、测试项目、发布工具、编辑器、生态和平台覆盖率都在评分范围之外。

后续固定以 Unity 和 Godot 为对照。各引擎使用同一套 11 个评分项和权重。每轮把 HGame 的能力变化写进末尾的复评记录，并用原公式重算分数。更新参照版本时注明版本、后端、证据及分数变化。AI 开发和验收流程单独记录。

## 打分规则

1. 固定评估日期、引擎版本、浏览器构建目标和图形后端。官方支持的可选后端可以计分，同时记录它的前置条件和降级路径。引擎依赖的功能只有接入该引擎的运行路径才计分。
2. 每项给 0–10 的整数分。**0** 表示已确认没有覆盖，**2** 表示有局部组件，**4** 表示能在受限路径使用，**6** 表示主要路径已有基本能力，**8** 表示主要路径具备控制或降级并覆盖常见场景，**10** 表示满足该项表中的全部条件。奇数表示达到较低一档并满足了下一档的部分条件。没有证据时记 `?`，表中存在 `?` 时保留已评小计和待评权重。
3. 每个原始分附一条源码、运行时 API 或官方版本资料。更新时记录原分、新分、改动路径和影响范围。重复出现的功能按不同作用计分，例如批处理在 P2 看提交成本，在 R1 看 2D 画面覆盖。
4. 加权总分 = Σ（单项分 × 权重 ÷ 10）。差距贡献 =（参照引擎单项分 − HGame 单项分）× 权重 ÷ 10。优先关注影响多个场景或后续能力的差距。分数的小数来自权重计算。

性能项按调度、数据结构、提交策略和可观测能力计分。HGame 依据源码，参照引擎依据公开资料，分数为当前证据下的工程判断。帧率、帧时间、峰值内存、加载耗时和设备稳定性均未测量。

| 编号 | 评分项 | 权重 | 10 分所需证据 |
| --- | --- | ---: | --- |
| A1 | 调度与生命周期 | 8 | 更新阶段、固定步、场景切换、销毁及扩展顺序均有清晰的代码契约 |
| A2 | 渲染架构与扩展 | 9 | Pass 可由代码组合，显式声明输入输出、资源生命周期和降级规则，各视口共用契约 |
| A3 | 资源生命周期 | 8 | 可分包、异步加载和取消，运行时具备去重、释放、驻留预算以及纹理与模型解码入口 |
| P1 | CPU 仿真设计 | 10 | 仿真可与渲染频率解耦，有密集数据路径、可控工作量和适用的并行或分时策略 |
| P2 | GPU 提交与规模化 | 12 | 主要路径具备批处理、实例化、裁剪、分级细节和变化驱动的上传，后端有适用的提交回退 |
| P3 | 帧预算与降级 | 10 | 主要路径按 CPU/GPU 和内存预算管理分辨率、特效与临时目标，具备迟滞与能力降级 |
| P4 | 运行时性能诊断 | 8 | 可按帧和 Pass 导出 CPU/GPU 时间、绘制量、上传字节、渲染目标占用及采样状态 |
| R1 | 2D 渲染 | 8 | 精灵、图块、文字、遮罩、粒子和后处理具备一致的排序、混合与质量配置 |
| R2 | 3D 材质与光照 | 10 | PBR、IBL、阴影、多光源与间接光有完整主路径及明确的低成本替代 |
| R3 | 时间域与画面输出 | 10 | 抗锯齿、色调映射、曝光、缩放及带运动处理的时间域输出覆盖主要视图，有历史失效规则 |
| R4 | 几何、动画与远景 | 7 | 几何压缩、骨骼动画、群体动画、LOD 和远景管理可组合，资源切换和降级语义明确 |

## HGame 首轮基线 · 2026-11-19

HGame 基线提交为 `ead9005`，覆盖 Pixi 2D、可选 WebGL2D 与 Three 3D。下表记录 HGame 的原始分，供末尾的复评记录逐轮累加。

| 引擎 | 架构 / 25 | 性能设计 / 40 | 渲染 / 35 | 合计 / 100 |
| --- | ---: | ---: | ---: | ---: |
| HGame | 17.4 | 30.4 | 26.0 | **73.8** |

| 编号 | HGame | 基线依据 |
| --- | ---: | --- |
| A1 | 8 | 单一应用调度，集中管理固定步、插值、场景和服务。 [应用调度](../assets/runtime/core/application.js) |
| A2 | 6 | 3D Pass 顺序由管线内部编排，单视口进入后处理，分屏各视口直接前向绘制。 [Three 适配器](../assets/runtime/integrations/three.js) · [3D 后处理](../assets/runtime/integrations/post3d/pipeline.js) |
| A3 | 7 | Catalog 有并发上限，关卡支持预取和取消，3D 模型默认接入 Meshopt。默认模型加载器尚无 KTX2 解码入口。 [资源目录](../assets/runtime/platform/asset-catalog.js) · [关卡流转](../assets/runtime/world/level-flow.js) · [默认模型加载器](../assets/profiles/3d/model-loader.js) |
| P1 | 8 | 固定步仿真、确定性物理和扁平群体数据路径已接入。 [应用调度](../assets/runtime/core/application.js) · [群体仿真](../assets/runtime/world/swarm-ecs.js) · [确定性物理](architecture/DETERMINISTIC-PHYSICS.md) |
| P2 | 8 | WebGL2 群体仿真、实例化、裁剪和 Bone-VAT 已接入。Three 3D 后端为 WebGL，聚簇灯光仍会标记整张聚簇纹理上传。 [GPU 群体](../assets/runtime/world/gpu-swarm-webgl2.js) · [裁剪](../assets/runtime/integrations/culling3d.js) · [灯光](../assets/runtime/integrations/lighting3d.js) |
| P3 | 8 | 3D 有自动画质档、能力判定和异步 GPU 计时。预算主要落在 3D 画质控制。 [画质控制](../assets/runtime/integrations/quality3d.js) · [GPU 计时](../assets/runtime/integrations/quality3d/gpu-timer.js) |
| P4 | 6 | 已有帧窗口、错误与事件记录，以及 GPU 帧级采样。还缺统一的逐 Pass 时间与资源计数。 [运行时诊断](../assets/runtime/platform/diagnostics.js) · [GPU 计时](../assets/runtime/integrations/quality3d/gpu-timer.js) |
| R1 | 8 | Pixi 路径有图集、粒子、选择性 Bloom 和多后端降级，可选 WebGL2D 路径提供 2D 光照。 [Pixi 渲染器](../assets/profiles/pixi2d/src/engine/Renderer2D.js) · [2D 后处理](../assets/runtime/integrations/post2d.js) |
| R2 | 7 | 已有 Three PBR、太阳阴影、聚簇灯光与可选辐照探针。屏幕空间 GI 对屏外遮挡和反射信息的覆盖有限。 [3D 管线](rendering/PIPELINE-3D.md) · [灯光系统](../assets/runtime/integrations/lighting3d.js) |
| R3 | 7 | 已有色调映射、曝光与可选的深度校验 GI/SSR 历史。时间域处理针对 GI/SSR，重投影使用相机矩阵。 [后处理配置及历史](../assets/runtime/integrations/post3d/pipeline.js) |
| R4 | 8 | 默认模型有 Meshopt，大规模群体有 Bone-VAT 与分级细节，开放世界有分块、HLOD 和浮动原点。 [3D 模型](../assets/runtime/integrations/model3d.js) · [开放世界](../assets/runtime/world/open-world.js) |

## 当前 Web 引擎对照 · 2026-11-20

- **HGame** 以 `33d4ffb` 为本轮代码基准。2D 评估 Canvas2D、WebGL2D 与 Pixi 路径，3D 评估 Three WebGL2。 [渲染诊断](guides/AI-VERIFICATION.md#per-frame-render-diagnostics) · [3D 渲染管线](rendering/PIPELINE-3D.md)
- **Unity 6.6（6000.6.10f1）URP Web**。默认 WebGL 2。项目可启用 WebGPU，并按浏览器、设备和图形 API 配置回退到 WebGL 2。STP 时间域上采样、计算着色器、间接绘制等能力按 WebGPU 的可选路径计入。 [版本说明](https://unity.com/releases/editor/whats-new/6000.6.10f1) · [Unity WebGPU 支持与回退](https://discussions.unity.com/t/webgpu-out-of-experimental-in-unity-6-6/1734694/1)
- **Godot 4.7.2 Stable Web**。采用 Wasm + WebGL 2 的 Compatibility 渲染器。启用多线程需要浏览器跨源隔离。渲染能力按 Compatibility 功能矩阵计入。 [版本说明](https://godotengine.org/download/archive/4.7.2-stable/) · [Web 导出](https://docs.godotengine.org/en/4.7/tutorials/export/exporting_for_web.html) · [渲染器功能矩阵](https://docs.godotengine.org/en/4.7/tutorials/rendering/renderers.html)

| 引擎 | 架构 / 25 | 性能设计 / 40 | 渲染 / 35 | 总分 / 100 |
| --- | ---: | ---: | ---: | ---: |
| **HGame** | 22.5 | 36.0 | 31.5 | **90.0** |
| Unity 6.6 URP Web | 22.5 | 33.2 | 29.8 | **85.5** |
| Godot 4.7.2 Web | 19.0 | 30.2 | 27.8 | **77.0** |

Unity 较上轮 **85.3 → 85.5**。官方确认 WebGPU 路径可用 STP，R3 从 8 升到 9（+1.0）。默认 WebGL 路径的官方 GPU Profiler 和 GPU 帧时间受限，本轮缺少 WebGPU 逐 Pass GPU 时间与资源指标覆盖的充分依据，P4 从 9 调为 8（−0.8）。 [Unity WebGPU 功能说明](https://discussions.unity.com/t/webgpu-out-of-experimental-in-unity-6-6/1734694/1) · [GPU Usage Profiler](https://docs.unity.com/en-us/engine/6000.6/manual/analysis/graphics-performance-profiling/profile-rendering/profiler-gpu) · [Frame Timing 支持矩阵](https://docs.unity.com/en-us/engine/6000.6/manual/analysis/graphics-performance-profiling/profile-rendering/frame-timing-manager/manager#platform-support)

### 逐项评分与 HGame 改进

单项满分 10。同档得分可以来自不同实现。HGame 的代码依据见首轮基线和末尾复评记录。

| 评分项（权重） | HGame | Unity | Godot | 两个参照引擎的依据 | HGame 改进 |
| --- | ---: | ---: | ---: | --- | --- |
| A1 调度与生命周期（8） | 9 | 9 | 9 | Unity 有 Player Loop、固定步和显式事件顺序。Godot 有 SceneTree 生命周期、固定物理步和节点处理优先级。 [Unity 执行顺序](https://docs.unity3d.com/6000.6/Documentation/Manual/execution-order.html) · [Godot Node](https://docs.godotengine.org/en/4.7/classes/class_node.html) | 导出单帧顺序和场景取消原因，便于 AI 定位异常发生在哪个阶段。 |
| A2 渲染架构（9） | 9 | 9 | 6 | URP Render Graph 按 Pass 声明管理资源依赖。Godot Web 可组合 Viewport 和全屏着色器，CompositorEffects 适用于 Mobile 和 Forward+。 [URP Render Graph](https://docs.unity.com/en-us/engine/6000.6/manual/render-pipelines/universal-render-pipeline/customizing-urp/render-graph/introduction) · [Godot 渲染器矩阵](https://docs.godotengine.org/en/4.7/tutorials/rendering/renderers.html#environment-and-post-processing) | 将已有 Pass 读写声明用于自动排序和临时目标回收。 |
| A3 资源生命周期（8） | 9 | 9 | 8 | Unity 支持按场景渐进下载、Addressables 引用释放和 Web 压缩纹理。Godot 支持 PCK、ResourceLoader 缓存和后台请求，常驻预算与请求取消仍由项目处理。 [Unity 渐进加载](https://discussions.unity.com/t/unity-6-6-is-now-available/1735357) · [Unity Addressables 管理](https://docs.unity3d.com/Packages/com.unity.addressables@2.7/manual/MemoryManagement.html) · [Unity Web 纹理](https://docs.unity.com/en-us/engine/6000.6/manual/platform-specific/webgl/develop/texture-compression) · [Godot PCK](https://docs.godotengine.org/en/4.7/tutorials/export/exporting_pcks.html) · [Godot ResourceLoader](https://docs.godotengine.org/en/4.7/classes/class_resourceloader.html) | 将取消信号传给 glTF 外置依赖，统一模型、纹理和音频的驻留统计。 |
| P1 CPU 仿真（10） | 9 | 8 | 8 | Unity 有固定步和 Burst 并行路径，普通 C# Jobs 在 Web 主线程运行。Godot 有固定物理步和 WorkerThreadPool，多线程导出需要跨源隔离。 [Unity Web 性能](https://docs.unity.com/en-us/engine/6000.6/manual/platform-specific/webgl/develop/performance) · [Godot 工作线程池](https://docs.godotengine.org/en/4.7/classes/class_workerthreadpool.html) · [Godot Web 线程](https://docs.godotengine.org/en/4.7/tutorials/export/exporting_for_web.html) | 为只读寻路增加可选 Worker 后端，按固定步稳定顺序接收结果。 |
| P2 GPU 提交（12） | 9 | 9 | 8 | Unity WebGPU 支持间接绘制、GPU 蒙皮与 GPU 遮挡裁剪。Godot Web 有 MultiMesh 和网格 LOD，同一 MultiMesh 批次共享裁剪范围。 [Unity WebGPU 功能](https://discussions.unity.com/t/webgpu-out-of-experimental-in-unity-6-6/1734694/1) · [Godot MultiMesh](https://docs.godotengine.org/en/4.7/classes/class_multimesh.html) · [Godot 网格 LOD](https://docs.godotengine.org/en/4.7/tutorials/3d/mesh_lod.html) | 先让普通 3D 实例按脏区上传，再为 GPU 裁剪与间接提交提供可选 WebGPU 路径。 |
| P3 帧预算（10） | 9 | 8 | 7 | URP 有按档配置的渲染缩放、阴影和后效果，以及 WebGPU 设备筛选。Godot 有逐视口缩放、MSAA 和阴影开关，自动调节由项目编排。 [URP Asset](https://docs.unity.com/en-us/engine/6000.6/manual/render-pipelines/universal-render-pipeline/urp-reference/universalrp-asset) · [Godot Viewport](https://docs.godotengine.org/en/4.7/classes/class_viewport.html) | 将 2D 后端接入统一预算，按空闲缓存、效果、内部渲染分辨率的顺序调节。 |
| P4 性能诊断（8） | 9 | 8 | 7 | Unity Web 开发构建可采集 CPU 和内存，默认 WebGL GPU 计时有限。Godot 暴露帧、内存和绘制计数，Web 证据主要覆盖这些计数及 Compatibility 渲染诊断。 [Unity Web 性能分析](https://unity.com/how-to/profile-optimize-web-build) · [Godot Performance](https://docs.godotengine.org/en/4.7/classes/class_performance.html) · [Godot Visual Profiler](https://docs.godotengine.org/en/4.7/tutorials/scripting/debug/debugger_panel.html#visual-profiler) | 给支持时间戳的 Pixi WebGPU 设备补逐 Pass GPU 计时，区分实测、估算和不可用数据。 |
| R1 2D 渲染（8） | 9 | 9 | 9 | Unity URP 2D 有按层灯光、阴影和法线贴图。Godot Canvas 有排序、2D 灯光、遮挡和精灵法线贴图。 [Unity URP 2D](https://docs.unity.com/en-us/engine/6000.6/manual/unity2d/2d-urp/2d-index) · [Godot 2D 灯光与阴影](https://docs.godotengine.org/en/4.7/tutorials/2d/2d_lights_and_shadows.html) | 在现有 2D 光照路径补统一的阴影遮挡与精灵法线输入，图集容量按需分页。 |
| R2 3D 光照（10） | 9 | 8 | 8 | Unity URP 有 PBR、环境与反射探针、实时阴影和烘焙光照。Godot Compatibility 支持 PBR、阴影、反射探针和已烘焙的 LightmapGI，实时 GI 能力按 Compatibility 矩阵评估。 [Unity 渲染功能矩阵](https://docs.unity.com/en-us/engine/6000.6/manual/render-pipelines/choose-a-render-pipeline/feature-comparison) · [Godot 反射与间接光矩阵](https://docs.godotengine.org/en/4.7/tutorials/rendering/renderers.html#global-illumination) | 按世界分块加载烘焙探针，在相邻区域平滑过渡。 |
| R3 画面输出（10） | 9 | 9 | 7 | Unity WebGPU 有 STP。Godot Web 有色调映射、3D MSAA 和双线性分辨率缩放，TAA 与 FSR2 在 Forward+。 [Unity WebGPU STP](https://discussions.unity.com/t/webgpu-out-of-experimental-in-unity-6-6/1734694/1) · [Godot 抗锯齿矩阵](https://docs.godotengine.org/en/4.7/tutorials/rendering/renderers.html#antialiasing) | 为骨骼和 VAT 增加运动向量及遮挡失效，再接入时间域上采样。 |
| R4 几何、动画与远景（7） | 9 | 8 | 8 | Unity 有 LOD Group、交叉淡入淡出和 WebGPU 蒙皮。Godot 有导入时自动网格 LOD、距离式 HLOD 和 AnimationTree 混合。 [Unity LOD Group](https://docs.unity.com/en-us/engine/6000.6/manual/analysis/graphics-performance-profiling/lod/lod-group/class-lodgroup) · [Unity WebGPU 蒙皮](https://discussions.unity.com/t/webgpu-out-of-experimental-in-unity-6-6/1734694/1) · [Godot 网格 LOD](https://docs.godotengine.org/en/4.7/tutorials/3d/mesh_lod.html) · [Godot HLOD](https://docs.godotengine.org/en/4.7/tutorials/3d/visibility_ranges.html) · [Godot AnimationTree](https://docs.godotengine.org/en/4.7/tutorials/animation/animation_tree.html) | 参考 Godot 为资产生成简化网格和 LOD 元数据。按需扩展 Bone-VAT 独立高度与多动画状态交接。 |

### 改进优先级

1. **时间域画面。** 先为骨骼和 VAT 提供当前与上一帧的变换，按深度及可见性淘汰失效历史。再把现有动态分辨率接到时间域上采样，参照 Unity STP。
2. **渲染调度。** 让内置与扩展 Pass 声明资源读写和能力要求，管线计算执行顺序和临时目标首末使用点。每个视口按同一规则编排。
3. **低成本渲染。** 先推进 3D 实例脏区上传和按屏幕尺寸选择网格 LOD。2D 借鉴 Godot 的光照遮挡和精灵法线，接入现有质量档和统一排序。

## AI 开发与任务验收

HGame 已能把任务要求绑定到精确测试名和 WebAsset 检查点。Unity Test Framework 提供命令行测试和结果文件，Godot 可通过 `--headless --script` 运行项目脚本。HGame 的下一步是让 `task:check` 把每条要求、运行结果和实际代码版本绑定在同一个任务记录上。 [HGame 验收规范](guides/AI-VERIFICATION.md#task-acceptance) · [Unity 命令行测试](https://docs.unity3d.com/Packages/com.unity.test-framework@1.4/manual/reference-command-line.html) · [Godot 命令行](https://docs.godotengine.org/en/4.7/tutorials/editor/command_line_tutorial.html)

开始时保留原始需求和约束，逐条映射到可观察结果。执行时记录证据对应的代码版本、入口和断言。失败后定位到原要求，修复并重跑受影响检查。缺失、跳过或过期的证据保持待处理。涉及画面的要求由 AI 检查当前版本的画面并记录结论。

## HGame 复评记录

当前复评 **90.0／100**，架构 **22.5／25**，性能设计 **36.0／40**，渲染 **31.5／35**。

| 阶段 | 构建目标与后端 | 评项 | 原分 | 新分 | 加权变化与工程依据 |
| --- | --- | --- | ---: | ---: | --- |
| 分屏 HDR | Web · Three WebGL2 | A2 | 6 | 7 | **+0.9**。单视口和分屏共用视图渲染入口，分屏复用 HDR 阶段并隔离曝光、时间域历史和视口资源。仍需明确渲染阶段的读写依赖与扩展接口，才能评 8 分。 [Three 适配器](../assets/runtime/integrations/three.js) · [输出阶段](../assets/runtime/integrations/post3d/pipeline.js) · [专项测试](../tests/rendering-pipeline3d.test.mjs) |
| HDR 扩展接口 | Web · Three WebGL2 | A2 | 7 | 8 | **+0.9**。可组合的 Pass 声明颜色和可选深度输入，管线负责输出目标复用与降级。单视口和分屏应用同一份链。内置阶段的通用资源依赖仍待完善。 [接口与资源所有权](rendering/PIPELINE-3D.md#custom-hdr-effects) · [专项测试](../tests/rendering-pipeline3d.test.mjs) |
| 渲染诊断 | Web · Three WebGL2 | P4 | 6 | 7 | **+0.8**。可导出帧和命名阶段的 CPU、绘制次数、三角形及目标占用估算。GPU 异步结果带原帧和阶段索引，异常采样与不支持有明确状态。上传字节及 2D 路径的逐阶段覆盖还待完善。 [诊断接口](rendering/PIPELINE-3D.md#frame-and-pass-diagnostics) · [专项测试](../tests/rendering-pipeline3d.test.mjs) |
| 聚簇灯光增量上传 | Web · Three WebGL2 | P2 | 8 | 9 | **+1.2**。既有实例批处理和裁剪路径之外，聚簇灯光在静止帧复用分桶数据，稀疏变化只上传对齐的行内范围。密集变化与外部 Three 后端使用全量回退，重建 GPU 纹理时恢复完整内容。 [灯光上传路径](rendering/PIPELINE-3D.md#clustered-light-texture-updates) · [专项测试](../tests/ue-rendering-and-openworld.test.mjs) |
| WebGL 上传观测 | Web · Three WebGL2 | P4 | 7 | 8 | **+0.8**。按帧和阶段记录实际 WebGL 调用提交的缓冲与纹理载荷，列出可观测的命令及无法计算的次数。2D 路径仍缺同级覆盖。 [上传统计口径](rendering/PIPELINE-3D.md#frame-and-pass-diagnostics) · [专项测试](../tests/rendering-pipeline3d.test.mjs) |
| KTX2/Basis 资源路径 | Web · Three WebGL2 | A3 | 7 | 8 | **+0.8**。默认 glTF 加载器按需转码外置与嵌入的压缩纹理。支持格式探测、可选纹理回退、共享解码与独立采样状态。发布包带齐离线转码资源，应用退出时释放 Worker。已发起请求的取消和统一驻留预算待补齐。 [资源路径](rendering/PIPELINE-3D.md#compressed-model-textures) · [发布包检查](../tests/package-release.test.mjs) |
| 世界画面 TAA | Web · Three WebGL2 | R3 | 7 | 8 | **+1.0**。世界 HDR 增加可选的逐视口时间域抗锯齿，使用相机重投影和深度校验，提供历史失效与 FXAA 回退。物体级运动向量待接入。 [时间域抗锯齿](rendering/PIPELINE-3D.md#temporal-antialiasing) · [专项测试](../tests/rendering-pipeline3d.test.mjs) |
| 3D Pass 资源契约 | Web · Three WebGL2 | A2 | 8 | 9 | **+0.9**。内置和自定义全屏阶段声明纹理读取与输出附件，由绘制入口校验绑定。世界光照和自定义链在视口内复用 HDR 目标，资源跟随尺寸、上下文和视口生命周期。通用的跨阶段自动资源调度仍有提升空间。 [绘制和资源契约](rendering/PIPELINE-3D.md#pass-inputs-outputs-and-target-lifetime) · [专项测试](../tests/rendering-pipeline3d.test.mjs) |
| 烘焙间接光 | Web · Three WebGL2 | R2 | 7 | 9 | **+2.0**。版本化 SH 探针数据在场景级接入 PBR 漫反射，支持前向出图及低档使用。HDR 以有界权重衰减覆盖内部的 SSGI，边界保留重叠，SSR 单独处理。原生网格或 3D 纹理尺寸不支持时沿用已有光照。当前每个场景管理一个烘焙网格。 [资源与混合契约](rendering/PIPELINE-3D.md#baked-world-irradiance) · [专项测试](../tests/rendering-pipeline3d.test.mjs) |
| 不透明物体运动重投影 | Web · Three WebGL2 | R3 | 8 | 9 | **+1.0**。刚体和 CPU 实例记录上一帧变换，运动缓冲用当前深度淘汰遮挡像素，TAA 用上一帧深度验证重投影。新物体和尺寸变化有独立的历史失效规则，静止视图跳过运动绘制。骨骼、GPU 动画和时间域上采样仍有提升空间。 [运动与历史](rendering/PIPELINE-3D.md#temporal-antialiasing) · [专项测试](../tests/rendering-pipeline3d.test.mjs) |
| 2D 渲染诊断 | Web · WebGL2D、Canvas2D、Pixi | P4 | 8 | 9 | **+0.8**。主 2D 后端提供同格式的帧与阶段报告。WebGL 记录实际绘制、上传载荷、目标估算与异步 GPU 采样。Pixi WebGPU 记录可观测的队列传输和提交，Canvas2D 保留 CPU 阶段和缓存估算。Canvas2D 的 GPU 计数与 Pixi WebGPU 的 GPU 时间按不可用报告。 [诊断口径](guides/AI-VERIFICATION.md#per-frame-render-diagnostics) · [专项测试](../tests/webgl2d-lighting-post.test.mjs) |
| 帧与内存预算 | Web · Three WebGL2 | P3 | 8 | 9 | **+1.0**。普通绘制计入各视口的后处理目标、阴影贴图、烘焙探针与项目登记的缓存占用。自动模式先回收空闲资源，再按目标类型调整分辨率或特效，恢复前留出余量。预算按已知分配估算，覆盖 Three 路径。 [预算接口](rendering/PIPELINE-3D.md#target-and-residency-budget) · [专项测试](../tests/rendering-pipeline3d.test.mjs) |
| 模型资源驻留 | Web · 资源目录与 Three 模型服务 | A3 | 8 | 9 | **+0.8**。关卡和模型槽共享解码结果，最后一个待加载的持有者离开时取消主请求，迟到的解码结果按引用清理。模型几何和纹理可按估算驻留量回收，生成项目可把同一份占用接入渲染预算。已开始的 glTF 内部解析和部分外部依赖加载可能继续完成。 [使用契约](guides/ASSET-CATALOG.md#scene-owned-decoded-models) · [专项测试](../tests/model3d-ownership.test.mjs) |
| 阶段扩展与场景取消 | Web · 应用核心 | A1 | 8 | 9 | **+0.8**。固定更新、物理、逻辑和渲染的扩展按优先级及注册顺序执行。每次场景激活提供取消信号。候选回滚仅取消候选，重入销毁仍先停用组件再执行一次退出。可扩展位置由核心预先定义。 [调度与场景契约](guides/systems/01-core-lifecycle-tags.md#调度扩展与场景生命周期) · [专项测试](../tests/lifecycle-resilience.test.mjs) |
| 固定步工作预算 | Web · 仿真与 2D、3D 导航 | P1 | 8 | 9 | **+1.0**。可延后任务在物理之后按操作数轮转，渲染帧分组变化时保持固定步执行顺序。预算覆盖 A* 扩展、路径回溯和 3D 平滑。队列报告积压、拒绝与失败，场景切换可取消任务。执行模式为主线程协作分时。 [使用契约](guides/systems/13-ai-fsm-bt-navmesh.md#fixed-tick-budget-for-deferred-ai-and-navigation) · [专项测试](../tests/ai-navmesh.test.mjs) |
| 2D 排序与批处理 | Web · Canvas2D、WebGL2D、Pixi | R1 | 8 | 9 | **+0.8**。同层同深度的对象使用统一排序，普通精灵、文字和粒子可共享队列。Pixi 绘制组也可接入图块层。相邻绘制复用等值矩形裁剪，WebGL2D 按混合与裁剪边界提交实例。统一裁剪约定覆盖视口矩形，批绘粒子与图块层以组为单位参与排序。 [原生接口](guides/systems/03-sprite-2d-pathfinding.md#混排裁剪与混合) · [Pixi 接口](guides/PIXI2D-STARTER.md#ordered-draw-groups) · [专项测试](../tests/performance-and-quality.test.mjs) |
| 几何与动画切换 | Web · Three 骨骼、Bone-VAT 与 HLOD | R4 | 8 | 9 | **+0.7**。角色切档共享变换和循环动画时间，加载失败、群体满员、跨距离阈值和场景退出均有明确行为。世界分块先准备代理再卸完整内容，取消的近景加载释放迟到结果，失败重试让其他分块先行。共享群体使用统一地平面。 [接入与资源契约](rendering/PIPELINE-3D.md#model-lod-and-cell-handoff) · [角色测试](../tests/swarm-and-bone-vat.test.mjs) · [世界分块测试](../tests/ue-rendering-and-openworld.test.mjs) |

后续评审新增一行，先更新证据，再重算总分。过去包含试玩或交付的评分使用其原始口径，趋势从本页首轮基线开始记录。
