import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';
import {
  createWorldAlignedMaterial, createWorldMaterialPalette,
  worldProjectUV, triplanarWeights, createSmoothProceduralDetailTexture,
} from '../assets/runtime/integrations/world-aligned-material.js';
import { createProceduralModelSlots } from '../assets/runtime/integrations/procedural-models.js';

const materials = {
  stone: { color: '#a8b0b2', roughness: 0.86, pattern: 'stone', tileSize: 2.5, projection: 'triplanar' },
  timber: { color: '#b18a5d', roughness: 0.76, pattern: 'wood', tileSize: 1.8, projection: 'planar' },
  glass: { color: '#d0e9ed', roughness: 0.12, metalness: 0, transparent: true, opacity: 0.57, pattern: 'smooth' },
};
const slots = {
  'ground.stone': { shape: 'box', material: 'stone' },
  'building.stair': { shape: 'stair', material: 'stone' },
  'prop.bench': { shape: 'bench', material: 'timber', accent: 'stone', size: [1.5, 1, 0.7] },
  'building.window': { shape: 'window', material: 'glass', accent: 'timber' },
};

test('world-position UV is independent of mesh origin, and triplanar weights normalize', () => {
  const options = { tileSize: 2, offset: [0, 0, 0] };
  const samePointFromTwoObjects = [5.5, 2.25, -3];
  assert.deepEqual(worldProjectUV(samePointFromTwoObjects, 'y', options),
    worldProjectUV([5.5, 2.25, -3], 'y', options));
  assert.deepEqual(worldProjectUV(samePointFromTwoObjects, 'y', options), [2.75, -1.5]);
  assert.deepEqual(worldProjectUV(samePointFromTwoObjects, 'x', options), [-1.5, 1.125]);
  assert.deepEqual(triplanarWeights([0, 1, 0], 4), [0, 1, 0]);
  const w = triplanarWeights([1, 1, 1], 2);
  assert.ok(Math.abs(w.reduce((a, b) => a + b, 0) - 1) < 1e-8);
  assert.throws(() => worldProjectUV([0, NaN, 0], 'y', options));
  assert.throws(() => triplanarWeights([0, 0, 0], 4));
});

