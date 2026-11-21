import {
  decodeTransformPacket,
  type DecodedTransformDelta,
  type DecodedTransformSnapshot,
  type EncodedSnapshotEntity,
} from '@hgame/network-protocol';
import type { HGameRoomConnection } from './HGameNetworkClient.js';
import { SnapshotInterpolationBuffer } from './interpolation.js';

export interface SnapshotChannelOptions {
  messageType?: string;
  resyncMessageType?: string;
  autoResync?: boolean;
  interpolationDelayMs?: number;
  maxSnapshots?: number;
  maxExtrapolationMs?: number;
  angleFields?: readonly string[];
  now?: () => number;
}

export interface SampledEntityPose {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  flags: number;
}

export interface SnapshotUpdateInfo {
  kind: 'snapshot' | 'delta';
  tick: number;
  baseTick?: number;
  removedIds: readonly number[];
  entities: readonly EncodedSnapshotEntity[];
}

export class HGameSnapshotChannel {
  private readonly messageType: string;
  private readonly resyncMessageType: string;
  private readonly autoResync: boolean;
  private readonly now: () => number;
  private readonly buffer: SnapshotInterpolationBuffer<{ x: number; y: number; z: number; yaw: number }>;
  private readonly baseline = new Map<number, EncodedSnapshotEntity>();
  private readonly updateHandlers = new Set<(info: SnapshotUpdateInfo) => void>();
  private readonly resyncHandlers = new Set<(expectedBaseTick: number, receivedBaseTick: number) => void>();
  private readonly unsubscribeMessage: () => void;
  private readonly unsubscribeReconnect: () => void;

  private lastReceivedTick = 0;
  private resyncPending = false;
  private disposed = false;

  constructor(
    private readonly connection: Pick<HGameRoomConnection, 'onMessage' | 'send'> & Partial<Pick<HGameRoomConnection, 'onReconnect'>>,
    options: SnapshotChannelOptions = {},
  ) {
    this.messageType = options.messageType ?? 'arena:snapshot';
    this.resyncMessageType = options.resyncMessageType ?? 'arena:resync';
    this.autoResync = options.autoResync !== false;
    this.now = options.now ?? (() => performance.now());
    this.buffer = new SnapshotInterpolationBuffer({
      interpolationDelayMs: options.interpolationDelayMs ?? 90,
      maxSnapshots: options.maxSnapshots ?? 32,
      maxExtrapolationMs: options.maxExtrapolationMs ?? 80,
      angleFields: options.angleFields ?? ['yaw'],
    });
    this.unsubscribeMessage = connection.onMessage<Uint8Array>(this.messageType, (bytes) => {
      this.receiveBytes(bytes);
    });
    this.unsubscribeReconnect = typeof connection.onReconnect === 'function'
      ? connection.onReconnect(() => {
        this.lastReceivedTick = 0;
        this.baseline.clear();
        this.buffer.clear();
        if (this.autoResync) this.requestResync();
      })
      : () => undefined;
  }

  get lastTick(): number {
    return this.lastReceivedTick;
  }

  get entityCount(): number {
    return this.baseline.size;
  }

  getEntity(id: number): EncodedSnapshotEntity | undefined {
    const entity = this.baseline.get(id);
    return entity ? { ...entity } : undefined;
  }

  onSnapshot(handler: (info: SnapshotUpdateInfo) => void): () => void {
    if (this.disposed) throw new Error('Snapshot channel is disposed');
    this.updateHandlers.add(handler);
    return () => this.updateHandlers.delete(handler);
  }

  onResyncNeeded(handler: (expectedBaseTick: number, receivedBaseTick: number) => void): () => void {
    if (this.disposed) throw new Error('Snapshot channel is disposed');
    this.resyncHandlers.add(handler);
    return () => this.resyncHandlers.delete(handler);
  }

  requestResync(): void {
    if (this.disposed || this.resyncPending) return;
    this.resyncPending = true;
    this.connection.send(this.resyncMessageType, { lastTick: this.lastReceivedTick });
  }

  receiveBytes(raw: Uint8Array, timestampMs = this.now()): SnapshotUpdateInfo | null {
    if (this.disposed) return null;
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    const decoded = decodeTransformPacket(bytes, Array.from(this.baseline.values()));

    if (decoded.kind === 'snapshot') {
      return this.applySnapshot(decoded, timestampMs);
    }
    return this.applyDelta(decoded, timestampMs);
  }

  sample(nowMs = this.now()): Map<number, SampledEntityPose> {
    const sampled = this.buffer.sample(nowMs);
    const result = new Map<number, SampledEntityPose>();
    for (const [idStr, pose] of sampled) {
      const id = Number(idStr);
      const base = this.baseline.get(id);
      result.set(id, {
        id,
        x: pose.x,
        y: pose.y,
        z: pose.z,
        yaw: pose.yaw,
        flags: base?.flags ?? 0,
      });
    }
    return result;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeMessage();
    this.unsubscribeReconnect();
    this.baseline.clear();
    this.buffer.clear();
    this.updateHandlers.clear();
    this.resyncHandlers.clear();
  }

