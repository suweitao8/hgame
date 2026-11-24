import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';
import {
  cameraAngleBetween,
  cameraMotionBetween,
  createGpuIndirectCuller3D,
  createIndirectInstancedBatch3D,
  widenFrustumPlanes,
} from '../assets/runtime/integrations/gpu-indirect3d.js';

const USAGE = { MAP_READ: 0x0001, COPY_SRC: 0x0004, COPY_DST: 0x0008, UNIFORM: 0x0040, STORAGE: 0x0080, INDIRECT: 0x0100 };
const RADIUS = 0.5;
const COUNT = 180;

/**
 * A WebGPU device that really culls. A submission snapshots the planes and bounds it was given and its
 * answer reaches the staging buffers `lag` GPU ticks later, the way a real readback does.
 */
function createSimulatedGpu({ lag = 2 } = {}) {
  const buffers = [];
  const pendingMaps = [];
  const jobs = [];
  let now = 0;
  let submissions = 0;
  const byUsage = (usage, exact) => buffers.find(buffer => exact ? buffer.usage === usage : (buffer.usage & usage) === usage);
  const device = {
    createShaderModule: () => ({}),
    createComputePipeline: () => ({ getBindGroupLayout: () => ({}) }),
    createBindGroup: () => ({}),
    createBuffer: ({ size, usage }) => {
      const buffer = {
        size, usage, data: new ArrayBuffer(size),
        mapAsync: () => new Promise(resolve => { pendingMaps.push({ buffer, resolve }); }),
        getMappedRange() { return this.data; },
        unmap() {},
        destroy() {},
      };
      buffers.push(buffer);
      return buffer;
    },
    queue: {
      writeBuffer: (buffer, byteOffset, data, srcOffset = 0, length = data.length - srcOffset) => {
        const bytes = new Uint8Array(data.buffer, data.byteOffset + srcOffset * data.BYTES_PER_ELEMENT, length * data.BYTES_PER_ELEMENT);
        new Uint8Array(buffer.data, byteOffset).set(bytes);
      },
      submit: encoders => {
        const bounds = byUsage(USAGE.STORAGE | USAGE.COPY_DST, true);
        for (const encoder of encoders) {
          const ticks = typeof lag === 'function' ? lag(submissions) : lag;
          submissions++;
          jobs.push({
            at: now + ticks,
            encoder,
            planes: new Uint8Array(byUsage(USAGE.UNIFORM).data).slice(),
            bounds: bounds ? new Uint8Array(bounds.data).slice() : new Uint8Array(0),
          });
        }
      },
    },
    createCommandEncoder: () => {
      const copies = [];
      return {
        beginComputePass: () => ({ setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} }),
        copyBufferToBuffer: (src, srcOffset, dst, dstOffset, size) => { copies.push({ src, dst, dstOffset, size }); },
        finish: () => ({ copies }),
      };
    },
    /** Runs the GPU for one tick: every submission whose time has come is executed and its readback resolves. */
    tick() {
      now++;
      const waiting = [];
      for (const job of jobs) {
        if (job.at > now) {
          waiting.push(job);
          continue;
        }
        const planes = new Float32Array(job.planes.buffer);
        const count = new Uint32Array(job.planes.buffer)[24];
        const bounds = new Float32Array(job.bounds.buffer);
        const visible = [];
        for (let i = 0; i < count; i++) {
          const x = bounds[i * 4], y = bounds[i * 4 + 1], z = bounds[i * 4 + 2], r = bounds[i * 4 + 3];
          let kept = r > 0;
          for (let p = 0; kept && p < 24; p += 4) {
            if (planes[p] * x + planes[p + 1] * y + planes[p + 2] * z + planes[p + 3] < -r) kept = false;
          }
          if (kept) visible.push(i);
        }
        const args = byUsage(USAGE.INDIRECT);
        for (const copy of job.encoder.copies) {
          new Uint32Array(copy.dst.data, copy.dstOffset).set(copy.src === args ? [36, visible.length] : visible);
          for (let m = pendingMaps.length - 1; m >= 0; m--) {
            if (pendingMaps[m].buffer === copy.dst) pendingMaps.splice(m, 1)[0].resolve();
          }
        }
      }
      jobs.length = 0;
      jobs.push(...waiting);
    },
  };
  return device;
}

