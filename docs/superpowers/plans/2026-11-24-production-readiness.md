# HGame production-readiness iteration

**Goal**: Reach at least 90/100 on the existing 40% runtime, 35% production kit, and 25% verification and delivery rubric.

1. Recover repository-owned test and benchmark inputs. Keep private and local assets excluded. Restore the two public Arena fixtures from their existing Git history. Verify Node, WebAsset, network, example packaging, and browser recipes using a checkout containing only versioned inputs.
2. Put the approved action bindings and touch layout into a reusable runtime preset. Integrate it into the generated action archetype with input and mode-switch regression coverage. Verify the normal generated entry and a standalone release.
3. Add a narrowly scoped LAN preview option for one selected game. Keep management on loopback. Verify route isolation, serving on an explicitly selected interface, and mobile reconnect/multi-touch behavior.
4. Split playable and release evidence in acceptance. Require applicable mandatory release gates and measured target-device budgets. Reassess the same rubric against the resulting evidence and mark device or platform gaps explicitly.
5. Reconcile the engine scorecard prose with its structured data and evaluate any remaining runtime deficit using reproducible measurements before claiming the target.
6. Use the existing i18n service for the generated action game's stock shell and touch labels. Select Chinese or English from `?lang=` or the browser language. Keep authored titles and unrecognized choice labels. Extend the generated-game browser test to verify the default English browser and the Chinese override.
7. In the default Pixi arena, replace its private touch input with the shared action controls and retain mouse aim and legacy shortcuts. Show only implemented actions, use a single resume button during pauses, and verify English and Chinese in a generated arena with keyboard, simulated Xbox and two-touch input. Keep the bare Pixi entry empty.
8. Give the three action archetypes one generated module for bindings, touch, locale, and menu behavior. Preserve authored actions and combat rules. Exercise published horde and 3D arena builds through damage, results, and replay using normal input and authored fixture balance.
9. Record the actual rendering environment of packaged playtests. Keep software coverage and let release manifests explicitly require hardware rendering. Verify the same 3D lifecycle with an actual desktop GPU, preserving the release budgets.
10. Add optional package budgets for minimum measurement duration, p99 frame time and peak estimated GPU bytes. Sample an authored resource hook during the measured scenario and surface coverage and failures. Verify a hardware arena package through a minute of gameplay in both viewports and exercise an exceeded resource budget.
11. Add an opt-in release requirement for mobile touch. Run the opted-in packaged mobile scenario using Chromium touch emulation and record trusted touch presses during measurement. Preserve existing release scenarios by default. Verify a Web package opens through touch, a Toy Pixi package moves and attacks with two fingers, and keyboard or script-dispatched events alone cannot satisfy the touch requirement.

## 2026-11-24 复评

| 维度 | 权重 | 初评 | 本轮 | 依据 |
| --- | ---: | ---: | ---: | --- |
| 引擎运行时 | 40% | 84 | 84 | 沿用 [17 项引擎评分卡](../../ENGINE-SCORECARD.md)。CPU 与桌面 GPU 的实测补强了性能证据，现有架构缺项仍在。 |
| 制作工具链 | 35% | 80 | 88 | 公共依赖、生成原型、WebAsset、独立包已串通。动作原型具备可复用的三端输入和简中／英文界面，默认 Pixi 及其他原型的接入程度仍不同。 |
| 验证与交付 | 25% | 62 | 89 | Web 和 Toy 产物通过桌面／移动视口实机浏览器流程、包体和帧预算、源码与产物新鲜度检测。移动视口是桌面浏览器模拟。 |
| 综合 | | **77.1** | **86.7** | 沿用 40／35／25 权重，综合分为工程判断。 |

### 可复跑的证据

- `npm run bench`。10,000 粒子加 2,000 条飘字的生成耗时从中位数 15.70 ms、p95 18.51 ms 降到中位数 1.85 ms、p95 4.84 ms。以原有 2.5 ms 中位数门槛验收。
- `npm run bench:render3d -- --gpu hardware`。RTX 4070，WebGL2，960 × 540，2,000 实例、64 光源和后处理，p95 11.72 ms，预算 16.67 ms。该数据使用 40 个采样帧。
- `node tests/browser-api-recipes.mjs`。7 条生成入口通过 Chromium 验证。动作原型覆盖键盘、模拟 Xbox、模拟双指触控和中英文切换。
- `node tests/browser-release-acceptance.mjs`。生成并验证 Web 与 Toy 发布包，同时覆盖超预算与过期验收报告。

### Pixi 竞技场迭代

默认 Pixi 入口已复用动作输入和双语界面。制作工具链从 88 升至 90，验证与交付从 89 升至 90，运行时分数沿用 84。综合 **87.6 / 100**。