  private applySnapshot(decoded: DecodedTransformSnapshot, timestampMs: number): SnapshotUpdateInfo {
    this.resyncPending = false;
    this.lastReceivedTick = decoded.tick;
    this.baseline.clear();
    const renderMap = new Map<string, { x: number; y: number; z: number; yaw: number }>();
    for (const entity of decoded.entities) {
      this.baseline.set(entity.id, { ...entity });
      renderMap.set(String(entity.id), { x: entity.x, y: entity.y, z: entity.z, yaw: entity.yaw });
    }
    this.buffer.push(timestampMs, renderMap);
    const info: SnapshotUpdateInfo = {
      kind: 'snapshot',
      tick: decoded.tick,
      removedIds: [],
      entities: decoded.entities,
    };
    for (const handler of this.updateHandlers) handler(info);
    return info;
  }

  private applyDelta(decoded: DecodedTransformDelta, timestampMs: number): SnapshotUpdateInfo | null {
    if (this.lastReceivedTick === 0 || decoded.baseTick !== this.lastReceivedTick) {
      for (const handler of this.resyncHandlers) {
        handler(this.lastReceivedTick, decoded.baseTick);
      }
      if (this.autoResync) this.requestResync();
      return null;
    }

    this.lastReceivedTick = decoded.tick;
    this.baseline.clear();
    const renderMap = new Map<string, { x: number; y: number; z: number; yaw: number }>();
    for (const entity of decoded.entities) {
      this.baseline.set(entity.id, { ...entity });
      renderMap.set(String(entity.id), { x: entity.x, y: entity.y, z: entity.z, yaw: entity.yaw });
    }
    this.buffer.push(timestampMs, renderMap);
    const info: SnapshotUpdateInfo = {
      kind: 'delta',
      tick: decoded.tick,
      baseTick: decoded.baseTick,
      removedIds: decoded.removedIds,
      entities: decoded.entities,
    };
    for (const handler of this.updateHandlers) handler(info);
    return info;
  }
}

export interface PendingPredictionInput<TInput> {
  seq: number;
  dt: number;
  input: TInput;
}

export interface ClientPredictionOptions<TState> {
  initialState: TState;
  cloneState: (state: TState) => TState;
  maxPendingInputs?: number;
  snapThreshold?: number;
}

export class ClientPredictionController<
  TState extends { x: number; y: number },
  TInput,
> {
  private state: TState;
  private readonly cloneState: (state: TState) => TState;
  private readonly maxPendingInputs: number;
  private readonly snapThreshold: number;
  private readonly pending: Array<PendingPredictionInput<TInput>> = [];
  private nextSeq = 1;
  private lastAckedSeq = 0;
  private offsetX = 0;
  private offsetY = 0;

  constructor(options: ClientPredictionOptions<TState>) {
    this.cloneState = options.cloneState;
    this.state = this.cloneState(options.initialState);
    this.maxPendingInputs = options.maxPendingInputs ?? 128;
    this.snapThreshold = options.snapThreshold ?? 120;
  }

  get currentState(): TState {
    return this.state;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  get lastAckSeq(): number {
    return this.lastAckedSeq;
  }

  get visualOffset(): { x: number; y: number } {
    return { x: this.offsetX, y: this.offsetY };
  }

  predict(
    input: TInput,
    dt: number,
    stepFn: (state: TState, input: TInput, dt: number) => void,
  ): number {
    const seq = this.nextSeq++;
    stepFn(this.state, input, dt);
    this.pending.push({ seq, dt, input: structuredClone(input) });
    while (this.pending.length > this.maxPendingInputs) {
      this.pending.shift();
    }
    return seq;
  }

  reconcile(
    ackSeq: number,
    authoritativeState: TState,
    stepFn: (state: TState, input: TInput, dt: number) => void,
  ): void {
    const prevX = this.state.x + this.offsetX;
    const prevY = this.state.y + this.offsetY;

    if (ackSeq > this.lastAckedSeq) {
      this.lastAckedSeq = ackSeq;
    }
    while (this.pending.length > 0 && this.pending[0]!.seq <= this.lastAckedSeq) {
      this.pending.shift();
    }

    const nextState = this.cloneState(authoritativeState);
    for (const entry of this.pending) {
      stepFn(nextState, entry.input, entry.dt);
    }
    this.state = nextState;

    const errX = prevX - this.state.x;
    const errY = prevY - this.state.y;
    if (Math.hypot(errX, errY) > this.snapThreshold) {
      this.offsetX = 0;
      this.offsetY = 0;
    } else {
      this.offsetX = errX;
      this.offsetY = errY;
    }
  }

  decayVisualOffset(dt: number, halfLifeMs = 60): { x: number; y: number } {
    if (dt > 0 && halfLifeMs > 0) {
      const factor = Math.pow(0.5, (dt * 1000) / halfLifeMs);
      this.offsetX = Math.abs(this.offsetX * factor) < 0.01 ? 0 : this.offsetX * factor;
      this.offsetY = Math.abs(this.offsetY * factor) < 0.01 ? 0 : this.offsetY * factor;
    } else if (halfLifeMs <= 0) {
      this.offsetX = 0;
      this.offsetY = 0;
    }
    return {
      x: this.state.x + this.offsetX,
      y: this.state.y + this.offsetY,
    };
  }

  reset(state: TState, nextSeq = 1): void {
    this.state = this.cloneState(state);
    this.pending.length = 0;
    this.nextSeq = nextSeq;
    this.lastAckedSeq = 0;
    this.offsetX = 0;
    this.offsetY = 0;
  }
}
