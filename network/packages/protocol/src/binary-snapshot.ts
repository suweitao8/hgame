export const BINARY_SNAPSHOT_MAGIC = [0x48, 0x47] as const; // "HG"
export const BINARY_SNAPSHOT_VERSION = 1;
export const BINARY_SNAPSHOT_HEADER_BYTES = 16;
export const BINARY_SNAPSHOT_ENTITY_BYTES = 20;
export const BINARY_DELTA_HEADER_BYTES = 20;
export const BINARY_SNAPSHOT_MAX_ENTITIES = 65535;
export const DEFAULT_POSITION_SCALE = 1000;

const TWO_PI = Math.PI * 2;
const KIND_SNAPSHOT = 1;
const KIND_DELTA = 2;

const MASK_X = 0x01;
const MASK_Y = 0x02;
const MASK_Z = 0x04;
const MASK_YAW = 0x08;
const MASK_FLAGS = 0x10;
const MASK_DX_INT16 = 0x20;
const MASK_DY_INT16 = 0x40;
const MASK_DZ_INT16 = 0x80;

export interface TransformSnapshotEntity {
  id: number;
  x: number;
  y?: number;
  z?: number;
  yaw?: number;
  flags?: number;
}

export interface EncodedSnapshotEntity {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  flags: number;
}

export interface TransformSnapshotInput {
  tick: number;
  positionScale?: number;
  entities: readonly TransformSnapshotEntity[];
}

export interface DecodedTransformSnapshot {
  version: number;
  kind: 'snapshot';
  tick: number;
  positionScale: number;
  entities: EncodedSnapshotEntity[];
}

export interface TransformDeltaUpsert {
  id: number;
  x?: number;
  y?: number;
  z?: number;
  yaw?: number;
  flags?: number;
}

export interface TransformDeltaInput {
  tick: number;
  baseTick: number;
  positionScale?: number;
  prevEntities?: readonly TransformSnapshotEntity[];
  nextEntities?: readonly TransformSnapshotEntity[];
  upserts?: readonly TransformDeltaUpsert[];
  removedIds?: readonly number[];
}

export interface DecodedTransformDelta {
  version: number;
  kind: 'delta';
  tick: number;
  baseTick: number;
  positionScale: number;
  upserts: TransformDeltaUpsert[];
  removedIds: number[];
  entities: EncodedSnapshotEntity[];
}

function assertUInt32(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError(`${name} must be an unsigned 32-bit integer`);
  }
}

function assertUInt16(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new RangeError(`${name} must be an unsigned 16-bit integer`);
  }
}

function validateScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new RangeError('positionScale must be a positive finite number');
  }
  return scale;
}

