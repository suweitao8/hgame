/**
 * Modular 3D level data -> instanced display objects.
 *
 * Level JSON is authoritative only for static VISUAL PLACEMENTS. Colliders
 * are explicit independent metadata: never derive physics from the GLB art.
 * This utility has no RAF, DOM, Game/Entity dependency or hidden network calls.
 *
 * version=1 schema: grid {cellSize, origin:[x,y,z]},
 * groups [{slot, cells:[[x,y,z]...]}] OR
 *        [{slot, fill:{from:[x,y,z],to:[x,y,z]}, exclude:[...]}]
 * Each group optionally turns=0|1|2|3 (quarter-turns), scale>0.
 */
const SLOT = /^[a-z][a-z0-9-]*(?:.[a-z][a-z0-9-]*)+$/;
const COLLIDER_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const MAX_TILES = 20000;
const MAX_DIMENSION = 512;
const own = (value, fields, context) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(context + ' must be a JSON object');
  }
  for (const name of Object.keys(value)) {
    if (!fields.includes(name)) throw new Error(context + ' unknown field: ' + name);
  }
};
const positive = (value, label, limit = 1000) => {
  if (!Number.isFinite(value) || value <= 0 || value > limit) {
    throw new RangeError(label + ' must be positive and finite');
  }
  return value;
};
const vec3 = (value, label, integer = false) => {
  if (!Array.isArray(value) || value.length !== 3 ||
      !value.every(n => Number.isFinite(n) && (!integer || Number.isSafeInteger(n)))) {
    throw new TypeError(label + ' must be a finite ' +
      (integer ? 'integer ' : '') + '[x,y,z] array');
  }
  if (value.some(n => Math.abs(n) > 100000)) throw new RangeError(label + ' exceeds level bounds');
  return [...value];
};
const cellKey = cell => cell.join(',');

function validatedGrid(value) {
  if (value === undefined) return { cellSize: 1, origin: [0, 0, 0] };
  own(value, ['cellSize', 'origin'], 'grid');
  return {
    cellSize: positive(value.cellSize ?? 1, 'grid.cellSize', 100),
    origin: vec3(value.origin ?? [0, 0, 0], 'grid.origin'),
  };
}
export function gridToWorld(cell, grid = { cellSize: 1, origin: [0, 0, 0] }) {
  const coord = vec3(cell, 'cell', true);
  const g = validatedGrid(grid);
  return coord.map((n, i) => g.origin[i] + n * g.cellSize);
}
export function worldToGrid(world, grid = { cellSize: 1, origin: [0, 0, 0] }) {
  const coord = vec3(world, 'world');
  const g = validatedGrid(grid);
  return coord.map((n, i) => Math.round((n - g.origin[i]) / g.cellSize));
}

/**
 * Expand compact JSON into a deterministic, immutable render recipe.
 * Order is group input order, then fill: y outer, z middle, x inner.
 */