test('world-aligned standard PBR shader supports world positions, instances and projection modes', () => {
  for (const projection of ['planar', 'triplanar']) {
    const m = createWorldAlignedMaterial(THREE, {
      color: '#abb5bc', roughness: 0.8, pattern: 'stone', projection,
      tileSize: 2, blendSharpness: 6,
    });
    assert.equal(m.isMeshStandardMaterial, true);
    assert.equal(m.userData.worldAligned.projection, projection);
    assert.equal(m.userData.worldAligned.tileSize, 2);
    const shader = {
      uniforms: {},
      vertexShader: '#include <project_vertex>',
      fragmentShader: '#include <map_fragment>',
    };
    m.onBeforeCompile(shader);
    assert.match(shader.vertexShader, /vWorldAlignedPos/);
    assert.match(shader.vertexShader, /USE_INSTANCING/);
    assert.match(shader.fragmentShader, /texture2D\s*\(/);
    if (projection === 'triplanar') assert.match(shader.fragmentShader, /triWeights/);
    assert.ok(shader.uniforms.uWorldAlignedTile);
    assert.ok(m.customProgramCacheKey().includes(projection));
    m.dispose();
  }
});

test('shared PBR palette reuses high-resolution smooth textures and supports instance reuse', async () => {
  const palette = createWorldMaterialPalette(THREE, materials);
  assert.equal(palette.get('stone'), palette.get('stone'));
  assert.equal(palette.get('stone').userData.worldAligned.projection, 'triplanar');
  const texture = palette.get('stone').userData.worldAligned.texture;
  assert.ok(texture.isDataTexture);
  assert.ok(texture.image.width >= 256, 'non-pixel texture resolution');
  assert.equal(texture.magFilter, THREE.LinearFilter);
  assert.equal(texture.minFilter, THREE.LinearMipmapLinearFilter);
  assert.throws(() => palette.get('no-such-material'));
  const models = createProceduralModelSlots({ THREE, slots, materialPalette: palette });
  const first = await models.instantiate('ground.stone');
  const second = await models.instantiate('ground.stone');
  assert.notStrictEqual(first, second);
  let a, b;
  first.traverse(o => { if (o.isMesh) a = o; });
  second.traverse(o => { if (o.isMesh) b = o; });
  assert.equal(a.geometry, b.geometry);
  assert.equal(a.material, b.material);
  const batch = await models.instantiateBatch('ground.stone',
    Array.from({ length: 100 }, (_, i) => ({ x: i % 10, z: Math.floor(i / 10) })));
  assert.equal(batch.isInstancedMesh, true);
  assert.equal(batch.count, 100);
  const stair = await models.instantiate('building.stair');
  assert.ok(stair.children.length >= 2, 'stair geometry is assembled without MC GLB');
  const benchBatch = await models.instantiateBatch('prop.bench', [{ x: 0 }, { x: 2 }]);
  assert.equal(benchBatch.isGroup, true);
  assert.equal(benchBatch.children.length, 2);
  assert.throws(() => models.setReplacement('ground.stone', 'https://invalid.test/model.glb'));
  models.setReplacement('ground.stone', 'assets/models/stone-final.glb');
  assert.equal(models.get('ground.stone').replacement, 'assets/models/stone-final.glb');
  models.setReplacement('ground.stone', null);
  await models.dispose();
  palette.dispose();
});

test('world aligned input validates bad patterns, projection, scale and material slots', () => {
  for (const params of [
    { projection: 'spherical' },
    { pattern: 'pixelated' },
    { tileSize: 0 },
    { tileSize: Infinity },
    { blendSharpness: -1 },
    { color: 'javascript:alert(1)' },
  ]) assert.throws(() => createWorldAlignedMaterial(THREE, params));
  const palette = createWorldMaterialPalette(THREE, materials);
  assert.throws(() => createProceduralModelSlots({
    THREE, materialPalette: palette, slots: { 'bad-name': { shape: 'box', material: 'stone' } },
  }));
  assert.throws(() => createProceduralModelSlots({
    THREE, materialPalette: palette, slots: { 'test.invalid': { shape: 'character', material: 'stone' } },
  }));
  palette.dispose();
});

test('native geometry can be replaced with an authored static GLB while preserving its logical slot', async () => {
  const palette = createWorldMaterialPalette(THREE, materials);
  const urls = [];
  class StubLoader {
    async loadAsync(url) {
      urls.push(url);
      const root = new THREE.Group();
      root.name = 'authored-visual';
      root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), palette.get('stone')));
      return { scene: root, animations: [] };
    }
  }
  const models = createProceduralModelSlots({
    THREE, slots, materialPalette: palette,
    GLTFLoader: StubLoader, projectBaseUrl: 'http://localhost:4176/',
  });
  const initial = await models.instantiate('ground.stone');
  assert.equal(initial.name, 'ground.stone');
  models.setReplacement('ground.stone', 'assets/models/final-stone.glb');
  const changed = await models.instantiate('ground.stone');
  assert.equal(changed.name, 'authored-visual');
  assert.equal(models.get('ground.stone').shape, 'box');
  assert.deepEqual(urls, ['http://localhost:4176/assets/models/final-stone.glb']);
  models.setReplacement('ground.stone', null);
  assert.equal((await models.instantiate('ground.stone')).name, 'ground.stone');
  await models.dispose();
  palette.dispose();
});

test('opt-in world-detail packs normal XY, roughness and AO in one repeatable RGBA texture', () => {
  const detail = createSmoothProceduralDetailTexture(THREE, 'stone', 256);
  assert.equal(detail.isDataTexture, true);
  assert.equal(detail.image.width, 256);
  assert.equal(detail.image.height, 256);
  assert.equal(detail.image.data.length, 256 * 256 * 4);
  assert.equal(detail.wrapS, THREE.RepeatWrapping);
  assert.equal(detail.wrapT, THREE.RepeatWrapping);
  assert.equal(detail.magFilter, THREE.LinearFilter);
  assert.equal(detail.minFilter, THREE.LinearMipmapLinearFilter);
  assert.equal(detail.colorSpace, THREE.NoColorSpace);
  const channels = [new Set(), new Set(), new Set(), new Set()];
  for (let i = 0; i < detail.image.data.length; i += 4 * 83) {
    for (let n = 0; n < 4; n++) channels[n].add(detail.image.data[i + n]);
  }
  assert.ok(channels.every(x => x.size > 2), 'all normal/roughness/AO channels have detail');
  assert.throws(() => createSmoothProceduralDetailTexture(THREE, 'not-pattern'));
  detail.dispose();
});

