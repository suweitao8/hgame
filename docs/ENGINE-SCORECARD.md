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

## HGame 优先改进项

| 优先级 | 对应评分 | 当前差距 | 达到下一档的工程依据 |
| --- | --- | --- | --- |
| 首先 | A2 | 单视口与分屏共享 3D 管线。自定义 HDR Pass 已能声明输入。 | 补齐内置阶段的资源依赖与统一的生命周期契约。 |
| 首先 | P4 | Three 已能按帧和阶段报告 CPU、GPU、绘制量、目标估算和提交的上传字节。 | 扩展 2D 路径的逐阶段诊断覆盖。 |
| 其次 | R2、R3 | 对 PlayCanvas 合计差 4.0 加权分。现有时间域管线只覆盖 GI/SSR，屏幕空间光照受当前视野约束。 | 在统一视图入口增加可选的全画面时间域路径，对动态物体使用运动数据，对相机切换、视口调整和质量变更定义历史失效规则。让探针或环境光补足屏幕空间结果缺失处。 |
| 其次 | A3 | 默认 glTF 动态加载已覆盖 Meshopt 和 KTX2/Basis，支持按设备选格式、失败重试和应用退出时释放。 | 补齐已发起请求的取消和共享纹理的驻留预算。 |
| 随后 | P2、P3 | WebGL 3D 的聚簇灯光已支持稀疏上传，密集变化执行全量回退。 | 按场景测量密集更新的 CPU 和上传成本。再按后端能力接入可选 3D WebGPU，保留 WebGL 路径的画面和降级契约。 |

## HGame 复评记录

当前复评 **79.2／100**，架构 **20.0／25**，性能设计 **33.2／40**，渲染 **26.0／35**。距离目标 **10.8 分**。

| 阶段 | 构建目标与后端 | 评项 | 原分 | 新分 | 加权变化与工程依据 |
| --- | --- | --- | ---: | ---: | --- |
| 分屏 HDR | Web · Three WebGL2 | A2 | 6 | 7 | **+0.9**。单视口和分屏共用视图渲染入口，分屏复用 HDR 阶段并隔离曝光、时间域历史和视口资源。仍需明确渲染阶段的读写依赖与扩展接口，才能评 8 分。 [Three 适配器](../assets/runtime/integrations/three.js) · [输出阶段](../assets/runtime/integrations/post3d/pipeline.js) · [专项测试](../tests/rendering-pipeline3d.test.mjs) |
| HDR 扩展接口 | Web · Three WebGL2 | A2 | 7 | 8 | **+0.9**。可组合的 Pass 声明颜色和可选深度输入，管线负责输出目标复用与降级。单视口和分屏应用同一份链。内置阶段的通用资源依赖仍待完善。 [接口与资源所有权](rendering/PIPELINE-3D.md#custom-hdr-effects) · [专项测试](../tests/rendering-pipeline3d.test.mjs) |
| 渲染诊断 | Web · Three WebGL2 | P4 | 6 | 7 | **+0.8**。可导出帧和命名阶段的 CPU、绘制次数、三角形及目标占用估算。GPU 异步结果带原帧和阶段索引，异常采样与不支持有明确状态。上传字节及 2D 路径的逐阶段覆盖还待完善。 [诊断接口](rendering/PIPELINE-3D.md#frame-and-pass-diagnostics) · [专项测试](../tests/rendering-pipeline3d.test.mjs) |
| 聚簇灯光增量上传 | Web · Three WebGL2 | P2 | 8 | 9 | **+1.2**。既有实例批处理和裁剪路径之外，聚簇灯光在静止帧复用分桶数据，稀疏变化只上传对齐的行内范围。密集变化与外部 Three 后端使用全量回退，重建 GPU 纹理时恢复完整内容。 [灯光上传路径](rendering/PIPELINE-3D.md#clustered-light-texture-updates) · [专项测试](../tests/ue-rendering-and-openworld.test.mjs) |
| WebGL 上传观测 | Web · Three WebGL2 | P4 | 7 | 8 | **+0.8**。按帧和阶段记录实际 WebGL 调用提交的缓冲与纹理载荷，列出可观测的命令及无法计算的次数。2D 路径仍缺同级覆盖。 [上传统计口径](rendering/PIPELINE-3D.md#frame-and-pass-diagnostics) · [专项测试](../tests/rendering-pipeline3d.test.mjs) |
| KTX2/Basis 资源路径 | Web · Three WebGL2 | A3 | 7 | 8 | **+0.8**。默认 glTF 加载器按需转码外置与嵌入的压缩纹理。支持格式探测、可选纹理回退、共享解码与独立采样状态。发布包带齐离线转码资源，应用退出时释放 Worker。已发起请求的取消和统一驻留预算待补齐。 [资源路径](rendering/PIPELINE-3D.md#compressed-model-textures) · [发布包检查](../tests/package-release.test.mjs) |

后续评审新增一行，先更新证据，再重算总分。过去包含试玩或交付的评分使用其原始口径，趋势从本页首轮基线开始记录。
