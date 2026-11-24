// PvZ-style Gameplay-First Stage & Campaign Architect:
// Multi-topology tactical maps, sawtooth wave pacing, one-new-thing counter fairness,
// ultra-light micro-barks (<= 24 chars), and a deterministic 60Hz StageDirector.

/**
 * @typedef {'floor' | 'wall' | 'water' | 'hazard' | 'cover' | 'destructible' | 'spawn' | 'enemySpawn' | 'goal' | 'pad'} StageCellKind
 * @typedef {{ code: string, kind: StageCellKind, walkable: boolean, swimOnly: boolean, blocksSight: boolean, destructible: boolean, hazard: boolean, tactical: boolean }} StageCellSpec
 * @typedef {'grid-2d' | 'lane-defense' | 'arena' | 'modular-3d'} StageTopology
 * @typedef {{ x: number, y: number, id?: string }} StagePoint
 * @typedef {{ enemy: string, count?: number, lane?: number, point?: string, intervalSec?: number, delaySec?: number }} StageWaveSpawn
 * @typedef {{ id: string, durationSec: number, breatherSec: number, flag: boolean, spawns: StageWaveSpawn[] }} StageWave
 * @typedef {'preStage' | 'firstFlag' | 'finalWave' | 'boss' | 'victory'} StageBarkTrigger
 * @typedef {{ at: StageBarkTrigger, speaker: string, icon: string, text: string, cue?: string | null, durationSec: number }} StageBark
 * @typedef {{ id: string, kind: 'tool' | 'upgrade' | 'passive' | 'badge', label: string, icon: string, counters: string[] }} StageUnlock
 * @typedef {{ threat?: number, speed?: number, traits?: readonly string[], requiresCounter?: boolean }} StageEnemySpec
 * @typedef {{
 *   introduced: string[],
 *   availableTools: string[],
 *   modifiers: string[],
 *   enemyCatalog: Record<string, StageEnemySpec>,
 *   toolCounters: Record<string, string[]>,
 *   requiredCounterTraits: string[]
 * }} StageMechanics
 * @typedef {{
 *   schemaVersion: 1,
 *   id: string,
 *   title: string,
 *   topology: StageTopology,
 *   width: number,
 *   height: number,
 *   cellSize: number,
 *   allowDiag: boolean,
 *   cells: string[],
 *   spawn: StagePoint,
 *   objectives: StagePoint[],
 *   enemySpawns: StagePoint[],
 *   laneTypes: string[],
 *   mechanics: StageMechanics,
 *   waves: StageWave[],
 *   barks: StageBark[],
 *   unlock: StageUnlock | null
 * }} StageDefinition
 * @typedef {{
 *   allowDiag?: boolean,
 *   allowSwim?: boolean,
 *   strictGameplay?: boolean,
 *   minReactionSec?: number,
 *   maxBarkChars?: number,
 *   maxBarksPerStage?: number
 * }} StageAnalyzeOptions
 * @typedef {{
 *   ok: boolean,
 *   pass: boolean,
 *   score: number,
 *   topology: StageTopology,
 *   width: number,
 *   height: number,
 *   reachableCells: number,
 *   isolatedFloorCells: number,
 *   objectiveCount: number,
 *   unreachableObjectives: string[],
 *   minimap: string,
 *   metrics: {
 *     spatial: {
 *       walkableRatio: number,
 *       featureRatio: number,
 *       chokepointCount: number,
 *       routeCount: number,
 *       minEnemySpawnDistMeters: number | null,
 *       firstContactSec: number | null
 *     },
 *     pacing: {
 *       waveCount: number,
 *       totalDurationSec: number,
 *       waveThreats: number[],
 *       waveIntensities: number[],
 *       flagWaves: string[],
 *       flagPositions: number[],
 *       sawtoothDrops: number,
 *       peakToFirstRatio: number
 *     },
 *     mechanics: {
 *       introducedCount: number,
 *       activeTraits: string[],
 *       uncounteredTraits: string[],
 *       encounteredEnemies: string[]
 *     },
 *     barks: {
 *       count: number,
 *       maxTextLength: number,
 *       unlockLabelLength: number
 *     }
 *   },
 *   warnings: string[],
 *   errors: string[]
 * }} StageAuditReport
 */

/** Canonical tactical terrain cell palette shared by validators and runtime renderers. */
export const STAGE_CELL_PALETTE = Object.freeze({
  '.': Object.freeze({ code: '.', kind: 'floor', walkable: true, swimOnly: false, blocksSight: false, destructible: false, hazard: false, tactical: false }),
  '#': Object.freeze({ code: '#', kind: 'wall', walkable: false, swimOnly: false, blocksSight: true, destructible: false, hazard: false, tactical: true }),
  '~': Object.freeze({ code: '~', kind: 'water', walkable: false, swimOnly: true, blocksSight: false, destructible: false, hazard: false, tactical: true }),
  '^': Object.freeze({ code: '^', kind: 'hazard', walkable: true, swimOnly: false, blocksSight: false, destructible: false, hazard: true, tactical: true }),
  '=': Object.freeze({ code: '=', kind: 'cover', walkable: false, swimOnly: false, blocksSight: false, destructible: false, hazard: false, tactical: true }),
  '+': Object.freeze({ code: '+', kind: 'destructible', walkable: true, swimOnly: false, blocksSight: false, destructible: true, hazard: false, tactical: true }),
  'S': Object.freeze({ code: 'S', kind: 'spawn', walkable: true, swimOnly: false, blocksSight: false, destructible: false, hazard: false, tactical: false }),
  'E': Object.freeze({ code: 'E', kind: 'enemySpawn', walkable: true, swimOnly: false, blocksSight: false, destructible: false, hazard: false, tactical: false }),
  'G': Object.freeze({ code: 'G', kind: 'goal', walkable: true, swimOnly: false, blocksSight: false, destructible: false, hazard: false, tactical: false }),
  'P': Object.freeze({ code: 'P', kind: 'pad', walkable: true, swimOnly: false, blocksSight: false, destructible: false, hazard: false, tactical: true }),
});

const DEFAULT_REQUIRED_TRAITS = Object.freeze(['aquatic', 'water-lane', 'flying', 'shielded', 'armored', 'burrow', 'fog']);
const BARK_TRIGGERS = new Set(['preStage', 'firstFlag', 'finalWave', 'boss', 'victory']);
const OBSTACLE_KIND_TO_CODE = { wall: '#', '#': '#', cover: '=', '=': '=', hazard: '^', '^': '^', destructible: '+', '+': '+', water: '~', '~': '~', pad: 'P', P: 'P' };
const NUMERIC_TO_CODE = { 0: '.', 1: '#', 2: '~', 3: '^', 4: '=', 5: '+' };

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function asStringList(value) {
  return Array.isArray(value) ? value.map((v) => String(v).trim()).filter(Boolean) : [];
}

