import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';

import {
  FOG_FADE_TYPE,
  FOG_QUALITY,
  TOPDOWN_FOG_DEFAULTS,
  createFogOfWarWorld,
  extractTileMapObstacles,
} from '../assets/runtime/world/fog-of-war.js';
import {
  createFogOfWarCanvas2DOverlay,
  createFogOfWarThreeOverlay,
  createFogOfWarMaterialBinder,
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

test('Top-down FogOfWar defaults to 256x256 binary visibility, 23.25m sight, 0.30 edge hide, and LoL slate shader binder', () => {
  const fow = createFogOfWarWorld({
    plane: 'xz',
    bounds: { minX: -40, minY: -40, maxX: 40, maxY: 40 },
  });
  assert.equal(fow.resX, TOPDOWN_FOG_DEFAULTS.resolution);
  assert.equal(fow.resY, 256);

  fow.addRevealer({ x: 0, z: 0 });
  const hiderTransition = fow.addHider({ x: 24.8, z: 0 });
  const hiderDarkEdge = fow.addHider({ x: 26.2, z: 0 });
  fow.update(0.25);

  assert.equal(fow.sampleExploration(0, 0), 0, 'useMemory must default to false (no explored memory)');
  assert.equal(fow.isHiderVisible(hiderTransition), true, 'hider inside transition zone (>= 0.30) must show');
  assert.equal(fow.isHiderVisible(hiderDarkEdge), false, 'hider entering dark fog (< 0.30) must hide immediately');

  // Verify LoL slate material binder injects uniforms and smoothstep(0.30, 0.95)
  const mat = new THREE.MeshStandardMaterial({ color: '#73aa52' });
  const binder = createFogOfWarMaterialBinder(THREE);
  binder.applyToMaterial(mat);
  const shader = {
    uniforms: {},
    vertexShader: 'varying vec3 vWorldAlignedPosition; void main() { gl_Position = vec4(0.0); }',
    fragmentShader: 'varying vec3 vWorldAlignedPosition; void main() { gl_FragColor = vec4(1.0); #include <tonemapping_fragment> }',
  };
  mat.onBeforeCompile(shader, {});
  assert.ok(shader.uniforms.uFogColor);
  assert.match(shader.fragmentShader, /smoothstep\(0\.300, 0\.950/);
  assert.equal(binder.bind(new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat), fow.bounds), true);
  assert.equal(binder.uniforms.uFogEnabled.value, 1);
  binder.dispose();
  mat.dispose();
});

test('Multi-unit FogOfWar supports sliding camera window, dirty-AABB blur, and off-window teammate analytical sight', () => {
  const fow = createFogOfWarWorld({
    plane: 'xz',
    bounds: { minX: -32, minY: -32, maxX: 32, maxY: 32 },
  });

  // Player + nearby teammate inside the 64x64 window, plus a distant teammate 120m away
  fow.addRevealer({ id: 'p0', x: 0, z: 0 });
  fow.addRevealer({ id: 'ally-1', x: 18, z: 0 });
  fow.addRevealer({ id: 'ally-far', x: 120, z: 0 });

  const nearAllyEnemy = fow.addHider({ x: 30, z: 0 }); // visible via ally-1 inside window
  const farAllyEnemy = fow.addHider({ x: 128, z: 0 }); // visible via off-window ally-far analytically
  const darkEnemy = fow.addHider({ x: -29, z: 0 }); // outside all revealers

  fow.update(0.016);
  assert.equal(fow.isHiderVisible(nearAllyEnemy), true, 'teammate inside window shares vision');
  assert.equal(fow.isHiderVisible(farAllyEnemy), true, 'off-window teammate retains analytical vision');
  assert.equal(fow.isHiderVisible(darkEnemy), false, 'unseen enemy remains hidden');
  assert.ok(fow.sampleGridVisibility(18, 0) > 0.9, 'dirty-AABB blur keeps active window cells lit');

  // Slide window to center on distant teammate with texel snapping
  const moved = fow.setWindowCenter(120.1, 0.2, 64, 64);
  assert.equal(moved, true);
  const cellW = 64 / 256;
  assert.ok(Math.abs(fow.bounds.minX / cellW - Math.round(fow.bounds.minX / cellW)) < 1e-9, 'window snaps to texel grid');

  const scene = new THREE.Scene();
  const overlay = createFogOfWarThreeOverlay(fow, { THREE, scene });
  fow.update(0.016);
  overlay.sync(0.016);
  assert.ok(Math.abs(overlay.material.uniforms.uFogBounds.value.x - fow.bounds.minX) < 1e-6);
  assert.equal(fow.isHiderVisible(farAllyEnemy), true);
  assert.equal(fow.isHiderVisible(nearAllyEnemy), true, 'p0/ally-1 off-window still spot analytically');

  // Verify character/ward-only revealer defaults & addWard helper (outside ally-far's 23.25m sight)
  assert.deepEqual(TOPDOWN_FOG_DEFAULTS.revealerSources, ['character', 'ward']);
  const wardId = fow.addWard({ id: 'ward-1', x: 100, z: -40 });
  const wardEnemy = fow.addHider({ x: 108, z: -40 });
  fow.update(0.016);
  assert.equal(fow.isHiderVisible(wardEnemy), true, 'ward illuminates nearby enemy');
  assert.equal(fow.removeRevealer(wardId), true);
  fow.update(0.016);
  assert.equal(fow.isHiderVisible(wardEnemy), false, 'removing ward immediately hides enemy');
  overlay.dispose();
});