const settle = async gpu => {
  gpu.tick();
  await new Promise(resolve => setTimeout(resolve, 0));
};

/** Frustum planes of a camera with the four side planes first, as the scene culler orders them. */
function planesOf(camera, out = new Float64Array(24)) {
  camera.updateMatrixWorld(true);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
  frustum.planes.forEach((plane, i) => {
    out[i * 4] = plane.normal.x;
    out[i * 4 + 1] = plane.normal.y;
    out[i * 4 + 2] = plane.normal.z;
    out[i * 4 + 3] = plane.constant;
  });
  return out;
}

function poseOf(camera) {
  return {
    position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    quaternion: { x: camera.quaternion.x, y: camera.quaternion.y, z: camera.quaternion.z, w: camera.quaternion.w },
    projection: [camera.fov, camera.aspect, camera.zoom, camera.near, camera.far],
  };
}

/** A batch of `COUNT` unit cubes evenly spaced on a ring of radius 18 around the camera. */
function createRingBatch({ phase = 0 } = {}) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial();
  const batch = createIndirectInstancedBatch3D(THREE, { geometry, material, capacity: COUNT });
  const matrix = new THREE.Matrix4();
  const centers = [];
  const byPosition = new Map();
  for (let i = 0; i < COUNT; i++) {
    const angle = (i / COUNT) * Math.PI * 2 + phase;
    const x = Math.cos(angle) * 18;
    const z = Math.sin(angle) * 18;
    centers.push({ x, y: 0, z });
    byPosition.set(`${x.toFixed(3)},0.000,${z.toFixed(3)}`, i);
    batch.setInstanceMatrix(i, matrix.makeTranslation(x, 0, z));
    batch.setInstanceBounds(i, x, 0, z, RADIUS);
  }
  return {
    batch,
    centers,
    byPosition,
    dispose() {
      batch.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}

function visibleAgainst(centers, planes, radius = RADIUS) {
  const visible = new Set();
  centers.forEach(({ x, y, z }, i) => {
    for (let p = 0; p < 24; p += 4) {
      if (planes[p] * x + planes[p + 1] * y + planes[p + 2] * z + planes[p + 3] < -radius) return;
    }
    visible.add(i);
  });
  return visible;
}

/** Indices of the instances the batch is about to draw, read back from its instance matrices. */
function drawnIndices(ring) {
  const { batch, byPosition } = ring;
  const matrices = batch.mesh.instanceMatrix.array;
  const drawn = new Set();
  for (let i = 0; i < batch.mesh.count; i++) {
    const key = `${matrices[i * 16 + 12].toFixed(3)},${matrices[i * 16 + 13].toFixed(3)},${matrices[i * 16 + 14].toFixed(3)}`;
    const index = byPosition.get(key);
    assert.notEqual(index, undefined, `drawn instance ${i} sits at no known position (${key})`);
    drawn.add(index);
  }
  assert.equal(drawn.size, batch.mesh.count, 'an instance is drawn twice');
  return drawn;
}

const missingCount = (expected, drawn) => [...expected].filter(index => !drawn.has(index)).length;

test('camera motion is measured as translation plus the arc a turn sweeps at a given distance', () => {
  const still = { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };
  assert.equal(cameraAngleBetween(still, still), 0);
  assert.equal(cameraAngleBetween(still, { ...still, quaternion: { x: 0, y: 0, z: 0, w: -1 } }), 0, 'a quaternion and its negative are one rotation');
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
  near(cameraAngleBetween(still, { ...still, quaternion: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 } }), Math.PI / 2);
  near(cameraAngleBetween(still, { ...still, quaternion: { x: 1, y: 0, z: 0, w: 0 } }), Math.PI);

  assert.equal(cameraMotionBetween(still, { ...still, position: { x: 3, y: 4, z: 0 } }, 100), 5);
  near(cameraMotionBetween(still, { ...still, quaternion: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 } }, 100),
    2 * 100 * Math.sin(Math.PI / 4));
  near(cameraMotionBetween(still, { ...still, position: { x: 0, y: 0, z: 2 }, quaternion: { x: 1, y: 0, z: 0, w: 0 } }, 100), 202);
});

