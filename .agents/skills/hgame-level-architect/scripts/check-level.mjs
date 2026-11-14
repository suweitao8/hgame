#!/usr/bin/env node
// Zero-dependency BFS level reachability & island validator with ASCII minimap output.
import fs from 'node:fs';

function parseArgs(argv) {
  let levelPath = '';
  let demo = false;
  let allowDiag = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--level' || a === '-l') levelPath = argv[++i] ?? '';
    else if (a === '--demo') demo = true;
    else if (a === '--diag') allowDiag = true;
  }
  return { levelPath, demo, allowDiag };
}

function normalizeLevel(raw) {
  const rows = raw.tiles || raw.grid || raw.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Level JSON must contain a non-empty tiles/grid array');
  }
  const height = rows.length;
  const width = typeof rows[0] === 'string' ? rows[0].length : rows[0].length;
  const solid = new Uint8Array(width * height);
  let spawn = raw.spawn ? { ...raw.spawn } : null;
  const objectives = Array.isArray(raw.objectives || raw.waypoints || raw.goals)
    ? [...(raw.objectives || raw.waypoints || raw.goals)]
    : [];

  for (let y = 0; y < height; y++) {
    const row = rows[y];
    for (let x = 0; x < width; x++) {
      const cell = typeof row === 'string' ? row[x] : row[x];
      if (typeof cell === 'string') {
        if (cell === '#' || cell === '1' || cell === 'X') solid[y * width + x] = 1;
        else if (cell === 'S' && !spawn) spawn = { x, y };
        else if (cell === 'G') objectives.push({ id: `goal_${x}_${y}`, x, y });
      } else if (Number(cell) > 0) {
        solid[y * width + x] = 1;
      }
    }
  }

  if (!spawn) throw new Error('Level JSON is missing spawn {x,y} or "S" marker');
  return { width, height, solid, spawn, objectives };
}

function analyzeLevel(level, allowDiag) {
  const { width, height, solid, spawn, objectives } = level;
  const dist = new Int32Array(width * height).fill(-1);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  const sx = spawn.x | 0;
  const sy = spawn.y | 0;
  if (sx < 0 || sx >= width || sy < 0 || sy >= height || solid[sy * width + sx]) {
    throw new Error(`Invalid spawn (${sx},${sy}): out of bounds or inside wall`);
  }

  const sIdx = sy * width + sx;
  dist[sIdx] = 0;
  queue[tail++] = sIdx;

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
      if (solid[nIdx] || dist[nIdx] !== -1) continue;
      dist[nIdx] = nextD;
      queue[tail++] = nIdx;
    }
  }

  const unreachableObjectives = [];
  const objSet = new Map();
  for (const obj of objectives) {
    const ox = obj.x | 0;
    const oy = obj.y | 0;
    const valid = ox >= 0 && ox < width && oy >= 0 && oy < height && !solid[oy * width + ox];
    const d = valid ? dist[oy * width + ox] : -1;
    const reachable = d >= 0;
    if (!reachable) unreachableObjectives.push(obj.id || `${ox},${oy}`);
    objSet.set(oy * width + ox, reachable);
  }

  let isolatedFloorCells = 0;
  const lines = [];
  for (let y = 0; y < height; y++) {
    let row = '';
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (x === sx && y === sy) row += '@';
      else if (objSet.has(idx)) row += objSet.get(idx) ? '*' : '!';
      else if (solid[idx]) row += '#';
      else if (dist[idx] >= 0) row += '.';
      else {
        row += 'x';
        isolatedFloorCells++;
      }
    }
    lines.push(row);
  }

  return {
    width,
    height,
    reachableCells: tail,
    isolatedFloorCells,
    objectiveCount: objectives.length,
    unreachableObjectives,
    pass: unreachableObjectives.length === 0,
    minimap: lines.join('\n'),
  };
}

const DEMO_LEVEL = {
  grid: [
    '############',
    '#S..#...G..#',
    '#...#..##..#',
    '#......#...#',
    '###..###.###',
    '#G.........#',
    '############',
  ],
};

const args = parseArgs(process.argv.slice(2));
const raw = args.levelPath
  ? JSON.parse(fs.readFileSync(args.levelPath, 'utf8'))
  : (args.demo ? DEMO_LEVEL : null);

if (!raw) {
  console.error('Usage: node check-level.mjs --level <level.json> [--diag] | --demo');
  process.exit(1);
}

const level = normalizeLevel(raw);
const res = analyzeLevel(level, args.allowDiag);
console.log(res.minimap);
console.log(JSON.stringify({
  width: res.width,
  height: res.height,
  reachableCells: res.reachableCells,
  isolatedFloorCells: res.isolatedFloorCells,
  objectiveCount: res.objectiveCount,
  unreachableObjectives: res.unreachableObjectives,
  pass: res.pass,
}, null, 2));

if (!res.pass) process.exit(1);
