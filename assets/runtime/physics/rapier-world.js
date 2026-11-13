import { createEmitter } from '../platform/events.js';

const ENGINE_VERSION = '0.21.0';
const CHECKSUM_INTERVAL = 30;

function fnv1a(bytes) {
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, '0');
}

function finite(value, name, fallback) {
  const result = value ?? fallback;
  if (!Number.isFinite(result)) throw new TypeError(`${name} must be finite`);
  return result;
}

function vector(value, dimension, defaults = {}) {
  const source = value ?? defaults;
  return dimension === 2
    ? { x: finite(source.x, 'x', 0), y: finite(source.y, 'y', 0) }
    : { x: finite(source.x, 'x', 0), y: finite(source.y, 'y', 0), z: finite(source.z, 'z', 0) };
}

function setDescriptorTranslation(descriptor, position, dimension) {
  if (dimension === 2) descriptor.setTranslation(position.x, position.y);
  else descriptor.setTranslation(position.x, position.y, position.z);
  return descriptor;
}

function createRigidBodyDescriptor(RAPIER, type, position, dimension, canSleep) {
  const factories = {
    fixed: () => RAPIER.RigidBodyDesc.fixed(),
    dynamic: () => RAPIER.RigidBodyDesc.dynamic(),
    kinematicPosition: () => RAPIER.RigidBodyDesc.kinematicPositionBased(),
    kinematicVelocity: () => RAPIER.RigidBodyDesc.kinematicVelocityBased(),
  };
  const factory = factories[type];
  if (!factory) throw new Error(`Unsupported Rapier rigid-body type: ${type}`);
  return setDescriptorTranslation(factory().setCanSleep(Boolean(canSleep)), position, dimension);
}

function createColliderDescriptor(RAPIER, dimension, entity, options) {
  const shape = options.shape ?? 'cuboid';
  const width = Math.max(0.001, finite(options.width, 'width', entity.width || 1));
  const height = Math.max(0.001, finite(options.height, 'height', entity.height || 1));
  const depth = Math.max(0.001, finite(options.depth, 'depth', entity.depth || 1));
  const radius = Math.max(0.001, finite(options.radius, 'radius', Math.min(width, height, dimension === 3 ? depth : width) / 2));
  const halfHeight = Math.max(0, finite(options.halfHeight, 'halfHeight', Math.max(0, height / 2 - radius)));
  let descriptor;

  if (shape === 'ball') descriptor = RAPIER.ColliderDesc.ball(radius);
  else if (shape === 'capsule') descriptor = RAPIER.ColliderDesc.capsule(halfHeight, radius);
  else if (shape === 'cuboid') {
    descriptor = dimension === 2
      ? RAPIER.ColliderDesc.cuboid(width / 2, height / 2)
      : RAPIER.ColliderDesc.cuboid(width / 2, height / 2, depth / 2);
  } else {
    throw new Error(`Unsupported Rapier${dimension}D collider shape: ${shape}`);
  }

  const offset = vector(options.offset, dimension, {
    x: options.offsetX ?? 0,
    y: options.offsetY ?? 0,
    z: options.offsetZ ?? 0,
  });
  setDescriptorTranslation(descriptor, offset, dimension);
  descriptor.setSensor(Boolean(options.sensor));
  descriptor.setFriction(Math.max(0, finite(options.friction, 'friction', 0.5)));
  descriptor.setRestitution(Math.max(0, Math.min(1, finite(options.restitution, 'restitution', 0))));
  descriptor.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
  if (options.density !== undefined) descriptor.setDensity(Math.max(0, finite(options.density, 'density', 1)));
  if (options.collisionGroups !== undefined) descriptor.setCollisionGroups(options.collisionGroups >>> 0);
  else if (options.layer !== undefined || options.mask !== undefined) {
    const membership = (options.layer ?? 1) & 0xffff;
    const filter = (options.mask ?? 0xffff) & 0xffff;
    descriptor.setCollisionGroups(((membership << 16) | filter) >>> 0);
  }
  return descriptor;
}

