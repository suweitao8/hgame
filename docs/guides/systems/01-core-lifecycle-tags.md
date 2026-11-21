# 4.1 核心生命周期、渲染插值与 GameplayTags

> 子系统速查(AI Agent 用)。完整 API 签名见 `docs/api/API-INDEX.json`。

- **文件**：`vendor/hgame/index.js`、`vendor/hgame/core/*`
- **何时用**：所有游戏都通过 `HGame.createApplication` 托管唯一 `requestAnimationFrame` 与固定步长物理循环；需要在高刷新率屏幕上消除物理步长锯齿时读取 `app.renderAlpha` / `entity.interpolatedWorldPosition(app.renderAlpha)`；需要打击顿帧或子弹时间时调用 `app.hitStop(...)` / `app.setTimeScale(...)`；需要分层状态标签（如 `State.Movement.Dashing`）时用 Entity GameplayTags。

```js
import { HGame, Component, Entity, Scene } from '../vendor/hgame/index.js';

const project = HGame.defineProject(engineConfig);
const app = HGame.createApplication({ project, gameId: gameConfig.id, gameVersion: gameConfig.version, renderer });
await app.installFeatures();

const scene = app.scenes.add(new Scene('main'));
const hero = scene.add(new Entity({ name: 'hero', x: 0, y: 0, width: 48, height: 64 }));
hero.addTag('Faction.Player');
hero.addTag('State.Buff.Haste');

// 查询所有带 State 标签的激活实体
const buffed = scene.queryTags({ all: ['Faction.Player'], any: ['State'] }, { activeOnly: true });

// 命中顿帧与慢动作
app.hitStop(0.06);      // 顿帧 60ms（期间 hitStopTimeScale 默认为 0）
app.setTimeScale(0.5);  // 全局 0.5x 子弹时间
```

## 调度扩展与场景生命周期

通过 `app.onPhase(phase, callback, { order, signal })` 把同步扩展接入应用调度。较小的 `order` 较早执行，同值按注册顺序执行。注册返回幂等的注销函数。运行某个阶段时新增的回调从该阶段下次执行开始生效，已注销的回调立即跳过。

| 阶段 | 调用位置 |
| --- | --- |
| `beforeFixedUpdate` | 每个固定步捕获上一帧变换后，场景和组件 `fixedUpdate` 前 |
| `afterPhysics` | 每个固定步的物理推进后，输入边沿清理前。未启用物理时同样执行 |
| `beforeUpdate` | 固定步完成后，场景和组件 `update` 前 |
| `beforeLateUpdate` | 同一次场景激活的 `update` 后、`lateUpdate` 前 |
| `beforeRender` | 绘制当前场景前 |
| `afterRender` | 当前场景绘制完成并记入帧统计后 |

回调接收 `{ phase, app, scene, signal, deltaSeconds }`。固定步阶段使用固定秒数，其他阶段使用缩放后的帧秒数。由 `start`、`resume` 或 `dispatch` 触发的单次绘制使用 0 秒。回调切换场景时，旧激活本阶段剩余的回调和更新会跳过。指令驱动应用在绘制中收到 `dispatch` 时立即执行指令，把重绘合并到下一次绘制请求。帧内重复调用 `app.step()` 会抛出错误。

每次激活均在组件 `onEnable` 和场景 `enter` 前创建 `scene.activationSignal`。场景停用时先取消该信号，再调用组件 `onDisable` 和场景 `exit`。非激活场景的属性值为 `null`。需要在场景切走时取消的加载和扩展同时使用这个信号。

```js
class Battle extends Scene {
  enter(app) {
    const signal = this.activationSignal;
    app.onPhase('afterPhysics', ({ deltaSeconds }) => this.syncSensors(deltaSeconds), { signal });
    void this.loadEffects(signal).catch(error => {
      if (!signal.aborted) app.platform.diagnostics.reportError(error);
    });
  }
}
```

普通切换先退出旧场景，再进入新场景。普通进入失败时，新场景停用并清空当前场景，可重新选择场景。`activatePrepared` 在候选进入成功后才停用旧场景，候选回滚仅取消自己的信号。通过 `app.scenes.remove(name)` 移除已注册场景。每次管理器调用 `enter` 后，对应的 `exit` 最多执行一次，即使回调触发了重入销毁。实体和物理销毁后执行 `scene.onDispose` 注册的清理，顺序与注册相反。

阶段异常归因与取消传播：调度器实时追踪 `app.activePhase`（`fixedUpdate`、`physics`、`input`、`update`、`lateUpdate`、`render`、`phaseHook:<name>`、`sceneEnter`、`sceneExit`、`command`、`dispose`）与 `app.activeScene`，任一阶段异常会携带 `phase` 与 `scene` 上下文记入 `diagnostics.snapshot().lastPhaseError` 并保证状态复位；场景切换、移除、销毁与候选回滚会把明确的取消原因写入 `activationSignal.reason` 并记入 `diagnostics.snapshot().sceneCancellations`。

## 易错点
- `tickHz: 0` 的应用按需渲染。`app.start()`、`app.dispatch()` 和 `app.step()` 可触发绘制。空闲时无需调度帧。

## 确定性模拟辅助 (sim/)
- `createSeededRng(seed)`(mulberry32: `next/int/range/pick/shuffle/fork/getState/setState`)、`hashState(value)` / `createStateChecksum()`(FNV-1a;数字、TypedArray、按键排序的普通对象)、`runScripted({ step, script, ticks, checksum })` 用于确定性回放与 lockstep 失步测试。
```js
const rng = createSeededRng(1234);
const r = runScripted({ script: inputs, step: (t, i) => sim.step(i, rng), checksum: () => sim.state });
assert.equal(r.checksum, GOLDEN);
```
