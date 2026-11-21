# HGame 引擎评分机制（v4 · Web 相对百分制标准）

**评分标准 v4（以 Unity 6.6 URP Web 能力上限 = `100.0` 为 Web 端 100% 基准 · 仅评浏览器能真正落地的 HTML5/Web 竞品：`Unity 6.6 URP Web`、`Cocos Creator 3.8 Web`、`Godot 4.3+ Web`，彻底移除无 Web 端产物的 Unreal）：经 Phases 1–5、T1-A~D、T2-A~D 及第三梯队 `T3-A~T3-D`（3D 16×16×16 色彩分级 LUT + 指数高度雾 + 移动端 `msaaSamples: 4` 默认链、WebGL2 原生 `UniformsGroup` `std140` UBO 全局常量批合、KTX2/ASTC/ETC2 硬件压缩纹理探测与容器解析、竖屏零 GC 动态分辨率 DRS 闭环与热循环字节/帧回归审计），HGame 通用 Web 能力达到 Unity Web 能力的 `93.7 / 100`（原始底座分 `82.9 / 100`），超过 Cocos Creator 3.8 Web（`88.2`）与 Godot 4.3+ Web（`81.9`）；在定向竖屏 B站 Toy 50MB 单包无分包校准下，HGame 达到 `96.8 / 100`（原始分 `85.7 / 100`，其中渲染 `96.3%`、性能 `93.5%`）。**

> **为什么改用“Unity Web = 100.0 相对百分制”**：纯 HTML5 / WebGL2 / WebGPU 运行时天然受限于浏览器沙箱、驱动级 PSO 黑盒及移动端 WebView 显存墙；拿原生 PC/主机离线光追等不可能在 Web 落地的能力去扣分没有指导意义。v4 保留原始底座严苛分数（v3 满分 100 下的绝对能力值）的同时，统一换算为 **Web 端真实上限（Unity Web = 100.0）** 作为主排位。

> 编辑器可视化 GUI、各小游戏平台发行/兼容适配（B站 Toy / 抖音 / 微信 / TapTap 小游戏等）及商店资产市场均**不计入**引擎运行时得分，仅评估**运行时直接支撑游戏开发的 5 大技术底座**：架构与资产（18）、图形渲染（30）、性能与硬件（24）、核心运行时子系统（20）、多人与确定性网络（8）。

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

## Web 端四大竞品全方位评分 · 2026-11-22（v4 · Unity 6.6 URP Web = 100.0 相对基准）

- **HGame（`T3-A..T3-D` 全链路实测）**：经 `npm run check:all`、`npm run test:examples`（`49/49`）、60s 3,600-tick 零泄漏压测、`measureHotLoopAllocations` Zero-GC 审计、`tests/browser-engine-v3-commercial-benchmark.mjs`（`1280×720`）以及 **`tests/browser-mobile-portrait-benchmark.mjs`（`390×844` DPR 2 竖屏 Chromium WebGL2** + 真实按钮点击：`pixelRatio=1.5`、`buffer=585×1266`、`glError=0`、`warmupFailed=0`、`uboEnabled=true`、`lutEnabled=true`、`glPixels.uniqueColors=1372`、`compressedSupport.preferred="astc"` / `vramSavingsRatio=4`、`drsDropped=true`、`drsRecovered=true`、`allInLowerHalf=true`、`pressedActions=["atk","dash"]`）端到端实证。
- **对比竞品 Web 端实际能力边界（不含无 Web 导出能力的 Unreal）**：
  - **Unity 6.6 URP Web（Web 天花板 `100.0` / 原始 `88.5`）**：WebGL2 默认稳定 + WebGPU 逐步可用，SRP Batcher、APV、DBuffer 贴花、PCSS/CSM Atlas、Mecanim（含 Humanoid Retargeting）、PhysX、AudioMixer DSP、UI Toolkit 完整；但 WebAssembly 空包体积 10–18MB，对 50MB B站 Toy 占用偏大且冷启动较慢。
  - **Cocos Creator 3.8 Web（`88.2` / 原始 `78.0`）**：小游戏 HTML5 实战生态最强，ASTC/ETC2、2D 混排、自定义 Render Pipeline、多物理后端 WASM 与小包体启动均成熟；但原生 3D 软阴影/SSR/TAA 深度、大型群体 Bone-VAT 及前后端同源确定性联机框架略逊于前两者。
  - **Godot 4.3+ Web（`81.9` / 原始 `72.5`）**：编辑器与 2D/UI 工作流极佳，但**导出 Web 端被迫退回 Compatibility/GLES3 渲染后端**，桌面端引以为傲的 Forward+ / SDFGI / TAA / Compute 剔除全部不可用，且 Web 多线程高度依赖 `SharedArrayBuffer`（COOP/COEP 宿主头限制）与 20–35MB 重 WASM 包体。