export function compileModularLevel(level) {
  own(level, ['version', 'grid', 'groups', 'colliders', 'playerSpawn'], 'level');
  if (level.version !== 1) throw new Error('Unsupported modular level version (expected 1)');
  if (!Array.isArray(level.groups) || !level.groups.length || level.groups.length > 2048) {
    throw new RangeError('Level needs 1..2048 groups');
  }
  const grid = validatedGrid(level.grid);
  const batches = new Map();
  const occupied = new Map();
  let tiles = 0;
  for (const [index, group] of level.groups.entries()) {
    own(group, ['slot', 'fill', 'cells', 'exclude', 'turns', 'scale'], 'groups[' + index + ']');
    if (typeof group.slot !== 'string' || !SLOT.test(group.slot)) {
      throw new Error('Invalid logical scene model slot in group ' + index);
    }
    if (Number(group.fill !== undefined) + Number(group.cells !== undefined) !== 1) {
      throw new Error('Group must have exactly one of fill or cells: ' + group.slot);
    }
    const turns = group.turns ?? 0;
    if (!Number.isInteger(turns) || turns < 0 || turns > 3) {
      throw new RangeError('Quarter-turns must be 0..3: ' + group.slot);
    }
    const scale = positive(group.scale ?? 1, 'group.scale', 100);
    let cells;
    if (group.cells !== undefined) {
      if (!Array.isArray(group.cells) || group.cells.length < 1 || group.cells.length > MAX_TILES) {
        throw new RangeError('Invalid explicit cell list');
      }
      cells = group.cells.map((cell, i) => vec3(cell, 'cells[' + i + ']', true));
    } else {
      own(group.fill, ['from', 'to'], 'group.fill');
      const from = vec3(group.fill.from, 'fill.from', true);
      const to = vec3(group.fill.to, 'fill.to', true);
      const size = to.map((n, i) => n - from[i] + 1);
      if (size.some(n => n < 1 || n > MAX_DIMENSION) ||
          size.reduce((n, value) => n * value, 1) > MAX_TILES) {
        throw new RangeError('Fill exceeds the 512-per-axis / 20,000-tile budget');
      }
      cells = [];
      for (let y = from[1]; y <= to[1]; y++) {
        for (let z = from[2]; z <= to[2]; z++) {
          for (let x = from[0]; x <= to[0]; x++) cells.push([x, y, z]);
        }
      }
    }
    const cellSet = new Set(cells.map(cellKey));
    if (cellSet.size !== cells.length) throw new Error('Duplicate tile in group: ' + group.slot);
    const excluded = new Set();
    if (group.exclude !== undefined) {
      if (!Array.isArray(group.exclude)) throw new Error('exclude must be a cell list');
      for (const cell of group.exclude) {
        const key = cellKey(vec3(cell, 'exclude.cell', true));
        if (!cellSet.has(key) || excluded.has(key)) throw new Error('Invalid exclude tile: ' + key);
        excluded.add(key);
      }
    }
    let batch = batches.get(group.slot);
    if (!batch) {
      batch = { slot: group.slot, placements: [] };
      batches.set(group.slot, batch);
      occupied.set(group.slot, new Set());
    }
    for (const cell of cells) {
      const key = cellKey(cell);
      if (excluded.has(key)) continue;
      if (occupied.get(group.slot).has(key)) {
        throw new Error('Duplicate tile across groups for ' + group.slot + ' at ' + key);
      }
      occupied.get(group.slot).add(key);
      if (++tiles > MAX_TILES) throw new RangeError('Level exceeds 20,000 visible tiles');
      const world = cell.map((n, i) => grid.origin[i] + n * grid.cellSize);
      const position = Object.freeze({
        x: world[0], y: world[1], z: world[2],
        rotationY: turns * Math.PI / 2,
        scale: scale * grid.cellSize,
      });
      batch.placements.push(position);
    }
  }
  const colliders = [];
  const ids = new Set();
  if (level.colliders !== undefined && !Array.isArray(level.colliders)) {
    throw new TypeError('colliders must be an array');
  }
  for (const item of level.colliders ?? []) {
    own(item, ['id', 'center', 'size', 'sensor', 'layer', 'mask'], 'collider');
    if (typeof item.id !== 'string' || !COLLIDER_ID.test(item.id) || ids.has(item.id)) {
      throw new Error('Invalid or duplicate collider ID');
    }
    ids.add(item.id);
    const center = vec3(item.center, 'collider.center');
    const size = vec3(item.size, 'collider.size');
    size.forEach(n => positive(n, 'collider dimension', 100000));
    if (item.sensor !== undefined && typeof item.sensor !== 'boolean') {
      throw new TypeError('collider sensor must be boolean');
    }
    for (const key of ['layer', 'mask']) {
      if (item[key] !== undefined && (!Number.isInteger(item[key]) ||
          item[key] < 0 || item[key] > 0xffffffff)) {
        throw new RangeError('collider ' + key + ' is not a valid uint32 mask');
      }
    }
    colliders.push(Object.freeze({
      id: item.id, center: Object.freeze(center), size: Object.freeze(size),
      sensor: item.sensor ?? false,
      layer: item.layer ?? 1, mask: item.mask ?? 0xffffffff,
    }));
  }
  const spawn = vec3(level.playerSpawn ?? [0, 1.8, 0], 'playerSpawn');
  return Object.freeze({
    version: 1,
    grid: Object.freeze({ ...grid, origin: Object.freeze(grid.origin) }),
    batches: Object.freeze([...batches.values()].map(batch => Object.freeze({
      slot: batch.slot,
      placements: Object.freeze(batch.placements),
    }))),
    colliders: Object.freeze(colliders),
    playerSpawn: Object.freeze(spawn),
    stats: Object.freeze({ tiles, slots: batches.size, colliders: colliders.length }),
  });
}

