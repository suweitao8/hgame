/**
 * Incremental Shader / PSO Pre-Compilation Warmup Queue for Three.js WebGL2/WebGPU renderers.
 * Prevents first-frame shader compile hitches when new materials, lights, or post effects appear.
 * Never imports 'three' directly; callers inject { THREE } and renderer.
 */

function defaultNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/**
 * Create an incremental shader warmup queue bounded by a per-frame millisecond budget.
 * @param {object} THREE Three.js namespace or compatible mock.
 * @param {object} renderer WebGLRenderer / WebGPURenderer compatible instance.
 * @param {object} [options]
 * @param {number} [options.budgetMsPerFrame=4] Default millisecond budget per `step()` call.
 * @param {() => number} [options.now] Clock function returning milliseconds.
 */
export function createShaderWarmupQueue3D(THREE, renderer, {
  budgetMsPerFrame = 4,
  now = defaultNow,
} = {}) {
  if (!THREE || !renderer) {
    throw new TypeError('createShaderWarmupQueue3D requires THREE and renderer');
  }
  const defaultBudgetMs = Math.max(0.1, Number(budgetMsPerFrame) || 4);
  const queue = [];
  const compiledSet = new WeakSet();
  let compiledCount = 0;
  let failedCount = 0;
  let totalMs = 0;
  let disposed = false;

  function enqueue(target, camera) {
    if (disposed || !target || !camera) return 0;
    let added = 0;
    if (typeof target.traverse === 'function') {
      const seen = [];
      target.traverse(node => {
        if (node?.isMesh && node.material && !compiledSet.has(node.material)) {
          seen.push(node);
        }
      });
      if (seen.length === 0) {
        queue.push({ object: target, material: null, camera });
        return 1;
      }
      for (const mesh of seen) {
        queue.push({ object: mesh, material: mesh.material, camera });
        added++;
      }
      return added;
    }
    queue.push({ object: target, material: target.material ?? null, camera });
    return 1;
  }

  function enqueueMaterials(materials, camera) {
    if (disposed || !camera || !materials) return 0;
    const list = Array.isArray(materials) ? materials : [materials];
    let added = 0;
    const geo = THREE.PlaneGeometry ? new THREE.PlaneGeometry(1, 1) : (THREE.BufferGeometry ? new THREE.BufferGeometry() : null);
    for (const mat of list) {
      if (!mat || compiledSet.has(mat)) continue;
      const mesh = THREE.Mesh && geo ? new THREE.Mesh(geo, mat) : { material: mat };
      queue.push({ object: mesh, material: mat, camera, ownedGeo: geo });
      added++;
    }
    return added;
  }

  function markMaterialCompiled(mat) {
    if (mat && typeof mat === 'object') {
      if (Array.isArray(mat)) {
        for (const m of mat) if (m && typeof m === 'object') compiledSet.add(m);
      } else {
        compiledSet.add(mat);
      }
    }
  }

  function step(budgetMs = defaultBudgetMs) {
    if (disposed || queue.length === 0) {
      return { compiled: 0, failed: 0, remaining: 0, elapsedMs: 0, done: true };
    }
    const capMs = Math.max(0.05, Number(budgetMs) || defaultBudgetMs);
    const tStart = now();
    let compiled = 0;
    let failed = 0;

    while (queue.length > 0) {
      if (compiled > 0 && (now() - tStart) >= capMs) break;
      const job = queue.shift();
      if (job.material && !Array.isArray(job.material) && compiledSet.has(job.material)) {
        continue;
      }
      try {
        if (typeof renderer.compile === 'function') {
          renderer.compile(job.object, job.camera);
        } else if (typeof renderer.compileAsync === 'function') {
          // Kick async compile when synchronous compile is absent
          renderer.compileAsync(job.object, job.camera);
        }
        markMaterialCompiled(job.material);
        compiled++;
        compiledCount++;
      } catch {
        failed++;
        failedCount++;
      }
    }

    const elapsedMs = Math.max(0, now() - tStart);
    totalMs += elapsedMs;
    return {
      compiled,
      failed,
      remaining: queue.length,
      elapsedMs,
      done: queue.length === 0,
    };
  }

  async function warmupAll(camera = null) {
    if (disposed) return getStats();
    while (queue.length > 0) {
      const job = queue.shift();
      const cam = job.camera ?? camera;
      if (job.material && !Array.isArray(job.material) && compiledSet.has(job.material)) continue;
      const t0 = now();
      try {
        if (typeof renderer.compileAsync === 'function') {
          await renderer.compileAsync(job.object, cam);
        } else if (typeof renderer.compile === 'function') {
          renderer.compile(job.object, cam);
        }
        markMaterialCompiled(job.material);
        compiledCount++;
      } catch {
        failedCount++;
      } finally {
        totalMs += Math.max(0, now() - t0);
      }
    }
    return getStats();
  }

  function getStats() {
    return {
      queued: queue.length,
      compiled: compiledCount,
      failed: failedCount,
      totalMs,
      done: queue.length === 0,
    };
  }

  function clear() {
    queue.length = 0;
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    queue.length = 0;
    return true;
  }

  return {
    enqueue,
    enqueueMaterials,
    step,
    stepWarmupBudget: step,
    warmupAll,
    getStats,
    clear,
    dispose,
  };
}