- 生成入口测试覆盖 WASD、J 攻击、模拟 Xbox 左摇杆和 X 攻击、A/B 暂停恢复、断连后键盘继续、触屏笔电鼠标射击、移动视口双指操作和取消。
- 默认 Pixi Toy 包通过 WebAsset 注册和启动验收。独立产物在 Chromium 验证移动攻击、暂停期间停止移动、点击继续，以及各阶段 UI。ZIP 为 438,899 字节，桌面和移动视口的 p95 均为 16.70 ms，采样分别为 55 和 57 帧。

### 动作原型统一

综合 **88.8 / 100**。制作工具链从 90 升至 92，验证与交付从 90 升至 91，引擎运行时采用已提交的 v5.2 评分 84.6。

- 三个动作原型共用键盘、手柄、触屏和简中／英文界面。生成文档列出实际键位。3D 原型的 Chromium 测试经过实际升级界面，模拟 Xbox B 取消后返回战斗。
- 修复割草的固定步调用与场地查询网格。割草 Toy 包与 3D Web 包都验证了正常接触伤害、结算、静音和模拟 Xbox A 重开。割草通过发布门禁。
- 3D 的软件渲染帧预算仍失败。最终发布验收的桌面和移动视口 p95 分别为 216.6 ms 和 200.0 ms，高于 100 ms。临时关闭天空、抗锯齿并将分辨率减半，独立探针仍报约 200 ms。保留原发布门槛和实际失败状态。

### 发布报告的 GPU 实测

综合 **89.3 / 100**。验证与交付从 91 升至 93，制作工具链 92，引擎运行时 84.6。硬件发布配置记录游戏实际创建的渲染上下文，回退或未知 GPU 无法通过硬件门禁。

- 3D Web 独立包在 RTX 4070 上通过正式发布验收，包体 2,255,247 字节。桌面 p95 7.0 ms（710 帧），360 × 800 视口 p95 7.1 ms（699 帧）。Web 和 Toy 的 2D 样例仍通过 SwiftShader 验收。
- `npm run bench:render3d -- --gpu hardware --frames 26000`。同一 GPU 的 2,000 实例、64 光源和后处理压测采集 26,000 帧，约 91 秒。p95 8.0 ms，p99 12.6 ms，最慢 64 ms。样例尚无显存峰值证据。

### 距离 90 分的主要缺口

1. 交付需要补上 Android Chrome、iOS Safari、实体 Xbox 和目标 Toy 宿主的实测。重点是局域网打开、移动同时出招、返回前台、设备断连与恢复，以及代表性低端手机的帧时间。
2. 运行时评分卡仍有 3D 主管线与 WebGPU 接线、持续分配的渲染目标、主线程骨骼动画等缺项。已验证的显存与帧尾数据来自一台桌面设备。

### 独立发布包的长时预算

综合 **89.8 / 100**。引擎运行时 84.6，制作工具链 92，验证与交付从 93 升至 95。保留原 40／35／25 权重。

- 3D 原型的普通粒子池从 65,536 调整到 4,096。发布包的引擎显存估算峰值从 21.72 MB 降至 13.86 MB，两种视口均通过原定的 16 MiB 门槛。资源采样各 72 次，最长采样间隔约 1.01 秒。
- RTX 4070，桌面 960 × 540、模拟竖屏 360 × 800，独立包各运行约 70.8 秒。全部 10,007 帧与 9,969 帧纳入计算，p95 均为 7.0 ms，p99 均为 13.9 ms。发布校验通过，且超预算的样例仍被拦截。
- Windows 以 Chrome GPU 子进程为范围采样专用显存，两个视口各有 14 个有效样本，峰值分别为 96.15 MB 和 73.72 MB。有一次计数器采样无效，已丢弃。进程计数包含 Chrome 和驱动资源，范围大于引擎资源账本。

### 独立包触屏验收

综合 **90.04 / 100**（一位小数为 **90.0**）。保留原 40／35／25 权重。引擎运行时 84.6、制作工具链 92，验证与交付从 95 升至 96。新增的一分来自正式发布门禁已能检测触摸缺失，并有 Web 和 Toy 独立包正反例。

- Web 和 Toy 的动作包分别在 360 × 800 Chromium 触屏环境点击开始。Pixi Toy 包收到三次可信触摸按下，验证固定摇杆和攻击键双指并用、抬手后停止移动、攻击按钮复位和触屏继续。该包移动视口 p95 16.7 ms。
- 键盘与脚本伪造事件无法通过触屏门禁。旧工具报告即使源码摘要与 ZIP 均匹配，缺少所要求的触屏证据时也无法通过新鲜度检查。
- 同次发布套件保留割草 Toy 与 RTX 4070 竞技场 Web 包覆盖。3D 的两种尺寸仍以键盘运行约 71 秒，p95 均为 7.0 ms，显存估算峰值为 13,855,680 字节。
- 完整六动作输入展示和 Android Chrome、iOS Safari 局域网访问、实体 Xbox、Toy 宿主仍待补证据。
