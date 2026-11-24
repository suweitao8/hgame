// Scorecard R1 evidence: 2D lighting/occluders (post2d) + AutoTile masks (tilemap). Headless, pure logic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_2D_LIGHTS, MAX_2D_OCCLUDERS, QUALITY2D_LIGHTING_PRESETS,
  createLighting2DState, addPolygonOccluder, setPolygonOccluders,
} from '../assets/runtime/integrations/post2d.js';
import { TileMap, applyAutoTileRules } from '../assets/runtime/world/tilemap.js';

test('R1 lighting: lights clamp to MAX_2D_LIGHTS and quality tier caps effective count', () => {
  const s = createLighting2DState();
  const many = Array.from({ length: 50 }, (_, i) => ({ x: i, y: 0, radius: 50, intensity: 1 }));
  assert.equal(s.setLights(many), MAX_2D_LIGHTS);
  assert.equal(s.rawLightCount, 32);
  s.setQuality('low');
  assert.equal(s.lightCount, 8);
  assert.equal(s.rawLightCount, 32);
  s.setQuality('medium');
  assert.equal(s.lightCount, 16);
  s.setQuality('ultra'); // alias of high
  assert.equal(s.qualityTier, 'high');
  assert.equal(s.lightCount, 32);
  s.setQuality('bogus');
  assert.equal(s.qualityTier, 'high');
});

test('R1 lighting: light params are sanitised and packed', () => {
  const s = createLighting2DState();
  assert.equal(s.addLight(null), false);
  s.addLight({ x: 10, y: 20, radius: -5, intensity: 99, color: 0xff8000 });
  assert.equal(s.lightWorld[2], 1);       // radius min 1... (-5 is truthy -> max(1,-5))
  assert.equal(s.lightWorld[3], 8);       // intensity clamped to 8
  assert.ok(Math.abs(s.lightWorld[4] - 1) < 1e-6);
  assert.ok(Math.abs(s.lightWorld[5] - 128 / 255) < 1e-6);
  assert.equal(s.lightWorld[6], 0);
});

test('R1 shadows: polygon occluders become closed edge segments, capped at 128, gated by quality', () => {
  assert.equal(MAX_2D_OCCLUDERS, 128);
  const s = createLighting2DState();
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(addPolygonOccluder(s, square), 4);
  // closing edge (0,10)->(0,0)
  assert.deepEqual([...s.occluderWorld.slice(12, 16)], [0, 10, 0, 0]);
  // open polyline has n-1 edges
  s.clearOccluders();
  assert.equal(s.addPolygonOccluder(square, { closed: false }), 3);
  // degenerate (zero-length) edges skipped
  s.clearOccluders();
  assert.equal(s.addPolygonOccluder([{ x: 1, y: 1 }, { x: 1, y: 1 }], { closed: false }), 0);
  // cap
  const polys = Array.from({ length: 60 }, () => square);
  assert.equal(setPolygonOccluders(s, polys), 128);
  assert.equal(s.rawOccluderCount, 128);
  // quality gating: low has no occluder shadows
  s.setQuality('low');
  assert.equal(s.occluderCount, 0);
  s.setQuality('medium');
  assert.equal(s.occluderCount, 128);
  assert.equal(QUALITY2D_LIGHTING_PRESETS.low.occluderShadows, false);
  assert.equal(QUALITY2D_LIGHTING_PRESETS.high.softShadows, true);
});

test('R1 lighting: projectLightsToUv maps world light/occluder to screen UV (y flipped)', () => {
  const s = createLighting2DState();
  s.addLight({ x: 100, y: 100, radius: 50, intensity: 2, color: '#ffffff' });
  s.addOccluder({ x1: 100, y1: 100, x2: 110, y2: 100 });
  s.projectLightsToUv({ x: 100, y: 100, zoom: 1 }, { vw: 800, vh: 600, scale: 1 }, 800, 600);
  // camera centred on light -> UV centre
  assert.ok(Math.abs(s.lightUvPosRad[0] - 0.5) < 1e-6);
  assert.ok(Math.abs(s.lightUvPosRad[1] - 0.5) < 1e-6);
  assert.ok(Math.abs(s.lightUvPosRad[2] - 50 / 800) < 1e-6);
  assert.ok(Math.abs(s.lightUvPosRad[3] - 50 / 600) < 1e-6);
  assert.equal(s.lightUvColorInt[3], 2);
  assert.ok(Math.abs(s.occluderUv[2] - (0.5 + 10 / 800)) < 1e-6);
  // light moved below camera in world (+y) -> lower UV v
  const s2 = createLighting2DState();
  s2.addLight({ x: 100, y: 160, radius: 10 });
  s2.projectLightsToUv({ x: 100, y: 100, zoom: 1 }, { vw: 800, vh: 600, scale: 1 }, 800, 600);
  assert.ok(Math.abs(s2.lightUvPosRad[1] - (0.5 - 60 / 600)) < 1e-6);
});

