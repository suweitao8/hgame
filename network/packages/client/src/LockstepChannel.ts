import {
  ConfirmedFrameQueue,
  LockstepInputFlags,
  decodeConfirmedFrame,
  decodeLockstepCheckpoint,
  encodeLockstepCheckpoint,
  encodeLockstepInput,
  type ConfirmedLockstepFrame,
  type LockstepCheckpointPacket,
} from '@hgame/network-protocol';
import type { HGameRoomConnection } from './HGameNetworkClient.js';
import { AdaptiveInputLeadController } from './interpolation.js';

export interface LockstepSyncStatus {
  ok: boolean;
  fromNetTick?: number;
  toNetTick?: number;
  sentFrames?: number;
  sentBytes?: number;
  hasMore?: boolean;
  reason?: string;
  retryAfterMs?: number;
  oldestAvailableTick?: number | null;
  checkpointTick?: number | null;
  currentNetTick?: number;
}

export interface LockstepWelcomeInfo {
  matchTag: number;
  slot: number;
  netHz: number;
  currentNetTick: number;
  lastInputSequence: number;
  oldestAvailableTick: number | null;
  trustedCheckpointTick: number | null;
  reconnected: boolean;
}

export interface LockstepCatchupState {
  catchingUp: boolean;
  currentTick: number;
  targetTick: number;
}

export type LockstepCheckpointProvider = (
  request: { netTick: number; stateHash: number },
) => Uint8Array | null | Promise<Uint8Array | null>;

export interface LockstepChannelOptions {
  autoSyncOnReconnect?: boolean;
  autoRestoreCheckpoint?: boolean;
  requestWelcomeOnStart?: boolean;
  minLeadTicks?: number;
  maxLeadTicks?: number;
  safetyMarginMs?: number;
  netHz?: number;
}

export class HGameLockstepChannel {
  private sequence = 0;
  private lastTargetNetTick = 0;
  private serverNetTick = 0;
  private serverNetHz = 20;
  private disposed = false;
  private syncFrom = 0;
  private syncRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private queuedSyncFrom = 0;
  private replayThrough = 0;
  private replayPaused = false;
  private flushingFrames = false;
  private catchingUp = false;
  private snapshotRequested = false;

  private readonly autoSyncOnReconnect: boolean;
  private readonly autoRestoreCheckpoint: boolean;
  private readonly leadController: AdaptiveInputLeadController;
  private readonly queue: ConfirmedFrameQueue;
  private readonly handlers = new Set<(frame: ConfirmedLockstepFrame) => void>();
  private frameSubscribers: Array<(frame: ConfirmedLockstepFrame) => void> | null = null;
  private readonly syncStatusHandlers = new Set<(status: LockstepSyncStatus) => void>();
  private readonly welcomeHandlers = new Set<(welcome: LockstepWelcomeInfo) => void>();
  private readonly checkpointHandlers = new Set<(checkpoint: LockstepCheckpointPacket) => void>();
  private readonly catchupHandlers = new Set<(state: LockstepCatchupState) => void>();
  private checkpointProvider: LockstepCheckpointProvider | null = null;

  private readonly unsubscribeFrame: () => void;
  private readonly unsubscribeSyncStatus: () => void;
  private readonly unsubscribeWelcome: () => void;
  private readonly unsubscribeSnapshot: () => void;
  private readonly unsubscribeRequestCheckpoint: () => void;
  private readonly unsubscribePong: () => void;
  private readonly unsubscribeReconnect: () => void;

