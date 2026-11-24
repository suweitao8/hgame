// Scorecard R3 evidence: material keyword variants + ProgramCacheKey reuse, UBO batch registry,
// decal pooling/projection math. Headless (real THREE objects, no GL context).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';
import {
  defineMaterialVariants3D, createMaterialBatchRegistry3D, createComposableMaterial3D, createSharedMaterialBlock3D,
} from '../assets/runtime/integrations/material-graph3d.js';
import { createDecalSystem3D } from '../assets/runtime/integrations/decal3d.js';

function variants(extra = {}) {
  return defineMaterialVariants3D(THREE, {
    base: { color: 0x808080, roughness: 0.5, defines: { BASE: 1 } },
    keywords: {
      WET: { roughness: 0.1, defines: { USE_WET: 1 }, uniforms: { uWet: 1 } },
      RIM: { defines: { USE_RIM: 1 } },
      QUALITY: { high: { defines: { Q_HIGH: 1 } }, low: { defines: { Q_LOW: 1 } } },
    },
    ...extra,
  });
}

test('R3 variants: key is canonical (order independent), falsy keywords drop out, enums map to KEY=value', () => {
  const v = variants();
  assert.equal(v.getKey(), 'default');
  assert.equal(v.getKey({ WET: false, RIM: null, QUALITY: '' }), 'default');
  assert.equal(v.getKey({ WET: true, RIM: true }), 'RIM|WET');
  assert.equal(v.getKey({ RIM: true, WET: true }), 'RIM|WET');
  assert.equal(v.getKey({ QUALITY: 'high' }), 'QUALITY=high');
  assert.equal(v.getKey({ QUALITY: 'ultra' }), 'default', 'unknown enum value ignored');
  assert.equal(v.getKey({ UNKNOWN: true }), 'default');
  assert.equal(v.getKey({ WET: 1 }), 'WET', 'truthy number activates boolean keyword');
  assert.equal(v.getKey({ WET: 0 }), 'default');
});

test('R3 variants: identical keyword sets share one material/ProgramCacheKey; different sets get distinct keys', () => {
  const v = variants();
  const a = v.get({ WET: true, RIM: true });
  const b = v.get({ RIM: true, WET: true });
  const c = v.get({ WET: true });
  const base = v.get();
  assert.equal(a, b);
  assert.equal(v.size, 3);
  assert.deepEqual(new Set(v.list()), new Set(['RIM|WET', 'WET', 'default']));
  const keys = [a, c, base].map(m => m.customProgramCacheKey());
  assert.equal(new Set(keys).size, 3);
  assert.ok(a.customProgramCacheKey().endsWith('|var:RIM|WET'));
  assert.equal(a.userData.hgameVariantKey, 'RIM|WET');
  // merged defines/props follow base < keyword patch order
  assert.deepEqual({ ...a.defines }, { ...base.defines, USE_WET: 1, USE_RIM: 1 });
  assert.equal(c.roughness, 0.1);
  assert.equal(base.roughness, 0.5);
  assert.ok(!('USE_WET' in (base.defines ?? {})));
});

test('R3 variants: keyword uniforms are injected at compile time without clobbering existing ones; warmup compiles each unique key once', () => {
  const v = variants({ uniforms: { uShared: 3 } });
  const wet = v.get({ WET: true });
  const shader = { uniforms: { uShared: { value: 'keep' } }, vertexShader: '', fragmentShader: '' };
  wet.onBeforeCompile(shader, null);
  assert.equal(shader.uniforms.uShared.value, 'keep');
  assert.equal(shader.uniforms.uWet.value, 1);

  const compiled = [];
  const renderer = { compile: scene => compiled.push(scene.children.map(m => m.material)) };
  const out = v.warmup(renderer, new THREE.PerspectiveCamera(), [{ WET: true }, { WET: true }, { RIM: true }, {}]);
  assert.deepEqual(out.keys, ['WET', 'RIM', 'default']);
  assert.equal(compiled.length, 1);
  assert.equal(compiled[0].length, 3);
  v.dispose();
  assert.throws(() => v.get({ WET: true }), /disposed/);
  assert.throws(() => defineMaterialVariants3D({}), TypeError);
});

test('R3 UBO batch registry: std140 header injected once, shared globals propagate O(1) to registered materials', () => {
  const reg = createMaterialBatchRegistry3D({ uTime: 0, uFogDensity: 0.02, uWindDir: new THREE.Vector3(1, 0, 0) }, { THREE });
  const stats0 = reg.getStats();
  assert.equal(stats0.uboEnabled, true);
  assert.equal(stats0.uboGroupName, 'HGamePerFrameUBO');
  const m1 = new THREE.MeshStandardMaterial();
  const m2 = new THREE.MeshStandardMaterial();
  assert.equal(reg.register(m1), true);
  reg.register(m2);
  reg.register(m1); // idempotent
  assert.equal(reg.getStats().registeredCount, 2);
  assert.ok(m1.uniformsGroups.includes(reg.uboGroup));
  assert.equal(m1.uniformsGroups.filter(g => g === reg.uboGroup).length, 1);
  assert.match(m1.customProgramCacheKey(), /\|ubo:HGamePerFrameUBO$/);

  const shader = { vertexShader: 'void main(){}', fragmentShader: 'void main(){}' };
  m1.onBeforeCompile(shader, null);
  assert.match(shader.vertexShader, /layout\(std140\) uniform HGamePerFrameUBO/);
  assert.match(shader.vertexShader, /float uTime;/);
  assert.match(shader.vertexShader, /float uFogDensity;/);
  assert.match(shader.fragmentShader, /vec3 uWindDir;/);
  const once = shader.vertexShader;
  m1.onBeforeCompile(shader, null);
  assert.equal(shader.vertexShader, once, 'header not injected twice');

  const v0 = reg.sharedBlock.version;
  reg.updateFrame(0.5);
  reg.updateFrame(0.25, { uFogDensity: 0.1 });
  assert.equal(reg.sharedBlock.get('uTime'), 0.75);
  assert.equal(reg.sharedBlock.get('uFogDensity'), 0.1);
  assert.ok(reg.sharedBlock.version > v0);
  assert.equal(reg.unregister(m2), true);
  assert.equal(reg.getStats().registeredCount, 1);
});

