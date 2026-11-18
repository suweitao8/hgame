import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';

import {
  FOG_FADE_TYPE,
  FOG_QUALITY,
  createFogOfWarWorld,
  extractTileMapObstacles,
} from '../assets/runtime/world/fog-of-war.js';
import {
  createFogOfWarCanvas2DOverlay,
  createFogOfWarThreeOverlay,
} from '../assets/runtime/integrations/fog-of-war.js';

test('FogOfWar analytical line-of-sight occludes behind box and circle obstacles while preserving unobscured radius', () => {
  const fow = createFogOfWarWorld({
    plane: 'xy',
    bounds: { minX: -200, minY: -200, maxX: 200, maxY: 200 },
    resolutionX: 64,
    resolutionY: 64,
    fadeType: FOG_FADE_TYPE.SMOOTHSTEP,
  });

  fow.addObstacle({ x: 60, y: 0, width: 20, height: 80 });
  fow.addObstacle({ x: -70, y: 0, radius: 18 });

  fow.addRevealer({
    x: 0,
    y: 0,
    viewRadius: 140,
    softenDistance: 20,
    unobscuredRadius: 24,
    quality: FOG_QUALITY.HIGH,
  });
  fow.update(0.016);

  // Unobstructed forward/upward view is visible
  assert.ok(fow.sampleVisibility(0, 80) > 0.95);
  // In front of wall is visible
  assert.ok(fow.sampleVisibility(40, 0) > 0.95);
  // Behind wall is occluded
  assert.equal(fow.sampleVisibility(110, 0), 0);
  // Behind circle pillar is occluded
  assert.equal(fow.sampleVisibility(-115, 0), 0);
  // Unobscured sixth-sense inner circle reveals close point even across obstacle check
  assert.ok(fow.sampleVisibility(12, 0) > 0.95);
});

test('FogOfWar supports directional vision cones, height check, and hider callbacks', () => {
  const fow = createFogOfWarWorld({
    plane: 'xz',
    bounds: { minX: -50, minY: -50, maxX: 50, maxY: 50 },
    resolutionX: 48,
    resolutionY: 48,
  });

  const revId = fow.addRevealer({
    x: 0,
    y: 1,
    z: 0,
    yaw: 0, // facing +X
    viewRadius: 20,
    softenDistance: 4,
    viewAngleDeg: 90,
    innerSoftenAngleDeg: 10,
    visionHeight: 3,
    visionHeightSoften: 1,
    unobscuredRadius: 0,
  });

  const events = [];
  const enemyId = fow.addHider({
    x: 10,
    y: 1,
    z: 0,
    threshold: 0.4,
    onVisibilityChanged: (_h, vis) => events.push(vis),
  });
  const shrineId = fow.addHider({
    x: -10,
    y: 1,
    z: 0,
    permanentlyReveal: true,
  });

  fow.update(0.016);
  assert.equal(fow.isHiderVisible(enemyId), true);
  assert.equal(fow.isHiderVisible(shrineId), false);
  // Outside vision cone (-X) and too high
  assert.equal(fow.sampleVisibility(-10, 0, 1), 0);
  assert.equal(fow.sampleVisibility(10, 0, 6), 0);

  // Turn revealer toward -X: enemy becomes hidden, shrine becomes permanently revealed
  fow.updateRevealer(revId, { yaw: Math.PI });
  fow.update(0.016);
  assert.equal(fow.isHiderVisible(enemyId), false);
  assert.equal(fow.isHiderVisible(shrineId), true);
  assert.deepEqual(events, [true, false]);

  // Turn back to +X: permanent shrine stays visible
  fow.updateRevealer(revId, { yaw: 0 });
  fow.update(0.016);
  assert.equal(fow.isHiderVisible(shrineId), true);
});