function quantizeCoord(value: number, scale: number, axis: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${axis} must be a finite number`);
  }
  const q = Math.round(value * scale);
  if (q < -0x8000_0000 || q > 0x7fff_ffff) {
    throw new RangeError(`${axis} exceeds signed 32-bit quantized range`);
  }
  return q | 0;
}

function quantizeYaw(yaw = 0): number {
  if (!Number.isFinite(yaw)) {
    throw new RangeError('yaw must be a finite number');
  }
  const wrapped = ((yaw % TWO_PI) + TWO_PI) % TWO_PI;
  return Math.round((wrapped / TWO_PI) * 65536) & 0xffff;
}

function dequantizeYaw(qYaw: number): number {
  return (qYaw / 65536) * TWO_PI;
}

function normalizeEntity(entity: TransformSnapshotEntity): EncodedSnapshotEntity {
  assertUInt32(entity.id, 'entity.id');
  const flags = entity.flags ?? 0;
  assertUInt16(flags, 'entity.flags');
  return {
    id: entity.id,
    x: entity.x,
    y: entity.y ?? 0,
    z: entity.z ?? 0,
    yaw: entity.yaw ?? 0,
    flags,
  };
}

function validateTransformPacketHeader(bytes: Uint8Array, minBytes: number): { view: DataView; kind: number } {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('Packet must be a Uint8Array');
  }
  if (bytes.byteLength < minBytes) {
    throw new RangeError('Truncated binary snapshot packet');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(0) !== BINARY_SNAPSHOT_MAGIC[0] || view.getUint8(1) !== BINARY_SNAPSHOT_MAGIC[1]) {
    throw new Error('Invalid HGame binary snapshot magic');
  }
  const version = view.getUint8(2);
  if (version !== BINARY_SNAPSHOT_VERSION) {
    throw new RangeError(`Unsupported binary snapshot version: ${version}`);
  }
  const kind = view.getUint8(3);
  return { view, kind };
}

function assertPacketHeader(bytes: Uint8Array, minBytes: number, expectedKind: number): DataView {
  const { view, kind } = validateTransformPacketHeader(bytes, minBytes);
  if (kind !== expectedKind) {
    throw new Error(`Unexpected binary snapshot kind: ${kind}`);
  }
  return view;
}

export function peekTransformPacketKind(bytes: Uint8Array): 'snapshot' | 'delta' {
  const { kind } = validateTransformPacketHeader(bytes, BINARY_SNAPSHOT_HEADER_BYTES);
  if (kind === KIND_SNAPSHOT) return 'snapshot';
  if (kind === KIND_DELTA) return 'delta';
  throw new Error(`Unexpected binary snapshot kind: ${kind}`);
}

export function decodeTransformPacket(
  bytes: Uint8Array,
  baseEntities: readonly TransformSnapshotEntity[] = [],
): DecodedTransformSnapshot | DecodedTransformDelta {
  const kind = peekTransformPacketKind(bytes);
  return kind === 'snapshot'
    ? decodeTransformSnapshot(bytes)
    : decodeTransformDelta(bytes, baseEntities);
}

export function encodeTransformSnapshot(input: TransformSnapshotInput): Uint8Array {
  assertUInt32(input.tick, 'tick');
  const scale = validateScale(input.positionScale ?? DEFAULT_POSITION_SCALE);
  if (!Array.isArray(input.entities)) {
    throw new TypeError('entities must be an array');
  }
  if (input.entities.length > BINARY_SNAPSHOT_MAX_ENTITIES) {
    throw new RangeError('Entity count exceeds 16-bit protocol limit');
  }

  const count = input.entities.length;
  const out = new Uint8Array(BINARY_SNAPSHOT_HEADER_BYTES + count * BINARY_SNAPSHOT_ENTITY_BYTES);
  const view = new DataView(out.buffer);

  view.setUint8(0, BINARY_SNAPSHOT_MAGIC[0]);
  view.setUint8(1, BINARY_SNAPSHOT_MAGIC[1]);
  view.setUint8(2, BINARY_SNAPSHOT_VERSION);
  view.setUint8(3, KIND_SNAPSHOT);
  view.setUint32(4, input.tick, true);
  view.setFloat32(8, scale, true);
  view.setUint16(12, count, true);
  view.setUint16(14, 0, true);

  let offset = BINARY_SNAPSHOT_HEADER_BYTES;
  for (let i = 0; i < count; i++) {
    const e = normalizeEntity(input.entities[i]);
    view.setUint32(offset, e.id, true);
    view.setInt32(offset + 4, quantizeCoord(e.x, scale, 'x'), true);
    view.setInt32(offset + 8, quantizeCoord(e.y, scale, 'y'), true);
    view.setInt32(offset + 12, quantizeCoord(e.z, scale, 'z'), true);
    view.setUint16(offset + 16, quantizeYaw(e.yaw), true);
    view.setUint16(offset + 18, e.flags, true);
    offset += BINARY_SNAPSHOT_ENTITY_BYTES;
  }

  return out;
}

export function decodeTransformSnapshot(bytes: Uint8Array): DecodedTransformSnapshot {
  const view = assertPacketHeader(bytes, BINARY_SNAPSHOT_HEADER_BYTES, KIND_SNAPSHOT);
  const tick = view.getUint32(4, true);
  const positionScale = validateScale(view.getFloat32(8, true));
  const count = view.getUint16(12, true);
  const expectedBytes = BINARY_SNAPSHOT_HEADER_BYTES + count * BINARY_SNAPSHOT_ENTITY_BYTES;
  if (bytes.byteLength < expectedBytes) {
    throw new RangeError('Truncated transform snapshot body');
  }

  const entities: EncodedSnapshotEntity[] = new Array(count);
  let offset = BINARY_SNAPSHOT_HEADER_BYTES;
  for (let i = 0; i < count; i++) {
    entities[i] = {
      id: view.getUint32(offset, true),
      x: view.getInt32(offset + 4, true) / positionScale,
      y: view.getInt32(offset + 8, true) / positionScale,
      z: view.getInt32(offset + 12, true) / positionScale,
      yaw: dequantizeYaw(view.getUint16(offset + 16, true)),
      flags: view.getUint16(offset + 18, true),
    };
    offset += BINARY_SNAPSHOT_ENTITY_BYTES;
  }

  return {
    version: BINARY_SNAPSHOT_VERSION,
    kind: 'snapshot',
    tick,
    positionScale,
    entities,
  };
}

interface QuantizedRecord {
  id: number;
  qx: number;
  qy: number;
  qz: number;
  qYaw: number;
  flags: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

function quantizeRecord(entity: TransformSnapshotEntity, scale: number): QuantizedRecord {
  const n = normalizeEntity(entity);
  return {
    id: n.id,
    qx: quantizeCoord(n.x, scale, 'x'),
    qy: quantizeCoord(n.y, scale, 'y'),
    qz: quantizeCoord(n.z, scale, 'z'),
    qYaw: quantizeYaw(n.yaw),
    flags: n.flags,
    x: n.x,
    y: n.y,
    z: n.z,
    yaw: n.yaw,
  };
}

function fitsInt16(delta: number): boolean {
  return delta >= -32768 && delta <= 32767;
}

export function encodeTransformDelta(input: TransformDeltaInput): Uint8Array {
  assertUInt32(input.tick, 'tick');
  assertUInt32(input.baseTick, 'baseTick');
  const scale = validateScale(input.positionScale ?? DEFAULT_POSITION_SCALE);

  const prevMap = new Map<number, QuantizedRecord>();
  if (Array.isArray(input.prevEntities)) {
    for (const prev of input.prevEntities) {
      const q = quantizeRecord(prev, scale);
      prevMap.set(q.id, q);
    }
  }

  interface PendingUpsert {
    id: number;
    mask: number;
    vx: number;
    vy: number;
    vz: number;
    qYaw: number;
    flags: number;
    byteLen: number;
  }

  const pendingUpserts: PendingUpsert[] = [];
  let removedIds: number[] = [];

  if (Array.isArray(input.nextEntities)) {
    const nextIds = new Set<number>();
    for (const raw of input.nextEntities) {
      const q = quantizeRecord(raw, scale);
      nextIds.add(q.id);
      const prev = prevMap.get(q.id);

      let mask = 0;
      let vx = 0, vy = 0, vz = 0;
      let byteLen = 5; // 4 (id) + 1 (mask)

      if (!prev || q.qx !== prev.qx) {
        mask |= MASK_X;
        const delta = prev ? (q.qx - prev.qx) : 0;
        if (prev && fitsInt16(delta)) {
          mask |= MASK_DX_INT16;
          vx = delta;
          byteLen += 2;
        } else {
          vx = q.qx;
          byteLen += 4;
        }
      }
      if (!prev || q.qy !== prev.qy) {
        mask |= MASK_Y;
        const delta = prev ? (q.qy - prev.qy) : 0;
        if (prev && fitsInt16(delta)) {
          mask |= MASK_DY_INT16;
          vy = delta;
          byteLen += 2;
        } else {
          vy = q.qy;
          byteLen += 4;
        }
      }
      if (!prev || q.qz !== prev.qz) {
        mask |= MASK_Z;
        const delta = prev ? (q.qz - prev.qz) : 0;
        if (prev && fitsInt16(delta)) {
          mask |= MASK_DZ_INT16;
          vz = delta;
          byteLen += 2;
        } else {
          vz = q.qz;
          byteLen += 4;
        }
      }
      if (!prev || q.qYaw !== prev.qYaw) {
        mask |= MASK_YAW;
        byteLen += 2;
      }
      if (!prev || q.flags !== prev.flags) {
        mask |= MASK_FLAGS;
        byteLen += 2;
      }

      if (mask !== 0) {
        pendingUpserts.push({ id: q.id, mask, vx, vy, vz, qYaw: q.qYaw, flags: q.flags, byteLen });
      }
    }

    if (Array.isArray(input.removedIds)) {
      removedIds = input.removedIds.slice();
    } else {
      for (const prevId of prevMap.keys()) {
        if (!nextIds.has(prevId)) removedIds.push(prevId);
      }
    }
  } else {
    const explicitUpserts = input.upserts ?? [];
    for (const u of explicitUpserts) {
      assertUInt32(u.id, 'upsert.id');
      const prev = prevMap.get(u.id);
      let mask = 0;
      let vx = 0, vy = 0, vz = 0;
      let qYaw = 0, flags = 0;
      let byteLen = 5;

      if (u.x !== undefined) {
        const qx = quantizeCoord(u.x, scale, 'x');
        mask |= MASK_X;
        const delta = prev ? (qx - prev.qx) : 0;
        if (prev && fitsInt16(delta)) {
          mask |= MASK_DX_INT16;
          vx = delta;
          byteLen += 2;
        } else {
          vx = qx;
          byteLen += 4;
        }
      }
      if (u.y !== undefined) {
        const qy = quantizeCoord(u.y, scale, 'y');
        mask |= MASK_Y;
        const delta = prev ? (qy - prev.qy) : 0;
        if (prev && fitsInt16(delta)) {
          mask |= MASK_DY_INT16;
          vy = delta;
          byteLen += 2;
        } else {
          vy = qy;
          byteLen += 4;
        }
      }
      if (u.z !== undefined) {
        const qz = quantizeCoord(u.z, scale, 'z');
        mask |= MASK_Z;
        const delta = prev ? (qz - prev.qz) : 0;
        if (prev && fitsInt16(delta)) {
          mask |= MASK_DZ_INT16;
          vz = delta;
          byteLen += 2;
        } else {
          vz = qz;
          byteLen += 4;
        }
      }
      if (u.yaw !== undefined) {
        qYaw = quantizeYaw(u.yaw);
        mask |= MASK_YAW;
        byteLen += 2;
      }
      if (u.flags !== undefined) {
        assertUInt16(u.flags, 'upsert.flags');
        flags = u.flags;
        mask |= MASK_FLAGS;
        byteLen += 2;
      }
      if (mask !== 0) {
        pendingUpserts.push({ id: u.id, mask, vx, vy, vz, qYaw, flags, byteLen });
      }
    }
    removedIds = Array.isArray(input.removedIds) ? input.removedIds.slice() : [];
  }

  for (const id of removedIds) assertUInt32(id, 'removedId');
  if (pendingUpserts.length > BINARY_SNAPSHOT_MAX_ENTITIES || removedIds.length > BINARY_SNAPSHOT_MAX_ENTITIES) {
    throw new RangeError('Delta entry count exceeds 16-bit protocol limit');
  }

  let bodyBytes = removedIds.length * 4;
  for (const p of pendingUpserts) bodyBytes += p.byteLen;

  const out = new Uint8Array(BINARY_DELTA_HEADER_BYTES + bodyBytes);
  const view = new DataView(out.buffer);
  view.setUint8(0, BINARY_SNAPSHOT_MAGIC[0]);
  view.setUint8(1, BINARY_SNAPSHOT_MAGIC[1]);
  view.setUint8(2, BINARY_SNAPSHOT_VERSION);
  view.setUint8(3, KIND_DELTA);
  view.setUint32(4, input.tick, true);
  view.setUint32(8, input.baseTick, true);
  view.setFloat32(12, scale, true);
  view.setUint16(16, pendingUpserts.length, true);
  view.setUint16(18, removedIds.length, true);

  let offset = BINARY_DELTA_HEADER_BYTES;
  for (const p of pendingUpserts) {
    view.setUint32(offset, p.id, true);
    view.setUint8(offset + 4, p.mask);
    offset += 5;
    if (p.mask & MASK_X) {
      if (p.mask & MASK_DX_INT16) { view.setInt16(offset, p.vx, true); offset += 2; }
      else { view.setInt32(offset, p.vx, true); offset += 4; }
    }
    if (p.mask & MASK_Y) {
      if (p.mask & MASK_DY_INT16) { view.setInt16(offset, p.vy, true); offset += 2; }
      else { view.setInt32(offset, p.vy, true); offset += 4; }
    }
    if (p.mask & MASK_Z) {
      if (p.mask & MASK_DZ_INT16) { view.setInt16(offset, p.vz, true); offset += 2; }
      else { view.setInt32(offset, p.vz, true); offset += 4; }
    }
    if (p.mask & MASK_YAW) {
      view.setUint16(offset, p.qYaw, true);
      offset += 2;
    }
    if (p.mask & MASK_FLAGS) {
      view.setUint16(offset, p.flags, true);
      offset += 2;
    }
  }

  for (const id of removedIds) {
    view.setUint32(offset, id, true);
    offset += 4;
  }

  return out;
}

export function decodeTransformDelta(
  bytes: Uint8Array,
  baseEntities: readonly TransformSnapshotEntity[] = [],
): DecodedTransformDelta {
  const view = assertPacketHeader(bytes, BINARY_DELTA_HEADER_BYTES, KIND_DELTA);
  const tick = view.getUint32(4, true);
  const baseTick = view.getUint32(8, true);
  const positionScale = validateScale(view.getFloat32(12, true));
  const upsertCount = view.getUint16(16, true);
  const removedCount = view.getUint16(18, true);

  const entityMap = new Map<number, EncodedSnapshotEntity>();
  const quantBaseMap = new Map<number, { qx: number; qy: number; qz: number }>();
  for (const raw of baseEntities) {
    const n = normalizeEntity(raw);
    entityMap.set(n.id, n);
    quantBaseMap.set(n.id, {
      qx: quantizeCoord(n.x, positionScale, 'x'),
      qy: quantizeCoord(n.y, positionScale, 'y'),
      qz: quantizeCoord(n.z, positionScale, 'z'),
    });
  }

  let offset = BINARY_DELTA_HEADER_BYTES;
  const ensureBytes = (need: number): void => {
    if (offset + need > bytes.byteLength) {
      throw new RangeError('Truncated binary transform delta payload');
    }
  };

  const upserts: TransformDeltaUpsert[] = new Array(upsertCount);
  for (let i = 0; i < upsertCount; i++) {
    ensureBytes(5);
    const id = view.getUint32(offset, true);
    const mask = view.getUint8(offset + 4);
    offset += 5;

    const baseQ = quantBaseMap.get(id);
    const merged: EncodedSnapshotEntity = entityMap.get(id)
      ? { ...entityMap.get(id)! }
      : { id, x: 0, y: 0, z: 0, yaw: 0, flags: 0 };
    const upsert: TransformDeltaUpsert = { id };

    if (mask & MASK_X) {
      if (mask & MASK_DX_INT16) {
        ensureBytes(2);
        const dx = view.getInt16(offset, true);
        offset += 2;
        if (!baseQ) throw new Error(`Missing base state for relative X delta on entity ${id}`);
        merged.x = (baseQ.qx + dx) / positionScale;
      } else {
        ensureBytes(4);
        merged.x = view.getInt32(offset, true) / positionScale;
        offset += 4;
      }
      upsert.x = merged.x;
    }

    if (mask & MASK_Y) {
      if (mask & MASK_DY_INT16) {
        ensureBytes(2);
        const dy = view.getInt16(offset, true);
        offset += 2;
        if (!baseQ) throw new Error(`Missing base state for relative Y delta on entity ${id}`);
        merged.y = (baseQ.qy + dy) / positionScale;
      } else {
        ensureBytes(4);
        merged.y = view.getInt32(offset, true) / positionScale;
        offset += 4;
      }
      upsert.y = merged.y;
    }

    if (mask & MASK_Z) {
      if (mask & MASK_DZ_INT16) {
        ensureBytes(2);
        const dz = view.getInt16(offset, true);
        offset += 2;
        if (!baseQ) throw new Error(`Missing base state for relative Z delta on entity ${id}`);
        merged.z = (baseQ.qz + dz) / positionScale;
      } else {
        ensureBytes(4);
        merged.z = view.getInt32(offset, true) / positionScale;
        offset += 4;
      }
      upsert.z = merged.z;
    }

    if (mask & MASK_YAW) {
      ensureBytes(2);
      merged.yaw = dequantizeYaw(view.getUint16(offset, true));
      offset += 2;
      upsert.yaw = merged.yaw;
    }

    if (mask & MASK_FLAGS) {
      ensureBytes(2);
      merged.flags = view.getUint16(offset, true);
      offset += 2;
      upsert.flags = merged.flags;
    }

    upserts[i] = upsert;
    entityMap.set(id, merged);
  }

  ensureBytes(removedCount * 4);
  const removedIds: number[] = new Array(removedCount);
  for (let i = 0; i < removedCount; i++) {
    const id = view.getUint32(offset, true);
    offset += 4;
    removedIds[i] = id;
    entityMap.delete(id);
  }

  return {
    version: BINARY_SNAPSHOT_VERSION,
    kind: 'delta',
    tick,
    baseTick,
    positionScale,
    upserts,
    removedIds,
    entities: Array.from(entityMap.values()),
  };
}
