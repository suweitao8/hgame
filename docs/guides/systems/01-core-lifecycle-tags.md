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

## 易错点
- UI profile (`tickHz: 0`) 没有循环:仅 `app.start()` 渲染一次;之后状态变化必须由调用方显式 `app.step()` 或自行渲染,引擎不会自动重绘。

## 确定性模拟辅助 (sim/)
- `createSeededRng(seed)`(mulberry32: `next/int/range/pick/shuffle/fork/getState/setState`)、`hashState(value)` / `createStateChecksum()`(FNV-1a;数字、TypedArray、按键排序的普通对象)、`runScripted({ step, script, ticks, checksum })` 用于确定性回放与 lockstep 失步测试。
```js
const rng = createSeededRng(1234);
const r = runScripted({ script: inputs, step: (t, i) => sim.step(i, rng), checksum: () => sim.state });
assert.equal(r.checksum, GOLDEN);
```
