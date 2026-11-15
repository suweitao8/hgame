# Unity 原作逆向 → HTML 游戏：二维/三维独立判定与模块映射

## 1. Unity 只是原作技术标签，不决定目标渲染维度

Unity 场景内部通常带 3D Transform；实际玩法可使用 2D Sprite、正交摄像机、UI Canvas，或真正的 3D 模型、透视相机和物理。不能因为识别到 UnityPlayer.dll 就自动创建 Three.js 3D 项目。

至少检查两种独立来源（例如脚本或资源 + 运行时截图/录屏）：

| 需要确认的事实 | 典型 2D 证据 | 典型 3D 证据 |
|---|---|---|
| 摄像机 | Orthographic、固定平面/2.5D、Sprite/Tilemap | Perspective、可旋转 3D 空间、深度与投影 |
| 物理 | Rigidbody2D、Collider2D、Physics2D | Rigidbody、Collider、PhysX、Physics |
| 视觉 | SpriteRenderer、Canvas、Sorting Layer、2D Animator | MeshRenderer、SkinnedMeshRenderer、光照、Shader、骨骼模型 |
| 地图 | Tilemap、2D Trigger、Grid/Nav2D | Terrain、Mesh/Volume、NavMesh、3D Trigger |
| 控制 | 屏幕平面移动/点击、轴向滑动 | 地面平面/空间移动、镜头空间移动、射线检测 |
| 游戏流程 | 逐层状态/回合制也可能是 UI | 3D 并不意味着一定需要每帧物理 |

有混合模式要记录：2.5D、World Space UI、3D 视觉 + 2D 逻辑、正交 3D 场景。**不能通过少量文件名就断言维度。**

## 2. 复制设计规律，不复制 Unity 内部代码（默认目标底座：`HGame`）

Web 复刻默认统一基于 `HGame 1.0.0` 引擎与净室规格桥（`export-clean-spec.mjs` → `hgame-spec-forge`），不再手搓野生单 HTML `requestAnimationFrame` 主循环：

| 原版 Unity 概念 | HGame 1.0.0 目标对应 | 说明 / `hgame-fallback` 边界 |
|---|---|---|
| GameObject / MonoBehaviour | `HGame` `Scene`、`Entity`、`Component`、`addTag` | 单一 `app.start()` 调度器，禁止手写第二个 RAF |
| Awake/Start/FixedUpdate/Update | `Entity` 生命周期与 `tickHz` 固定步长 | 原脚本执行顺序与步长须记 `seen` |
| Prefab / ScriptableObject | `src/sim/` 声明式 JSON 配置 + 净室 `clean-spec.json` | 仅提取数值、字段、权重与覆盖优先级 |
| Input System / Input.GetAxis | `app.input` + `HGame.createArcadeControls` / `touch-controls.js` | 遵循 P1 `WASD + JKL UIO` 标准键位 |
| Physics2D / 3D PhysX | `physics/rapier2d.js` / `physics/rapier3d.js`（或 `hgame-fallback` 碰撞） | 严禁浪费精力逆向底层物理求解器 |
| AnimationClip / Animator | `SpriteSheet.fromGrid`、`AnimationPlayer`、`BoneVatCrowd3D` | 仅提取技能前摇/命中帧/后摇时间窗；骨骼状态机标 `hgame-fallback` |
| Tilemap / NavMesh | `world/tilemap.js` (`findGridPath`) / `world/navmesh3d.js` / `FlowField2D` | 寻路网格底层标 `hgame-fallback`，由 HGame 原生接管 |
| URP/HDRP/Shader/VFX/Audio | `vfx/index.js` (`createVfxSystem`)、`platform/audio.js` (`playSynth`)、`integrations/three.js` | 底层 Shader、复杂材质与私有视听资源一律标 `hgame-fallback` |

HGame 没有 Unity `.unity` Scene 导入器；必须先通过 `export-clean-spec.mjs` 将机制与数值转为脱敏净室规格，再由 `HGame` 的 `create-game.mjs` 与 `hgame-spec-forge` 装配。

## 3. 先恢复规则/数学，再确定 Renderer

逆向阶段至少固定：

- 原版版本、固定更新时间（Time.fixedDeltaTime）、Update/FixedUpdate 调用顺序、输入采样和 RNG 种子。
- 游戏对象坐标系（平面/三维）、方向轴、重心和动画驱动关系；是否采用 root motion。
- 碰撞形状、layer/mask、trigger/contact、射弹运动、攻击判定帧与硬直。
- AI 感知、状态机、路径计算、移动/攻击优先级、脱困方式、机关/地编。
- 数据配置的原始字段、默认值、优先级和覆盖，批量核对总量与引用关系。
- 运行时与源代码证据分别登记；未经双证据确认的按 inferred/unknown 处理。

## 4. 选择最小合法技术配置

研究项目的 production/rebuild-plan.json 需要**人工确认选择** profile，不能由 Unity 扫描候选自动决定。

    node ".agents/skills/hgame-reverse-engineering/scripts/plan-rebuild.mjs" "<research-dir>" --profile 2d --target "<new-game-dir>" --evidence "scene camera ortho + Rigidbody2D in source"

对于真实 3D：

    node ".agents/skills/hgame-reverse-engineering/scripts/plan-rebuild.mjs" "<research-dir>" --profile 3d --target "<new-game-dir>" --evidence "runtime perspective camera, 3D mesh and 3D collider"

计划工具只写独立研究目录内的 rebuild-plan.json，拒绝覆盖已有计划。evidence 字符串是**声明而不是自动核验**（verified=false），必须后续补 source anchor。

确定配置后，再用全局 hgame 的 create-game.mjs --profile 2d|3d|ui 创建目标项目。不要为了统一而强制迁移已有工作量。

## 5. 按需使用系统，不做“伪完整复刻”

- 2D 物理若包含高速射弹/旋转刚体/关节，Rapier2D 不等同原版 Box2D；需做 A/B 差异并记录偏差。
- 3D 游戏默认仅有 Three.js Render；可按需启用 physics3d（deterministic Rapier3D），但与原版 PhysX 的精度差异、角色控制器、NavMesh、骨骼/IK 和模型导入必须另选可验证适配器，不能宣称与原版等价。
- 卡牌/剧情/经营优先 DOM + 命令驱动，不能把“引擎统一”理解为必须每秒固定 60 次更新。
- Unity 资产可能受版权保护；本地研究不等于拥有公开分发权限；目标项目优先独立代码与获授权资源。

## 6. 可验证交付

- Source evidence：类名与调用路径、字段、反编译或二进制证据、运行观察、可信度。
- Fidelity：每个目标机制对应 coverage.csv 一行，区分 reverse/implementation/verification。
- 运行：浏览器实际按键、地图阻挡、AI 长时间模拟、碰撞边界、帧动画、音频解锁、存档恢复、无 404。
- 危险假设：明示未识别/未知部分，不能仅以“画面像 Unity 原版”声明还原完成。

## 相关参考

- Unity 生命周期：https://docs.unity.cn/Components/execution-order.html
- Unity 2D / 3D Physics：https://docs.unity.com/en-us/engine/6000.0/manual/physics-section
- 引擎 Playbooks：`references/playbooks/engine-playbooks.md`
- HGame 引擎规范：`docs/ENGINE.md` 与 `.agents/skills/hgame/SKILL.md`
