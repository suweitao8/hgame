import {
  ConfirmedFrameQueue,
  LockstepInputFlags,
  decodeConfirmedFrame,
  encodeLockstepInput,
  type ConfirmedLockstepFrame,
} from '@hgame/network-protocol';
import type { HGameRoomConnection } from './HGameNetworkClient.js';

export interface LockstepSyncStatus {
  ok: boolean;
  fromNetTick?: number;
  toNetTick?: number;
  sentFrames?: number;
  hasMore?: boolean;
  reason?: string;
  oldestAvailableTick?: number | null;
  currentNetTick?: number;
}

export interface LockstepChannelOptions {
  autoSyncOnReconnect?: boolean;
}

export class HGameLockstepChannel {
  private sequence = 0;
  private lastTargetNetTick = 0;
  private disposed = false;
  private syncFrom = 0;
  private queuedSyncFrom = 0;
  private replayThrough = 0;
  private replayPaused = false;
  private readonly autoSyncOnReconnect: boolean;
  private readonly queue: ConfirmedFrameQueue;
  private readonly handlers = new Set<(frame: ConfirmedLockstepFrame) => void>();
  private readonly syncStatusHandlers = new Set<(status: LockstepSyncStatus) => void>();
  private readonly unsubscribeFrame: () => void;
  private readonly unsubscribeSyncStatus: () => void;
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
    this.sequence = firstSequence - 1;
    this.queue = new ConfirmedFrameQueue(matchTag, firstNetTick, maxBufferedFrames);
    this.unsubscribeFrame = connection.onMessage<Uint8Array>('lockstep:frame', (bytes) => this.receive(bytes));
    this.unsubscribeSyncStatus = connection.onMessage<LockstepSyncStatus>(
      'lockstep:sync-status',
      (status) => this.receiveSyncStatus(status),
    );
    this.unsubscribeReconnect = this.autoSyncOnReconnect && typeof connection.onReconnect === 'function'
      ? connection.onReconnect(() => {
        this.syncFrom = 0;
        this.replayPaused = false;
        this.replayThrough = Math.max(this.replayThrough, this.expectedNetTick);
        this.resumeReplay();
      })
      : () => undefined;
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
  }

  onFrame(handler: (frame: ConfirmedLockstepFrame) => void): () => void {
    if (this.disposed) throw new Error('Lockstep channel is disposed');
    this.handlers.add(handler);
    this.flushFrames();
    this.resumeReplay();
    return () => this.handlers.delete(handler);
  }

  onSyncStatus(handler: (status: LockstepSyncStatus) => void): () => void {
    this.syncStatusHandlers.add(handler);
    return () => this.syncStatusHandlers.delete(handler);
  }

  get expectedNetTick(): number { return this.queue.expectedNetTick; }
  get bufferedFrames(): number { return this.queue.bufferedFrames; }

  dispose(): void {
    this.disposed = true;
    this.unsubscribeFrame();
    this.unsubscribeSyncStatus();
    this.unsubscribeReconnect();
    this.queue.drainContiguous();
    this.handlers.clear();
    this.syncStatusHandlers.clear();
  }

  private receiveSyncStatus(status: LockstepSyncStatus): void {
    const from = this.syncFrom;
    const isCurrent = from > 0 && (status?.fromNetTick === undefined || status.fromNetTick === from);
    if (isCurrent) {
      this.syncFrom = 0;
      // On history_evicted, let the game choose a snapshot or exit. Live
      // frames must not trigger another request for the same unavailable tick.
      this.replayPaused = status?.ok !== true;
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
  }

  private receive(bytes: Uint8Array): void {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('Lockstep frame transport returned a non-binary message');
    const frame = decodeConfirmedFrame(bytes);
    if (this.autoSyncOnReconnect && frame.matchTag === this.matchTag &&
        frame.netTick >= this.expectedNetTick + this.queue.maxBufferedFrames) {
      // A live frame can precede replay on the same socket. Keep the observed
      // horizon, then request its bytes later through the authoritative history.
      this.replayThrough = Math.max(this.replayThrough, frame.netTick);
      this.resumeReplay();
      return;
    }
    if (!this.queue.push(frame)) return;
    this.flushFrames();
  }

  private flushFrames(): void {
    if (this.handlers.size === 0) return;
    for (const ready of this.queue.drainContiguous()) {
      for (const handler of this.handlers) handler(ready);
    }
  }

  private resumeReplay(): void {
    if (!this.disposed && this.autoSyncOnReconnect && this.handlers.size && !this.syncFrom &&
        !this.replayPaused && this.replayThrough >= this.expectedNetTick) {
      this.requestSync(this.expectedNetTick);
    }
  }
}