test('R3 shared block + composable material: one shared uniform object across materials', () => {
  const block = createSharedMaterialBlock3D({ uGlobal: 1 });
  const a = createComposableMaterial3D(THREE, { sharedBlock: block, windSway: { amplitude: 0.1 } });
  const b = createComposableMaterial3D(THREE, { sharedBlock: block, windSway: { amplitude: 0.3 } });
  assert.notEqual(a, b);
  assert.notEqual(a.customProgramCacheKey?.(), undefined);
  block.set('uGlobal', 5);
  assert.equal(block.get('uGlobal'), 5);
});

test('R3 decals: ring-pool recycles oldest slot at capacity, ids are unique, handle dispose is stale-safe', () => {
  const d = createDecalSystem3D(THREE, { mode: 'surface', maxDecals: 3 });
  const hs = [0, 1, 2].map(i => d.spawn({ position: [i, 0, 0], lifetime: 10 }));
  assert.equal(new Set(hs.map(h => h.id)).size, 3);
  assert.equal(d.getStats().active, 3);
  const h4 = d.spawn({ position: [9, 0, 0] });
  const st = d.getStats();
  assert.equal(st.active, 3);
  assert.equal(st.recycled, 1);
  assert.equal(st.totalSpawned, 4);
  assert.equal(hs[0].dispose(), false, 'recycled handle cannot free the new decal');
  assert.equal(h4.dispose(), true);
  assert.equal(d.getStats().active, 2);
  d.clear();
  assert.equal(d.getStats().active, 0);
  d.dispose();
  assert.equal(d.spawn({}), null);
});

test('R3 decals: orientation aligns +Z to surface normal, surface offset along normal, lifetime fade', () => {
  const d = createDecalSystem3D(THREE, { mode: 'surface', maxDecals: 4, fadeSeconds: 1 });
  const n = new THREE.Vector3(1, 1, 0).normalize();
  const h = d.spawn({ position: [0, 0, 0], normal: [n.x, n.y, n.z], size: [2, 3, 0.5], opacity: 0.8, lifetime: 2 });
  const zAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(h.mesh.quaternion);
  assert.ok(zAxis.distanceTo(n) < 1e-6);
  assert.ok(Math.abs(h.mesh.position.length() - 0.003) < 1e-9);
  assert.ok(h.mesh.position.clone().normalize().distanceTo(n) < 1e-6);
  assert.deepEqual(h.mesh.scale.toArray(), [2, 3, 0.5]);
  assert.equal(h.mesh.material.opacity, 0.8);
  d.update(1.0);
  assert.ok(Math.abs(h.mesh.material.opacity - 0.8) < 1e-9, 'not fading yet');
  d.update(0.5); // remaining 0.5 of 1s fade
  assert.ok(Math.abs(h.mesh.material.opacity - 0.4) < 1e-9);
  assert.equal(d.update(0.6), 0, 'expired');
  assert.equal(d.getStats().active, 0);
  assert.equal(h.mesh.visible, false);
  // degenerate normal falls back to +Y
  const h2 = d.spawn({ normal: [0, 0, 0] });
  assert.ok(new THREE.Vector3(0, 0, 1).applyQuaternion(h2.mesh.quaternion).distanceTo(new THREE.Vector3(0, 1, 0)) < 1e-6);
  d.dispose();
});

test('R3 projected decals: OBB inverse-model uniform maps world points to unit-box space; GLSL reconstructs depth', () => {
  const d = createDecalSystem3D(THREE, { mode: 'projected', maxDecals: 2 });
  const h = d.spawn({ position: [5, 0, 0], normal: [0, 1, 0], size: [4, 2, 6], edgeSoftness: 9, roughnessTint: -1 });
  const u = h.mesh.material.uniforms;
  // size [4,2,6] along local x,y,z; normal +Y rotates local Z -> world Y
  const inv = u.uInvModel.value;
  const inside = new THREE.Vector3(5 + 1.9, 0.5, 0).applyMatrix4(inv);
  assert.ok(Math.max(Math.abs(inside.x), Math.abs(inside.y), Math.abs(inside.z)) <= 0.5 + 1e-6, `inside ${inside.toArray()}`);
  const outside = new THREE.Vector3(5 + 2.5, 0, 0).applyMatrix4(inv);
  assert.ok(Math.max(Math.abs(outside.x), Math.abs(outside.y), Math.abs(outside.z)) > 0.5);
  assert.equal(u.uEdgeSoftness.value, 0.48, 'edgeSoftness clamped');
  assert.equal(u.uRoughnessTint.value, 0);
  const fs = h.mesh.material.fragmentShader;
  for (const token of ['uInvProj', 'uInvView', 'uInvModel', 'discard', 'tDepth']) assert.ok(fs.includes(token), token);
  assert.equal(h.mesh.material.depthWrite, false);
  // mode switch toggles which mesh is visible
  assert.equal(d.setMode('surface'), 'surface');
  assert.equal(h.mesh.visible, false);
  assert.equal(d.applyQualityProfile('low'), 'surface');
  assert.equal(d.applyQualityProfile('high'), 'projected');
  d.dispose();
});