### 1. Web 端五维相对得分总表（Unity Web = 100.0%）

| 引擎 / 视角 | A 架构（vs Unity%） | R 渲染（vs Unity%） | P 性能（vs Unity%） | S 子系统（vs Unity%） | N 联机（vs Unity%） | **Web 相对分 / 100** | 原始底座分 / 100 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **Unity 6.6 URP Web（基准）** | 16.2 (`100.0%`) | 27.0 (`100.0%`) | 20.8 (`100.0%`) | 17.7 (`100.0%`) | 6.8 (`100.0%`) | **100.0** | **88.5** |
| **HGame（T3 竖屏小游戏校准）** | 15.5 (`95.9%`) | **26.0 (`96.3%`)** | **19.4 (`93.5%`)** | **17.7 (`99.9%`)** | **7.0 (`103.5%`)** | **96.8** | **85.7** |
| **HGame（T3 通用 Web 全项）** | 14.9 (`92.2%`) | **26.0 (`96.3%`)** | **19.4 (`93.5%`)** | 16.1 (`91.1%`) | 6.4 (`94.1%`) | **93.7** | **82.9** |
| **Cocos Creator 3.8 Web** | 15.0 (`92.6%`) | 23.6 (`87.6%`) | 18.0 (`86.3%`) | 16.2 (`91.8%`) | 5.2 (`76.5%`) | **88.2** | **78.0** |
| **Godot 4.3+ Web（Compatibility）** | 14.0 (`86.7%`) | 21.0 (`77.6%`) | 15.5 (`74.6%`) | 16.4 (`92.8%`) | 5.6 (`82.4%`) | **81.9** | **72.5** |

> 精确加权校验：HGame T3 通用 Web `A 14.94 + R 25.99 + P 19.44 + S 16.12 + N 6.40 = 82.89`（`82.89 / 88.5 = 93.66% -> 93.7`）；HGame T3 定向竖屏校准 `A 15.54 + R 25.99 + P 19.44 + S 17.68 + N 7.04 = 85.69`（`85.69 / 88.5 = 96.82% -> 96.8`）。

### 2. Web / 50MB B站 Toy 实战专项横向对比（工程落地效率维度）

| 实战工程指标 | Unity 6.6 URP Web | Cocos Creator 3.8 Web | Godot 4.3+ Web | **HGame（v4）** |
| --- | --- | --- | --- | --- |
| 空包引擎 WASM/JS 体积 | 10–18 MB（挤占 50MB 配额） | 2.5–6 MB（轻量） | 18–35 MB（偏重，难进小游戏） | **< 1 MB 核心 ESM（Rapier 按需懒加载）** |
| 手机浏览器首屏冷启动 | 慢（WASM 编译 + 堆初始化） | 快 | 慢 | **极快（纯 ESM 秒开，分帧 Shader Warmup）** |
| COOP / COEP 宿主依赖 | 仅多线程开启时受限 | **零强依赖** | 多线程导出强依赖（宿主易拒） | **零强依赖（标准 Worker + 回退）** |
| 竖屏单手右下角弧形 UI 底座 | 需项目手搭 UGUI/Toolkit 适配 | 需项目手搭 Widget 适配 | 需项目手搭 Control 适配 | **引擎内置 `thumb-arc` + 自动化门禁** |
| 前后端同源确定性锁步物理 | 否（PhysX 非跨端位一致） | 否（默认 WASM 非锁步化） | 否 | **是（双端 pinned Rapier 0.21.0 + Checksum）** |
| 十万级同屏群体与 16B Bone-VAT | 通用对象较重，需手写 GPU Instancing | 中等（基础实例化） | 弱（Web GLES3 实例化受限） | **原生特化（16B Bone-VAT + GPU PingPong Swarm）** |
| AI Agent 全自动游验证闭环 | 无（强依赖人工 GUI 编辑器） | 无（强依赖可视化面板） | 无（强依赖可视化场景树） | **全文本设计文档 + `accept` / 82 项基准 / 零人工验证** |

### 定向商用小游戏工程取舍说明（主动不做，不作扣分）