  constructor(
    private readonly connection: HGameRoomConnection,
    readonly matchTag: number,
    firstNetTick = 1,
    maxBufferedFrames = 64,
    firstSequence = 1,
    options: LockstepChannelOptions = {},
  ) {
    if (!Number.isInteger(firstSequence) || firstSequence < 1 || firstSequence > 0xffff_ffff) {
      throw new RangeError('firstSequence must be a positive UInt32');
    }
    this.autoSyncOnReconnect = options.autoSyncOnReconnect !== false;
    this.autoRestoreCheckpoint = options.autoRestoreCheckpoint !== false;
    this.serverNetHz = options.netHz ?? 20;
    this.sequence = firstSequence - 1;
    this.leadController = new AdaptiveInputLeadController({
      minLeadTicks: options.minLeadTicks ?? 1,
      maxLeadTicks: options.maxLeadTicks ?? 8,
      safetyMarginMs: options.safetyMarginMs ?? 12,
    });
    this.queue = new ConfirmedFrameQueue(matchTag, firstNetTick, maxBufferedFrames);

    this.unsubscribeFrame = connection.onMessage<Uint8Array>('lockstep:frame', (bytes) => this.receive(bytes));
    this.unsubscribeSyncStatus = connection.onMessage<LockstepSyncStatus>(
      'lockstep:sync-status',
      (status) => this.receiveSyncStatus(status),
    );
    this.unsubscribeWelcome = connection.onMessage<LockstepWelcomeInfo>(
      'lockstep:welcome',
      (welcome) => this.receiveWelcome(welcome),
    );
    this.unsubscribeSnapshot = connection.onMessage<Uint8Array>(
      'lockstep:snapshot',
      (bytes) => this.receiveSnapshot(bytes),
    );
    this.unsubscribeRequestCheckpoint = connection.onMessage<{ netTick: number; stateHash: number }>(
      'lockstep:request-checkpoint',
      (req) => { void this.handleCheckpointRequest(req); },
    );
    this.unsubscribePong = connection.onMessage<{ clientTimeMs: number; serverTick: number }>(
      'lockstep:pong',
      (pong) => this.receivePong(pong),
    );
    this.unsubscribeReconnect = this.autoSyncOnReconnect && typeof connection.onReconnect === 'function'
      ? (() => {
        const sub = connection.onReconnect(() => {
          this.cancelReplayRetry();
          this.syncFrom = 0;
          this.snapshotRequested = false;
          this.replayPaused = false;
          this.replayThrough = Math.max(this.replayThrough, this.expectedNetTick);
          this.resumeReplay();
        });
        return typeof sub === 'function' ? sub : () => undefined;
      })()
      : () => undefined;

    if (options.requestWelcomeOnStart) {
      this.requestWelcome();
    }
  }

  requestWelcome(): void {
    if (this.disposed) return;
    this.connection.send('lockstep:hello', {});
  }

  ping(nowMs = performance.now()): void {
    if (this.disposed) return;
    this.connection.send('lockstep:ping', { clientTimeMs: nowMs });
  }

  recommendTargetNetTick(minTick = this.expectedNetTick): number {
    const lead = this.leadController.recommendLeadTicks(this.serverNetHz);
    return Math.max(this.lastTargetNetTick + 1, this.serverNetTick + lead, minTick, 1);
  }

  sendLiveInput(
    payload: Uint8Array,
    flags = LockstepInputFlags.NONE,
  ): { sequence: number; targetNetTick: number } {
    const targetNetTick = this.recommendTargetNetTick();
    const sequence = this.sendInput(targetNetTick, payload, flags);
    return { sequence, targetNetTick };
  }

  sendInput(targetNetTick: number, payload: Uint8Array, flags = LockstepInputFlags.NONE): number {
    if (this.disposed) throw new Error('Lockstep channel is disposed');
    if (!Number.isInteger(targetNetTick) || targetNetTick < 1 || targetNetTick > 0xffff_ffff || targetNetTick <= this.lastTargetNetTick) {
      throw new RangeError('targetNetTick must increase strictly for each player input');
    }
    if (this.sequence >= 0xffff_ffff) throw new RangeError('Lockstep input sequence exhausted');
    const sequence = this.sequence + 1;
    const packet = encodeLockstepInput({
      matchTag: this.matchTag,
      sequence,
      targetNetTick,
      flags,
      payload,
    });
    this.connection.sendBytes('lockstep:input', packet);
    this.sequence = sequence;
    this.lastTargetNetTick = targetNetTick;
    return sequence;
  }

  sendNoOp(targetNetTick: number): number {
    return this.sendInput(targetNetTick, new Uint8Array(), LockstepInputFlags.NO_OP);
  }

  reportHash(netTick: number, hash: number): void {
    if (this.disposed) return;
    this.connection.send('lockstep:hash', { netTick, hash });
  }