function cellSpec(code) {
  return STAGE_CELL_PALETTE[code] ?? STAGE_CELL_PALETTE['.'];
}

function normalizeCharCell(raw) {
  if (typeof raw === 'number') return NUMERIC_TO_CODE[raw] ?? (raw > 0 ? '#' : '.');
  const ch = String(raw ?? '.');
  if (ch === '1' || ch === 'X') return '#';
  if (ch === '0') return '.';
  return STAGE_CELL_PALETTE[ch] ? ch : '.';
}

function parseModular3D(input) {
  const cellSize = Number(input.grid?.cellSize) > 0 ? Number(input.grid.cellSize) : 1;
  const origin = Array.isArray(input.grid?.origin) ? input.grid.origin : [0, 0, 0];
  const ox = Number(origin[0]) || 0;
  const oy = Number(origin[1]) || 0;
  const oz = Number(origin[2]) || 0;

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const recordCell = (cx, cz) => {
    if (cx < minX) minX = cx;
    if (cx > maxX) maxX = cx;
    if (cz < minZ) minZ = cz;
    if (cz > maxZ) maxZ = cz;
  };
  for (const g of input.groups || []) {
    if (g.fill?.from && g.fill?.to) {
      recordCell(Math.min(g.fill.from[0], g.fill.to[0]), Math.min(g.fill.from[2], g.fill.to[2]));
      recordCell(Math.max(g.fill.from[0], g.fill.to[0]), Math.max(g.fill.from[2], g.fill.to[2]));
    }
    for (const c of g.cells || []) recordCell(c[0], c[2]);
  }
  if (!Number.isFinite(minX)) {
    minX = -4; maxX = 4; minZ = -4; maxZ = 4;
  }
  const width = (maxX - minX + 1) | 0;
  const height = (maxZ - minZ + 1) | 0;
  const cells = new Array(width * height).fill('.');

  const colliders = Array.isArray(input.colliders) ? input.colliders : [];
  const mapArea = width * height * cellSize * cellSize;
  let groundY = oy + cellSize;
  for (const c of colliders) {
    if (c?.sensor) continue;
    const sx = Number(c?.size?.[0]) || 0;
    const sy = Number(c?.size?.[1]) || 0;
    const sz = Number(c?.size?.[2]) || 0;
    const cy = Number(c?.center?.[1]) || 0;
    if (c.id === 'ground' || c.id === 'floor' || sx * sz >= mapArea * 0.45) {
      groundY = cy + sy * 0.5;
      break;
    }
  }

  for (let gz = minZ; gz <= maxZ; gz++) {
    for (let gx = minX; gx <= maxX; gx++) {
      const cMinX = ox + (gx - 0.5) * cellSize;
      const cMaxX = ox + (gx + 0.5) * cellSize;
      const cMinZ = oz + (gz - 0.5) * cellSize;
      const cMaxZ = oz + (gz + 0.5) * cellSize;
      for (const col of colliders) {
        if (!col || col.sensor) continue;
        const [cx, cy, cz] = col.center ?? [0, 0, 0];
        const [sx, sy, sz] = col.size ?? [0, 0, 0];
        const bottom = cy - sy * 0.5;
        const top = cy + sy * 0.5;
        if (!(top > groundY + 0.25 && bottom < groundY + 2.0)) continue;
        const oxLap = Math.min(cMaxX, cx + sx * 0.5) - Math.max(cMinX, cx - sx * 0.5);
        const ozLap = Math.min(cMaxZ, cz + sz * 0.5) - Math.max(cMinZ, cz - sz * 0.5);
        if (oxLap > 0.25 * cellSize && ozLap > 0.25 * cellSize) {
          cells[(gz - minZ) * width + (gx - minX)] = '#';
          break;
        }
      }
    }
  }

  const ps = Array.isArray(input.playerSpawn) ? input.playerSpawn : [0, groundY + 0.8, 0];
  const sx = clamp(Math.round((ps[0] - ox) / cellSize) - minX, 0, width - 1);
  const sy = clamp(Math.round((ps[2] - oz) / cellSize) - minZ, 0, height - 1);
  const objectives = Array.isArray(input.objectives)
    ? input.objectives.map((o, idx) => ({ id: String(o.id ?? `goal_${idx}`), x: o.x | 0, y: o.y | 0 }))
    : [];
  const enemySpawns = Array.isArray(input.enemySpawns)
    ? input.enemySpawns.map((e, idx) => ({ id: String(e.id ?? `spawn_${idx}`), x: e.x | 0, y: e.y | 0 }))
    : [];

  return { width, height, cellSize, cells, spawn: { x: sx, y: sy }, objectives, enemySpawns, laneTypes: [] };
}

function parseLaneDefense(input) {
  const laneTypes = Array.isArray(input.laneTypes) && input.laneTypes.length > 0
    ? input.laneTypes.map((t) => String(t))
    : new Array(Math.max(1, (input.lanes | 0) || 5)).fill('grass');
  const height = laneTypes.length;
  const width = Math.max(3, (input.cols | 0) || 9);
  const cellSize = Number(input.cellSize) > 0 ? Number(input.cellSize) : 1.5;
  const cells = new Array(width * height).fill('.');

  for (let y = 0; y < height; y++) {
    const t = laneTypes[y];
    const fill = t === 'water' ? '~' : t === 'blocked' ? '#' : t === 'hazard' ? '^' : '.';
    for (let x = 0; x < width; x++) cells[y * width + x] = fill;
  }
  for (const obs of input.obstacles || []) {
    const lx = obs.col | 0;
    const ly = obs.lane | 0;
    if (lx >= 0 && lx < width && ly >= 0 && ly < height) {
      cells[ly * width + lx] = OBSTACLE_KIND_TO_CODE[obs.kind] ?? '#';
    }
  }

  const homeCol = Number.isInteger(input.homeCol) ? clamp(input.homeCol, 0, width - 1) : 0;
  const spawnCol = Number.isInteger(input.spawnCol) ? clamp(input.spawnCol, 0, width - 1) : width - 1;
  const objectives = [];
  const enemySpawns = [];
  for (let y = 0; y < height; y++) {
    if (laneTypes[y] === 'blocked') continue;
    objectives.push({ id: `lane_${y}_home`, x: homeCol, y });
    enemySpawns.push({ id: `lane_${y}_spawn`, x: spawnCol, y });
  }
  const midLane = Math.floor(height / 2);
  const defaultY = laneTypes[midLane] !== 'blocked' ? midLane : Math.max(0, laneTypes.findIndex((t) => t !== 'blocked'));
  const spawn = input.spawn ? { x: input.spawn.x | 0, y: input.spawn.y | 0 } : { x: homeCol, y: defaultY };
  return { width, height, cellSize, cells, spawn, objectives, enemySpawns, laneTypes };
}