围绕**“竖屏 B站 Toy 50MB 单包无分包 + 自研权威服务器 + Blender Auto-Rig 统一骨架 + 确定性 Rapier 物理”**目标，以下 4 类通用 3A/多端引擎特性属于**主动工程舍弃**，在定向校准视角中不计为扣分项（平台发行/渠道兼容同样不纳入引擎分）：
1. **不做 WebRTC / P2P 通道（`N1`: 通用 `8.0` → 校准 `8.8`）**：统一使用自研服务器承载状态同步/帧同步，已在运行时具备二进制 Delta 编解码、`createSceneReplicator` 预测回滚与服务端 `createSpatialAoiFilter`（入口/滞回兴趣裁剪）。
2. **不做跨骨架 Humanoid Retargeting（`S2`: 通用 `8.2` → 校准 `9.0`）**：团队内部采用 Blender Auto-Rig 统一规范，无需异形商业商店骨架重定向；已具备分层状态机、1D/2D 混合树、Two-Bone/LookAt/FABRIK IK、RootMotion、MorphTarget、`createSpringBoneChain3D`（头发/披风弹性悬垂与球体防穿模）及 `createInertialBlend3D`（半衰期惯性过渡）。
3. **不做布料物理 / 轮胎动力学载具 / Featherstone / 运行时凸包自动分解（`S1`: 通用 `7.0` → 校准 `8.8`）**：为保证确定性帧同步与移动端性能，物理底座保持前后端同源确定性 Rapier 0.21.0 + 基础复合碰撞体/高度场/关节/Sweep；披风与植物摇摆改由零逻辑开销的 GPU 顶点着色器（`windSway`）与 `SpringBone` 表现层替代。
4. **不做运行时分包加载与多包拆解（`A3`: 通用 `7.8` → 校准 `8.8`）**：首发单包 50MB 内扁平结构直出（后续扩展微信/抖音分包时再按需演进），当前通过 KTX2/ASTC/ETC2 压缩纹理管线与 Mip 流控保障显存与装包空间。

### 逐项能力客观评分与剩余真实缺口（v4 / T3 复评）

