# 4.12 确定性物理、行为轨迹录制与多人联网

> 子系统速查(AI Agent 用)。完整 API 签名见 `docs/api/API-INDEX.json`。

- **确定性物理（`physics/rapier2d.js`、`physics/rapier3d.js`）**：
  - 固定版本 `@dimforge/rapier2d-deterministic@0.21.0` / `rapier3d-deterministic@0.21.0`，离线与联机永不切换物理后端。
  - 提供 `scene.physics.add(entity, { type: 'dynamic' | 'fixed' | 'kinematicPosition' | 'kinematicVelocity', shape: 'cuboid' | 'ball' | 'capsule' })`、`createCharacterController(entity, { autostep, snapToGround, slide: true })`、`castRay`、`overlaps`、`takeSnapshot` / `restoreSnapshot`、`stateChecksum`。
- **行为轨迹录制（`HGame.createTraceRecorder`）**：
  - 用于高保真玩法校验、AI 复刻对照的 JSONL 逻辑事件记录器，见 [TRACE-RECORDER.md](./TRACE-RECORDER.md)。
- **多人联网（`network/` + `lockstep/`）**：
  - 独立 workspace（先执行 `npm ci --prefix network`），包含 `StateSyncRoom`（状态同步 + `InterestGrid2D` 兴趣网格 + `ReplicationPriorityScheduler` 防饥饿调度 + 二进制快照）、`PredictedRoom`（服务端回溯 `LagCompensationHistory` + 客户端自适应预测提前量 `AdaptiveInputLeadController`）和 `LockstepRoom`（限帧防卡死 `NO_OP` 补帧 + 断线补帧回放），配合客户端 `lockstep/confirmed-frames.js`。详见 [NETWORK.md](../../architecture/NETWORK.md) 与 [LOCKSTEP.md](../../architecture/LOCKSTEP.md)。

## 易错点:TileMap 与物理碰撞体
- 用 `scene.physics.addTileMap(scene, map, { originX, originY, yUp = true, merge = true })` 一键生成 fixed 碰撞体(2D);相邻实心格会合并为最少的矩形。
- TileMap 的 y 轴向下,物理世界 y 轴向上:默认 `yUp: true` 会对 y 取反(格 (x,y) 占世界 y ∈ [originY-(y+1)·th, originY-y·th])。