function parseArena(input) {
  const bw = Number(input.bounds?.width) > 0 ? Number(input.bounds.width) : 48;
  const bh = Number(input.bounds?.height) > 0 ? Number(input.bounds.height) : 48;
  const cellSize = Number(input.cellSize) > 0 ? Number(input.cellSize) : Math.max(1, Math.round(Math.min(bw, bh) / 24));
  const width = Math.max(3, Math.ceil(bw / cellSize));
  const height = Math.max(3, Math.ceil(bh / cellSize));
  const minX = Number.isFinite(input.bounds?.originX) ? Number(input.bounds.originX) : -bw * 0.5;
  const minY = Number.isFinite(input.bounds?.originY) ? Number(input.bounds.originY) : -bh * 0.5;
  const toGrid = (wx, wy) => ({
    x: clamp(Math.floor((wx - minX) / cellSize), 0, width - 1),
    y: clamp(Math.floor((wy - minY) / cellSize), 0, height - 1),
  });
  const cells = new Array(width * height).fill('.');

  for (const obs of input.obstacles || []) {
    const code = OBSTACLE_KIND_TO_CODE[obs.kind] ?? '#';
    const ox = Number(obs.x) || 0;
    const oy = Number(obs.y) || 0;
    const rx = Number(obs.radius) > 0 ? Number(obs.radius) : (Number(obs.width) || cellSize) * 0.5;
    const ry = Number(obs.radius) > 0 ? Number(obs.radius) : (Number(obs.height) || cellSize) * 0.5;
    for (let gy = 0; gy < height; gy++) {
      const cy = minY + (gy + 0.5) * cellSize;
      for (let gx = 0; gx < width; gx++) {
        const cx = minX + (gx + 0.5) * cellSize;
        if (obs.radius > 0 ? Math.hypot(cx - ox, cy - oy) <= rx : (Math.abs(cx - ox) <= rx && Math.abs(cy - oy) <= ry)) {
          cells[gy * width + gx] = code;
        }
      }
    }
  }

  let spawn = { x: Math.floor(width / 2), y: Math.floor(height / 2) };
  if (input.spawn && Number.isFinite(input.spawn.x) && Number.isFinite(input.spawn.y)) {
    spawn = input.spawnCoordSpace === 'grid' ? { x: input.spawn.x | 0, y: input.spawn.y | 0 } : toGrid(input.spawn.x, input.spawn.y);
  } else if (input.spawns?.player?.position) {
    const p = input.spawns.player.position;
    spawn = toGrid(p[0], input.dimensions === 3 ? p[2] : p[1]);
  }
  const objectives = (input.objectives || input.goals || []).map((o, idx) => ({
    id: String(o.id ?? `goal_${idx}`),
    ...(input.spawnCoordSpace === 'grid' ? { x: o.x | 0, y: o.y | 0 } : toGrid(o.x, o.y)),
  }));
  const enemySpawns = (input.enemySpawns || []).map((e, idx) => ({
    id: String(e.id ?? `enemy_${idx}`),
    ...(input.spawnCoordSpace === 'grid' ? { x: e.x | 0, y: e.y | 0 } : toGrid(e.x, e.y)),
  }));
  return { width, height, cellSize, cells, spawn, objectives, enemySpawns, laneTypes: [] };
}

function parseGrid2D(input) {
  const rows = input.tiles || input.grid || input.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Stage grid-2d requires a non-empty tiles/grid/rows array');
  }
  const height = rows.length;
  const width = rows[0].length;
  if (!width) throw new Error('Stage grid-2d rows must be non-empty');
  const cellSize = Number(input.cellSize) > 0 ? Number(input.cellSize) : 1;
  const cells = new Array(width * height).fill('.');
  let spawn = input.spawn ? { x: input.spawn.x | 0, y: input.spawn.y | 0 } : null;
  const objectives = Array.isArray(input.objectives || input.waypoints || input.goals)
    ? (input.objectives || input.waypoints || input.goals).map((o, idx) => ({ id: String(o.id ?? `goal_${idx}`), x: o.x | 0, y: o.y | 0 }))
    : [];
  const enemySpawns = Array.isArray(input.enemySpawns)
    ? input.enemySpawns.map((e, idx) => ({ id: String(e.id ?? `enemy_${idx}`), x: e.x | 0, y: e.y | 0 }))
    : [];

  for (let y = 0; y < height; y++) {
    const row = rows[y];
    if (row.length !== width) throw new Error(`Inconsistent row width at y=${y}: expected ${width}, got ${row.length}`);
    for (let x = 0; x < width; x++) {
      const raw = typeof row === 'string' ? row[x] : row[x];
      const code = normalizeCharCell(raw);
      cells[y * width + x] = code;
      if (code === 'S' && !spawn) spawn = { x, y };
      else if (code === 'G') objectives.push({ id: `goal_${x}_${y}`, x, y });
      else if (code === 'E') enemySpawns.push({ id: `enemy_${x}_${y}`, x, y });
    }
  }
  if (!spawn) throw new Error('Stage JSON is missing spawn {x,y} or "S" marker');
  return { width, height, cellSize, cells, spawn, objectives, enemySpawns, laneTypes: [] };
}

function normalizeWaves(rawWaves) {
  if (!Array.isArray(rawWaves)) return [];
  return rawWaves.map((w, idx) => {
    const spawns = Array.isArray(w?.spawns)
      ? w.spawns.map((s) => ({
          enemy: String(s?.enemy ?? 'grunt'),
          count: Math.max(1, (s?.count | 0) || 1),
          ...(Number.isInteger(s?.lane) ? { lane: s.lane } : {}),
          ...(s?.point !== undefined ? { point: String(s.point) } : {}),
          intervalSec: Math.max(0, Number(s?.intervalSec) || 0),
          delaySec: Math.max(0, Number(s?.delaySec) || 0),
        }))
      : (w?.enemy ? [{
          enemy: String(w.enemy),
          count: Math.max(1, (w.count | 0) || 1),
          ...(Number.isInteger(w.lane) ? { lane: w.lane } : {}),
          intervalSec: Math.max(0, Number(w.intervalSec) || 0),
          delaySec: Math.max(0, Number(w.delaySec) || 0),
        }] : []);
    return {
      id: String(w?.id ?? `wave-${idx + 1}`),
      durationSec: Math.max(1, Number(w?.durationSec) || 18),
      breatherSec: Math.max(0, Number(w?.breatherSec) || 0),
      flag: w?.flag === true,
      spawns,
    };
  });
}

