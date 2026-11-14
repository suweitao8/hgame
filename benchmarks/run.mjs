#!/usr/bin/env node
// Node-side performance budgets for CPU-bound runtime subsystems.
// Budgets are deliberately loose (CI noise tolerant): they catch order-of-magnitude regressions.
// Usage: npm run bench [-- --json out.json]
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  ObjectPool,
  SpatialHash2D,
  FlatSpatialHash2D,
  FlowField2D,
  createSwarmSimulation,
  TileMap,
  findGridPath,
  createTagContainer,
} from '../assets/runtime/index.js';

function bestOf(runs, fn) {
  fn(); // warm-up
  let best = Infinity;
  for (let i = 0; i < runs; i++) { const t = performance.now(); fn(); best = Math.min(best, performance.now() - t); }
  return best;
}

const cases = [
  { name: 'SpatialHash2D: insert 20k + 20k radius queries', budgetMs: 400, run() {
    const h = new SpatialHash2D({ cellSize: 64 });
    const out = [];
    let seed = 1; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    return bestOf(5, () => {
      h.clear();
      for (let i = 0; i < 20000; i++) h.insert(i, rnd() * 4000, rnd() * 4000, 8);
      for (let i = 0; i < 20000; i++) { out.length = 0; h.queryRadius(rnd() * 4000, rnd() * 4000, 48, out); }
    });
  } },
  { name: 'ObjectPool: 500k acquire/release', budgetMs: 250, run() {
    const p = new ObjectPool({ create: () => ({ x: 0, y: 0 }), initialSize: 64, maxSize: 1024 });
    return bestOf(5, () => { for (let i = 0; i < 500000; i++) p.release(p.acquire()); });
  } },
  { name: 'findGridPath: 200x200 open grid, diagonal', budgetMs: 400, run() {
    const tiles = Array.from({ length: 200 }, () => Array.from({ length: 200 }, () => 0));
    for (let y = 20; y < 180; y++) tiles[y][100] = 1; // wall forcing a detour
    const map = new TileMap({ tiles, solid: [1] });
    return bestOf(5, () => {
      const path = findGridPath(map, { x: 2, y: 100 }, { x: 197, y: 100 }, { allowDiagonal: true, maxNodes: 60000 });
      if (!path || !path.length) throw new Error('no path found');
    });
  } },
  { name: 'Gameplay tags: 50k add/match on container', budgetMs: 400, run() {
    return bestOf(5, () => {
      const c = createTagContainer();
      for (let i = 0; i < 50000; i++) { c.add(`state.buff.t${i % 64}`); c.has('state.buff'); }
    });
  } },
  { name: 'FlatSpatialHash2D: insert 30k + 30k cell-neighbor scans', budgetMs: 250, run() {
    const N = 30000;
    const h = new FlatSpatialHash2D({ cols: 128, rows: 128, cellSize: 2, originX: -128, originY: -128, capacity: N });
    const flags = new Uint8Array(N).fill(1);
    const px = new Float32Array(N);
    const py = new Float32Array(N);
    const out = new Int32Array(64);
    let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < N; i++) { px[i] = (rnd() - 0.5) * 200; py[i] = (rnd() - 0.5) * 200; }
    return bestOf(5, () => {
      h.rebuildFromArrays(flags, px, py, N);
      for (let i = 0; i < N; i++) h.queryRadiusIds(px[i], py[i], 1.5, out, 8, px, py, i);
    });
  } },
  { name: 'FlowField2D: 128x128 Dijkstra + gradient rebuild', budgetMs: 150, run() {
    const ff = new FlowField2D({ cols: 128, rows: 128, cellSize: 2, originX: -128, originY: -128 });
    ff.setObstacleRect(-40, -10, 40, -2, 255);
    return bestOf(5, () => { ff.compute({ x: 0, y: 0 }); });
  } },
  { name: 'SwarmSimulation: step 25k units (flow + hash + separation + 10m ECS)', budgetMs: 250, run() {
    const sim = createSwarmSimulation({
      capacity: 25000,
      ecsSlots: 5000,
      promoteRadius: 10,
      demoteRadius: 12,
      flowInterval: 0.1,
    });
    sim.spawnWave({ count: 25000, minRadius: 3, maxRadius: 90, seed: 42 });
    sim.step(1 / 60, { heroX: 0, heroY: 0 }); // prime initial flow + ECS ring
    return bestOf(5, () => { sim.step(1 / 60, { heroX: 0, heroY: 0 }); });
  } },
  { name: 'SwarmSimulation: step 100k units (3-tier separation + chunks + 10m ECS)', budgetMs: 80, run() {
    const sim = createSwarmSimulation({
      capacity: 100000,
      ecsSlots: 5000,
      promoteRadius: 10,
      demoteRadius: 12,
      flowInterval: 0.1,
    });
    sim.spawnWave({ count: 100000, minRadius: 3, maxRadius: 95, seed: 77 });
    sim.step(1 / 60, { heroX: 0, heroY: 0 });
    return bestOf(5, () => { sim.step(1 / 60, { heroX: 0, heroY: 0 }); });
  } },
];

const results = [];
let failed = false;
for (const c of cases) {
  const ms = c.run();
  const ok = ms <= c.budgetMs;
  failed ||= !ok;
  results.push({ name: c.name, ms: +ms.toFixed(2), budgetMs: c.budgetMs, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}  ${ms.toFixed(1)}ms (budget ${c.budgetMs}ms)`);
}
const i = process.argv.indexOf('--json');
if (i >= 0) writeFileSync(process.argv[i + 1], JSON.stringify({ node: process.version, results }, null, 2));
process.exit(failed ? 1 : 0);