  requestSync(fromNetTick = this.expectedNetTick): void {
    if (this.disposed) return;
    if (!Number.isInteger(fromNetTick) || fromNetTick < 1 || fromNetTick > 0xffff_ffff) {
      throw new RangeError('fromNetTick must be a positive UInt32');
    }
    if (this.syncFrom) {
      if (fromNetTick !== this.syncFrom) {
        this.queuedSyncFrom = this.queuedSyncFrom ? Math.min(this.queuedSyncFrom, fromNetTick) : fromNetTick;
      }
      return;
    }
    this.connection.send('lockstep:sync', { fromNetTick });
    this.syncFrom = fromNetTick;
    this.replayPaused = false;
    this.updateCatchupState();
  }

  requestSnapshot(): void {
    if (this.disposed || this.snapshotRequested) return;
    this.snapshotRequested = true;
    this.connection.send('lockstep:snapshot', {});
  }

  setCheckpointProvider(provider: LockstepCheckpointProvider | null): void {
    this.checkpointProvider = provider;
  }

  onFrame(handler: (frame: ConfirmedLockstepFrame) => void): () => void {
    if (this.disposed) throw new Error('Lockstep channel is disposed');
    const alreadySubscribed = this.handlers.has(handler);
    this.handlers.add(handler);
    if (!alreadySubscribed) this.frameSubscribers = null;
    const unsubscribe = () => {
      if (this.handlers.delete(handler)) this.frameSubscribers = null;
    };
    try {
      this.flushFrames();
      this.resumeReplay();
    } catch (error) {
      if (!alreadySubscribed) unsubscribe();
      throw error;
    }
    return unsubscribe;
  }

  onSyncStatus(handler: (status: LockstepSyncStatus) => void): () => void {
    if (this.disposed) throw new Error('Lockstep channel is disposed');
    this.syncStatusHandlers.add(handler);
    return () => this.syncStatusHandlers.delete(handler);
  }

  onWelcome(handler: (welcome: LockstepWelcomeInfo) => void): () => void {
    if (this.disposed) throw new Error('Lockstep channel is disposed');
    this.welcomeHandlers.add(handler);
    return () => this.welcomeHandlers.delete(handler);
  }

  onCheckpoint(handler: (checkpoint: LockstepCheckpointPacket) => void): () => void {
    if (this.disposed) throw new Error('Lockstep channel is disposed');
    this.checkpointHandlers.add(handler);
    return () => this.checkpointHandlers.delete(handler);
  }

  onCatchupChange(handler: (state: LockstepCatchupState) => void): () => void {
    if (this.disposed) throw new Error('Lockstep channel is disposed');
    this.catchupHandlers.add(handler);
    return () => this.catchupHandlers.delete(handler);
  }