function normalizeBarks(rawBarks) {
  if (!Array.isArray(rawBarks)) return [];
  return rawBarks.map((b) => ({
    at: String(b?.at ?? 'preStage'),
    speaker: String(b?.speaker ?? '戴夫'),
    icon: String(b?.icon ?? '💬'),
    text: String(b?.text ?? ''),
    cue: b?.cue ? String(b.cue) : null,
    durationSec: Number(b?.durationSec) > 0 ? Number(b.durationSec) : 2.5,
  }));
}

function normalizeUnlock(rawUnlock) {
  if (!rawUnlock || typeof rawUnlock !== 'object') return null;
  const kind = rawUnlock.kind ?? 'tool';
  return {
    id: String(rawUnlock.id ?? 'unlock'),
    kind: ['tool', 'upgrade', 'passive', 'badge'].includes(kind) ? kind : 'tool',
    label: String(rawUnlock.label ?? rawUnlock.id ?? '新解锁'),
    icon: String(rawUnlock.icon ?? '⭐'),
    counters: asStringList(rawUnlock.counters),
  };
}

/**
 * Normalize a 2D grid, PvZ lane-defense board, arena, or modular-3d level into a canonical StageDefinition.
 * @param {object} input
 * @returns {StageDefinition}
 */
export function defineStage(input = {}) {
  if (!input || typeof input !== 'object') throw new TypeError('Stage definition must be an object');
  if (input.schemaVersion === 1 && Array.isArray(input.cells) && Number.isInteger(input.width) && Number.isInteger(input.height)) {
    return input;
  }

  /** @type {StageTopology} */
  const topology = input.topology
    ?? (Array.isArray(input.groups) ? 'modular-3d'
      : (Number.isInteger(input.lanes) || Array.isArray(input.laneTypes)) ? 'lane-defense'
      : (input.bounds || input.schemaVersion === 1) && !(input.grid || input.tiles || input.rows) ? 'arena'
      : 'grid-2d');

  const parsed = topology === 'modular-3d' ? parseModular3D(input)
    : topology === 'lane-defense' ? parseLaneDefense(input)
    : topology === 'arena' ? parseArena(input)
    : parseGrid2D(input);

  const mechIn = input.mechanics ?? {};
  const enemyCatalog = {};
  for (const [eid, spec] of Object.entries(mechIn.enemyCatalog ?? input.enemyCatalog ?? {})) {
    enemyCatalog[eid] = {
      threat: Number(spec?.threat) > 0 ? Number(spec.threat) : 1,
      speed: Number(spec?.speed) > 0 ? Number(spec.speed) : (topology === 'lane-defense' ? 1.0 : 4.0),
      traits: asStringList(spec?.traits),
      requiresCounter: spec?.requiresCounter === true,
    };
  }
  const toolCounters = {};
  for (const [tid, list] of Object.entries(mechIn.toolCounters ?? input.toolCounters ?? {})) {
    toolCounters[tid] = asStringList(list);
  }

  return {
    schemaVersion: 1,
    id: String(input.id ?? 'stage-1'),
    title: String(input.title ?? input.name ?? input.id ?? '关卡 1'),
    topology,
    width: parsed.width,
    height: parsed.height,
    cellSize: parsed.cellSize,
    allowDiag: input.allowDiag === true,
    cells: parsed.cells,
    spawn: parsed.spawn,
    objectives: parsed.objectives,
    enemySpawns: parsed.enemySpawns,
    laneTypes: parsed.laneTypes,
    mechanics: {
      introduced: asStringList(mechIn.introduced ?? input.introduced),
      availableTools: asStringList(mechIn.availableTools ?? input.availableTools),
      modifiers: asStringList(mechIn.modifiers ?? input.modifiers),
      enemyCatalog,
      toolCounters,
      requiredCounterTraits: asStringList(mechIn.requiredCounterTraits ?? input.requiredCounterTraits).length
        ? asStringList(mechIn.requiredCounterTraits ?? input.requiredCounterTraits)
        : [...DEFAULT_REQUIRED_TRAITS],
    },
    waves: normalizeWaves(input.waves),
    barks: normalizeBarks(input.barks),
    unlock: normalizeUnlock(input.unlock),
  };
}

function runBfs(stage, allowDiag, allowSwim) {
  const { width, height, cells, spawn } = stage;
  const sx = spawn.x | 0;
  const sy = spawn.y | 0;
  if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
    throw new Error(`Invalid spawn (${sx},${sy}): out of bounds`);
  }
  const spawnCell = cellSpec(cells[sy * width + sx]);
  if (!spawnCell.walkable && !(allowSwim && spawnCell.swimOnly)) {
    throw new Error(`Invalid spawn (${sx},${sy}): inside solid cell "${spawnCell.code}"`);
  }

  const dist = new Int32Array(width * height).fill(-1);
  const queue = new Int32Array(width * height);
  let head = 0, tail = 0;
  const startIdx = sy * width + sx;
  dist[startIdx] = 0;
  queue[tail++] = startIdx;
  const dirs = allowDiag
    ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
    : [[1, 0], [-1, 0], [0, 1], [0, -1]];

  while (head < tail) {
    const cur = queue[head++];
    const cx = cur % width;
    const cy = (cur / width) | 0;
    const nextD = dist[cur] + 1;
    for (let d = 0; d < dirs.length; d++) {
      const nx = cx + dirs[d][0];
      const ny = cy + dirs[d][1];
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nIdx = ny * width + nx;
      if (dist[nIdx] !== -1) continue;
      const spec = cellSpec(cells[nIdx]);
      if (!spec.walkable && !(allowSwim && spec.swimOnly)) continue;
      dist[nIdx] = nextD;
      queue[tail++] = nIdx;
    }
  }
  return { dist, reachableCount: tail, sx, sy };
}

function analyzeLaneConnectivity(stage) {
  const { width, height, cells, laneTypes, objectives } = stage;
  const reachableObj = new Set();
  const unreachableObjectives = [];
  let reachableCells = 0;
  for (let y = 0; y < height; y++) {
    if (laneTypes[y] === 'blocked') continue;
    let laneOpen = true;
    for (let x = 0; x < width; x++) {
      const spec = cellSpec(cells[y * width + x]);
      if (!spec.walkable && !spec.swimOnly) laneOpen = false;
    }
    if (laneOpen) reachableCells += width;
    for (const obj of objectives) {
      if ((obj.y | 0) === y) {
        if (laneOpen) reachableObj.add(y * width + (obj.x | 0));
        else unreachableObjectives.push(obj.id || `${obj.x},${obj.y}`);
      }
    }
  }
  return { reachableObj, unreachableObjectives, reachableCells, isolatedFloorCells: 0 };
}