test('a widened frustum turns its side planes outward and moves its near and far planes back', () => {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 100);
  camera.updateProjectionMatrix();
  const exact = planesOf(camera);
  const pristine = Float64Array.from(exact);
  const pose = poseOf(camera);
  const halfHorizontal = Math.atan(Math.tan(THREE.MathUtils.degToRad(30)) * 16 / 9);
  const outsideBy = (distance, extra) => ({ x: Math.tan(halfHorizontal + extra) * distance, y: 0, z: -distance });

  // A turn of five degrees keeps what is two degrees beside the view, near or far, but nothing behind.
  const five = THREE.MathUtils.degToRad(5);
  const turned = widenFrustumPlanes(exact, pose, { angle: five });
  assert.equal(turned.angle, five);
  assert.deepEqual([...exact], [...pristine], 'the given planes are left as they were');
  for (const distance of [20, 40]) {
    const point = outsideBy(distance, THREE.MathUtils.degToRad(2));
    assert.equal(visibleAgainst([point], exact).size, 0, `${distance} units away: outside the exact frustum`);
    assert.equal(visibleAgainst([point], turned.planes).size, 1, `${distance} units away: inside the widened frustum`);
  }
  assert.equal(visibleAgainst([{ x: 0, y: 0, z: 5 }], turned.planes).size, 0);
  assert.equal(visibleAgainst([{ x: 0, y: 0, z: -10 }], turned.planes).size, 1, 'what was in view stays in view');

  const backed = widenFrustumPlanes(exact, pose, { distance: 0.25 });
  const nearPoint = { x: 0, y: 0, z: -0.4 };
  const farPoint = { x: 0, y: 0, z: -100.1 };
  assert.equal(visibleAgainst([nearPoint, farPoint], exact, 0).size, 0);
  assert.equal(visibleAgainst([nearPoint, farPoint], backed.planes, 0).size, 2);

  // No margin leaves the frustum alone, and an absurd turn is capped below a full revolution.
  assert.deepEqual([...widenFrustumPlanes(exact, pose, {}).planes], [...pristine]);
  const capped = widenFrustumPlanes(exact, pose, { angle: 100 }, new Float64Array(24));
  assert.ok(capped.angle > 0 && capped.angle < Math.PI);
  assert.equal(capped.planes.every(Number.isFinite), true);
  assert.equal(visibleAgainst([{ x: 0, y: 0, z: -10 }, { x: 30, y: 0, z: 0 }], capped.planes).size, 2);
});

test('an indirect batch never drops an instance that is in view while the camera turns', async () => {
  const gpu = createSimulatedGpu({ lag: 2 });
  const culler = createGpuIndirectCuller3D({ device: gpu, maxInstances: COUNT });
  const ring = createRingBatch();
  const { batch } = ring;
  try {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 100);
    const exact = new Float64Array(24);
    const widened = new Float64Array(24);
    const sources = [];
    let previous = null;
    let widest = 0;
    for (let frame = 0; frame < 40; frame++) {
      camera.rotation.set(0, frame * THREE.MathUtils.degToRad(8), 0);
      planesOf(camera, exact);
      const pose = poseOf(camera);
      // The answer being submitted now will be applied a few frames on, so it is asked for a frustum
      // widened by the turn expected in that time.
      const turn = (previous ? cameraAngleBetween(previous, pose) : 0) * (batch.getStats().readbackLag || 3) * 1.25;
      const margin = widenFrustumPlanes(exact, pose, { angle: turn }, widened);
      batch.cull(margin.planes, culler, { view: { ...pose, angle: margin.angle } });

      const expected = visibleAgainst(ring.centers, exact);
      const drawn = drawnIndices(ring);
      assert.equal(missingCount(expected, drawn), 0, `frame ${frame}: an instance in view is not drawn`);
      sources.push(batch.getStats().source);
      if (batch.getStats().source === 'gpu-readback') {
        widest = Math.max(widest, drawn.size - expected.size);
      }
      previous = pose;
      await settle(gpu);
    }

    assert.deepEqual([...new Set(sources)], ['cpu-fallback', 'unculled', 'gpu-readback']);
    assert.equal(sources.at(-1), 'gpu-readback');
    // Widening turns with the camera, so only the stretch of ring about to enter the view is drawn extra.
    assert.ok(widest > 0 && widest < COUNT * 0.25, `instances drawn beyond the view: ${widest}`);
  } finally {
    ring.dispose();
    culler.dispose();
  }
});

