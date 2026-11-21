import { Room, type Client } from '@colyseus/core';
import { schema, t } from '@colyseus/schema';
import {
  encodeTransformDelta,
  encodeTransformSnapshot,
} from '@hgame/network-protocol';
import {
  AoiDeltaPlanner,
  LagCompensationHistory,
  createArenaMotionState,
  stepArenaMotion2D,
  type ArenaMotionConfig,
  type ArenaMotionInput,
  type ArenaMotionState,
  type HitVerificationResult,
  type LagCompensatedPose,
  type Ray2D,
} from '@hgame/network-simulation';
import {
  TokenBucketRateLimiter,
  allocateSlot,
  createMatchTag,
  handleRoomDrop,
  validateMaxClients,
  validateRateLimit,
  validateReconnectSeconds,
} from './shared.js';

const AuthorityArenaPlayer = schema({
  slot: t.uint8().default(0),
  entityId: t.uint32().default(0),
  connected: t.boolean().default(true),
  lastInputSeq: t.uint32().default(0),
  spectatingEntityId: t.uint32().default(0),
});

export const AuthorityArenaState = schema({
  gameId: t.string().default(''),
  matchTag: t.uint32().default(0),
  serverTick: t.uint32().default(0),
  tickHz: t.uint16().default(30),
  actorCount: t.uint16().default(0),
  players: t.map(AuthorityArenaPlayer),
});

export interface ArenaSelfAckPayload {
  tick: number;
  ackSeq: number;
  entityId: number;
  x: number;
  y: number;
  yaw: number;
  dashTimer: number;
  dashCooldown: number;
  dashDirX: number;
  dashDirY: number;
}

/**
 * Generic authoritative arena synchronization room combining:
 * - `AoiDeltaPlanner` (`InterestGrid2D` + `ReplicationPriorityScheduler`)
 * - Binary transform snapshots & delta compression (`encodeTransformSnapshot` / `encodeTransformDelta`)
 * - Server-side `LagCompensationHistory` for bounded rewind hit verification
 * - Monotonic client input sequence tracking (`arena:self` reconciliation acks)
 * - Seamless spectator AOI target rebinding (`arena:spectate`)
 */
export class AuthorityArenaRoom extends Room {
  state = new AuthorityArenaState();
  protected reconnectSeconds = 45;
  protected tickHz = 30;
  protected aoiEnterRadius = 480;
  protected aoiExitRadius = 560;
  protected maxEntitiesPerPacket = 64;
  protected maxBytesPerPacket = 1600;
  protected positionScale = 1000;
  protected motionConfig: ArenaMotionConfig = {
    speed: 220,
    dashSpeed: 620,
    dashDuration: 0.14,
    dashCooldown: 0.7,
    radius: 14,
    bounds: { minX: -1200, minY: -1200, maxX: 1200, maxY: 1200 },
  };

  protected readonly replicator = new AoiDeltaPlanner({ cellSize: 128 });
  protected readonly lagHistory = new LagCompensationHistory(64);
  protected readonly actors = new Map<number, ArenaMotionState>();
  protected readonly actorFlags = new Map<number, number>();
  protected readonly pendingInputs = new Map<string, ArenaMotionInput[]>();
  protected readonly lastInputs = new Map<string, ArenaMotionInput>();
  protected inputLimiter = new TokenBucketRateLimiter(64, 120);
  protected nextEntityId = 1;
  protected simTimestampMs = 0;

  onCreate(options: Record<string, unknown> = {}): void {
    this.maxClients = validateMaxClients(options.maxClients, 32);
    this.reconnectSeconds = validateReconnectSeconds(options.reconnectSeconds, 45);
    this.tickHz = Number(options.tickHz ?? 30);
    if (!Number.isInteger(this.tickHz) || this.tickHz < 10 || this.tickHz > 60) {
      throw new RangeError('AuthorityArenaRoom tickHz must be an integer from 10 to 60');
    }

    const enterRadius = Number(options.aoiEnterRadius ?? 480);
    const exitRadius = Number(options.aoiExitRadius ?? Math.round(enterRadius * 1.18));
    if (!Number.isFinite(enterRadius) || enterRadius <= 0 || !Number.isFinite(exitRadius) || exitRadius < enterRadius) {
      throw new RangeError('Invalid AOI radius configuration');
    }
    this.aoiEnterRadius = enterRadius;
    this.aoiExitRadius = exitRadius;

    if (options.maxEntitiesPerPacket !== undefined) {
      const cap = Number(options.maxEntitiesPerPacket);
      if (!Number.isInteger(cap) || cap < 1 || cap > 4096) throw new RangeError('Invalid maxEntitiesPerPacket');
      this.maxEntitiesPerPacket = cap;
    }
    if (options.maxBytesPerPacket !== undefined) {
      const bytes = Number(options.maxBytesPerPacket);
      if (!Number.isInteger(bytes) || bytes < 64 || bytes > 65535) throw new RangeError('Invalid maxBytesPerPacket');
      this.maxBytesPerPacket = bytes;
    }

    const maxInputsPerSecond = validateRateLimit(
      options.maxInputsPerSecond,
      Math.max(60, this.tickHz * 4),
      10,
      600,
      'maxInputsPerSecond',
    );
    this.inputLimiter = new TokenBucketRateLimiter(Math.max(32, maxInputsPerSecond), maxInputsPerSecond);

    this.state.gameId = typeof options.gameId === 'string' ? options.gameId : 'network-lab';
    this.state.matchTag = createMatchTag();
    this.state.tickHz = this.tickHz;
    this.patchRate = 100;

    this.onMessage('arena:input', (client, payload: unknown) => this.receiveArenaInput(client, payload));
    this.onMessage('arena:resync', (client) => this.replicator.resetObserver(client.sessionId));
    this.onMessage('arena:spectate', (client, payload: unknown) => this.handleSpectate(client, payload));
    this.onMessage('arena:hit-check', (client, payload: unknown) => this.handleHitCheck(client, payload));

    this.setFixedTimestep((ctx) => this.stepTick(ctx.dt), this.tickHz);
  }

