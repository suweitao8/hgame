import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Scene,
  SceneManager,
  createHotReloadController,
  captureResourceSnapshot,
  diffResourceSnapshots,
  createPhysicalRenderTargetPool3D,
  quantizeBufferGeometry3D,
  dispatchWebGpuHiZOcclusion,
} from '../assets/runtime/index.js';

function createMockThree() {
  class BufferAttribute {
    constructor(array, itemSize, normalized = false) {
      this.array = array;
      this.itemSize = itemSize;
      this.normalized = normalized;
      this.count = array ? Math.floor(array.length / itemSize) : 0;
    }
    getX(i) { return this.array[i * this.itemSize]; }
    getY(i) { return this.array[i * this.itemSize + 1]; }
    getZ(i) { return this.array[i * this.itemSize + 2]; }
    clone() {
      return new BufferAttribute(this.array.slice(), this.itemSize, this.normalized);
    }
  }
  class BufferGeometry {
    constructor() {
      this.uuid = `geo_${Math.random().toString(36).slice(2, 8)}`;
      this.attributes = {};
      this.index = null;
      this.disposed = false;
    }
    setAttribute(name, attr) {
      this.attributes[name] = attr;
      return this;
    }
    getAttribute(name) {
      return this.attributes[name];
    }
    setIndex(attrOrArr) {
      this.index = attrOrArr instanceof BufferAttribute
        ? attrOrArr
        : new BufferAttribute(Uint32Array.from(attrOrArr), 1, false);
      return this;
    }
    clone() {
      const copy = new BufferGeometry();
      for (const [k, v] of Object.entries(this.attributes)) copy.attributes[k] = v.clone();
      if (this.index) copy.index = this.index.clone();
      return copy;
    }
    dispose() {
      this.disposed = true;
    }
  }
  class WebGLRenderTarget {
    constructor(width, height, options = {}) {
      this.uuid = `rt_${Math.random().toString(36).slice(2, 8)}`;
      this.width = width;
      this.height = height;
      this.options = options;
      this.texture = {
        uuid: `tex_${Math.random().toString(36).slice(2, 8)}`,
        image: { width, height },
      };
      this.disposed = false;
    }
    setSize(w, h) {
      this.width = w;
      this.height = h;
    }
    dispose() {
      this.disposed = true;
    }
  }
  return {
    BufferAttribute,
    BufferGeometry,
    WebGLRenderTarget,
    HalfFloatType: 1016,
    UnsignedByteType: 1009,
    RGBAFormat: 1023,
    LinearFilter: 1006,
  };
}

test('T6-A1: createHotReloadController preserves state on swap and rolls back on failure', () => {
  const scenes = new SceneManager({ disposed: false });
  const events = [];

  const v1 = new Scene('main');
  v1.customState = { hp: 100, wave: 3, score: 42 };
  v1.enter = () => events.push(`enter:v1:${v1.customState.score}`);
  v1.exit = () => events.push('exit:v1');

  scenes.add(v1);
  scenes.start('main');
  assert.equal(scenes.current, v1);

  const reloader = createHotReloadController(scenes);
  const okResult = reloader.reload('main', () => {
    const s = new Scene('main');
    s.customState = { hp: 0, wave: 0, score: 0 };
    s.enter = () => events.push('enter:v2');
    return s;
  }, {
    captureState: (scene) => ({ ...scene.customState, tag: 'preserved' }),
    restoreState: (scene, state) => {
      scene.customState = { ...state, version: 2 };
    },
  });

  assert.equal(okResult.ok, true);
  assert.equal(okResult.rolledBack, false);
  assert.equal(scenes.current.customState.tag, 'preserved');
  assert.equal(scenes.current.customState.wave, 3);
  assert.equal(scenes.current.customState.score, 42);
  assert.equal(scenes.current.customState.version, 2);
  assert.equal(reloader.getStats().reloadCount, 1);

  // Faulty replacement throws -> rolls back & keeps previous live scene untouched
  const beforeFaultScene = scenes.current;
  assert.throws(() => {
    reloader.reload('main', () => {
      throw new Error('intentional syntax/runtime fault');
    }, {
      captureState: (scene) => ({ ...scene.customState }),
      restoreState: (scene, state) => { scene.customState = state; },
    });
  }, /intentional syntax\/runtime fault/);

  assert.equal(scenes.current, beforeFaultScene);
  assert.equal(scenes.current.customState.version, 2);
  scenes.dispose();
});