test('detail shader retains MeshStandardMaterial lighting and shares world-coordinate projection', () => {
  for (const projection of ['planar', 'triplanar']) {
    const m = createWorldAlignedMaterial(THREE, {
      color: '#a8b1b8', pattern: 'stone', tileSize: 2.75, projection,
      normalStrength: 0.9, roughnessVariation: 0.65, aoIntensity: 0.8,
    });
    assert.equal(m.isMeshStandardMaterial, true);
    assert.ok(m.userData.worldAligned.detailTexture.isDataTexture);
    const vertexShader = '#include <project_vertex>';
    const fragmentShader = [
      '#include <map_fragment>', '#include <roughnessmap_fragment>',
      '#include <normal_fragment_begin>', '#include <normal_fragment_maps>',
      '#include <lights_fragment_begin>', '#include <aomap_fragment>',
    ].join('\n');
    const shader = { uniforms: {}, vertexShader, fragmentShader };
    m.onBeforeCompile(shader);
    assert.ok(shader.uniforms.uWorldAlignedDetailTexture);
    assert.equal(shader.uniforms.uWorldAlignedDetailTexture.value,
      m.userData.worldAligned.detailTexture);
    assert.ok(shader.uniforms.uWorldAlignedNormalStrength);
    assert.match(shader.fragmentShader, /waDetail/);
    assert.match(shader.fragmentShader, /roughnessFactor\s*\*=/);
    assert.match(shader.fragmentShader, /viewMatrix/);
    assert.match(shader.fragmentShader, /normal\s*=\s*normalize/);
    assert.match(shader.fragmentShader, /reflectedLight\.indirectDiffuse\s*\*=/);
    assert.match(shader.fragmentShader, /waP\.(xz|zy|xy)/);
    assert.ok(shader.fragmentShader.indexOf('roughnessFactor *=') >
      shader.fragmentShader.indexOf('#include <roughnessmap_fragment>'));
    assert.ok(shader.fragmentShader.indexOf('reflectedLight.indirectDiffuse *=') >
      shader.fragmentShader.indexOf('#include <aomap_fragment>'));
    assert.match(m.customProgramCacheKey(), /detail/);
    m.userData.worldAligned.detailTexture.dispose();
    m.userData.worldAligned.texture.dispose();
    m.dispose();
  }
  const base = createWorldAlignedMaterial(THREE, { pattern: 'smooth', projection: 'planar' });
  assert.equal(base.userData.worldAligned.detailTexture, null);
  assert.doesNotMatch(base.customProgramCacheKey(), /detail/);
  base.userData.worldAligned.texture.dispose();
  base.dispose();
});

test('material palette deduplicates per-pattern detail maps; details are off when unrequested', () => {
  const palette = createWorldMaterialPalette(THREE, {
    wall: { ...materials.stone, normalStrength: 0.55, roughnessVariation: 0.6, aoIntensity: 0.5 },
    steps: { ...materials.stone, color: '#e6d0c5', normalStrength: 0.4 },
    grass: { ...materials.stone, pattern: 'grass', projection: 'planar', aoIntensity: 0.4 },
    metal: { color: '#bbbbbb', pattern: 'metal', projection: 'triplanar', roughness: 0.3 },
  });
  const detail = palette.get('wall').userData.worldAligned.detailTexture;
  assert.equal(detail, palette.get('steps').userData.worldAligned.detailTexture);
  assert.notEqual(detail, palette.get('grass').userData.worldAligned.detailTexture);
  assert.equal(palette.get('metal').userData.worldAligned.detailTexture, null);
  assert.deepEqual(palette.stats, { materials: 4, uniqueTextures: 3, uniqueDetailTextures: 2 });
  palette.dispose();
  assert.equal(palette.stats.uniqueDetailTextures, 0);
});

test('detail strength settings reject invalid configuration', () => {
  for (const bad of [
    { normalStrength: -0.1 }, { normalStrength: Infinity },
    { normalStrength: 2 }, { roughnessVariation: -1 },
    { roughnessVariation: 2 }, { aoIntensity: -0.2 }, { aoIntensity: 4 },
  ]) assert.throws(() => createWorldAlignedMaterial(THREE, bad));
});
