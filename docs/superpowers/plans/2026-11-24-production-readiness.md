# HGame production-readiness iteration

**Goal**: Reach at least 90/100 on the existing 40% runtime, 35% production kit, and 25% verification and delivery rubric.

1. Recover repository-owned test and benchmark inputs. Keep private and local assets excluded. Restore the two public Arena fixtures from their existing Git history. Verify Node, WebAsset, network, example packaging, and browser recipes using a checkout containing only versioned inputs.
2. Put the approved action bindings and touch layout into a reusable runtime preset. Integrate it into the generated action archetype with input and mode-switch regression coverage. Verify the normal generated entry and a standalone release.
3. Add a narrowly scoped LAN preview option for one selected game. Keep management on loopback. Verify route isolation, serving on an explicitly selected interface, and mobile reconnect/multi-touch behavior.
4. Split playable and release evidence in acceptance. Require applicable mandatory release gates and measured target-device budgets. Reassess the same rubric against the resulting evidence and mark device or platform gaps explicitly.
5. Reconcile the engine scorecard prose with its structured data and evaluate any remaining runtime deficit using reproducible measurements before claiming the target.
6. Use the existing i18n service for the generated action game's stock shell and touch labels. Select Chinese or English from `?lang=` or the browser language. Keep authored titles and unrecognized choice labels. Extend the generated-game browser test to verify the default English browser and the Chinese override.

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

### 距离 90 分的主要缺口

1. 交付需要补上 Android Chrome、iOS Safari、实体 Xbox 和目标 Toy 宿主的实测。重点是局域网打开、移动同时出招、返回前台、设备断连与恢复，以及代表性低端手机的帧时间。
2. 制作能力需要在默认 Pixi 和其他常用原型上验证同一套输入、键位提示及本地化接线，并用有完整循环的样例验证发布流程。
3. 运行时仍需验证长时帧尾与显存峰值，处理 3D 主管线与 WebGPU 接线、持续分配的渲染目标、主线程骨骼动画等评分卡缺项。