| 编号 | 项（权） | 基线 | 通用 | 校准 | Unity Web | Web 达成率 | 已落地的真链路证明 & 诚实保留的真实缺口 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| A1 | 调度与生命周期（6） | 7.5 | **8.5** | **8.5** | **9.0** | `94.4%` | **T1-A 补齐**：`SceneManager` 支持 `mountAdditive`/`unmountAdditive` 与 `Application` 同步步进渲染叠加子场景；缺运行时脚本序列化热重载。 |
| A2 | 渲染图与扩展管线（6） | 6.0 | **8.6** | **8.6** | **9.0** | `95.6%` | **T2-B 升级（`c85225e`）**：`createThreeAdapter({ renderGraph: true })` 接入 Scene 级 `compileRenderGraph` + `executeRenderGraph`（死 Pass 自动剔除，`390×844` 实测 `culled=["projected-decals"]`）；仍缺 Three.js WebGLRenderer 内核态原生 RT 物理别名复用。 |
| A3 | 资产流送与驻留（6） | 6.5 | **7.8** | **8.8** | **9.0** | `86.7%` / `97.8%` | **T3-B 升级**：新增 `ktx2.js`（KTX2 文件头解析、ASTC/ETC2/BC7/DXT 扩展探测、`selectOptimalTextureVariant` 与 `CompressedTexture` 构建）与 `bindTextureMipStreaming`；按需不做多包分包。 |
| R1 | 2D 渲染、光照与混排（6） | 7.0 | **8.5** | **8.5** | **9.0** | `94.4%` | **T1-B 补齐**：2D 光照遮挡线段扩容至 `128` 条，新增 `applyAutoTileRules` 4/8 邻域自动瓦片拼接及 `webgl2d` 精灵 Shader 描边/溶解/波纹特效；缺 2D 骨骼蒙皮。 |
| R2 | 3D 光照、阴影与 GI（7） | 5.5 | **8.6** | **8.6** | **9.0** | `95.6%` | **T1-C 补齐**：CSM 支持 `pcss: true` 接触硬化 Poisson 软阴影，新增 `applyBakedLightmap3D`（lightMap + L2 SH 系数）；仍缺多光单张 Shadow Atlas 与 Web 运行时多次反弹 GI。 |
| R3 | 材质、Shader 与贴花（6） | 5.0 | **8.8** | **8.8** | **9.0** | **`97.8%`** | **T3-B 升级**：`createMaterialBatchRegistry3D` 接入 WebGL2 原生 `THREE.UniformsGroup` + `std140` 共享 UBO（在 `390×844` Chromium SwiftShader 编译执行 `uboEnabled=true`, `glError=0`）+ 软边投影贴花；仍缺全屏幕 MRT DBuffer 法线贴花写入。 |
| R4 | TAA、上采样与后处理（6） | 6.5 | **8.9** | **8.9** | **9.0** | **`98.9%`** | **T3-A 升级**：在 5-tap AMD FSR1 RCAS + `reactiveMaskRT` TAA 之上落地 `createColorLutTexture3D`（5 套 16³ 调色 LUT）、基于解析深度的**指数高度雾**与竖屏 `msaaSamples: 4` 默认预设（Chromium `uniqueColors` 跃升至 `1372`）。 |
| R5 | 几何、LOD 与大世界远景（5） | 7.0 | **8.5** | **8.5** | **9.0** | `94.4%` | **T1-C 补齐**：Bone-VAT 16B + `createInstancedFoliage3D` GPU 实例化草地/植被（风摆 + 踩踏弯折 + 视距 Bayer 淡出）+ `injectDitherLodMaterial3D` 静态 LOD 抖动淡入淡出。 |
| P1 | 多线程与 CPU 仿真并行（6） | 4.5 | **7.5** | **7.5** | **7.5** | **`100.0%`** | **T1-A 补齐**：`worker-sim.js` 涵盖 `'flow-field'`、`'swarm-separate'` 与 `'navmesh-path'` 异步寻路；Rapier 为帧同步确定性保留主线程（与 Unity WebGL 一致）。 |
| P2 | GPU 驱动提交与 WebGPU（7） | 5.0 | **7.5** | **7.5** | **9.0** | `83.3%` | **Phase 4 补齐**：`createIndirectInstancedBatch3D` 实现真视锥裁剪压缩并提交 `webgl2-multidraw`（2000 裁剪至 1000 可见）；仍缺 Dawn WebGPU Compute/Hi-Z 实机 CI。 |
| P3 | 帧预算、PSO 与内存（6） | 7.0 | **8.9** | **8.9** | **8.5** | **`104.7%`** | **T3-C 升级**：在 VRAM 台账 + 分帧 Shader Warmup + 竖屏像素上限之外，落地 `createPortraitDrsController`（基于 RingBuffer 的零分配动态分辨率缩放，过载降档恢复升档已实证），规避 Web 无磁盘 PSO API 的浏览器共性上限。 |
| P4 | 跨后端性能剖析（5） | 7.0 | **8.7** | **8.7** | **9.0** | **`96.7%`** | **T3-C 升级**：Chrome Trace + `createLiveProfilerOverlay` + 60s 长稳压测之外，新增 `measureHotLoopAllocations` 实时帧内 Heap 零 GC 分配回归门禁。 |
| S1 | 物理与空间查询（6） | 7.0 | **7.0** | **8.8** | **9.0** | `77.8%` / `97.8%` | 确定性 Rapier 2D/3D + 关节/Cast/Overlap/分层矩阵扎实；布料/载具/Featherstone/运行时 VHACD 属主动舍弃。 |
| S2 | 骨骼动画、混合树与 IK（6） | 5.5 | **8.2** | **9.0** | **9.5** | `86.3%` / `94.7%` | **Phase 4 & 专项补齐**：`solveFabrikIK`、`extractRootMotion`、`blendMorphTargets`、`createSpringBoneChain3D` 与 `createInertialBlend3D` 全闭环；Blender Auto-Rig 下无需 Humanoid 重定向。 |
| S3 | 空间音频与动态 DSP（4） | 6.0 | **8.5** | **8.5** | **8.5** | **`100.0%`** | **T1-A 补齐**：完整混响链 + 3 段参数 EQ + 采样级 `GainNode` 包络 `duckBus`（已齐平 Unity Web 常见场景）。 |
| S4 | 运行时 UI、输入与无障碍（4） | 6.0 | **9.0** | **9.0** | **9.0** | **`100.0%`** | **T2-A 升级（`3d9c52c`）**：`renderSdfText` + `textInput`（含中文 IME）+ 竖屏右下角半圆拇指舒适区（`ui/thumb-arc.js` / `'portrait-arc'` / `auditPortraitThumbZone`），`390×844` 实机点击全绿。 |
| N1 | 联机、预测与状态同步（8） | 5.0 | **8.0** | **8.8** | **8.5** | `94.1%` / **`103.5%`** | **Phase 2 & 专项补齐**：`valuesEqual` + `0x48 0x47` 二进制增量包 + `createSceneReplicator` + `createSpatialAoiFilter`；自研权威服无需 WebRTC。 |

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
