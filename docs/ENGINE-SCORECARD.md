# HGame 引擎评分机制

**评分标准 v1，基线 73.8／100，目标 90.0／100。**

这张表衡量引擎底座的能力和覆盖范围。架构占 25 分，性能设计占 40 分，渲染占 35 分。评估以浏览器本地运行、可通过代码或数据接入的 2D/3D 路径为准。成品游戏品质、测试项目、发布工具、编辑器、生态和平台覆盖率都在评分范围之外。

从 73.8 提升到 90 的过程使用下表的 11 项、权重和首轮商用参照版本。每轮把能力变化写进末尾的复评记录，并用原公式重算 HGame 分数。商用引擎的新版本可以独立立一轮参照。AI 开发和验收流程单独记录。

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

## 首轮评分 · 2026-11-19

HGame 基线为 `ead9005`，覆盖 Pixi 2D、可选 WebGL2D 与 Three 3D。Unity 采用 6.6 URP Web，覆盖 WebGL 2 和显式启用的 WebGPU。Cocos 采用 Creator 3.8 LTS Web。PlayCanvas 采用 Engine 2.x 官方 Web 路径，作为可商用的开源引擎参照。各引擎的可选能力按其后端约束计入。

| 引擎 | 架构 / 25 | 性能设计 / 40 | 渲染 / 35 | 合计 / 100 |
| --- | ---: | ---: | ---: | ---: |
| HGame | 17.4 | 30.4 | 26.0 | **73.8** |
| Unity URP Web | 22.5 | 34.0 | 28.8 | **85.3** |
| Cocos Creator Web | 20.0 | 29.2 | 26.1 | **75.3** |
| PlayCanvas | 20.9 | 31.0 | 29.2 | **81.1** |

| 编号 | HGame | Unity | Cocos | PlayCanvas | HGame 本轮依据 |
| --- | ---: | ---: | ---: | ---: | --- |
| A1 | 8 | 9 | 8 | 8 | 单一应用调度，集中管理固定步、插值、场景和服务。 [应用调度](../assets/runtime/core/application.js) |
| A2 | 6 | 9 | 8 | 9 | 3D Pass 顺序由管线内部编排，单视口进入后处理，分屏各视口直接前向绘制。 [Three 适配器](../assets/runtime/integrations/three.js) · [3D 后处理](../assets/runtime/integrations/post3d/pipeline.js) |
| A3 | 7 | 9 | 8 | 8 | Catalog 有并发上限，关卡支持预取和取消，3D 模型默认接入 Meshopt。默认模型加载器尚无 KTX2 解码入口。 [资源目录](../assets/runtime/platform/asset-catalog.js) · [关卡流转](../assets/runtime/world/level-flow.js) · [默认模型加载器](../assets/profiles/3d/model-loader.js) |
| P1 | 8 | 8 | 7 | 7 | 固定步仿真、确定性物理和扁平群体数据路径已接入。 [应用调度](../assets/runtime/core/application.js) · [群体仿真](../assets/runtime/world/swarm-ecs.js) · [确定性物理](architecture/DETERMINISTIC-PHYSICS.md) |
| P2 | 8 | 9 | 8 | 8 | WebGL2 群体仿真、实例化、裁剪和 Bone-VAT 已接入。Three 3D 后端为 WebGL，聚簇灯光仍会标记整张聚簇纹理上传。 [GPU 群体](../assets/runtime/world/gpu-swarm-webgl2.js) · [裁剪](../assets/runtime/integrations/culling3d.js) · [灯光](../assets/runtime/integrations/lighting3d.js) |
| P3 | 8 | 8 | 7 | 8 | 3D 有自动画质档、能力判定和异步 GPU 计时。预算主要落在 3D 画质控制。 [画质控制](../assets/runtime/integrations/quality3d.js) · [GPU 计时](../assets/runtime/integrations/quality3d/gpu-timer.js) |
| P4 | 6 | 9 | 7 | 8 | 已有帧窗口、错误与事件记录，以及 GPU 帧级采样。还缺统一的逐 Pass 时间与资源计数。 [运行时诊断](../assets/runtime/platform/diagnostics.js) · [GPU 计时](../assets/runtime/integrations/quality3d/gpu-timer.js) |
| R1 | 8 | 9 | 9 | 7 | Pixi 路径有图集、粒子、选择性 Bloom 和多后端降级，可选 WebGL2D 路径提供 2D 光照。 [Pixi 渲染器](../assets/profiles/pixi2d/src/engine/Renderer2D.js) · [2D 后处理](../assets/runtime/integrations/post2d.js) |
| R2 | 7 | 8 | 7 | 9 | 已有 Three PBR、太阳阴影、聚簇灯光与可选辐照探针。屏幕空间 GI 对屏外遮挡和反射信息的覆盖有限。 [3D 管线](rendering/PIPELINE-3D.md) · [灯光系统](../assets/runtime/integrations/lighting3d.js) |
| R3 | 7 | 8 | 7 | 9 | 已有色调映射、曝光与可选的深度校验 GI/SSR 历史。时间域处理针对 GI/SSR，重投影使用相机矩阵。 [后处理配置及历史](../assets/runtime/integrations/post3d/pipeline.js) |
| R4 | 8 | 8 | 7 | 8 | 默认模型有 Meshopt，大规模群体有 Bone-VAT 与分级细节，开放世界有分块、HLOD 和浮动原点。 [3D 模型](../assets/runtime/integrations/model3d.js) · [开放世界](../assets/runtime/world/open-world.js) |

