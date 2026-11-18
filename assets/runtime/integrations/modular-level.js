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
/**
 * @typedef {[number, number, number]} Vec3Tuple Finite `[x, y, z]`.
 * @typedef {object} ModularGridSpec
 * @property {number} [cellSize] Cell edge length in world units, (0, 100]. Default `1`.
 * @property {Vec3Tuple} [origin] World position of cell [0,0,0]. Default `[0,0,0]`.
 * @typedef {object} ModularLevelGroup
 * @property {string} slot Logical scene model slot id, e.g. `kit.wall`.
 * @property {{from: Vec3Tuple, to: Vec3Tuple}} [fill] Inclusive integer cell box (xor with `cells`).
 * @property {Vec3Tuple[]} [cells] Explicit integer cells (xor with `fill`).
 * @property {Vec3Tuple[]} [exclude] Cells to skip from the group.
 * @property {0|1|2|3} [turns] Quarter-turns about Y. Default `0`.
 * @property {number} [scale] Uniform scale multiplier, (0, 100]. Default `1`.
 * @typedef {object} ModularColliderSpec Explicit physics metadata, independent of art.
 * @property {string} id Unique id, `/^[a-z][a-z0-9_-]{0,63}$/`.
 * @property {Vec3Tuple} center World-space centre.
 * @property {Vec3Tuple} size Full extents in world units (> 0).
 * @property {boolean} [sensor] Trigger-only collider. Default `false`.
 * @property {number} [layer] uint32 collision layer. Default `1`.
 * @property {number} [mask] uint32 collision mask. Default `0xffffffff`.
 * @typedef {object} ModularLevelData Version-1 level JSON.
 * @property {1} version
 * @property {ModularGridSpec} [grid]
 * @property {ModularLevelGroup[]} groups 1..2048 groups.
 * @property {ModularColliderSpec[]} [colliders]
 * @property {Vec3Tuple} [playerSpawn] Default `[0, 1.8, 0]`.
 * @typedef {object} ModularPlacement
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} rotationY Radians.
 * @property {number} scale Final uniform scale (group scale * cellSize).
 * @typedef {object} ModularBatch
 * @property {string} slot
 * @property {readonly ModularPlacement[]} placements
 * @typedef {object} ModularLevelStats
 * @property {number} tiles Visible tile count.
 * @property {number} slots Distinct slot count.
 * @property {number} colliders Collider count.
 * @typedef {object} CompiledModularLevel Immutable render recipe.
 * @property {1} version
 * @property {Readonly<{cellSize: number, origin: readonly number[]}>} grid
 * @property {readonly ModularBatch[]} batches
 * @property {readonly Readonly<{id: string, center: readonly number[], size: readonly number[], sensor: boolean, layer: number, mask: number}>[]} colliders
 * @property {readonly number[]} playerSpawn
 * @property {Readonly<ModularLevelStats>} stats
 * @typedef {object} ModularObject3DLike Minimal Three.js Object3D structure.
 * @property {(...objects: object[]) => unknown} add
 * @property {(...objects: object[]) => unknown} [remove]
 * @typedef {object} ModularGroupLike
 * @property {string} name
 * @property {unknown} [parent]
 * @typedef {object} ModularThreeLike Used Three.js constructors.
 * @property {new () => ModularGroupLike & ModularObject3DLike} Group
 * @typedef {object} ModularModelSlotsLike Scene model slot provider.
 * @property {(slot: string) => unknown} get Throws/returns for unknown slots.
 * @property {(slot: string) => Promise<object> | object} instantiate
 * @property {(slot: string, placements: readonly ModularPlacement[]) => Promise<object> | object} instantiateBatch
 * @property {(root: object) => void} [releaseInstance] Release resources owned by instantiated objects.
 * @typedef {object} ModularLevelRendererOptions
 * @property {ModularThreeLike} THREE Three.js namespace subset.
 * @property {ModularModelSlotsLike} models Slot provider.
 * @property {ModularObject3DLike} parent Object3D that receives the level group.
 * @property {number} [chunkCells=0] Partition large instance batches into chunks of this many cells per axis. Zero keeps one batch per slot.
 * @typedef {ModularLevelStats & {committed: boolean}} ModularLevelCommit
 * @typedef {object} ModularLevelRenderer
 * @property {(level: ModularLevelData) => Promise<ModularLevelCommit>} setLevel Stage and atomically swap in a level.
 * @property {() => Promise<ModularLevelCommit>} rebuild Re-run the last committed level.
 * @property {() => void} clear Remove the mounted level.
 * @property {() => void} dispose Clear and disable the renderer.
 * @property {ModularLevelStats} stats Copy of last committed stats.
 * @property {CompiledModularLevel | null} level Immutable metadata of the mounted level.
 * @property {object | null} root Mounted Group or null.
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
/**
 * Cell to world position.
 * @param {Vec3Tuple} cell Integer cell.
 * @param {ModularGridSpec} [grid] Default cellSize 1, origin 0.
 * @returns {number[]} World [x,y,z].
 */
export function gridToWorld(cell, grid = { cellSize: 1, origin: [0, 0, 0] }) {
  const coord = vec3(cell, 'cell', true);
  const g = validatedGrid(grid);
  return coord.map((n, i) => g.origin[i] + n * g.cellSize);
}
/**
 * World position to nearest cell.
 * @param {Vec3Tuple} world World [x,y,z].
 * @param {ModularGridSpec} [grid] Default cellSize 1, origin 0.
 * @returns {number[]} Integer cell [x,y,z].
 */
export function worldToGrid(world, grid = { cellSize: 1, origin: [0, 0, 0] }) {
  const coord = vec3(world, 'world');
  const g = validatedGrid(grid);
  return coord.map((n, i) => Math.round((n - g.origin[i]) / g.cellSize));
}