test('the widened volume contains the near and far corners throughout a camera turn', () => {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 100);
  camera.position.set(7, 9, 12);
  camera.setViewOffset(1600, 900, 110, 95, 1350, 700);
  const origin = camera.position.clone();
  const offset = new THREE.Vector3(0.06, -0.1, 0.08);
  const angle = THREE.MathUtils.degToRad(10);
  for (const marginAngle of [angle, Math.PI * 0.9]) {
    camera.rotation.set(0, 0, 0);
    camera.position.copy(origin);
    const exact = planesOf(camera);
    const widened = widenFrustumPlanes(exact, poseOf(camera), { angle: marginAngle, distance: offset.length() });
    for (const axis of [
      new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 2, 1).normalize(),
    ]) {
      for (const rotation of [-1, -0.8, 0.8, 1]) {
        camera.quaternion.setFromAxisAngle(axis, marginAngle * rotation);
        camera.position.copy(origin).add(offset);
        camera.updateMatrixWorld(true);
        const corners = [];
        for (const x of [-0.99999, 0.99999]) {
          for (const y of [-0.99999, 0.99999]) {
            for (const z of [-0.99999, 0.99999]) corners.push(new THREE.Vector3(x, y, z).unproject(camera));
          }
        }
        assert.equal(visibleAgainst(corners, widened.planes, 0).size, 8,
          `rotation ${rotation * marginAngle} about ${axis.toArray()} includes the near and far corners`);
      }
    }
  }
});

test('changed bounds or a new frustum without a pose never reuse old instance indices', async () => {
  const gpu = createSimulatedGpu();
  const culler = createGpuIndirectCuller3D({ device: gpu, maxInstances: COUNT });
  const ring = createRingBatch();
  const { batch } = ring;
  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 100);
  try {
    const first = planesOf(camera);
    for (let frame = 0; frame < 4; frame++) {
      batch.cull(first, culler);
      await settle(gpu);
    }
    assert.equal(batch.getStats().source, 'gpu-readback');
    const originallyDrawn = drawnIndices(ring);
    const moved = ring.centers.findIndex((_, index) => !originallyDrawn.has(index));
    batch.setInstanceMatrix(moved, new THREE.Matrix4().makeTranslation(0, 0, -5));
    batch.setInstanceBounds(moved, 0, 0, -5, RADIUS);
    batch.cull(first, culler);
    assert.equal(batch.getStats().source, 'cpu-fallback', 'a batch with changed bounds uses the current planes');
    const matrix = new THREE.Matrix4();
    const drawnZ = Array.from({ length: batch.visibleCount }, (_, index) => {
      batch.mesh.getMatrixAt(index, matrix);
      return matrix.elements[14];
    });
    assert.ok(drawnZ.includes(-5), 'the newly visible instance was drawn');
    for (let frame = 0; frame < 4; frame++) {
      await settle(gpu);
      batch.cull(first, culler);
    }
    assert.equal(batch.getStats().source, 'gpu-readback');
    culler.setFrustumPlanes(first);
    batch.cull(null, culler);
    assert.equal(batch.getStats().source, 'gpu-readback', 'an explicitly configured culler still supplies its planes');
    camera.rotation.y = Math.PI / 2;
    batch.cull(planesOf(camera), culler);
    assert.equal(batch.getStats().source, 'cpu-fallback', 'a changed exact frustum invalidates the older answer');
  } finally {
    ring.dispose();
    culler.dispose();
  }
});

test('a still camera gets exactly the visible instances from the readback', async () => {
  const gpu = createSimulatedGpu({ lag: 2 });
  const culler = createGpuIndirectCuller3D({ device: gpu, maxInstances: COUNT });
  const ring = createRingBatch();
  try {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 100);
    const exact = planesOf(camera, new Float64Array(24));
    const pose = poseOf(camera);
    const expected = visibleAgainst(ring.centers, exact);
    let sources = [];
    for (let frame = 0; frame < 6; frame++) {
      ring.batch.cull(exact, culler, { view: { ...pose, angle: 0 } });
      assert.deepEqual([...drawnIndices(ring)].sort(), [...expected].sort(), `frame ${frame}`);
      sources.push(ring.batch.getStats().source);
      await settle(gpu);
    }
    assert.deepEqual(sources, ['cpu-fallback', 'cpu-fallback', 'gpu-readback', 'gpu-readback', 'gpu-readback', 'gpu-readback']);
  } finally {
    ring.dispose();
    culler.dispose();
  }
});

