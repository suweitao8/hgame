import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';
import { RapierPhysicsWorld3D } from '../assets/runtime/physics/rapier3d.js';
import { createHeightfieldTerrain3D, fbmNoise2D } from '../assets/runtime/world/terrain3d.js';
import { createProceduralModelSlots } from '../assets/runtime/integrations/procedural-models.js';
import { createWorldMaterialPalette } from '../assets/runtime/integrations/world-aligned-material.js';

test('createHeightfieldTerrain3D builds deterministic geometry, normals, biomes, and scatters props', () => {
  const terrainA = createHeightfieldTerrain3D({
    width: 80,
    depth: 80,
    segmentsX: 16,
    segmentsZ: 16,
    seed: 2026,
    minHeight: -1,
    maxHeight: 14,
    edgeFalloff: 'island',
  });
  const terrainB = createHeightfieldTerrain3D({
    width: 80,
    depth: 80,
    segmentsX: 16,
    segmentsZ: 16,
    seed: 2026,
    minHeight: -1,
    maxHeight: 14,
    edgeFalloff: 'island',
  });

  assert.equal(terrainA.heights.length, 17 * 17);
  assert.equal(fbmNoise2D(12.5, -4.2, { seed: 42 }), fbmNoise2D(12.5, -4.2, { seed: 42 }));
  assert.equal(terrainA.sampleHeight(3.75, -8.25), terrainB.sampleHeight(3.75, -8.25));
  assert.ok(terrainA.sampleHeight(0, 0) > terrainA.sampleHeight(39, 39));

  const n = terrainA.sampleNormal(5, -6);
  const len = Math.hypot(n.x, n.y, n.z);
  assert.ok(Math.abs(len - 1) < 1e-5);
  assert.ok(n.y > 0);
  assert.ok(['sand', 'grass', 'rock', 'peak'].includes(terrainA.sampleBiome(0, 0)));

  const { mesh, geometry, material, dispose } = terrainA.createMesh(THREE, { name: 'island-terrain' });
  assert.equal(mesh.name, 'island-terrain');
  assert.equal(geometry.attributes.position.count, 17 * 17);
  assert.equal(geometry.attributes.normal.count, 17 * 17);
  assert.equal(geometry.attributes.uv.count, 17 * 17);
  assert.equal(geometry.attributes.color.count, 17 * 17);
  assert.equal(geometry.index.count, 16 * 16 * 6);
  assert.equal(material.vertexColors, true);

  const scattered = terrainA.scatterPositions({ count: 10, minSpacing: 3, minHeight: -10, maxSlope: 0.9 });
  assert.equal(scattered.length, 10);
  for (const pt of scattered) {
    assert.ok(Math.abs(pt.y - terrainA.sampleHeight(pt.x, pt.z)) < 1e-5);
  }
  dispose();
});

test('createHeightfieldTerrain3D attachPhysics matches sampled terrain height via Rapier3D raycast', () => {
  const terrain = createHeightfieldTerrain3D({
    width: 40,
    depth: 40,
    segmentsX: 8,
    segmentsZ: 8,
    seed: 99,
    minHeight: 0,
    maxHeight: 8,
    heightFn: (x, z) => 2 + Math.sin(x * 0.25) * 1.5 + Math.cos(z * 0.25) * 1.5,
  });

  const physics = new RapierPhysicsWorld3D({ tickHz: 60, gravity: { x: 0, y: -9.81, z: 0 } });
  const attached = terrain.attachPhysics(physics, { friction: 0.8 });
  assert.ok(attached.collider);
  physics.step();

  for (const [x, z] of [[0, 0], [5, -5], [-10, 7.5], [12.5, 10]]) {
    const expectedY = terrain.sampleHeight(x, z);
    const ray = new physics.RAPIER.Ray({ x, y: 30, z }, { x: 0, y: -1, z: 0 });
    const hit = physics.world.castRay(ray, 60, true);
    assert.ok(hit, `expected raycast hit at (${x}, ${z})`);
    const hitY = 30 - hit.timeOfImpact;
    assert.ok(Math.abs(hitY - expectedY) < 0.2, `height mismatch at (${x}, ${z}): hit=${hitY} vs sample=${expectedY}`);
  }

  attached.dispose();
  physics.dispose();
});

test('createProceduralModelSlots builds all 7 new architectural & prop shapes cleanly', async () => {
  const palette = createWorldMaterialPalette(THREE, {
    stone: { color: '#9ca3af', roughness: 0.85, pattern: 'stone' },
    trim: { color: '#d97706', roughness: 0.45, metalness: 0.4, pattern: 'smooth' },
    leaf: { color: '#2f6f3e', roughness: 0.8, pattern: 'smooth' },
  });

  const slotDefs = {
    'gate.arch': { shape: 'arch', material: 'stone', accent: 'trim', size: [4, 3.5, 1] },
    'prop.crate': { shape: 'crate', material: 'stone', accent: 'trim', size: [1.2, 1.2, 1.2] },
    'prop.barrel': { shape: 'barrel', material: 'stone', accent: 'trim', size: [0.9, 1.4, 0.9] },
    'prop.crystal': { shape: 'crystal', material: 'trim', accent: 'stone', size: [1, 2.2, 1] },
    'nature.rock': { shape: 'rock', material: 'stone', accent: 'stone', size: [2, 1.2, 1.8] },
    'nature.pine': { shape: 'pine', material: 'leaf', accent: 'stone', size: [2.2, 4.5, 2.2] },
    'combat.turret': { shape: 'turret', material: 'stone', accent: 'trim', size: [1.5, 1.8, 1.5] },
  };

  const models = createProceduralModelSlots({ THREE, materialPalette: palette, slots: slotDefs });
  for (const id of Object.keys(slotDefs)) {
    const obj = await models.instantiate(id);
    assert.equal(obj.name, id);
    assert.ok(obj.children.length >= 1, `${id} should produce at least 1 mesh child`);
  }

  const pineBatch = await models.instantiateBatch('nature.pine', [
    { x: 3, y: 0, z: -4, ry: 0.7 },
    { x: -2, y: 1, z: 5, sx: 1.5, sy: 1.5, sz: 1.5 },
  ]);
  assert.ok(pineBatch);

  models.dispose();
  palette.dispose();
});