  onJoin(client: Client): void {
    const slot = allocateSlot(this.state.players.values(), this.maxClients);
    const entityId = this.allocateEntityId();
    const spawnAngle = (slot / Math.max(1, this.maxClients)) * Math.PI * 2;
    const spawnRadius = 80;
    const actor = createArenaMotionState(
      Math.cos(spawnAngle) * spawnRadius,
      Math.sin(spawnAngle) * spawnRadius,
      spawnAngle,
    );

    this.actors.set(entityId, actor);
    this.actorFlags.set(entityId, 1);
    this.replicator.upsertEntity({
      id: entityId,
      x: actor.x,
      y: actor.y,
      yaw: actor.yaw,
      flags: 1,
      basePriority: 2,
    });
    this.replicator.setObserver(client.sessionId, {
      x: actor.x,
      y: actor.y,
      followEntityId: entityId,
      enterRadius: this.aoiEnterRadius,
      exitRadius: this.aoiExitRadius,
      maxEntities: this.maxEntitiesPerPacket,
      maxBytes: this.maxBytesPerPacket,
    });

    const player = new AuthorityArenaPlayer();
    player.slot = slot;
    player.entityId = entityId;
    player.connected = true;
    player.lastInputSeq = 0;
    player.spectatingEntityId = 0;
    this.state.players.set(client.sessionId, player);
    this.state.actorCount = this.actors.size;
  }

  onDrop(client: Client): void {
    handleRoomDrop(this, client, this.state.players.get(client.sessionId), this.reconnectSeconds);
  }

  onReconnect(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = true;
    this.replicator.resetObserver(client.sessionId);
  }