test('R1 lighting: hasLighting/hasActivePass reflect ambient, lights and post state', () => {
  const s = createLighting2DState();
  assert.equal(s.hasLighting(), false);
  assert.equal(s.hasActivePass(), false);
  s.setAmbientLight('#404040', 0.5);
  assert.equal(s.hasLighting(), true);
  const t = createLighting2DState();
  t.setPost({ bloomIntensity: 1 });
  assert.equal(t.hasActivePass(), true);
  t.setQuality('low'); // bloom disabled at low
  assert.equal(t.hasActivePass(), false);
});

function map(rows) { return new TileMap({ tiles: rows.map(r => [...r]) }); }

test('R1 autotile: 4-way bitmask N=1,E=2,S=4,W=8 resolves edges/corners/inner', () => {
  const m = map([
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1],
  ]);
  const rules = { 15: 'inner', 6: 'tl', 12: 'tr', 3: 'bl', 9: 'br', 14: 'top', 7: 'left', 13: 'right', 11: 'bottom' };
  // treat border as unmatched so corners/edges appear
  const changed = applyAutoTileRules(m, { sourceTile: 1, rules, treatBorderAsMatched: false });
  assert.equal(changed, 9);
  assert.deepEqual(m.tiles, [
    ['tl', 'top', 'tr'],
    ['left', 'inner', 'right'],
    ['bl', 'bottom', 'br'],
  ]);
});

test('R1 autotile: border matching, defaultTile fallback, Map rules, untouched other tiles', () => {
  const m = map([[1, 0, 1]]);
  // border matched: lone tiles have N,S,(E|W at map edge) neighbours
  const n = applyAutoTileRules(m, { sourceTile: 1, rules: new Map([[5, 'v']]), defaultTile: 'x' });
  assert.equal(n, 2);
  // left tile: N=1,S=4,W=8 (border), E=0 -> 13 no rule -> default
  assert.deepEqual(m.tiles[0], ['x', 0, 'x']);
  assert.throws(() => applyAutoTileRules({}, { sourceTile: 1, rules: {} }), TypeError);
  assert.throws(() => applyAutoTileRules(m, { sourceTile: 1 }), TypeError);
});

test('R1 autotile: 8-way diagonal bits 16/32/64/128 only set when both adjacent cardinals match', () => {
  const m = map([
    [1, 1, 1],
    [1, 1, 1],
    [1, 0, 1],
  ]);
  // centre: n,e,s? s=(1,2)=0 so s false => no SE/SW bits. mask4 = N|E|W = 11, NE (16) and NW (128) set.
  const rules = { [11 | 16 | 128]: 'c8', 11: 'c4' };
  applyAutoTileRules(m, { sourceTile: 1, rules, mode: '8-way', treatBorderAsMatched: false });
  assert.equal(m.get(1, 1), 'c8');
  // 4-way ignores diagonals
  const m2 = map([[1, 1, 1], [1, 1, 1], [1, 0, 1]]);
  applyAutoTileRules(m2, { sourceTile: 1, rules, mode: '4-way', treatBorderAsMatched: false });
  assert.equal(m2.get(1, 1), 'c4');
  // 8-way falls back to mask4 when no 8-way rule
  const m3 = map([[1, 1, 1], [1, 1, 1], [1, 0, 1]]);
  applyAutoTileRules(m3, { sourceTile: 1, rules: { 11: 'fallback' }, mode: '8-way', treatBorderAsMatched: false });
  assert.equal(m3.get(1, 1), 'fallback');
});
