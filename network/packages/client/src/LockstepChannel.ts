import {
  ConfirmedFrameQueue,
  LockstepInputFlags,
  decodeConfirmedFrame,
  encodeLockstepInput,
  type ConfirmedLockstepFrame,
} from '@hgame/network-protocol';
import type { HGameRoomConnection } from './HGameNetworkClient.js';

export class HGameLockstepChannel {
  private sequence = 0;
  private lastTargetNetTick = 0;
  private readonly queue: ConfirmedFrameQueue;
  private readonly handlers = new Set<(frame: ConfirmedLockstepFrame) => void>();
  private readonly unhandledFrames: ConfirmedLockstepFrame[] = [];
  private readonly unsubscribe: () => void;

  constructor(
    private readonly connection: HGameRoomConnection,
    readonly matchTag: number,
    firstNetTick = 1,
    maxBufferedFrames = 64,
    firstSequence = 1,
  ) {
    if (!Number.isInteger(firstSequence) || firstSequence < 1 || firstSequence > 0xffff_ffff) {
      throw new RangeError('firstSequence must be a positive UInt32');
    }
    this.sequence = firstSequence - 1;
    this.queue = new ConfirmedFrameQueue(matchTag, firstNetTick, maxBufferedFrames);
    this.unsubscribe = connection.onMessage<Uint8Array>('lockstep:frame', (bytes) => this.receive(bytes));
  }

  sendInput(targetNetTick: number, payload: Uint8Array, flags = LockstepInputFlags.NONE): number {
    if (!Number.isInteger(targetNetTick) || targetNetTick < 1 || targetNetTick > 0xffff_ffff || targetNetTick <= this.lastTargetNetTick) {
      throw new RangeError('targetNetTick must increase strictly for each player input');
    }
    if (this.sequence >= 0xffff_ffff) throw new RangeError('Lockstep input sequence exhausted');
    const sequence = ++this.sequence;
    const packet = encodeLockstepInput({
      matchTag: this.matchTag,
      sequence,
      targetNetTick,
      flags,
      payload,
    });
    this.connection.sendBytes('lockstep:input', packet);
    this.lastTargetNetTick = targetNetTick;
    return sequence;
  }

  sendNoOp(targetNetTick: number): number {
    return this.sendInput(targetNetTick, new Uint8Array(), LockstepInputFlags.NO_OP);
  }

  onFrame(handler: (frame: ConfirmedLockstepFrame) => void): () => void {
    this.handlers.add(handler);
    while (this.unhandledFrames.length) handler(this.unhandledFrames.shift()!);
    return () => this.handlers.delete(handler);
  }

  get expectedNetTick(): number { return this.queue.expectedNetTick; }
  get bufferedFrames(): number { return this.queue.bufferedFrames; }

  dispose(): void {
    this.unsubscribe();
    this.queue.drainContiguous();
    this.handlers.clear();
    this.unhandledFrames.length = 0;
  }

  private receive(bytes: Uint8Array): void {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('Lockstep frame transport returned a non-binary message');
    const frame = decodeConfirmedFrame(bytes);
    if (!this.queue.push(frame)) return;
    for (const ready of this.queue.drainContiguous()) {
      if (this.handlers.size === 0) this.unhandledFrames.push(ready);
      else for (const handler of this.handlers) handler(ready);
    }
  }
}