  onLeave(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      this.actors.delete(player.entityId);
      this.actorFlags.delete(player.entityId);
      this.replicator.removeEntity(player.entityId);
    }
    this.state.players.delete(client.sessionId);
    this.pendingInputs.delete(client.sessionId);
    this.lastInputs.delete(client.sessionId);
    this.inputLimiter.remove(client.sessionId);
    this.replicator.removeObserver(client.sessionId);
    this.state.actorCount = this.actors.size;
  }

  protected allocateEntityId(): number {
    return this.nextEntityId++;
  }

  protected getMotionConfig(): ArenaMotionConfig {
    return this.motionConfig;
  }

  protected onBeforeTick(_dt: number, _tick: number): void {}

  protected onAfterTick(_dt: number, _tick: number): void {}

  verifyHit2D(
    shooterEntityId: number,
    targetTimestampMs: number,
    ray: Ray2D,
    maxRewindMs = 250,
    defaultRadius = 14,
  ): HitVerificationResult {
    return this.lagHistory.verifyHit2D({
      shooterId: String(shooterEntityId),
      targetTimestampMs,
      nowTimestampMs: this.simTimestampMs,
      maxRewindMs,
      ray,
      defaultRadius,
    });
  }

  private receiveArenaInput(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || !player.connected) return;
    if (!this.inputLimiter.consume(client.sessionId)) {
      client.send('arena:rejected', { reason: 'rate limit exceeded' });
      return;
    }
    if (!payload || typeof payload !== 'object') {
      client.send('arena:rejected', { reason: 'invalid input payload' });
      return;
    }
    const raw = payload as Record<string, unknown>;
    const seq = Number(raw.seq);
    const moveX = Number(raw.moveX ?? 0);
    const moveY = Number(raw.moveY ?? 0);
    if (!Number.isInteger(seq) || seq <= player.lastInputSeq || seq > 0xffff_ffff) {
      return;
    }
    if (!Number.isFinite(moveX) || !Number.isFinite(moveY)) {
      client.send('arena:rejected', { reason: 'non-finite move axes' });
      return;
    }

    const input: ArenaMotionInput = {
      moveX: Math.max(-1, Math.min(1, moveX)),
      moveY: Math.max(-1, Math.min(1, moveY)),
      dashPressed: Boolean(raw.dashPressed),
    };
    if (raw.aimX !== undefined && raw.aimY !== undefined) {
      const aimX = Number(raw.aimX);
      const aimY = Number(raw.aimY);
      if (Number.isFinite(aimX) && Number.isFinite(aimY)) {
        input.aimX = aimX;
        input.aimY = aimY;
      }
    }

    player.lastInputSeq = seq;
    let queue = this.pendingInputs.get(client.sessionId);
    if (!queue) {
      queue = [];
      this.pendingInputs.set(client.sessionId, queue);
    }
    if (queue.length < 16) {
      queue.push(input);
    }
  }

  private handleSpectate(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || !payload || typeof payload !== 'object') return;
    const rawTarget = (payload as { targetEntityId?: unknown }).targetEntityId;
    if (rawTarget === null || rawTarget === 0) {
      player.spectatingEntityId = 0;
      this.replicator.setObserverFollow(client.sessionId, this.actors.has(player.entityId) ? player.entityId : null);
      return;
    }
    const targetId = Number(rawTarget);
    if (!Number.isInteger(targetId) || !this.actors.has(targetId)) return;
    player.spectatingEntityId = targetId;
    this.replicator.setObserverFollow(client.sessionId, targetId);
  }

  private handleHitCheck(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || !payload || typeof payload !== 'object') return;
    const raw = payload as Record<string, unknown>;
    const targetTimestampMs = Number(raw.targetTimestampMs ?? this.simTimestampMs);
    const originX = Number(raw.originX);
    const originY = Number(raw.originY);
    const dirX = Number(raw.dirX);
    const dirY = Number(raw.dirY);
    const maxDistance = Number(raw.maxDistance ?? 240);
    if (![targetTimestampMs, originX, originY, dirX, dirY, maxDistance].every(Number.isFinite)) return;

    const result = this.verifyHit2D(player.entityId, targetTimestampMs, {
      originX,
      originY,
      dirX,
      dirY,
      maxDistance: Math.max(1, Math.min(2000, maxDistance)),
    });
    client.send('arena:hit-result', result);
  }

  protected stepTick(dtSeconds: number): void {
    const dt = dtSeconds;
    const nextTick = this.state.serverTick + 1;
    this.state.serverTick = nextTick;
    this.simTimestampMs += dt * 1000;

    this.onBeforeTick(dt, nextTick);

    const cfg = this.getMotionConfig();
    for (const [sessionId, player] of this.state.players) {
      const actor = this.actors.get(player.entityId);
      if (!actor) continue;
      const queue = this.pendingInputs.get(sessionId);
      const input = queue && queue.length > 0
        ? queue.shift()!
        : (this.lastInputs.get(sessionId) ?? { moveX: 0, moveY: 0, dashPressed: false });
      const repeatedInput: ArenaMotionInput = { moveX: input.moveX, moveY: input.moveY, dashPressed: false };
      if (input.aimX !== undefined) repeatedInput.aimX = input.aimX;
      if (input.aimY !== undefined) repeatedInput.aimY = input.aimY;
      this.lastInputs.set(sessionId, repeatedInput);

      stepArenaMotion2D(actor, input, dt, cfg);
      const flags = (actor.dashTimer > 0 ? 2 : 0) | 1;
      this.actorFlags.set(player.entityId, flags);
      this.replicator.upsertEntity({
        id: player.entityId,
        x: actor.x,
        y: actor.y,
        yaw: actor.yaw,
        flags,
        basePriority: 2,
      });
    }

    this.onAfterTick(dt, nextTick);

    // Record poses for lag-compensated hit verification.
    const poses = new Map<string, LagCompensatedPose>();
    for (const [id, actor] of this.actors) {
      poses.set(String(id), { x: actor.x, y: actor.y, radius: cfg.radius ?? 14 });
    }
    this.lagHistory.record(nextTick, this.simTimestampMs, poses);
    this.state.actorCount = this.actors.size;

    // Emit per-observer AOI binary snapshots/deltas and per-player prediction acks.
    for (const client of this.clients) {
      const player = this.state.players.get(client.sessionId);
      if (!player?.connected) continue;

      const plan = this.replicator.planForObserver(client.sessionId, nextTick, dt);
      if (plan) {
        const packet = plan.kind === 'snapshot'
          ? encodeTransformSnapshot({
            tick: plan.tick,
            positionScale: this.positionScale,
            entities: plan.entities,
          })
          : encodeTransformDelta({
            tick: plan.tick,
            baseTick: plan.baseTick,
            positionScale: this.positionScale,
            prevEntities: plan.prevEntities,
            upserts: plan.upserts,
            removedIds: plan.removedIds,
          });
        client.sendBytes('arena:snapshot', packet);
      }

      const selfActor = this.actors.get(player.entityId);
      if (selfActor) {
        const ack: ArenaSelfAckPayload = {
          tick: nextTick,
          ackSeq: player.lastInputSeq,
          entityId: player.entityId,
          x: selfActor.x,
          y: selfActor.y,
          yaw: selfActor.yaw,
          dashTimer: selfActor.dashTimer,
          dashCooldown: selfActor.dashCooldown,
          dashDirX: selfActor.dashDirX,
          dashDirY: selfActor.dashDirY,
        };
        client.send('arena:self', ack);
      }
    }
  }
}