  get expectedNetTick(): number { return this.queue.expectedNetTick; }
  get bufferedFrames(): number { return this.queue.bufferedFrames; }
  get srttMs(): number { return this.leadController.srttMs; }
  get jitterMs(): number { return this.leadController.jitterMs; }
  get recommendedLeadTicks(): number { return this.leadController.recommendLeadTicks(this.serverNetHz); }
  get serverTick(): number { return this.serverNetTick; }
  get isCatchingUp(): boolean { return this.catchingUp; }
  get lastSequence(): number { return this.sequence; }
  get lastTargetTick(): number { return this.lastTargetNetTick; }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelReplayRetry();
    if (typeof this.unsubscribeFrame === 'function') this.unsubscribeFrame();
    if (typeof this.unsubscribeSyncStatus === 'function') this.unsubscribeSyncStatus();
    if (typeof this.unsubscribeWelcome === 'function') this.unsubscribeWelcome();
    if (typeof this.unsubscribeSnapshot === 'function') this.unsubscribeSnapshot();
    if (typeof this.unsubscribeRequestCheckpoint === 'function') this.unsubscribeRequestCheckpoint();
    if (typeof this.unsubscribePong === 'function') this.unsubscribePong();
    if (typeof this.unsubscribeReconnect === 'function') this.unsubscribeReconnect();
    this.queue.clear();
    this.handlers.clear();
    this.frameSubscribers = null;
    this.syncStatusHandlers.clear();
    this.welcomeHandlers.clear();
    this.checkpointHandlers.clear();
    this.catchupHandlers.clear();
    this.checkpointProvider = null;
  }

  private receiveWelcome(welcome: LockstepWelcomeInfo): void {
    if (this.disposed || !welcome || welcome.matchTag !== this.matchTag) return;
    if (Number.isInteger(welcome.lastInputSequence) && welcome.lastInputSequence > this.sequence) {
      this.sequence = welcome.lastInputSequence;
    }
    if (Number.isInteger(welcome.netHz) && welcome.netHz > 0) {
      this.serverNetHz = welcome.netHz;
    }
    if (Number.isInteger(welcome.currentNetTick) && welcome.currentNetTick > this.serverNetTick) {
      this.serverNetTick = welcome.currentNetTick;
    }
    for (const handler of this.welcomeHandlers) handler(welcome);
    if (this.autoSyncOnReconnect && welcome.currentNetTick >= this.expectedNetTick) {
      this.replayThrough = Math.max(this.replayThrough, welcome.currentNetTick);
      this.replayPaused = false;
      this.resumeReplay();
    }
    this.updateCatchupState();
  }

  private receivePong(pong: { clientTimeMs: number; serverTick: number }): void {
    if (this.disposed || !pong) return;
    if (Number.isFinite(pong.clientTimeMs)) {
      const rtt = Math.max(0, performance.now() - pong.clientTimeMs);
      this.leadController.recordRttSample(rtt);
    }
    if (Number.isInteger(pong.serverTick) && pong.serverTick > this.serverNetTick) {
      this.serverNetTick = pong.serverTick;
    }
  }

  private async handleCheckpointRequest(req: { netTick: number; stateHash: number }): Promise<void> {
    if (this.disposed || !this.checkpointProvider || !req) return;
    try {
      const payload = await this.checkpointProvider(req);
      if (this.disposed || !(payload instanceof Uint8Array)) return;
      const packet = encodeLockstepCheckpoint({
        matchTag: this.matchTag,
        netTick: req.netTick,
        stateHash: req.stateHash,
        payload,
      });
      this.connection.sendBytes('lockstep:checkpoint-upload', packet);
    } catch {
      // Checkpoint upload is best-effort; server keeps waiting or requests another peer.
    }
  }

  private receiveSnapshot(bytes: Uint8Array): void {
    if (this.disposed) return;
    this.snapshotRequested = false;
    const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const checkpoint = decodeLockstepCheckpoint(raw);
    if (checkpoint.matchTag !== this.matchTag) return;
    if (checkpoint.netTick + 1 > this.expectedNetTick) {
      this.queue.resetCursor(checkpoint.netTick + 1);
    }
    for (const handler of this.checkpointHandlers) handler(checkpoint);
    this.cancelReplayRetry();
    this.syncFrom = 0;
    this.replayPaused = false;
    this.flushFrames();
    this.resumeReplay();
    this.updateCatchupState();
  }

  private receiveSyncStatus(status: LockstepSyncStatus): void {
    const from = this.syncFrom;
    const isCurrent = from > 0 && (status?.fromNetTick === undefined || status.fromNetTick === from);
    if (isCurrent) {
      if (status?.ok === false && status.reason === 'retry_later') {
        this.scheduleReplayRetry(from, status.retryAfterMs);
      } else {
        this.cancelReplayRetry();
        this.syncFrom = 0;
      }

      if (status?.reason === 'use_checkpoint' && this.autoRestoreCheckpoint && this.checkpointHandlers.size > 0) {
        this.replayPaused = true;
        if (typeof status.currentNetTick === 'number' && Number.isInteger(status.currentNetTick)) {
          this.replayThrough = Math.max(this.replayThrough, status.currentNetTick);
          this.serverNetTick = Math.max(this.serverNetTick, status.currentNetTick);
        }
        for (const handler of this.syncStatusHandlers) handler(status);
        this.requestSnapshot();
        this.updateCatchupState();
        return;
      }

      const oldest = status?.oldestAvailableTick;
      const cursorAlreadyConsumed = status?.reason === 'history_evicted' && this.expectedNetTick > from &&
        typeof oldest === 'number' && Number.isInteger(oldest) && oldest > 0 && oldest <= this.expectedNetTick;
      // The game owns recovery if the first missing frame is no longer retained.
      this.replayPaused = status?.ok !== true && this.syncRetryTimer === null && !cursorAlreadyConsumed;
      const current = status?.currentNetTick;
      if (typeof current === 'number' && Number.isInteger(current)) {
        this.serverNetTick = Math.max(this.serverNetTick, current);
      }
      if (cursorAlreadyConsumed && typeof current === 'number' && Number.isInteger(current) && current <= 0xffff_ffff) {
        this.replayThrough = Math.max(this.replayThrough, current);
      }
      const to = status?.toNetTick;
      if (status?.ok && status.hasMore && typeof to === 'number' && Number.isInteger(to) && to >= from && to < 0xffff_ffff) {
        this.replayThrough = Math.max(this.replayThrough, to + 1, this.expectedNetTick);
      }
    }
    for (const handler of this.syncStatusHandlers) handler(status);
    if (isCurrent && this.expectedNetTick > from) this.resumeReplay();
    if (isCurrent && !this.syncFrom && this.queuedSyncFrom) {
      const queued = this.queuedSyncFrom;
      this.queuedSyncFrom = 0;
      this.requestSync(queued);
    }
    this.updateCatchupState();
  }

  private scheduleReplayRetry(from: number, delay?: number): void {
    if (this.syncRetryTimer !== null) return;
    const waitMs = typeof delay === 'number' && Number.isFinite(delay) ? Math.min(5000, Math.max(25, delay)) : 250;
    this.syncRetryTimer = setTimeout(() => {
      this.syncRetryTimer = null;
      this.syncFrom = 0;
      const next = Math.max(from, this.expectedNetTick);
      if (this.connection.room?.connection?.isOpen !== false && next <= 0xffff_ffff) this.requestSync(next);
    }, waitMs);
  }

  private cancelReplayRetry(): void {
    if (this.syncRetryTimer === null) return;
    clearTimeout(this.syncRetryTimer);
    this.syncRetryTimer = null;
  }

  private receive(bytes: Uint8Array): void {
    if (this.disposed) return;
    if (!(bytes instanceof Uint8Array)) throw new TypeError('Lockstep frame transport returned a non-binary message');
    const frame = decodeConfirmedFrame(bytes);
    if (frame.matchTag === this.matchTag && frame.netTick > this.serverNetTick) {
      this.serverNetTick = frame.netTick;
    }
    if (this.autoSyncOnReconnect && frame.matchTag === this.matchTag &&
        frame.netTick >= this.expectedNetTick + this.queue.maxBufferedFrames) {
      // A live frame can precede replay on the same socket. Keep the observed
      // horizon, then request its bytes later through the authoritative history.
      this.replayThrough = Math.max(this.replayThrough, frame.netTick);
      this.resumeReplay();
      this.updateCatchupState();
      return;
    }
    if (!this.queue.push(frame)) return;
    this.flushFrames();
    this.updateCatchupState();
  }

  private flushFrames(): void {
    if (this.flushingFrames) return;
    this.flushingFrames = true;
    try {
      while (!this.disposed && this.handlers.size) {
        const ready = this.queue.takeNext();
        if (!ready) break;
        let errors: unknown[] | undefined;
        const subscribers = this.frameSubscribers ??= [...this.handlers];
        for (const handler of subscribers) {
          if (!this.handlers.has(handler)) continue;
          try { handler(ready); }
          catch (error) { (errors ??= []).push(error); }
        }
        if (errors?.length === 1) throw errors[0];
        if (errors) throw new AggregateError(errors, 'Lockstep frame consumers failed');
      }
    } finally {
      this.flushingFrames = false;
    }
  }

  private resumeReplay(): void {
    if (!this.disposed && this.autoSyncOnReconnect && this.handlers.size && !this.syncFrom &&
        !this.replayPaused && this.replayThrough >= this.expectedNetTick) {
      this.requestSync(this.expectedNetTick);
    }
  }

  private updateCatchupState(): void {
    const nextCatchingUp = this.syncFrom > 0
      || this.snapshotRequested
      || (this.replayThrough > 0 && this.expectedNetTick <= this.replayThrough);
    if (nextCatchingUp !== this.catchingUp || nextCatchingUp) {
      this.catchingUp = nextCatchingUp;
      const state: LockstepCatchupState = {
        catchingUp: this.catchingUp,
        currentTick: this.expectedNetTick - 1,
        targetTick: Math.max(this.serverNetTick, this.replayThrough),
      };
      for (const handler of this.catchupHandlers) handler(state);
    }
  }
}