/** Build a small, renderer-neutral adapter around one pinned Rapier WASM World. */
export function createRapierPhysicsWorldClass(RAPIER, dimension) {
  if (![2, 3].includes(dimension)) throw new RangeError('Rapier dimension must be 2 or 3');
  if (RAPIER.version() !== ENGINE_VERSION) {
    throw new Error(`HGame requires Rapier ${ENGINE_VERSION}; received ${RAPIER.version()}`);
  }

  return class RapierPhysicsWorld {
    constructor({ tickHz = 60, gravity } = {}) {
      if (!Number.isInteger(tickHz) || tickHz < 1 || tickHz > 240) {
        throw new RangeError('Rapier tickHz must be an integer from 1 to 240');
      }
      this.dimension = dimension;
      this.tickHz = tickHz;
      this.fixedDt = 1 / tickHz;
      this.backend = `@dimforge/rapier${dimension}d-deterministic`;
      this.engineVersion = RAPIER.version();
      this.gravity = vector(gravity, dimension, dimension === 2
        ? { x: 0, y: 0 }
        : { x: 0, y: -9.81, z: 0 });
      this.world = new RAPIER.World(this.gravity);
      this.world.timestep = this.fixedDt;
      this.events = createEmitter();
      this.eventQueue = new RAPIER.EventQueue(true);
      this.bodies = [];
      this._byEntity = new Map();
      this._byColliderHandle = new Map();
      this._nextId = 1;
      this._tick = 0;
      this._checksums = [];
      this._disposed = false;
    }

    get tick() { return this._tick; }
    get checksums() { return this._checksums.slice(); }

    on(type, listener) { return this.events.on(type, listener); }

    setGravity(gravity) {
      this._assertAlive();
      this.gravity = vector(gravity, dimension);
      this.world.gravity = this.gravity;
      return this.gravity;
    }

    add(entity, options = {}) {
      this._assertAlive();
      if (!entity || typeof entity.worldPosition !== 'function' || entity.destroyed) {
        throw new TypeError('Rapier physics requires a live HGame Entity');
      }
      if (entity.parent) throw new Error('Rapier physics bodies must be root Entities');
      if (this._byEntity.has(entity)) throw new Error('Entity already has a Rapier body');

      const type = options.type ?? (options.static ? 'fixed' : 'dynamic');
      const position = vector(entity.worldPosition(), dimension);
      const descriptor = createRigidBodyDescriptor(RAPIER, type, position, dimension, options.canSleep ?? false);
      const rigidBody = this.world.createRigidBody(descriptor);
      if (options.gravityScale !== undefined) rigidBody.setGravityScale(finite(options.gravityScale, 'gravityScale', 1), true);
      if (options.ccd) rigidBody.enableCcd(true);
      const collider = this.world.createCollider(createColliderDescriptor(RAPIER, dimension, entity, options), rigidBody);
      const record = {
        id: this._nextId++, entity, type, rigidBody, collider,
        bodyHandle: rigidBody.handle, colliderHandle: collider.handle,
        setVelocity: velocity => rigidBody.setLinvel(vector(velocity, dimension), true),
        getVelocity: () => rigidBody.linvel(),
        applyImpulse: (impulse, wakeUp = true) => rigidBody.applyImpulse(vector(impulse, dimension), wakeUp),
      };
      this.bodies.push(record);
      this._byEntity.set(entity, record);
      this._byColliderHandle.set(collider.handle, record);
      return record;
    }

    get(target) {
      if (target?.entity && target?.rigidBody) return this.bodies.includes(target) ? target : null;
      return this._byEntity.get(target) ?? null;
    }

    remove(target) {
      this._assertAlive();
      const record = this.get(target);
      if (!record) return false;
      this.world.removeRigidBody(record.rigidBody);
      this._byEntity.delete(record.entity);
      this._byColliderHandle.delete(record.colliderHandle);
      this.bodies.splice(this.bodies.indexOf(record), 1);
      return true;
    }

    setPosition(target, position) {
      this._assertAlive();
      const record = this.get(target);
      if (!record) throw new Error('Unknown Rapier body');
      const next = vector(position, dimension);
      if (record.type === 'kinematicPosition') record.rigidBody.setNextKinematicTranslation(next);
      else record.rigidBody.setTranslation(next, true);
      record.entity.x = next.x;
      record.entity.y = next.y;
      if (dimension === 3) record.entity.z = next.z;
    }

    setVelocity(target, velocity) {
      const record = this.get(target);
      if (!record) throw new Error('Unknown Rapier body');
      record.setVelocity(velocity);
    }

    getVelocity(target) {
      const record = this.get(target);
      return record?.getVelocity() ?? null;
    }

    overlaps(targetA, targetB) {
      const a = this.get(targetA), b = this.get(targetB);
      if (!a || !b) return false;
      if (this.world.intersectionPair(a.collider, b.collider)) return true;
      let touching = false;
      this.world.contactPair(a.collider, b.collider, () => { touching = true; });
      return touching;
    }

    castRay(origin, direction, maxDistance = 1000, { solid = true, filterPredicate } = {}) {
      this._assertAlive();
      if (!Number.isFinite(maxDistance) || maxDistance < 0) throw new RangeError('maxDistance must be >= 0');
      const start = vector(origin, dimension);
      const rawDirection = vector(direction, dimension);
      const lengthSquared = rawDirection.x ** 2 + rawDirection.y ** 2 + (dimension === 3 ? rawDirection.z ** 2 : 0);
      if (lengthSquared <= 1e-16) return null;
      const length = Math.sqrt(lengthSquared);
      const dir = dimension === 2
        ? { x: rawDirection.x / length, y: rawDirection.y / length }
        : { x: rawDirection.x / length, y: rawDirection.y / length, z: rawDirection.z / length };
      const hit = this.world.castRayAndGetNormal(new RAPIER.Ray(start, dir), maxDistance, solid,
        undefined, undefined, undefined, undefined, filterPredicate);
      if (!hit) return null;
      const point = dimension === 2
        ? { x: start.x + dir.x * hit.timeOfImpact, y: start.y + dir.y * hit.timeOfImpact }
        : { x: start.x + dir.x * hit.timeOfImpact, y: start.y + dir.y * hit.timeOfImpact,
          z: start.z + dir.z * hit.timeOfImpact };
      return {
        timeOfImpact: hit.timeOfImpact, point, normal: hit.normal,
        collider: hit.collider, body: this._byColliderHandle.get(hit.collider.handle) ?? null,
      };
    }

    step(dt = this.fixedDt) {
      this._assertAlive();
      if (!Number.isFinite(dt) || Math.abs(dt - this.fixedDt) > 1e-9) {
        throw new RangeError(`HGame Rapier requires fixed ${this.tickHz}Hz steps (${this.fixedDt}s)`);
      }
      for (const record of this.bodies) {
        if (record.type !== 'kinematicPosition' || record.entity.destroyed) continue;
        record.rigidBody.setNextKinematicTranslation(vector(record.entity.worldPosition(), dimension));
      }
      this.world.step(this.eventQueue);
      for (const record of this.bodies) {
        if (record.type === 'fixed' || record.entity.destroyed) continue;
        const position = record.rigidBody.translation();
        record.entity.x = position.x;
        record.entity.y = position.y;
        if (dimension === 3) record.entity.z = position.z;
      }
      this.eventQueue.drainCollisionEvents((handleA, handleB, started) => {
        const a = this._byColliderHandle.get(handleA);
        const b = this._byColliderHandle.get(handleB);
        if (!a || !b) return;
        this.events.emit(started ? 'enter' : 'exit', {
          a, b, sensor: a.collider.isSensor() || b.collider.isSensor(), tick: this._tick + 1,
        });
      });
      this._tick++;
      if (this._tick % CHECKSUM_INTERVAL === 0) {
        this._checksums.push({ tick: this._tick, checksum: this.stateChecksum() });
        if (this._checksums.length > 120) this._checksums.shift();
      }
      return this._tick;
    }

    takeSnapshot() {
      this._assertAlive();
      return {
        version: this.engineVersion,
        tick: this._tick,
        bytes: this.world.takeSnapshot(),
        records: this.bodies.map(record => ({
          entity: record.entity, type: record.type, id: record.id,
          bodyHandle: record.bodyHandle, colliderHandle: record.colliderHandle,
        })),
        nextId: this._nextId,
      };
    }

    restoreSnapshot(snapshot) {
      this._assertAlive();
      if (!snapshot || snapshot.version !== this.engineVersion || !(snapshot.bytes instanceof Uint8Array)) {
        throw new Error('Invalid or incompatible HGame Rapier snapshot');
      }
      if (!Array.isArray(snapshot.records)) throw new Error('HGame Rapier snapshot has no body registry');
      const restored = RAPIER.World.restoreSnapshot(snapshot.bytes);
      const records = snapshot.records.map(saved => {
        const rigidBody = restored.getRigidBody(saved.bodyHandle);
        const collider = restored.getCollider(saved.colliderHandle);
        if (!rigidBody || !collider || saved.entity.destroyed) {
          restored.free();
          throw new Error(`Rapier snapshot body ${saved.id} could not be rebound`);
        }
        return { ...saved, rigidBody, collider,
          setVelocity: velocity => rigidBody.setLinvel(vector(velocity, dimension), true),
          getVelocity: () => rigidBody.linvel(),
          applyImpulse: (impulse, wakeUp = true) => rigidBody.applyImpulse(vector(impulse, dimension), wakeUp),
        };
      });
      this.eventQueue.free();
      this.world.free();
      this.world = restored;
      this.world.timestep = this.fixedDt;
      this.eventQueue = new RAPIER.EventQueue(true);
      this.bodies = records;
      this._byEntity = new Map(records.map(record => [record.entity, record]));
      this._byColliderHandle = new Map(records.map(record => [record.colliderHandle, record]));
      this._nextId = snapshot.nextId;
      this._tick = snapshot.tick;
      this._checksums.length = 0;
      for (const record of records) {
        const position = record.rigidBody.translation();
        record.entity.x = position.x;
        record.entity.y = position.y;
        if (dimension === 3) record.entity.z = position.z;
      }
      return this;
    }

    stateChecksum() {
      this._assertAlive();
      return fnv1a(this.world.takeSnapshot());
    }

    _assertAlive() {
      if (this._disposed) throw new Error('HGame Rapier world is disposed');
    }

    dispose() {
      if (this._disposed) return false;
      this._disposed = true;
      this.eventQueue.free();
      this.world.free();
      this.events.clear();
      this.bodies.length = 0;
      this._byEntity.clear();
      this._byColliderHandle.clear();
      this._checksums.length = 0;
      return true;
    }
  };
}