/**
 * Atomic visual-only level renderer. Asynchronously staged new levels replace
 * the old group only after all GLB requests finish. No extra RAF or physics
 * bodies are created; the caller owns render scheduling and collision state.
 */
export function createModularLevelRenderer({ THREE, models, parent } = {}) {
  if (!THREE?.Group || !parent?.add || !parent?.remove ||
      typeof models?.get !== 'function' ||
      typeof models?.instantiate !== 'function' ||
      typeof models?.instantiateBatch !== 'function') {
    throw new TypeError('Three, model slots, and a parent Object3D are required');
  }
  let mounted = null;
  let lastLevel = null;
  let lastStats = { tiles: 0, slots: 0, colliders: 0 };
  let generation = 0;
  let disposed = false;

  function detach(group) {
    if (!group) return;
    if (group.parent) group.parent.remove(group);
    group.traverse(obj => {
      // InstancedMesh has an instance-owned GPU buffer and dispose event.
      // DO NOT dispose textures, shared materials or geometry here.
      if (obj.isInstancedMesh) obj.dispose?.();
    });
    group.clear();
  }

  async function setLevel(level) {
    if (disposed) throw new Error('Modular level renderer is disposed');
    const compiled = compileModularLevel(level);
    // Fail fast on misspelled scene slots before requesting any model.
    for (const group of compiled.batches) models.get(group.slot);
    const next = new THREE.Group();
    next.name = 'modular-level';
    const myGeneration = ++generation;
    try {
      for (const batch of compiled.batches) {
        const placements = batch.placements;
        const node = placements.length === 1 ?
          await models.instantiate(batch.slot) :
          await models.instantiateBatch(batch.slot, placements);
        if (!node?.isObject3D) throw new Error('Model slot returned no Object3D: ' + batch.slot);
        if (placements.length === 1) {
          const placement = placements[0];
          node.position.set(placement.x, placement.y, placement.z);
          node.rotation.y = placement.rotationY;
          node.scale.setScalar(placement.scale);
        }
        node.userData.levelSlot = batch.slot;
        next.add(node);
      }
      if (myGeneration !== generation || disposed) {
        detach(next);
        return { committed: false, ...compiled.stats };
      }
      parent.add(next);
      detach(mounted);
      mounted = next;
      lastLevel = JSON.parse(JSON.stringify(level));
      lastStats = compiled.stats;
      return { committed: true, ...compiled.stats };
    } catch (error) {
      detach(next);
      throw error;
    }
  }
  async function rebuild() {
    if (!lastLevel) throw new Error('No modular level to rebuild');
    return setLevel(lastLevel);
  }
  function clear() {
    generation++;
    detach(mounted);
    mounted = null;
    lastLevel = null;
    lastStats = { tiles: 0, slots: 0, colliders: 0 };
  }
  function dispose() {
    if (disposed) return;
    clear();
    disposed = true;
  }
  return {
    setLevel, rebuild, clear, dispose,
    get stats() { return { ...lastStats }; },
    get root() { return mounted; },
  };
}