### 商用参照依据

- **Unity 6.6 URP Web**。固定步和 Player Loop、Addressables 与按场景渐进加载支撑 A1/A3。URP Render Graph 声明 Pass 的资源依赖，WebGPU 路径支持 SRP Batcher、DOTS、间接绘制与 GPU 蒙皮，设备不支持时可回退到 WebGL 2。渲染与诊断按 URP 和 Web 文档评分。 [Web 支持](https://discussions.unity.com/t/unity-6-6-is-now-available/1735357) · [固定步与事件顺序](https://docs.unity3d.com/6000.0/Documentation/Manual/execution-order.html) · [URP Render Graph](https://docs.unity.com/en-us/engine/6000.3/manual/render-pipelines/universal-render-pipeline/customizing-urp/render-graph/view) · [URP 功能矩阵](https://docs.unity.com/en-us/engine/6000.3/manual/render-pipelines/choose-a-render-pipeline/feature-comparison) · [Web 性能分析](https://unity.com/how-to/profile-optimize-web-build)
- **Cocos Creator 3.8 Web**。有组件生命周期、Asset Bundle 加载与释放、动态图集及运行时 Profiler。3.8.4 起提供可定制的 RenderGraph 管线，内置前向路径覆盖阴影、Bloom、FXAA 和适用配置下的 FSR。 [运行时 API](https://docs.cocos.com/creator/3.8/api/en/README) · [Asset Bundle](https://docs.cocos.com/creator/3.8/manual/en/asset/bundle.html) · [RenderGraph](https://docs.cocos.com/creator/3.8/manual/en/render-pipeline/overview.html) · [内置管线](https://docs.cocos.com/creator/3.8/manual/en/render-pipeline/use-builtin-pipeline.html) · [动态图集](https://docs.cocos.com/creator/3.8/manual/en/advanced-topics/dynamic-atlas.html)
- **PlayCanvas Engine 2.x**。有 WebGL/WebGPU、实例化、批处理、PBR、IBL、聚簇灯光、运行时光照贴图和资源加载释放。CameraFrame 支持自定义效果和 TAA，MiniStats 提供帧时间与绘制统计。 [图形能力](https://developer.playcanvas.com/user-manual/graphics/) · [CameraFrame 扩展](https://developer.playcanvas.com/user-manual/graphics/posteffects/cameraframe/custom-effects/) · [聚簇灯光](https://developer.playcanvas.com/user-manual/graphics/lighting/clustered-lighting/) · [资产加载与释放](https://developer.playcanvas.com/user-manual/assets/loading-unloading/) · [MiniStats](https://developer.playcanvas.com/user-manual/optimization/mini-stats/)

Unreal Engine 5.9 的 Lumen、TSR 和阴影系统可作为渲染设计参照。Pixel Streaming 由远端主机执行引擎，浏览器接收画面流，因此 Unreal 使用单独的桌面技术口径。 [桌面渲染功能矩阵](https://dev.epicgames.com/documentation/unreal-engine/supported-features-by-rendering-path-for-desktop-with-unreal-engine) · [Pixel Streaming](https://dev.epicgames.com/documentation/unreal-engine/overview-of-pixel-streaming-in-unreal-engine)

## 当前商用对照

HGame 使用本页最新复评，参照引擎使用首轮分数。Δ 表示 HGame 减参照引擎的加权分。

| 引擎 | 架构 / 25 | 性能设计 / 40 | 渲染 / 35 | 总分 / 100 | Δ |
| --- | ---: | ---: | ---: | ---: | ---: |
| HGame | 22.5 | 35.0 | 30.0 | **87.5** | — |
| Unity 6.6 URP Web | 22.5 | 34.0 | 28.8 | **85.3** | +2.2 |
| PlayCanvas Engine 2.x | 20.9 | 31.0 | 29.2 | **81.1** | +6.4 |
| Cocos Creator 3.8 Web | 20.0 | 29.2 | 26.1 | **75.3** | +12.2 |

- **Unity URP Web**。两者的架构同为 **22.5／25**。Unity 提供可定制的 Player Loop。HGame 在应用调度器内提供固定扩展点，并将异步工作绑定到一次场景激活。HGame 的帧预算高一个原始分，GPU 提交和性能诊断同为 9。 [Unity 调度顺序](https://docs.unity3d.com/6000.0/Documentation/Manual/execution-order.html) · [HGame 调度契约](guides/systems/01-core-lifecycle-tags.md#调度扩展与场景生命周期)
- **PlayCanvas**。HGame 的性能设计高 **4.0** 加权分，2D 渲染高 **0.8**。两者的 3D 光照与输出评分相同。PlayCanvas 提供运行时光照贴图、环境光和 TAA 放大，HGame 使用离线探针与支持不透明刚体和 CPU 实例的 TAA。 [运行时光照贴图](https://developer.playcanvas.com/user-manual/graphics/lighting/runtime-lightmaps/) · [CameraFrame 时间域放大](https://developer.playcanvas.com/user-manual/graphics/posteffects/cameraframe/#taa-upscaling) · [HGame 时间域抗锯齿](rendering/PIPELINE-3D.md#temporal-antialiasing)
- **Cocos Creator Web**。HGame 在资源生命周期、CPU 仿真、GPU 提交、画质控制和诊断设计上得分更高。Cocos 的 R1 高 1 个原始分，值得参考的是动态图集和统一 2D 排序，尤其是文字、粒子和遮罩混排时如何维持批次。 [动态图集](https://docs.cocos.com/creator/3.8/manual/en/advanced-topics/dynamic-atlas.html) · [排序配置](https://docs.cocos.com/creator/3.8/manual/en/editor/project/) · [资源释放](https://docs.cocos.com/creator/3.8/manual/en/asset/release-manager.html)

## HGame 到 90 的改进顺序

以下是 v1 下的一条改进路径。每项达到 9 分时，原权重合计恰为 **90.0**。HGame 和参照引擎的单项分以 10 分为满分。表中的增量只有能力实际接入且复评后才入账。

| 顺序 | 评分项 | HGame 当前 → 目标 | Unity / PlayCanvas / Cocos | 加权增量 | 扣分原因与具体改进 |
| --- | --- | ---: | ---: | ---: | --- |
| 1 | P1 CPU 仿真 | 8 → 9 | 8 / 7 / 7 | +1.0 | 固定步、确定性物理和密集群体数据已接入。为可延后的寻路和非关键 AI 更新引入分时预算，保留固定步确定性与背压报告。 |
| 2 | R1 2D 渲染 | 8 → 9 | 9 / 7 / 9 | +0.8 | 主 2D 路径已有图集、精灵、粒子和 Bloom。明确精灵、文字、粒子和遮罩的排序与混合契约，减轻跨材质与裁剪切换造成的批次打断。 |
| 3 | R4 几何与动画 | 8 → 9 | 8 / 8 / 7 | +0.7 | Meshopt、骨骼、Bone-VAT 及 HLOD 已有入口。明确普通动画、群体动画、远景代理之间的切换及资源回收，保留加载失败时的回退。 |
| — | A1 调度生命周期 | 9 → 9 | 9 / 8 / 8 | +0.0 | 应用调度提供固定顺序的扩展点。场景激活在停用前发出取消信号，准备回滚和重入销毁沿用同一套退出契约。 |
| — | A3 资源生命周期 | 9 → 9 | 9 / 8 / 8 | +0.0 | 关卡资源作用域和 3D 模型槽可持有共享解码模型。主请求可取消，空闲模型几何和纹理可按引用和预算回收。 |
| — | P3 帧预算 | 9 → 9 | 8 / 8 / 7 | +0.0 | Three 自动画质同时接收耗时和内存压力。可回收空闲目标和已登记的缓存，并在内存有余量时恢复画质。 |
| — | P4 性能诊断 | 9 → 9 | 9 / 8 / 7 | +0.0 | WebGL2D、Canvas2D、Pixi 和 Three 共用快照结构。绘制、上传、GPU 时间与目标估算按后端能力公开。 |
| — | R3 画面输出 | 9 → 9 | 8 / 9 / 7 | +0.0 | TAA 复用不透明网格和 CPU 实例的上一帧姿态，并在遮挡变化或重建目标时放弃无效历史。 |
| — | R2 3D 光照 | 9 → 9 | 8 / 9 / 7 | +0.0 | PBR 材质可直接使用离线 SH 探针。高档在覆盖内衰减 SSGI，低档可以单独使用烘焙项。 |
| — | A2 渲染架构 | 9 → 9 | 9 / 9 / 8 | +0.0 | 内置和自定义全屏 Pass 通过同一入口检查纹理与输出，HDR 中间目标按视口和使用范围复用。 |
| — | P2 GPU 提交 | 9 → 9 | 9 / 8 / 8 | +0.0 | 现有实例化、裁剪和增量上传已达到此路径的目标。 |

## AI 开发与任务验收

HGame 已能把任务拆成要求，以精确测试名和浏览器检查点生成结构化结果。缺失、跳过或含糊的检查保持待处理，视觉项由 AI 读取新证据后判断。PlayCanvas 官方流程提供代码上下文和浏览器检查，Unity Test Framework 提供命令行测试及结果文件。HGame 的下一步应把需求、实现证据和最终状态绑定在同一个任务记录上。 [HGame 验收规范](guides/AI-VERIFICATION.md#task-acceptance) · [PlayCanvas AI 工作流](https://developer.playcanvas.com/user-manual/engine/developing-with-ai/) · [Unity 命令行测试](https://docs.unity3d.com/Packages/com.unity.test-framework@1.4/manual/reference-command-line.html)

从现有 `task:check` 扩展即可。开始时保留原始需求与约束，逐条映射到可观察结果。执行时记录证据对应的代码版本、入口和断言。失败后定位到原需求，修复并重跑受影响检查。最终报告列出每项的结果与证据，旧版本、跳过或缺失证据保持待处理。视觉要求由 AI 在相关代码或资产变更后重新审阅。现有检查器已经校验检查名和自动化结果，代码版本与视觉审阅的结构化闭环属于下一阶段。

## HGame 复评记录

当前复评 **87.5／100**，架构 **22.5／25**，性能设计 **35.0／40**，渲染 **30.0／35**。距离目标 **2.5 分**。

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

后续评审新增一行，先更新证据，再重算总分。过去包含试玩或交付的评分使用其原始口径，趋势从本页首轮基线开始记录。