test('FogOfWar exploration memory, regrow, snapshot serialization, and minimap RGBA export work cleanly', () => {
  const fow = createFogOfWarWorld({
    bounds: { minX: -100, minY: -100, maxX: 100, maxY: 100 },
    resolutionX: 32,
    resolutionY: 32,
    useMemory: true,
    useRegrow: true,
    regrowSpeed: 0.5,
    regrowFloor: 0.25,
    blurPasses: 0,
  });

  const revId = fow.addRevealer({ x: 0, y: 0, viewRadius: 40, softenDistance: 5, useOcclusion: false });
  fow.update(0.05);
  assert.ok(fow.sampleExploration(0, 0) > 0.9);

  // Move revealer away -> explored memory persists and regrows down to regrowFloor
  fow.updateRevealer(revId, { x: 80, y: 80 });
  for (let i = 0; i < 6; i++) fow.update(0.2);
  const expAfter = fow.sampleExploration(0, 0);
  assert.ok(expAfter >= 0.24 && expAfter <= 0.55, `expected regrown exploration ~0.4..0.25, got ${expAfter}`);

  // Save/restore exploration snapshot
  const saved = fow.exportExploration();
  fow.clearExploration(0);
  assert.equal(fow.sampleExploration(0, 0), 0);
  assert.equal(fow.importExploration(saved), true);
  assert.ok(fow.sampleExploration(0, 0) > 0.2);

  // Minimap RGBA buffer write
  const rgba = new Uint8ClampedArray(32 * 32 * 4);
  fow.writeMinimapRgba(rgba);
  assert.ok(rgba.some((v) => v > 0));
});

test('extractTileMapObstacles merges contiguous solid tiles into minimal bounding boxes', () => {
  const tiles = [
    1, 1, 1, 0,
    1, 1, 1, 0,
    0, 0, 0, 1,
  ];
  const merged = extractTileMapObstacles({
    width: 4,
    height: 3,
    tileSize: 32,
    originX: -64,
    originY: -48,
    getTile: (x, y) => tiles[y * 4 + x],
  });
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0], { minX: -64, minY: -48, maxX: 32, maxY: 16 });
  assert.deepEqual(merged[1], { minX: 32, minY: 16, maxX: 64, maxY: 48 });
});

test('FogOfWar Canvas2D and Three.js overlays run cleanly without errors', () => {
  const fow2d = createFogOfWarWorld({
    bounds: { minX: -200, minY: -200, maxX: 200, maxY: 200 },
    resolutionX: 16,
    resolutionY: 16,
  });
  fow2d.addRevealer({ x: 0, y: 0, viewRadius: 90, softenDistance: 20 });
  fow2d.update(0.016);

  const mockGridCtx = {
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {},
  };
  const mockMaskCtx = {
    save() {},
    restore() {},
    setTransform() {},
    clearRect() {},
    translate() {},
    rotate() {},
    scale() {},
    fillRect() {},
    drawImage() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    closePath() {},
    fill() {},
    strokeRect() {},
    createRadialGradient: () => ({ addColorStop() {} }),
  };
  let canvasIdx = 0;
  const overlay2d = createFogOfWarCanvas2DOverlay(fow2d, {
    createBufferCanvas: (w, h) => {
      canvasIdx++;
      return {
        width: w,
        height: h,
        getContext: () => (canvasIdx === 1 ? mockGridCtx : mockMaskCtx),
      };
    },
  });
  const drawn = [];
  const mainCtx = {
    save() {},
    restore() {},
    drawImage() { drawn.push('drawImage'); },
    fillRect() {},
    strokeRect() {},
    beginPath() {},
    arc() {},
    fill() {},
  };
  overlay2d.render(mainCtx, { x: 0, y: 0, zoom: 1 }, 640, 360);
  overlay2d.renderMinimap(mainCtx, 10, 10, 100, 100, [{ x: 0, y: 0, color: '#fff' }]);
  assert.ok(drawn.includes('drawImage'));
  overlay2d.dispose();

  // Three.js 3D overlay smoke test
  const scene = new THREE.Scene();
  const fow3d = createFogOfWarWorld({
    plane: 'xz',
    bounds: { minX: -40, minY: -40, maxX: 40, maxY: 40 },
    resolutionX: 32,
    resolutionY: 32,
  });
  fow3d.addRevealer({ x: 0, y: 0, z: 0, viewRadius: 15, softenDistance: 4 });
  fow3d.update(0.016);
  const overlay3d = createFogOfWarThreeOverlay(fow3d, { THREE, scene });
  overlay3d.sync(0.016);
  assert.ok(scene.getObjectByName('HGameFogOfWar3D'));
  assert.equal(overlay3d.texture.image.data[3], 255);
  overlay3d.dispose();
  assert.equal(scene.getObjectByName('HGameFogOfWar3D'), undefined);
});