test('a camera cut draws everything until an answer computed after the cut arrives', async () => {
  const gpu = createSimulatedGpu({ lag: 2 });
  const culler = createGpuIndirectCuller3D({ device: gpu, maxInstances: COUNT });
  const ring = createRingBatch();
  const { batch } = ring;
  try {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 100);
    const exact = new Float64Array(24);
    const widened = new Float64Array(24);
    let previous = null;
    const sources = [];
    const step = async yaw => {
      camera.rotation.set(0, yaw, 0);
      planesOf(camera, exact);
      const pose = poseOf(camera);
      const turn = (previous ? cameraAngleBetween(previous, pose) : 0) * (batch.getStats().readbackLag || 3) * 1.25;
      const margin = widenFrustumPlanes(exact, pose, { angle: turn }, widened);
      batch.cull(margin.planes, culler, { view: { ...pose, angle: margin.angle } });
      const missing = missingCount(visibleAgainst(ring.centers, exact), drawnIndices(ring));
      const source = batch.getStats().source;
      const drawn = batch.mesh.count;
      previous = pose;
      await settle(gpu);
      return { source, drawn, missing };
    };

    const straight = THREE.MathUtils.degToRad(20);
    const warmUp = [];
    for (let frame = 0; frame < 6; frame++) warmUp.push((await step(straight)).source);
    assert.deepEqual(warmUp.slice(2), ['gpu-readback', 'gpu-readback', 'gpu-readback', 'gpu-readback']);
    const viewCount = batch.visibleCount;

    const afterCut = [await step(straight + THREE.MathUtils.degToRad(170))];
    for (let frame = 0; frame < 6; frame++) afterCut.push(await step(straight + THREE.MathUtils.degToRad(170)));
    assert.deepEqual(afterCut.map(frame => frame.source), [
      'unculled', 'unculled', 'gpu-readback', 'gpu-readback', 'gpu-readback', 'gpu-readback', 'gpu-readback',
    ]);
    assert.deepEqual(afterCut.slice(0, 2).map(frame => frame.drawn), [COUNT, COUNT]);
    assert.equal(afterCut.every(frame => frame.missing === 0), true);
    assert.equal(afterCut.at(-1).drawn, viewCount, 'culling is back to the exact set once the answer catches up');
    assert.equal(batch.getStats().unculledPasses, 2);
  } finally {
    ring.dispose();
    culler.dispose();
  }
});

test('batches with the same instance count each draw from their own readback', async () => {
  const gpu = createSimulatedGpu({ lag: 2 });
  const culler = createGpuIndirectCuller3D({ device: gpu, maxInstances: COUNT });
  const rings = [createRingBatch(), createRingBatch({ phase: Math.PI / COUNT })];
  try {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 100);
    camera.rotation.set(0, THREE.MathUtils.degToRad(20), 0);
    const exact = planesOf(camera, new Float64Array(24));
    const pose = poseOf(camera);
    const view = { ...pose, angle: 0 };
    const settled = [];
    for (let frame = 0; frame < 10; frame++) {
      const sources = rings.map(ring => {
        ring.batch.cull(exact, culler, { view });
        return ring.batch.getStats().source;
      });
      // Both batches share the two staging slots, so some frames fall back while answers are in flight.
      if (sources.every(source => source === 'gpu-readback')) {
        settled.push(frame);
        for (const ring of rings) {
          assert.deepEqual([...drawnIndices(ring)].sort(), [...visibleAgainst(ring.centers, exact)].sort());
        }
      }
      await settle(gpu);
    }
    assert.ok(settled.length >= 4, `frames where both batches drew from their own answer: ${settled.length}`);
  } finally {
    for (const ring of rings) ring.dispose();
    culler.dispose();
  }
});

