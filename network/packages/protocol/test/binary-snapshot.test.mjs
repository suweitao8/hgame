import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BINARY_SNAPSHOT_HEADER_BYTES,
  BINARY_SNAPSHOT_ENTITY_BYTES,
  encodeTransformSnapshot,
  decodeTransformSnapshot,
  encodeTransformDelta,
  decodeTransformDelta,
  peekTransformPacketKind,
  decodeTransformPacket,
} from '../dist/index.js';

test('binary transform snapshot encodes compactly and round-trips quantized coordinates & wrapped yaw', () => {
  const entities = [
    { id: 1, x: 12.345, y: -4.5, z: 100.25, yaw: 0.75, flags: 3 },
    { id: 2, x: -999.123, y: 0, z: 0.004, yaw: -Math.PI * 0.5, flags: 1 },
    { id: 99, x: 0, y: 50, z: -20, yaw: Math.PI * 2 - 1e-6, flags: 0 },
  ];

  const encoded = encodeTransformSnapshot({ tick: 420, entities });
  assert.equal(
    encoded.byteLength,
    BINARY_SNAPSHOT_HEADER_BYTES + entities.length * BINARY_SNAPSHOT_ENTITY_BYTES,
  );
  // Check "HG" magic
  assert.equal(encoded[0], 0x48);
  assert.equal(encoded[1], 0x47);

  // Significantly smaller than equivalent JSON payload
  const jsonBytes = Buffer.byteLength(JSON.stringify({ tick: 420, entities }));
  assert.ok(encoded.byteLength < jsonBytes * 0.6);

  const decoded = decodeTransformSnapshot(encoded);
  assert.equal(decoded.tick, 420);
  assert.equal(decoded.positionScale, 1000);
  assert.equal(decoded.entities.length, 3);
  assert.ok(Math.abs(decoded.entities[0].x - 12.345) <= 0.001);
  assert.ok(Math.abs(decoded.entities[0].y - (-4.5)) <= 0.001);
  assert.ok(Math.abs(decoded.entities[0].z - 100.25) <= 0.001);
  assert.ok(Math.abs(decoded.entities[0].yaw - 0.75) < 0.0002);
  assert.equal(decoded.entities[0].flags, 3);

  // Negative yaw wrapped cleanly to [0, 2*PI) -> 1.5 * PI
  assert.ok(Math.abs(decoded.entities[1].yaw - (Math.PI * 1.5)) < 0.0002);
  // 2*PI wraps to ~0
  assert.ok(decoded.entities[2].yaw < 0.001);
});

test('binary transform delta omits unchanged entities, uses Int16 small moves, handles teleports & removals', () => {
  const prevEntities = [
    { id: 1, x: 10, y: 0, z: 20, yaw: 0.5, flags: 1 },
    { id: 2, x: 50, y: 2, z: -30, yaw: 1.0, flags: 1 }, // stationary
    { id: 3, x: 0, y: 0, z: 0, yaw: 0, flags: 0 },       // removed
  ];
  const nextEntities = [
    { id: 1, x: 10.25, y: 0, z: 20.5, yaw: 0.5, flags: 1 }, // small delta in x/z only
    { id: 2, x: 50, y: 2, z: -30, yaw: 1.0, flags: 1 },      // unchanged -> omitted
    { id: 4, x: 500, y: 3, z: -200, yaw: 2.0, flags: 7 },    // new -> full coords
  ];

  const deltaBytes = encodeTransformDelta({
    tick: 421,
    baseTick: 420,
    prevEntities,
    nextEntities,
  });
  const fullBytes = encodeTransformSnapshot({ tick: 421, entities: nextEntities });
  assert.ok(deltaBytes.byteLength < fullBytes.byteLength);

  const decoded = decodeTransformDelta(deltaBytes, prevEntities);
  assert.equal(decoded.tick, 421);
  assert.equal(decoded.baseTick, 420);
  assert.deepEqual(decoded.removedIds, [3]);
  // Entity 2 was unchanged so only entities 1 & 4 appear in upserts
  assert.deepEqual(decoded.upserts.map((u) => u.id).sort((a, b) => a - b), [1, 4]);

  const byId = new Map(decoded.entities.map((e) => [e.id, e]));
  assert.equal(byId.has(3), false);
  assert.ok(Math.abs(byId.get(1).x - 10.25) <= 0.001);
  assert.ok(Math.abs(byId.get(1).z - 20.5) <= 0.001);
  assert.equal(byId.get(2).x, 50);
  assert.ok(Math.abs(byId.get(4).x - 500) <= 0.001);
  assert.equal(byId.get(4).flags, 7);

  // Teleport (>32.767 units at scale 1000 overflows Int16) falls back seamlessly to Int32
  const teleported = [
    { id: 1, x: 150, y: 0, z: 20.5, yaw: 0.5, flags: 1 },
    nextEntities[1],
    nextEntities[2],
  ];
  const tpBytes = encodeTransformDelta({
    tick: 422,
    baseTick: 421,
    prevEntities: nextEntities,
    nextEntities: teleported,
  });
  const tpDecoded = decodeTransformDelta(tpBytes, nextEntities);
  const tpE1 = tpDecoded.entities.find((e) => e.id === 1);
  assert.ok(Math.abs(tpE1.x - 150) <= 0.001);
});

test('malformed or truncated binary snapshot packets fail closed', () => {
  const valid = encodeTransformSnapshot({ tick: 1, entities: [{ id: 1, x: 1, y: 2, z: 3 }] });
  assert.throws(() => decodeTransformSnapshot(valid.subarray(0, 10)), /Truncated/);
  assert.throws(() => decodeTransformSnapshot(valid.subarray(0, valid.byteLength - 4)), /Truncated/);

  const badMagic = new Uint8Array(valid);
  badMagic[0] = 0x00;
  assert.throws(() => decodeTransformSnapshot(badMagic), /magic/i);

  assert.throws(() => decodeTransformDelta(valid), /kind/i);
});

test('decodeTransformPacket dispatches both full snapshots and delta updates', () => {
  const base = [{ id: 1, x: 10, y: 20, z: 0, yaw: 0.2, flags: 1 }];
  const snapBytes = encodeTransformSnapshot({ tick: 10, entities: base });
  const deltaBytes = encodeTransformDelta({
    tick: 11,
    baseTick: 10,
    prevEntities: base,
    nextEntities: [{ id: 1, x: 11, y: 20, z: 0, yaw: 0.4, flags: 3 }],
  });

  assert.equal(peekTransformPacketKind(snapBytes), 'snapshot');
  assert.equal(peekTransformPacketKind(deltaBytes), 'delta');

  const decodedSnap = decodeTransformPacket(snapBytes);
  assert.equal(decodedSnap.kind, 'snapshot');
  assert.equal(decodedSnap.tick, 10);

  const decodedDelta = decodeTransformPacket(deltaBytes, decodedSnap.entities);
  assert.equal(decodedDelta.kind, 'delta');
  assert.equal(decodedDelta.tick, 11);
  assert.equal(decodedDelta.entities[0].flags, 3);
  assert.ok(Math.abs(decodedDelta.entities[0].x - 11) <= 0.001);
});