function spatialBatches(compiled, chunkCells) {
  if (chunkCells === 0) return compiled.batches;
  const { origin, cellSize } = compiled.grid;
  const minBatchSize = 16;
  const startAt = Math.max(128, chunkCells * chunkCells);
  const result = [];
  for (const batch of compiled.batches) {
    if (batch.placements.length < startAt) {
      result.push(batch);
      continue;
    }
    const chunks = new Map();
    const keys = [];
    for (const position of batch.placements) {
      const cx = Math.floor(Math.round((position.x - origin[0]) / cellSize) / chunkCells);
      const cy = Math.floor(Math.round((position.y - origin[1]) / cellSize) / chunkCells);
      const cz = Math.floor(Math.round((position.z - origin[2]) / cellSize) / chunkCells);
      const key = `${cx},${cy},${cz}`;
      let placements = chunks.get(key);
      if (!placements) chunks.set(key, placements = []);
      placements.push(position);
      keys.push(key);
    }
    const dense = [...chunks].filter(([, placements]) => placements.length >= minBatchSize);
    if (chunks.size < 2 || dense.length === 0) {
      result.push(batch);
      continue;
    }
    // Leave scattered instances in one batch to cap submissions for sparse levels.
    const scattered = batch.placements.filter((_, i) => chunks.get(keys[i]).length < minBatchSize);
    for (const [, placements] of dense) result.push({ slot: batch.slot, placements });
    if (scattered.length) result.push({ slot: batch.slot, placements: scattered });
  }
  return result;
}

/**
 * Expand compact JSON into a deterministic, immutable render recipe.
 * Order is group input order, then fill: y outer, z middle, x inner.
 *
 * @param {ModularLevelData} level Version-1 level JSON.
 * @returns {CompiledModularLevel}
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
 *
 * @param {ModularLevelRendererOptions} options
 * @returns {ModularLevelRenderer}
 */
export function createModularLevelRenderer({ THREE, models, parent, chunkCells = 0 } = {}) {
  if (!THREE?.Group || !parent?.add || !parent?.remove ||
      typeof models?.get !== 'function' ||
      typeof models?.instantiate !== 'function' ||
      typeof models?.instantiateBatch !== 'function') {
    throw new TypeError('Three, model slots, and a parent Object3D are required');
  }
  if (!Number.isInteger(chunkCells) || chunkCells < 0 || chunkCells > MAX_DIMENSION) {
    throw new RangeError('chunkCells must be an integer from 0 to 512');
  }
  let mounted = null;
  let lastLevel = null;
  let lastStats = { tiles: 0, slots: 0, colliders: 0 };
  let generation = 0;
  let disposed = false;

  function detach(group) {
    if (!group) return;
    if (group.parent) group.parent.remove(group);
    models.releaseInstance?.(group);
    group.traverse(obj => {
      // InstancedMesh has an instance-owned GPU buffer and dispose event.
      // DO NOT dispose textures, shared materials or geometry here.
      if (obj.isInstancedMesh) obj.dispose?.();
    });
    group.clear();
  }

  async function mountLevel(compiled) {
    if (disposed) throw new Error('Modular level renderer is disposed');
    // Fail fast on misspelled scene slots before requesting any model.
    for (const group of compiled.batches) models.get(group.slot);
    const next = new THREE.Group();
    next.name = 'modular-level';
    const myGeneration = ++generation;
    const batches = spatialBatches(compiled, chunkCells).filter(batch => batch.placements.length > 0);
    const nodes = new Array(batches.length);
    let nextBatch = 0;
    let failed = false;
    async function prepareBatches() {
      try {
        while (!failed && !disposed && myGeneration === generation && nextBatch < batches.length) {
          const index = nextBatch++;
          const { slot, placements } = batches[index];
          let node = placements.length === 1
            ? await models.instantiate(slot)
            : await models.instantiateBatch(slot, placements);
          if (!node?.isObject3D) throw new Error('Model slot returned no Object3D: ' + slot);
          nodes[index] = node;
          if (placements.length === 1) {
            const placement = placements[0];
            // Apply the level placement outside the clone so its authored root
            // transform composes the same way as an instanced model part.
            const placed = new THREE.Group();
            placed.add(node);
            nodes[index] = placed;
            node = placed;
            node.position.set(placement.x, placement.y, placement.z);
            node.rotation.y = placement.rotationY;
            node.scale.setScalar(placement.scale);
          }
          node.userData.levelSlot = slot;
        }
      } catch (error) {
        failed = true;
        throw error;
      }
    }
    try {
      // Limit concurrent model loads and attach objects in authored order.
      const outcomes = await Promise.allSettled(Array.from(
        { length: Math.min(batches.length, 4) }, prepareBatches,
      ));
      for (const node of nodes) if (node) next.add(node);
      const failure = outcomes.find(outcome => outcome.status === 'rejected');
      if (failure) throw failure.reason;
      if (myGeneration !== generation || disposed) {
        detach(next);
        return { committed: false, ...compiled.stats };
      }
      parent.add(next);
      detach(mounted);
      mounted = next;
      lastLevel = compiled;
      lastStats = compiled.stats;
      return { committed: true, ...compiled.stats };
    } catch (error) {
      detach(next);
      throw error;
    }
  }
  async function setLevel(level) {
    if (disposed) throw new Error('Modular level renderer is disposed');
    return mountLevel(compileModularLevel(level));
  }
  async function rebuild() {
    if (!lastLevel) throw new Error('No modular level to rebuild');
    return mountLevel(lastLevel);
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
    get level() { return lastLevel; },
    get root() { return mounted; },
  };
}
