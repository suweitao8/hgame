/**
 * Deterministic physics worker kernel wrapping a {@link RapierPhysicsWorld} instance.
 * Shared identically by the module Web Worker (`physics-worker.js`) and inline fallback (`worker-physics.js`).
 */

function createProxyEntity(init = {}) {
  const entity = {
    x: Number(init.x) || 0,
    y: Number(init.y) || 0,
    z: Number(init.z) || 0,
    rotationX: Number(init.rotationX) || 0,
    rotationY: Number(init.rotationY) || 0,
    rotationZ: Number(init.rotationZ) || 0,
    width: init.width,
    height: init.height,
    depth: init.depth,
    destroyed: false,
    parent: null,
    worldPosition() {
      return { x: entity.x, y: entity.y, z: entity.z };
    },
    snapTransform() {},
  };
  return entity;
}

/**
 * Create a message-driven deterministic physics kernel bound to a Rapier world constructor.
 * @param {import('./rapier-world.js').RapierPhysicsWorldConstructor} WorldClass
 * @param {{ tickHz?: number, gravity?: { x?: number, y?: number, z?: number } }} [options]
 * @returns {{ handle: (msg: object) => object, world: object }}
 */
export function createPhysicsKernel(WorldClass, { tickHz = 60, gravity } = {}) {
  if (typeof WorldClass !== 'function') {
    throw new TypeError('createPhysicsKernel requires a RapierPhysicsWorld constructor');
  }
  const worldOptions = { tickHz };
  if (gravity !== undefined) worldOptions.gravity = gravity;
  const world = new WorldClass(worldOptions);

  /** @type {Map<number, ReturnType<typeof createProxyEntity>>} */
  const proxies = new Map();
  /** @type {Map<object, number>} */
  const entityToId = new Map();
  let disposed = false;

  function packTransforms() {
    const sortedIds = Array.from(proxies.keys()).sort((a, b) => a - b);
    const ids = new Int32Array(sortedIds.length);
    const transforms = new Float32Array(sortedIds.length * 7);
    for (let i = 0; i < sortedIds.length; i++) {
      const id = sortedIds[i];
      const proxy = proxies.get(id);
      ids[i] = id;
      const base = i * 7;
      transforms[base] = proxy.x || 0;
      transforms[base + 1] = proxy.y || 0;
      transforms[base + 2] = proxy.z || 0;
      transforms[base + 3] = proxy.rotationX || 0;
      transforms[base + 4] = proxy.rotationY || 0;
      transforms[base + 5] = proxy.rotationZ || 0;
      transforms[base + 6] = 0;
    }
    return { tick: world._tick, ids, transforms };
  }

  function requireProxy(id, op) {
    const proxy = proxies.get(id);
    if (!proxy) {
      throw new Error(`Unknown physics proxy id ${id} for ${op}`);
    }
    return proxy;
  }

  function handleSingle(msg) {
    if (!msg || typeof msg !== 'object') {
      throw new TypeError('Physics kernel message must be an object');
    }
    const requestId = msg.requestId;
    switch (msg.type) {
      case 'add': {
        const id = Number(msg.id);
        if (!Number.isInteger(id) || id < 0) {
          throw new RangeError(`Invalid proxy body id: ${msg.id}`);
        }
        if (proxies.has(id)) {
          throw new Error(`Duplicate proxy body id: ${id}`);
        }
        const proxy = createProxyEntity(msg.init);
        world.add(proxy, msg.options || {});
        proxies.set(id, proxy);
        entityToId.set(proxy, id);
        return { type: 'add', requestId, id, ok: true };
      }
      case 'remove': {
        const id = Number(msg.id);
        const proxy = proxies.get(id);
        if (!proxy) return { type: 'remove', requestId, id, removed: false };
        const removed = world.remove(proxy);
        proxy.destroyed = true;
        proxies.delete(id);
        entityToId.delete(proxy);
        return { type: 'remove', requestId, id, removed };
      }
      case 'setVelocity': {
        const proxy = requireProxy(Number(msg.id), 'setVelocity');
        world.setVelocity(proxy, msg.velocity);
        return { type: 'setVelocity', requestId, ok: true };
      }
      case 'setPosition': {
        const proxy = requireProxy(Number(msg.id), 'setPosition');
        world.setPosition(proxy, msg.position);
        return { type: 'setPosition', requestId, ok: true };
      }
      case 'setAngularVelocity': {
        const proxy = requireProxy(Number(msg.id), 'setAngularVelocity');
        world.setAngularVelocity(proxy, msg.omega);
        return { type: 'setAngularVelocity', requestId, ok: true };
      }
      case 'step': {
        const ticks = Math.max(1, Math.floor(Number(msg.ticks ?? 1)));
        for (let i = 0; i < ticks; i++) {
          world.step(world.fixedDt);
        }
        const packed = packTransforms();
        return { type: 'step', requestId, ...packed };
      }
      case 'checksum': {
        return { type: 'checksum', requestId, checksum: world.stateChecksum() };
      }
      case 'snapshot': {
        const raw = world.takeSnapshot();
        return {
          type: 'snapshot',
          requestId,
          snapshot: {
            version: raw.version,
            tick: raw.tick,
            bytes: raw.bytes,
            nextId: raw.nextId,
            records: raw.records.map((r) => ({
              id: entityToId.get(r.entity),
              bodyId: r.id,
              type: r.type,
              bodyHandle: r.bodyHandle,
              colliderHandle: r.colliderHandle,
              syncRotation: r.syncRotation,
              lockRotations: r.lockRotations,
              enabledRotations: r.enabledRotations,
            })),
          },
        };
      }
      case 'restore': {
        const snap = msg.snapshot;
        if (!snap || !Array.isArray(snap.records)) {
          throw new TypeError('restore requires a valid kernel snapshot');
        }
        const rebound = {
          version: snap.version,
          tick: snap.tick,
          bytes: snap.bytes,
          nextId: snap.nextId,
          records: snap.records.map((r) => ({
            entity: requireProxy(r.id, 'restore'),
            id: r.bodyId,
            type: r.type,
            bodyHandle: r.bodyHandle,
            colliderHandle: r.colliderHandle,
            syncRotation: r.syncRotation,
            lockRotations: r.lockRotations,
            enabledRotations: r.enabledRotations,
          })),
        };
        world.restoreSnapshot(rebound);
        const packed = packTransforms();
        return { type: 'restore', requestId, ...packed };
      }
      case 'ping': {
        return { type: 'ping', requestId, tick: world._tick };
      }
      case 'dispose': {
        if (!disposed) {
          disposed = true;
          world.dispose();
          proxies.clear();
          entityToId.clear();
        }
        return { type: 'dispose', requestId, ok: true };
      }
      case 'batch': {
        const commands = Array.isArray(msg.commands) ? msg.commands : [];
        let lastStep = null;
        const replies = [];
        for (const cmd of commands) {
          const rep = handleSingle(cmd);
          if (rep.type === 'step' || rep.type === 'restore') {
            lastStep = { tick: rep.tick, ids: rep.ids, transforms: rep.transforms };
          } else if (rep.type === 'checksum' || rep.type === 'snapshot') {
            replies.push(rep);
          }
        }
        return {
          type: 'batch',
          requestId,
          step: lastStep,
          replies,
        };
      }
      default:
        throw new Error(`Unsupported physics kernel message type: ${msg.type}`);
    }
  }

  return {
    handle: handleSingle,
    get world() {
      return world;
    },
  };
}