test('T6-P4: captureResourceSnapshot and diffResourceSnapshots detect GPU resource leaks accurately', () => {
  const THREE = createMockThree();
  const geoA = new THREE.BufferGeometry();
  geoA.setAttribute('position', new THREE.BufferAttribute(new Float32Array(300), 3));
  const meshA = {
    isMesh: true,
    geometry: geoA,
    material: { uuid: 'mat_a', map: { uuid: 'tex_a', image: { width: 256, height: 256 } } },
  };

  const scene = {
    children: [meshA],
    traverse(fn) {
      fn(this);
      for (const c of this.children) fn(c);
    },
  };

  const rtA = new THREE.WebGLRenderTarget(512, 512);
  const snapBefore = captureResourceSnapshot(scene, { label: 't0', extraTargets: [rtA], THREE });

  // Simulate leaked geometry + texture + material + renderTarget
  const geoLeak = new THREE.BufferGeometry();
  geoLeak.setAttribute('position', new THREE.BufferAttribute(new Float32Array(600), 3));
  const meshLeak = {
    isMesh: true,
    geometry: geoLeak,
    material: { uuid: 'mat_leak', map: { uuid: 'tex_leak', image: { width: 512, height: 512 } } },
  };
  const rtLeak = new THREE.WebGLRenderTarget(512, 512);
  scene.children.push(meshLeak);

  const snapAfterLeak = captureResourceSnapshot(scene, { label: 't1', extraTargets: [rtA, rtLeak], THREE });
  const leakDiff = diffResourceSnapshots(snapBefore, snapAfterLeak);
  assert.equal(leakDiff.hasLeak, true);
  assert.equal(leakDiff.leakedCount, 4); // geometry + material + texture + renderTarget
  assert.ok(leakDiff.deltaBytes > 0);

  // Clean up leak -> diff back to before must report zero leaks
  scene.children.pop();
  const snapAfterClean = captureResourceSnapshot(scene, { label: 't2', extraTargets: [rtA], THREE });
  const cleanDiff = diffResourceSnapshots(snapBefore, snapAfterClean);
  assert.equal(cleanDiff.hasLeak, false);
  assert.equal(cleanDiff.leakedCount, 0);
  assert.equal(cleanDiff.deltaBytes, 0);
});

test('T6-A2: createPhysicalRenderTargetPool3D aliases transient render targets across lifetimes', () => {
  const THREE = createMockThree();
  const pool = createPhysicalRenderTargetPool3D(THREE, { maxIdleFrames: 4 });

  pool.beginFrame();
  const rt1 = pool.acquire({ width: 512, height: 512, depthBuffer: false, samples: 0 });
  const rt2 = pool.acquire({ width: 512, height: 512, depthBuffer: false, samples: 0 });
  assert.notEqual(rt1.uuid, rt2.uuid);
  pool.release(rt1);
  pool.release(rt2);

  const s1 = pool.getStats();
  assert.equal(s1.allocations, 2);
  assert.equal(s1.reuses, 0);

  // Frame 2: acquire matching descriptors after prior release -> 100% physical aliasing reuse
  pool.beginFrame();
  const b1 = pool.acquire({ width: 512, height: 512, depthBuffer: false, samples: 0 });
  const b2 = pool.acquire({ width: 512, height: 512, depthBuffer: false, samples: 0 });
  assert.ok([rt1.uuid, rt2.uuid].includes(b1.uuid));
  assert.ok([rt1.uuid, rt2.uuid].includes(b2.uuid));
  assert.notEqual(b1.uuid, b2.uuid);
  pool.release(b1);
  pool.release(b2);

  const s2 = pool.getStats();
  assert.equal(s2.allocations, 2);
  assert.equal(s2.reuses, 2);
  assert.ok(s2.estimatedSavedBytes > 0);
  pool.dispose();
});

test('T6-R5: quantizeBufferGeometry3D compacts normals, UVs, and Uint32 indices', () => {
  const THREE = createMockThree();
  const vCount = 400;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(vCount * 3);
  const norm = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  for (let i = 0; i < vCount; i++) {
    pos[i * 3] = Math.cos(i);
    pos[i * 3 + 1] = Math.sin(i);
    pos[i * 3 + 2] = 0;
    norm[i * 3] = 0;
    norm[i * 3 + 1] = 1;
    norm[i * 3 + 2] = 0;
    uv[i * 2] = (i % 20) / 20;
    uv[i * 2 + 1] = Math.floor(i / 20) / 20;
  }
  const indices = new Uint32Array(vCount * 3);
  for (let i = 0; i < indices.length; i++) indices[i] = i % vCount;

  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));

  const res = quantizeBufferGeometry3D(THREE, geo);
  assert.ok(res.geometry.getAttribute('normal').array instanceof Int8Array);
  assert.equal(res.geometry.getAttribute('normal').normalized, true);
  assert.ok(res.geometry.getAttribute('uv').array instanceof Uint16Array);
  assert.equal(res.geometry.getAttribute('uv').normalized, true);
  assert.ok(res.geometry.index.array instanceof Uint16Array);
  assert.ok(res.stats.reductionPct > 20, `expected >20% reduction, got ${res.stats.reductionPct}%`);
});

test('T6-P2: dispatchWebGpuHiZOcclusion cpu-hiz fallback accurately separates occluded vs visible objects', async () => {
  const width = 32;
  const height = 32;
  const hizDepthData = new Float32Array(width * height).fill(0.95);
  // Near wall [0.1..0.6] x [0.1..0.9] at depth 0.25
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const v = (y + 0.5) / height;
      if (u >= 0.1 && u <= 0.6 && v >= 0.1 && v <= 0.9) {
        hizDepthData[y * width + x] = 0.25;
      }
    }
  }
  const screenAabbs = new Float32Array([
    0.26, 0.26, 0.45, 0.70, // strictly behind near wall
    0.72, 0.26, 0.88, 0.70, // outside near wall (background depth 0.95)
  ]);
  const minDepths = new Float32Array([0.55, 0.55]);
  const out = await dispatchWebGpuHiZOcclusion({
    webgpuDevice: null,
    screenAabbs,
    minDepths,
    hizDepthData,
    width,
    height,
    objectCount: 2,
    readback: true,
  });
  assert.equal(out.mode, 'cpu-hiz');
  assert.equal(out.visibleCount, 1);
  assert.equal(out.occludedCount, 1);
  assert.deepEqual(Array.from(out.visibility), [0, 1]);
});