test('readback answers are kept apart per tag and carry the view they were computed for', async () => {
  const gpu = createSimulatedGpu({ lag: 1 });
  const culler = createGpuIndirectCuller3D({ device: gpu, maxInstances: 8 });
  try {
    culler.setInstanceCount(2);
    culler.setInstanceBounds(0, 0, 0, -5, 1);
    culler.setInstanceBounds(1, 50, 0, 50, 1);
    culler.setFrustumPlanes(planesOf(new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 100)));
    const view = { position: { x: 0, y: 0, z: 0 }, angle: 0.5 };
    assert.deepEqual(culler.submitComputeReadback({ tag: 'a', view }), { submitted: true, serial: 1 });
    culler.setInstanceBounds(0, 50, 0, 50, 1);
    assert.deepEqual(culler.submitComputeReadback({ tag: 'b' }), { submitted: true, serial: 2 });
    assert.equal(culler.submitComputeReadback({ tag: 'a' }).submitted, false, 'both staging slots are in flight');
    assert.equal(culler.getLatestResult('a'), null);

    await settle(gpu);
    assert.equal(culler.getLatestResult('a').visibleCount, 1);
    assert.deepEqual([...culler.getLatestResult('a').visibleIndices], [0]);
    assert.equal(culler.getLatestResult('a').view, view);
    assert.equal(culler.getLatestResult('b').visibleCount, 0);
    assert.equal(culler.getLatestResult('zzz'), null);
    assert.equal(culler.getLatestResult().visibleCount, 0, 'without a tag the latest answer of any batch is returned');

    // Direct callers still observe a single increasing serial across submissions.
    assert.deepEqual(culler.submitComputeReadback({ tag: 'a' }), { submitted: true, serial: 3 });
    assert.deepEqual(culler.submitComputeReadback({ tag: 'a' }), { submitted: true, serial: 4 });
    assert.equal(culler.submitComputeReadback().submitted, false);
    await settle(gpu);
    assert.deepEqual(culler.submitComputeReadback(), { submitted: true, serial: 5 });
  } finally {
    culler.dispose();
  }
});

test('older map completions do not replace newer readbacks', async () => {
  const gpu = createSimulatedGpu({ lag: index => index === 0 ? 3 : 1 });
  const culler = createGpuIndirectCuller3D({ device: gpu, maxInstances: 2 });
  const tag = {};
  try {
    culler.setInstanceBounds(0, 0, 0, -5, 1);
    culler.setInstanceCount(1);
    culler.setFrustumPlanes(planesOf(new THREE.PerspectiveCamera(60, 1, 0.5, 100)));
    culler.submitComputeReadback({ tag });
    culler.setInstanceBounds(0, 0, 0, 5, 1);
    culler.submitComputeReadback({ tag });
    await settle(gpu);
    assert.equal(culler.getLatestResult(tag).serial, 2);
    await settle(gpu);
    await settle(gpu);
    assert.equal(culler.getLatestResult(tag).serial, 2);
    assert.equal(culler.getLatestResult().visibleCount, 0);
  } finally {
    culler.dispose();
  }
});

test('one batch retains independent GPU answers for opposing views', async () => {
  const gpu = createSimulatedGpu();
  const culler = createGpuIndirectCuller3D({ device: gpu, maxInstances: COUNT });
  const ring = createRingBatch();
  const cameraA = new THREE.PerspectiveCamera(60, 1, 0.5, 100);
  const cameraB = cameraA.clone();
  cameraB.rotation.y = Math.PI;
  const views = [cameraA, cameraB].map(camera => ({ camera, exact: planesOf(camera) }));
  try {
    for (let frame = 0; frame < 8; frame++) {
      for (const { camera, exact } of views) {
        ring.batch.cull(exact, culler, { predict: true, view: { ...poseOf(camera), id: camera } });
        assert.equal(missingCount(visibleAgainst(ring.centers, exact), drawnIndices(ring)), 0);
        if (frame >= 4) assert.equal(ring.batch.getStats().source, 'gpu-readback');
      }
      await settle(gpu);
    }
  } finally {
    ring.dispose();
    culler.dispose();
  }
});

test('more batches than readback slots still get turns on the shared culler', async () => {
  const gpu = createSimulatedGpu({ lag: 1 });
  const culler = createGpuIndirectCuller3D({ device: gpu, maxInstances: COUNT });
  const rings = [0, 0.04, 0.08, 0.12].map(phase => createRingBatch({ phase }));
  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 100);
  try {
    const exact = planesOf(camera);
    for (let frame = 0; frame < 10; frame++) {
      for (const { batch } of rings) batch.cull(exact, culler);
      await settle(gpu);
    }
    assert.ok(rings.every(({ batch }) => batch.getStats().gpuReadbacks > 0), 'all four queues get usable GPU replies');
  } finally {
    for (const ring of rings) ring.dispose();
    culler.dispose();
  }
});