/**
 * Audit a stage across connectivity, tactical spatial shape, sawtooth wave pacing,
 * one-new-thing / counter fairness, and PvZ-style light micro-barks.
 * @param {object} input
 * @param {StageAnalyzeOptions} [options]
 * @returns {StageAuditReport}
 */
export function analyzeStageDesign(input, options = {}) {
  const stage = defineStage(input);
  const allowDiag = options.allowDiag ?? stage.allowDiag;
  const allowSwim = options.allowSwim ?? false;
  const strict = options.strictGameplay === true;
  const maxBarkChars = options.maxBarkChars ?? 24;
  const maxBarksPerStage = options.maxBarksPerStage ?? 3;
  const errors = [];
  const warnings = [];

  const { width, height, cells, spawn, objectives, enemySpawns, waves, barks, unlock, mechanics } = stage;
  const totalCells = width * height;
  const objCoords = new Map();
  const unreachableObjectives = [];
  let reachableCells = 0;
  let isolatedFloorCells = 0;
  let dist = null;

  if (stage.topology === 'lane-defense') {
    const laneRes = analyzeLaneConnectivity(stage);
    reachableCells = laneRes.reachableCells;
    unreachableObjectives.push(...laneRes.unreachableObjectives);
    for (const obj of objectives) {
      const idx = (obj.y | 0) * width + (obj.x | 0);
      objCoords.set(idx, laneRes.reachableObj.has(idx));
    }
  } else {
    const bfs = runBfs(stage, allowDiag, allowSwim);
    dist = bfs.dist;
    reachableCells = bfs.reachableCount;
    for (const obj of objectives) {
      const ox = obj.x | 0;
      const oy = obj.y | 0;
      const valid = ox >= 0 && ox < width && oy >= 0 && oy < height && cellSpec(cells[oy * width + ox]).walkable;
      const ok = valid && dist[oy * width + ox] >= 0;
      if (!ok) unreachableObjectives.push(obj.id || `${ox},${oy}`);
      objCoords.set(oy * width + ox, ok);
    }
  }

  if (unreachableObjectives.length > 0) {
    errors.push(`Unreachable objectives: ${unreachableObjectives.join(', ')}`);
  }

  const enemyCoordSet = new Set(enemySpawns.map((e) => (e.y | 0) * width + (e.x | 0)));
  const minimapRows = [];
  let walkableCells = 0;
  let tacticalCells = 0;
  let chokepointCount = 0;

  for (let y = 0; y < height; y++) {
    let row = '';
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const spec = cellSpec(cells[idx]);
      const isBorder = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      if (spec.walkable || spec.swimOnly) walkableCells++;
      if (spec.tactical && !(isBorder && spec.kind === 'wall')) tacticalCells++;

      if (spec.walkable && !isBorder) {
        const n = cellSpec(cells[(y - 1) * width + x]);
        const s = cellSpec(cells[(y + 1) * width + x]);
        const w = cellSpec(cells[y * width + (x - 1)]);
        const e = cellSpec(cells[y * width + (x + 1)]);
        const nsPinch = (!n.walkable && !n.swimOnly) && (!s.walkable && !s.swimOnly) && w.walkable && e.walkable;
        const ewPinch = (!w.walkable && !w.swimOnly) && (!e.walkable && !e.swimOnly) && n.walkable && s.walkable;
        if (nsPinch || ewPinch) chokepointCount++;
      }

      if (x === (spawn.x | 0) && y === (spawn.y | 0)) row += '@';
      else if (objCoords.has(idx)) row += objCoords.get(idx) ? '*' : '!';
      else if (enemyCoordSet.has(idx) && (spec.walkable || spec.swimOnly)) row += 'E';
      else if (spec.code !== '.') row += spec.code;
      else if (stage.topology === 'lane-defense' || (dist && dist[idx] >= 0)) row += '.';
      else {
        row += 'x';
        isolatedFloorCells++;
      }
    }
    minimapRows.push(row);
  }

  let routeCount = 0;
  if (stage.topology === 'lane-defense') {
    routeCount = stage.laneTypes.filter((t) => t !== 'blocked').length;
  } else if (dist) {
    const sx = spawn.x | 0;
    const sy = spawn.y | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = sx + dx, ny = sy + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && dist[ny * width + nx] > 0) routeCount++;
    }
  }

  let minEnemyDistCells = null;
  for (const es of enemySpawns) {
    const ex = es.x | 0, ey = es.y | 0;
    const d = (dist && ex >= 0 && ex < width && ey >= 0 && ey < height && dist[ey * width + ex] >= 0)
      ? dist[ey * width + ex]
      : Math.hypot(ex - (spawn.x | 0), ey - (spawn.y | 0));
    if (minEnemyDistCells === null || d < minEnemyDistCells) minEnemyDistCells = d;
  }
  const minEnemySpawnDistMeters = minEnemyDistCells === null ? null : +(minEnemyDistCells * stage.cellSize).toFixed(2);

  // Mechanics & active traits
  const encounteredSet = new Set();
  const traitSet = new Set(mechanics.modifiers.includes('fog') ? ['fog'] : []);
  let maxEnemySpeed = stage.topology === 'lane-defense' ? 1.0 : 4.0;
  for (const w of waves) {
    for (const s of w.spawns) {
      encounteredSet.add(s.enemy);
      const spec = mechanics.enemyCatalog[s.enemy];
      if (spec) {
        if (spec.speed > maxEnemySpeed) maxEnemySpeed = spec.speed;
        for (const tr of spec.traits) traitSet.add(tr);
        if (spec.requiresCounter) traitSet.add(s.enemy);
      }
      if (stage.topology === 'lane-defense' && Number.isInteger(s.lane) && stage.laneTypes[s.lane] === 'water') {
        traitSet.add('water-lane');
      }
    }
  }
  if (stage.topology === 'lane-defense' && waves.length > 0 && stage.laneTypes.includes('water') &&
      waves.every((w) => w.spawns.every((s) => !Number.isInteger(s.lane)))) {
    traitSet.add('water-lane');
  }

  const firstContactSec = minEnemySpawnDistMeters === null ? null : +(minEnemySpawnDistMeters / maxEnemySpeed).toFixed(2);
  const minReactionSec = options.minReactionSec ?? (stage.topology === 'lane-defense' ? 6.0 : 2.5);
  const featureRatio = +(tacticalCells / Math.max(1, totalCells)).toFixed(3);
  const walkableRatio = +(walkableCells / Math.max(1, totalCells)).toFixed(3);

  const pushGameplayIssue = (msg) => (strict ? errors : warnings).push(msg);
  if (enemySpawns.length > 0 && waves.length > 0 && firstContactSec !== null && firstContactSec < minReactionSec) {
    pushGameplayIssue(`Enemy spawn too close to home/player: firstContact ${firstContactSec}s < ${minReactionSec}s`);
  }
  if (waves.length > 0 && featureRatio === 0 && mechanics.modifiers.length === 0 && stage.topology !== 'lane-defense') {
    pushGameplayIssue('Empty flat arena with zero terrain features or stage modifiers');
  }

  // Sawtooth wave pacing
  const waveThreats = [];
  const waveIntensities = [];
  const flagWaves = [];
  const flagPositions = [];
  let totalDurationSec = 0;
  for (const w of waves) totalDurationSec += w.durationSec + w.breatherSec;
  let elapsedCursor = 0;
  for (const w of waves) {
    let threat = 0;
    for (const s of w.spawns) {
      const unitThreat = mechanics.enemyCatalog[s.enemy]?.threat ?? 1;
      threat += unitThreat * s.count;
    }
    const intensity = +(threat / Math.max(1, w.durationSec)).toFixed(3);
    waveThreats.push(+threat.toFixed(2));
    waveIntensities.push(intensity);
    elapsedCursor += w.durationSec;
    if (w.flag) {
      flagWaves.push(w.id);
      flagPositions.push(totalDurationSec > 0 ? +(elapsedCursor / totalDurationSec).toFixed(4) : 1);
    }
    elapsedCursor += w.breatherSec;
  }

  let sawtoothDrops = 0;
  for (let i = 1; i < waves.length; i++) {
    if (waves[i - 1].breatherSec >= 4 || (waveIntensities[i - 1] > 0 && waveIntensities[i] <= waveIntensities[i - 1] * 0.85)) {
      sawtoothDrops++;
    }
  }
  const maxIntensity = waveIntensities.length ? Math.max(...waveIntensities) : 0;
  const firstIntensity = waveIntensities[0] ?? 0;
  const peakToFirstRatio = firstIntensity > 0 ? +(maxIntensity / firstIntensity).toFixed(2) : (maxIntensity > 0 ? 99 : 1);

  if (waves.length >= 3 && firstIntensity >= maxIntensity && maxIntensity > 0) {
    pushGameplayIssue('Wave 1 already peaks without warmup escalation');
  }
  if (waves.length >= 4 && sawtoothDrops === 0) {
    pushGameplayIssue('Pacing is a flat grind with zero breather troughs (sawtoothDrops=0)');
  }
  if (waves.length >= 4 && flagWaves.length === 0) {
    pushGameplayIssue('4+ wave stage has no flag climax wave (flag: true)');
  }

  // One-New-Thing & Counter matrix
  if (mechanics.introduced.length > 3) {
    errors.push(`Too many new mechanics introduced in one stage (${mechanics.introduced.length} > 3)`);
  } else if (mechanics.introduced.length === 3) {
    warnings.push('3 new mechanics introduced in one stage (recommend <= 2)');
  }

  const counteredSet = new Set();
  for (const tool of mechanics.availableTools) {
    for (const tr of mechanics.toolCounters[tool] || []) counteredSet.add(tr);
  }
  const hasCounterSpec = Object.keys(mechanics.toolCounters).length > 0 || Object.values(mechanics.enemyCatalog).some((e) => e.requiresCounter);
  const reqTraits = new Set(mechanics.requiredCounterTraits);
  for (const eSpec of Object.values(mechanics.enemyCatalog)) {
    if (eSpec.requiresCounter) for (const tr of eSpec.traits) reqTraits.add(tr);
  }
  const uncounteredTraits = [];
  if (hasCounterSpec) {
    for (const tr of traitSet) {
      if ((reqTraits.has(tr) || Object.values(mechanics.enemyCatalog).some((e) => e.requiresCounter && e.traits.includes(tr))) && !counteredSet.has(tr)) {
        uncounteredTraits.push(tr);
      }
    }
  }
  if (uncounteredTraits.length > 0) {
    errors.push(`Uncountered enemy/terrain traits (${uncounteredTraits.join(', ')}) given availableTools [${mechanics.availableTools.join(', ')}]`);
  }

  // PvZ-style light micro-barks audit
  if (barks.length > maxBarksPerStage) {
    errors.push(`Too many barks in stage (${barks.length} > ${maxBarksPerStage}); keep story lightweight`);
  }
  let maxTextLength = 0;
  for (let i = 0; i < barks.length; i++) {
    const b = barks[i];
    if (!BARK_TRIGGERS.has(b.at)) errors.push(`bark[${i}] invalid trigger "${b.at}"`);
    if (!b.text.trim()) errors.push(`bark[${i}] text must be non-empty`);
    if (/[\r\n]/.test(b.text)) errors.push(`bark[${i}] must be single-line (no prose paragraphs)`);
    if (b.text.length > maxBarkChars) errors.push(`bark[${i}] exceeds ${maxBarkChars} chars (${b.text.length}): "${b.text}"`);
    if (b.text.length > maxTextLength) maxTextLength = b.text.length;
  }
  const unlockLabelLength = unlock ? unlock.label.length : 0;
  if (unlock && unlockLabelLength > 8) {
    errors.push(`unlock.label "${unlock.label}" exceeds 8 chars (${unlockLabelLength})`);
  }

  // Composite Stage Quality Score (0..100)
  const connScore = unreachableObjectives.length === 0 ? 30 : Math.max(0, 30 - unreachableObjectives.length * 15);
  let spaceScore = 25;
  if (stage.topology !== 'lane-defense' && featureRatio === 0 && mechanics.modifiers.length === 0) spaceScore -= 10;
  if (enemySpawns.length > 0 && waves.length > 0 && firstContactSec !== null && firstContactSec < minReactionSec) spaceScore -= 10;
  if (routeCount < 2 && stage.topology !== 'lane-defense' && waves.length > 0) spaceScore -= 5;
  let pacingScore = waves.length === 0 ? 18 : 25;
  if (waves.length >= 3 && firstIntensity >= maxIntensity && maxIntensity > 0) pacingScore -= 8;
  if (waves.length >= 4 && sawtoothDrops === 0) pacingScore -= 8;
  if (waves.length >= 4 && flagWaves.length === 0) pacingScore -= 7;
  let mechScore = 15;
  if (uncounteredTraits.length > 0) mechScore = 0;
  else if (mechanics.introduced.length > 3) mechScore -= 10;
  else if (mechanics.introduced.length === 3) mechScore -= 4;
  const barkScore = barks.some((b) => b.text.length > maxBarkChars || /[\r\n]/.test(b.text)) || barks.length > maxBarksPerStage || (unlock && unlockLabelLength > 8) ? 0 : 5;
  const score = clamp(connScore + spaceScore + pacingScore + mechScore + barkScore, 0, 100);

  return {
    ok: errors.length === 0,
    pass: errors.length === 0,
    score,
    topology: stage.topology,
    width,
    height,
    reachableCells,
    isolatedFloorCells,
    objectiveCount: objectives.length,
    unreachableObjectives,
    minimap: minimapRows.join('\n'),
    metrics: {
      spatial: { walkableRatio, featureRatio, chokepointCount, routeCount, minEnemySpawnDistMeters, firstContactSec },
      pacing: { waveCount: waves.length, totalDurationSec, waveThreats, waveIntensities, flagWaves, flagPositions, sawtoothDrops, peakToFirstRatio },
      mechanics: { introducedCount: mechanics.introduced.length, activeTraits: [...traitSet], uncounteredTraits, encounteredEnemies: [...encounteredSet] },
      barks: { count: barks.length, maxTextLength, unlockLabelLength },
    },
    warnings,
    errors,
  };
}

