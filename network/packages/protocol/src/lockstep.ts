export const LOCKSTEP_PROTOCOL_VERSION = 1;
export const LOCKSTEP_INPUT_HEADER_BYTES = 20;
export const LOCKSTEP_FRAME_HEADER_BYTES = 16;
export const LOCKSTEP_FRAME_ENTRY_HEADER_BYTES = 8;
export const LOCKSTEP_MAX_INPUT_BYTES = 256;
export const LOCKSTEP_MAX_PLAYERS = 32;

const INPUT_MAGIC = [0x48, 0x47, 0x49, 0x4e] as const; // HGIN
const FRAME_MAGIC = [0x48, 0x47, 0x46, 0x52] as const; // HGFR

export enum LockstepInputFlags {
  NONE = 0,
  NO_OP = 1,
}

export interface LockstepInputPacket {
  matchTag: number;
  sequence: number;
  targetNetTick: number;
  flags?: LockstepInputFlags;
  payload: Uint8Array;
}

export interface ConfirmedPlayerInput {
  slot: number;
  sequence: number;
  flags: LockstepInputFlags;
  payload: Uint8Array;
}

export interface ConfirmedLockstepFrame {
  matchTag: number;
  netTick: number;
  inputs: ConfirmedPlayerInput[];
}

function assertUInt(value: number, bits: 8 | 16 | 32, name: string, min = 0): void {
  const max = bits === 32 ? 0xffff_ffff : (2 ** bits) - 1;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an unsigned ${bits}-bit integer`);
  }
}

function assertMagic(view: DataView, expected: readonly number[]): void {
  for (let i = 0; i < expected.length; i++) {
    if (view.getUint8(i) !== expected[i]) throw new Error('Invalid HGame lockstep packet magic');
  }
}

function viewOf(bytes: Uint8Array, minimumBytes: number): DataView {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Packet must be a Uint8Array');
  if (bytes.byteLength < minimumBytes) throw new RangeError('Truncated HGame lockstep packet');
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function copyPayload(payload: Uint8Array): Uint8Array {
  if (!(payload instanceof Uint8Array)) throw new TypeError('Input payload must be a Uint8Array');
  if (payload.byteLength > LOCKSTEP_MAX_INPUT_BYTES) throw new RangeError('Input payload exceeds the protocol limit');
  return new Uint8Array(payload);
}

export function encodeLockstepInput(packet: LockstepInputPacket): Uint8Array {
  assertUInt(packet.matchTag, 32, 'matchTag', 1);
  assertUInt(packet.sequence, 32, 'sequence', 1);
  assertUInt(packet.targetNetTick, 32, 'targetNetTick', 1);
  const payload = copyPayload(packet.payload);
  const flags = packet.flags ?? LockstepInputFlags.NONE;
  assertUInt(flags, 8, 'flags');
  if ((flags & ~LockstepInputFlags.NO_OP) !== 0) throw new RangeError('Unknown lockstep input flags');
  if ((flags & LockstepInputFlags.NO_OP) !== 0 && payload.byteLength !== 0) {
    throw new RangeError('No-op inputs must have an empty payload');
  }

  const bytes = new Uint8Array(LOCKSTEP_INPUT_HEADER_BYTES + payload.byteLength);
  const view = new DataView(bytes.buffer);
  INPUT_MAGIC.forEach((value, index) => view.setUint8(index, value));
  view.setUint8(4, LOCKSTEP_PROTOCOL_VERSION);
  view.setUint8(5, flags);
  view.setUint16(6, payload.byteLength, true);
  view.setUint32(8, packet.matchTag, true);
  view.setUint32(12, packet.sequence, true);
  view.setUint32(16, packet.targetNetTick, true);
  bytes.set(payload, LOCKSTEP_INPUT_HEADER_BYTES);
  return bytes;
}

export function decodeLockstepInput(bytes: Uint8Array): LockstepInputPacket {
  const view = viewOf(bytes, LOCKSTEP_INPUT_HEADER_BYTES);
  assertMagic(view, INPUT_MAGIC);
  const version = view.getUint8(4);
  if (version !== LOCKSTEP_PROTOCOL_VERSION) throw new Error(`Unsupported lockstep protocol version: ${version}`);
  const flags = view.getUint8(5);
  if ((flags & ~LockstepInputFlags.NO_OP) !== 0) throw new Error('Unknown lockstep input flags');
  const payloadLength = view.getUint16(6, true);
  if (payloadLength > LOCKSTEP_MAX_INPUT_BYTES || bytes.byteLength !== LOCKSTEP_INPUT_HEADER_BYTES + payloadLength) {
    throw new RangeError('Invalid lockstep input payload length');
  }
  const matchTag = view.getUint32(8, true);
  const sequence = view.getUint32(12, true);
  const targetNetTick = view.getUint32(16, true);
  assertUInt(matchTag, 32, 'matchTag', 1);
  assertUInt(sequence, 32, 'sequence', 1);
  assertUInt(targetNetTick, 32, 'targetNetTick', 1);
  if ((flags & LockstepInputFlags.NO_OP) !== 0 && payloadLength !== 0) {
    throw new RangeError('No-op inputs must have an empty payload');
  }
  return {
    matchTag,
    sequence,
    targetNetTick,
    flags,
    payload: new Uint8Array(bytes.subarray(LOCKSTEP_INPUT_HEADER_BYTES)),
  };
}

export function encodeConfirmedFrame(frame: ConfirmedLockstepFrame): Uint8Array {
  assertUInt(frame.matchTag, 32, 'matchTag', 1);
  assertUInt(frame.netTick, 32, 'netTick', 1);
  if (!Array.isArray(frame.inputs) || frame.inputs.length < 1 || frame.inputs.length > LOCKSTEP_MAX_PLAYERS) {
    throw new RangeError(`A confirmed frame must contain 1..${LOCKSTEP_MAX_PLAYERS} player inputs`);
  }

  const entries = frame.inputs.map((input) => {
    assertUInt(input.slot, 8, 'slot');
    assertUInt(input.sequence, 32, 'sequence');
    assertUInt(input.flags, 8, 'flags');
    if ((input.flags & ~LockstepInputFlags.NO_OP) !== 0) throw new RangeError('Unknown lockstep input flags');
    const payload = copyPayload(input.payload);
    if ((input.flags & LockstepInputFlags.NO_OP) !== 0 && payload.byteLength !== 0) {
      throw new RangeError('No-op inputs must have an empty payload');
    }
    return { ...input, payload };
  });
  for (let i = 1; i < entries.length; i++) {
    if (entries[i - 1]!.slot >= entries[i]!.slot) {
      throw new RangeError('Confirmed frame inputs must be unique and sorted by slot');
    }
  }

  const payloadBytes = entries.reduce((total, input) => total + LOCKSTEP_FRAME_ENTRY_HEADER_BYTES + input.payload.byteLength, 0);
  const bytes = new Uint8Array(LOCKSTEP_FRAME_HEADER_BYTES + payloadBytes);
  const view = new DataView(bytes.buffer);
  FRAME_MAGIC.forEach((value, index) => view.setUint8(index, value));
  view.setUint8(4, LOCKSTEP_PROTOCOL_VERSION);
  view.setUint8(5, 0);
  view.setUint16(6, entries.length, true);
  view.setUint32(8, frame.matchTag, true);
  view.setUint32(12, frame.netTick, true);

  let offset = LOCKSTEP_FRAME_HEADER_BYTES;
  for (const input of entries) {
    view.setUint8(offset, input.slot);
    view.setUint8(offset + 1, input.flags);
    view.setUint16(offset + 2, input.payload.byteLength, true);
    view.setUint32(offset + 4, input.sequence, true);
    bytes.set(input.payload, offset + LOCKSTEP_FRAME_ENTRY_HEADER_BYTES);
    offset += LOCKSTEP_FRAME_ENTRY_HEADER_BYTES + input.payload.byteLength;
  }
  return bytes;
}

export function decodeConfirmedFrame(bytes: Uint8Array): ConfirmedLockstepFrame {
  const view = viewOf(bytes, LOCKSTEP_FRAME_HEADER_BYTES);
  assertMagic(view, FRAME_MAGIC);
  const version = view.getUint8(4);
  if (version !== LOCKSTEP_PROTOCOL_VERSION) throw new Error(`Unsupported lockstep protocol version: ${version}`);
  if (view.getUint8(5) !== 0) throw new Error('Unknown confirmed-frame flags');
  const count = view.getUint16(6, true);
  if (count < 1 || count > LOCKSTEP_MAX_PLAYERS) throw new RangeError('Invalid confirmed-frame player count');
  const matchTag = view.getUint32(8, true);
  const netTick = view.getUint32(12, true);
  assertUInt(matchTag, 32, 'matchTag', 1);
  assertUInt(netTick, 32, 'netTick', 1);

  const inputs: ConfirmedPlayerInput[] = [];
  let offset = LOCKSTEP_FRAME_HEADER_BYTES;
  let previousSlot = -1;
  for (let i = 0; i < count; i++) {
    if (offset + LOCKSTEP_FRAME_ENTRY_HEADER_BYTES > bytes.byteLength) throw new RangeError('Truncated confirmed-frame entry');
    const slot = view.getUint8(offset);
    const flags = view.getUint8(offset + 1);
    const payloadLength = view.getUint16(offset + 2, true);
    const sequence = view.getUint32(offset + 4, true);
    if (slot <= previousSlot) throw new RangeError('Confirmed frame inputs must be unique and sorted by slot');
    if ((flags & ~LockstepInputFlags.NO_OP) !== 0) throw new Error('Unknown confirmed-frame input flags');
    if (payloadLength > LOCKSTEP_MAX_INPUT_BYTES) throw new RangeError('Input payload exceeds the protocol limit');
    if ((flags & LockstepInputFlags.NO_OP) !== 0 && payloadLength !== 0) throw new RangeError('No-op inputs must have an empty payload');
    const payloadStart = offset + LOCKSTEP_FRAME_ENTRY_HEADER_BYTES;
    const payloadEnd = payloadStart + payloadLength;
    if (payloadEnd > bytes.byteLength) throw new RangeError('Truncated confirmed-frame payload');
    inputs.push({ slot, flags, sequence, payload: new Uint8Array(bytes.subarray(payloadStart, payloadEnd)) });
    previousSlot = slot;
    offset = payloadEnd;
  }
  if (offset !== bytes.byteLength) throw new RangeError('Unexpected trailing bytes in confirmed frame');
  return { matchTag, netTick, inputs };
}

export class ConfirmedFrameQueue {
  private readonly pending = new Map<number, ConfirmedLockstepFrame>();
  private nextNetTick: number;

  constructor(
    readonly matchTag: number,
    firstNetTick = 1,
    readonly maxBufferedFrames = 64,
  ) {
    assertUInt(matchTag, 32, 'matchTag', 1);
    assertUInt(firstNetTick, 32, 'firstNetTick', 1);
    if (!Number.isInteger(maxBufferedFrames) || maxBufferedFrames < 1 || maxBufferedFrames > 512) {
      throw new RangeError('maxBufferedFrames must be an integer from 1 to 512');
    }
    this.nextNetTick = firstNetTick;
  }

  push(frame: ConfirmedLockstepFrame): boolean {
    if (frame.matchTag !== this.matchTag) throw new Error('Confirmed frame belongs to another match');
    if (frame.netTick < this.nextNetTick || this.pending.has(frame.netTick)) return false;
    if (frame.netTick >= this.nextNetTick + this.maxBufferedFrames || this.pending.size >= this.maxBufferedFrames) {
      throw new RangeError('Confirmed-frame buffer limit exceeded');
    }
    this.pending.set(frame.netTick, structuredClone(frame));
    return true;
  }

  drainContiguous(): ConfirmedLockstepFrame[] {
    const result: ConfirmedLockstepFrame[] = [];
    while (this.pending.has(this.nextNetTick)) {
      const frame = this.pending.get(this.nextNetTick)!;
      this.pending.delete(this.nextNetTick);
      result.push(frame);
      this.nextNetTick++;
    }
    return result;
  }

  get expectedNetTick(): number { return this.nextNetTick; }
  get bufferedFrames(): number { return this.pending.size; }
}