/**
 * Validate a multi-stage PvZ-style campaign ("起-承-转-合"):
 * propagates cumulative tool unlocks, prevents premature enemy counters, and catches stagnation droughts.
 * @param {object} campaign
 * @param {StageAnalyzeOptions} [options]
 */
export function analyzeCampaignProgression(campaign, options = {}) {
  const stagesIn = Array.isArray(campaign?.stages) ? campaign.stages : [];
  if (stagesIn.length === 0) throw new Error('Campaign requires a non-empty stages array');
  const strict = options.strictGameplay === true;
  const unlockedTools = new Set(asStringList(campaign.initialTools));
  const toolCounters = {};
  for (const [k, v] of Object.entries(campaign.toolCounters ?? {})) toolCounters[k] = asStringList(v);
  const enemyCatalog = campaign.enemyCatalog ?? {};
  const requiredCounterTraits = asStringList(campaign.requiredCounterTraits);

  const stageReports = [];
  const errors = [];
  const warnings = [];
  const seenEnemies = new Set();
  let stagnantRun = 0;
  let prevSig = '';

  for (let i = 0; i < stagesIn.length; i++) {
    const rawStage = stagesIn[i];
    const mergedCounters = { ...toolCounters };
    for (const [k, v] of Object.entries(rawStage.mechanics?.toolCounters ?? rawStage.toolCounters ?? {})) {
      mergedCounters[k] = asStringList(v);
    }
    const availableTools = [...new Set([...unlockedTools, ...asStringList(rawStage.mechanics?.availableTools ?? rawStage.availableTools)])];
    const stageInput = {
      ...rawStage,
      mechanics: {
        ...(rawStage.mechanics ?? {}),
        availableTools,
        enemyCatalog: { ...enemyCatalog, ...(rawStage.mechanics?.enemyCatalog ?? {}) },
        toolCounters: mergedCounters,
        ...(requiredCounterTraits.length ? { requiredCounterTraits } : {}),
      },
    };
    const rep = analyzeStageDesign(stageInput, options);
    stageReports.push({ id: rawStage.id ?? `stage-${i + 1}`, ...rep });
    for (const e of rep.errors) errors.push(`[${rawStage.id ?? i + 1}] ${e}`);
    for (const w of rep.warnings) warnings.push(`[${rawStage.id ?? i + 1}] ${w}`);

    const newEnemies = rep.metrics.mechanics.encounteredEnemies.filter((e) => !seenEnemies.has(e));
    for (const e of rep.metrics.mechanics.encounteredEnemies) seenEnemies.add(e);
    const intro = asStringList(rawStage.mechanics?.introduced ?? rawStage.introduced);
    const sig = `${rep.topology}|${asStringList(rawStage.mechanics?.modifiers ?? rawStage.modifiers).sort().join(',')}`;

    if (i > 0 && intro.length === 0 && newEnemies.length === 0 && sig === prevSig) {
      stagnantRun++;
      if (stagnantRun >= 2) {
        const msg = `Campaign stagnation drought at stage "${rawStage.id ?? i + 1}" (${stagnantRun + 1} consecutive stages without new mechanic, enemy, or twist)`;
        (strict ? errors : warnings).push(msg);
      }
    } else {
      stagnantRun = 0;
    }
    prevSig = sig;

    const unlock = defineStage(stageInput).unlock;
    if (unlock && (unlock.kind === 'tool' || unlock.counters.length > 0)) {
      unlockedTools.add(unlock.id);
      if (unlock.counters.length > 0) toolCounters[unlock.id] = unlock.counters;
    }
  }

  const stageThreats = stageReports.map((r) => r.metrics.pacing.waveThreats.reduce((a, b) => a + b, 0));
  const maxThreat = stageThreats.length ? Math.max(...stageThreats) : 0;
  if (stagesIn.length >= 3) {
    if ((stageReports[0].metrics.mechanics.introducedCount ?? 0) > 2) {
      warnings.push('Opening stage introduces > 2 mechanics (heavy onboarding)');
    }
    if (maxThreat > 0 && stageThreats[0] >= maxThreat) {
      (strict ? errors : warnings).push('Opening stage threat equals campaign maximum (no escalation arc)');
    }
    if (stageThreats[0] > 0 && maxThreat < stageThreats[0] * 1.25) {
      (strict ? errors : warnings).push('Campaign total threat does not escalate >= 1.25x from Stage 1 to peak');
    }
    const last = stageReports[stageReports.length - 1];
    if (last.metrics.pacing.flagWaves.length === 0 && asStringList(stagesIn[stagesIn.length - 1].mechanics?.modifiers).length === 0) {
      warnings.push('Final stage lacks a flag climax wave or finale modifier');
    }
  }

  const score = Math.round(stageReports.reduce((s, r) => s + r.score, 0) / stageReports.length);
  return {
    ok: errors.length === 0,
    pass: errors.length === 0,
    score,
    stageCount: stageReports.length,
    stages: stageReports,
    unlockedTools: [...unlockedTools],
    warnings,
    errors,
  };
}

/**
 * Deterministic 60Hz runtime wave & light-bark director for any StageDefinition.
 * @param {object} stageInput
 * @param {{
 *   earlyClearDelaySec?: number,
 *   onSpawn?: (entry: { waveId: string, waveIndex: number, enemy: string, lane?: number, point?: string }) => void,
 *   onWaveStart?: (info: { waveId: string, waveIndex: number, totalWaves: number, flag: boolean }) => void,
 *   onFlagWave?: (info: { waveId: string, waveIndex: number }) => void,
 *   onBark?: (bark: StageBark) => void,
 *   onUnlock?: (unlock: StageUnlock) => void,
 *   onComplete?: (summary: { stageId: string, elapsed: number }) => void
 * }} [options]
 */
export function createStageDirector(stageInput, options = {}) {
  const stage = defineStage(stageInput);
  const earlyClearDelaySec = Number(options.earlyClearDelaySec) >= 0 ? Number(options.earlyClearDelaySec) : 1.0;

  let totalDurationSec = 0;
  const waveWindows = [];
  for (let i = 0; i < stage.waves.length; i++) {
    const w = stage.waves[i];
    const windowSec = w.durationSec + w.breatherSec;
    const schedule = [];
    for (const s of w.spawns) {
      const count = Math.max(1, s.count | 0);
      for (let k = 0; k < count; k++) {
        schedule.push({
          at: s.delaySec + k * s.intervalSec,
          enemy: s.enemy,
          ...(Number.isInteger(s.lane) ? { lane: s.lane } : {}),
          ...(s.point !== undefined ? { point: s.point } : {}),
        });
      }
    }
    schedule.sort((a, b) => a.at - b.at);
    waveWindows.push({ startAt: totalDurationSec, endAt: totalDurationSec + w.durationSec, windowSec, schedule });
    totalDurationSec += windowSec;
  }
  const flagPositions = stage.waves
    .map((w, i) => (w.flag && totalDurationSec > 0 ? +(waveWindows[i].endAt / totalDurationSec).toFixed(4) : null))
    .filter((v) => v !== null);

  let status = 'idle';
  let waveIndex = -1;
  let waveElapsed = 0;
  let totalElapsed = 0;
  let spawnCursor = 0;
  let earlyClearTimer = null;
  let firstFlagFired = false;
  let activeBark = null;
  let barkTimer = 0;

  function fireBark(at) {
    const b = stage.barks.find((entry) => entry.at === at);
    if (!b) return;
    activeBark = { ...b };
    barkTimer = b.durationSec;
    options.onBark?.({ ...b });
  }

  function enterWave(idx) {
    waveIndex = idx;
    waveElapsed = 0;
    spawnCursor = 0;
    earlyClearTimer = null;
    const w = stage.waves[idx];
    options.onWaveStart?.({ waveId: w.id, waveIndex: idx, totalWaves: stage.waves.length, flag: w.flag });
    if (w.flag) {
      options.onFlagWave?.({ waveId: w.id, waveIndex: idx });
      if (!firstFlagFired) {
        firstFlagFired = true;
        fireBark('firstFlag');
      }
    }
    if (idx === stage.waves.length - 1) fireBark('finalWave');
  }

  function finishStage() {
    status = 'completed';
    fireBark('victory');
    if (stage.unlock) options.onUnlock?.({ ...stage.unlock });
    options.onComplete?.({ stageId: stage.id, elapsed: totalElapsed });
  }

  function start() {
    status = 'running';
    waveIndex = -1;
    waveElapsed = 0;
    totalElapsed = 0;
    spawnCursor = 0;
    earlyClearTimer = null;
    firstFlagFired = false;
    activeBark = null;
    barkTimer = 0;
    fireBark('preStage');
    if (stage.waves.length === 0) {
      finishStage();
      return getHudState();
    }
    enterWave(0);
    return getHudState();
  }

  function update(dt, { aliveEnemies = null } = {}) {
    if (status !== 'running') return getHudState();
    const stepDt = Math.max(0, Number(dt) || 0);
    if (activeBark) {
      barkTimer -= stepDt;
      if (barkTimer <= 0) {
        activeBark = null;
        barkTimer = 0;
      }
    }
    waveElapsed += stepDt;
    totalElapsed += stepDt;

    const w = stage.waves[waveIndex];
    const win = waveWindows[waveIndex];
    while (spawnCursor < win.schedule.length && win.schedule[spawnCursor].at <= waveElapsed + 1e-9) {
      const entry = win.schedule[spawnCursor++];
      options.onSpawn?.({ waveId: w.id, waveIndex, ...entry });
    }

    const allSpawned = spawnCursor >= win.schedule.length;
    if (allSpawned && aliveEnemies === 0 && waveIndex < stage.waves.length - 1) {
      if (earlyClearTimer === null) earlyClearTimer = earlyClearDelaySec;
      else earlyClearTimer -= stepDt;
    }

    const doneEarly = earlyClearTimer !== null && earlyClearTimer <= 0;
    if (waveElapsed >= win.windowSec - 1e-9 || doneEarly) {
      if (waveIndex + 1 < stage.waves.length) enterWave(waveIndex + 1);
      else if (allSpawned && (aliveEnemies === null || aliveEnemies === 0)) finishStage();
    }
    return getHudState();
  }

  function getHudState() {
    const progress = status === 'completed' ? 1
      : totalDurationSec > 0 && waveIndex >= 0
        ? clamp((waveWindows[waveIndex].startAt + Math.min(waveElapsed, waveWindows[waveIndex].windowSec)) / totalDurationSec, 0, 1)
        : 0;
    return {
      status,
      stageId: stage.id,
      waveIndex,
      totalWaves: stage.waves.length,
      progress: +progress.toFixed(4),
      flagPositions,
      isFlagWave: waveIndex >= 0 && waveIndex < stage.waves.length ? stage.waves[waveIndex].flag : false,
      activeBark: activeBark ? { ...activeBark } : null,
      unlock: stage.unlock ? { ...stage.unlock } : null,
    };
  }

  function getSnapshot() {
    return {
      schemaVersion: 1,
      stageId: stage.id,
      status,
      waveIndex,
      waveElapsed,
      totalElapsed,
      spawnCursor,
      earlyClearTimer,
      firstFlagFired,
      activeBark: activeBark ? { ...activeBark } : null,
      barkTimer,
    };
  }

  function restoreSnapshot(snap) {
    if (!snap || snap.stageId !== stage.id) throw new Error(`Snapshot stageId mismatch: expected ${stage.id}`);
    status = snap.status;
    waveIndex = snap.waveIndex;
    waveElapsed = snap.waveElapsed;
    totalElapsed = snap.totalElapsed;
    spawnCursor = snap.spawnCursor;
    earlyClearTimer = snap.earlyClearTimer;
    firstFlagFired = snap.firstFlagFired;
    activeBark = snap.activeBark ? { ...snap.activeBark } : null;
    barkTimer = snap.barkTimer;
    return getHudState();
  }

  return Object.freeze({
    stage,
    start,
    update,
    triggerBark: fireBark,
    getHudState,
    getSnapshot,
    restoreSnapshot,
  });
}
