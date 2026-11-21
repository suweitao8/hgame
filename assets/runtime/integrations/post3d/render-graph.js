/**
 * Dependency-driven Render Graph compiler and executor for 3D fullscreen/HDR passes.
 * Computes deterministic topological execution order from declared read/write dependencies,
 * tracks transient resource [firstWrite, lastRead] lifetimes, and automatically aliases/reuses
 * and reclaims scratch targets at their last-use pass.
 */

function specKey(spec) {
  if (!spec || typeof spec !== 'object') return 'default';
  const width = spec.width ?? 'full';
  const height = spec.height ?? 'full';
  const format = spec.format ?? 'rgba16f';
  const depth = Boolean(spec.depthBuffer);
  const samples = spec.samples ?? 0;
  return `${width}x${height}:${format}:d${depth ? 1 : 0}:s${samples}`;
}

function normalizeList(value, label) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const out = [];
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) {
      throw new TypeError(`${label} entries must be nonempty strings`);
    }
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

/**
 * Compile a set of passes into a dependency-ordered Render Graph with transient lifetimes and aliasing.
 * @param {readonly {
 *   id: string,
 *   reads?: readonly string[],
 *   optionalReads?: readonly string[],
 *   writes?: readonly string[],
 *   transientSpecs?: Record<string, object>,
 *   enabled?: boolean,
 *   sideEffect?: boolean,
 *   execute?: (ctx: object) => void,
 *   meta?: unknown,
 * }[]} passes
 * @param {{ externalInputs?: Iterable<string>, externalOutputs?: Iterable<string>, pruneDeadPasses?: boolean }} [options]
 */
export function compileRenderGraph(passes, { externalInputs = [], externalOutputs = [], pruneDeadPasses = false } = {}) {
  if (!Array.isArray(passes)) throw new TypeError('compileRenderGraph requires an array of passes');
  const extIn = new Set(externalInputs);
  const extOut = new Set(externalOutputs);

  const seenIds = new Set();
  let activePasses = [];
  const culledPasses = [];
  for (let i = 0; i < passes.length; i++) {
    const raw = passes[i];
    const id = typeof raw?.id === 'string' ? raw.id.trim() : '';
    if (!id) throw new TypeError(`Pass at index ${i} requires a nonempty id`);
    if (seenIds.has(id)) throw new TypeError(`Duplicate render graph pass id: ${id}`);
    seenIds.add(id);
    if (raw.enabled === false) continue;
    activePasses.push({
      id,
      regIndex: activePasses.length,
      reads: Object.freeze(normalizeList(raw.reads, `${id}.reads`)),
      optionalReads: Object.freeze(normalizeList(raw.optionalReads, `${id}.optionalReads`)),
      writes: Object.freeze(normalizeList(raw.writes, `${id}.writes`)),
      transientSpecs: raw.transientSpecs && typeof raw.transientSpecs === 'object' ? { ...raw.transientSpecs } : {},
      sideEffect: Boolean(raw.sideEffect),
      execute: typeof raw.execute === 'function' ? raw.execute : null,
      meta: raw.meta ?? null,
    });
  }

  // Optional dead-pass elimination: keep passes backward-reachable from externalOutputs or sideEffect.
  if (pruneDeadPasses && extOut.size > 0 && activePasses.length > 0) {
    const initialWriters = new Map();
    for (let i = 0; i < activePasses.length; i++) {
      for (const res of activePasses[i].writes) {
        let list = initialWriters.get(res);
        if (!list) { list = []; initialWriters.set(res, list); }
        list.push(i);
      }
    }
    const live = new Set();
    const walk = [];
    for (let i = 0; i < activePasses.length; i++) {
      const p = activePasses[i];
      if (p.sideEffect || p.writes.some(w => extOut.has(w))) {
        live.add(i);
        walk.push(i);
      }
    }
    while (walk.length > 0) {
      const idx = walk.pop();
      const p = activePasses[idx];
      for (const res of [...p.reads, ...p.optionalReads]) {
        const writers = initialWriters.get(res);
        if (!writers?.length) continue;
        let producer = writers[0];
        for (const w of writers) if (w < idx) producer = w;
        if (!live.has(producer)) {
          live.add(producer);
          walk.push(producer);
        }
      }
    }
    const kept = [];
    for (let i = 0; i < activePasses.length; i++) {
      if (live.has(i)) {
        kept.push({ ...activePasses[i], regIndex: kept.length });
      } else {
        culledPasses.push(activePasses[i].id);
      }
    }
    activePasses = kept;
  }

  // Map each resource to its producer pass index in activePasses (or serial writers).
  /** @type {Map<string, number[]>} */
  const producersByResource = new Map();
  for (let i = 0; i < activePasses.length; i++) {
    for (const res of activePasses[i].writes) {
      let list = producersByResource.get(res);
      if (!list) {
        list = [];
        producersByResource.set(res, list);
      }
      list.push(i);
    }
  }

  const adj = Array.from({ length: activePasses.length }, () => new Set());
  const inDegree = new Int32Array(activePasses.length);
  const edges = [];

  function addEdge(from, to, resource) {
    if (from === to) {
      throw new Error(`Pass "${activePasses[from].id}" cannot both read and write transient resource "${resource}" without aliasing`);
    }
    if (!adj[from].has(to)) {
      adj[from].add(to);
      inDegree[to]++;
      edges.push(Object.freeze({ from: activePasses[from].id, to: activePasses[to].id, resource }));
    }
  }

  // Serialize multiple writers to the same logical resource in registration order.
  for (const [res, writers] of producersByResource) {
    for (let k = 1; k < writers.length; k++) {
      addEdge(writers[k - 1], writers[k], res);
    }
  }

  for (let i = 0; i < activePasses.length; i++) {
    const pass = activePasses[i];
    for (const res of pass.reads) {
      const writers = producersByResource.get(res);
      if (!writers?.length) {
        if (!extIn.has(res)) {
          throw new Error(`Render graph pass "${pass.id}" requires missing input resource "${res}"`);
        }
        continue;
      }
      // If multiple writers exist, pick the latest writer registered before i, or the first writer if registered after.
      let producer = writers[0];
      for (const w of writers) {
        if (w < i) producer = w;
      }
      addEdge(producer, i, res);
    }
    for (const res of pass.optionalReads) {
      const writers = producersByResource.get(res);
      if (!writers?.length) continue;
      let producer = writers[0];
      for (const w of writers) {
        if (w < i) producer = w;
      }
      if (producer !== i) addEdge(producer, i, res);
    }
  }

  // Deterministic Kahn topological sort preserving registration order among ready nodes.
  const ready = [];
  for (let i = 0; i < activePasses.length; i++) {
    if (inDegree[i] === 0) ready.push(i);
  }
  const orderedIndices = [];
  while (ready.length > 0) {
    ready.sort((a, b) => a - b);
    const current = ready.shift();
    orderedIndices.push(current);
    for (const next of adj[current]) {
      inDegree[next]--;
      if (inDegree[next] === 0) ready.push(next);
    }
  }

  if (orderedIndices.length !== activePasses.length) {
    const cyclic = activePasses.filter((_, idx) => !orderedIndices.includes(idx)).map(p => p.id);
    throw new Error(`Render graph contains a dependency cycle involving: ${cyclic.join(', ')}`);
  }

  const orderedPasses = orderedIndices.map(idx => Object.freeze(activePasses[idx]));

  // Compute [firstWrite, lastRead] lifetimes in execution order.
  /** @type {Record<string, { firstWrite: number, lastRead: number, external: boolean, specKey: string, spec: object | null }>} */
  const lifetimes = Object.create(null);
  for (let execIdx = 0; execIdx < orderedPasses.length; execIdx++) {
    const pass = orderedPasses[execIdx];
    for (const res of pass.writes) {
      if (extOut.has(res)) continue;
      const spec = pass.transientSpecs[res] ?? null;
      if (!lifetimes[res]) {
        lifetimes[res] = {
          firstWrite: execIdx,
          lastRead: execIdx,
          external: false,
          specKey: specKey(spec),
          spec,
        };
      } else {
        lifetimes[res].lastRead = Math.max(lifetimes[res].lastRead, execIdx);
      }
    }
    for (const res of [...pass.reads, ...pass.optionalReads]) {
      if (lifetimes[res]) {
        lifetimes[res].lastRead = Math.max(lifetimes[res].lastRead, execIdx);
      }
    }
  }

  // Assign physical transient target slots using greedy interval reuse + last-use reclamation.
  /** @type {Map<string, string[]>} */
  const freeSlotsBySpec = new Map();
  /** @type {Map<string, string>} */
  const resourceToSlot = new Map();
  /** @type {Map<string, string[]>} */
  const aliases = new Map();
  /** @type {Record<string, readonly { resource: string, slot: string }[]>} */
  const reclaimedAt = Object.create(null);
  let nextSlotId = 0;

  for (let execIdx = 0; execIdx < orderedPasses.length; execIdx++) {
    const pass = orderedPasses[execIdx];
    const readSlots = new Set();
    for (const res of [...pass.reads, ...pass.optionalReads]) {
      const slot = resourceToSlot.get(res);
      if (slot) readSlots.add(slot);
    }

    for (const res of pass.writes) {
      const life = lifetimes[res];
      if (!life) continue;
      if (resourceToSlot.has(res)) continue;
      const free = freeSlotsBySpec.get(life.specKey) ?? [];
      let chosenIdx = free.findIndex(slot => !readSlots.has(slot));
      let slot;
      if (chosenIdx >= 0) {
        slot = free.splice(chosenIdx, 1)[0];
      } else {
        slot = `transient:${life.specKey}#${nextSlotId++}`;
        aliases.set(slot, []);
      }
      resourceToSlot.set(res, slot);
      aliases.get(slot).push(res);
    }

    const releasedHere = [];
    for (const [res, life] of Object.entries(lifetimes)) {
      if (life.lastRead === execIdx) {
        const slot = resourceToSlot.get(res);
        if (slot) {
          let free = freeSlotsBySpec.get(life.specKey);
          if (!free) {
            free = [];
            freeSlotsBySpec.set(life.specKey, free);
          }
          if (!free.includes(slot)) free.push(slot);
          releasedHere.push(Object.freeze({ resource: res, slot }));
        }
      }
    }
    reclaimedAt[pass.id] = Object.freeze(releasedHere);
  }

  const frozenLifetimes = Object.create(null);
  for (const [res, life] of Object.entries(lifetimes)) {
    frozenLifetimes[res] = Object.freeze({ ...life, slot: resourceToSlot.get(res) ?? null });
  }

  const frozenAliases = Object.create(null);
  for (const [slot, list] of aliases) {
    frozenAliases[slot] = Object.freeze(list.slice());
  }

  return Object.freeze({
    passes: Object.freeze(orderedPasses),
    order: Object.freeze(orderedPasses.map(p => p.id)),
    culledPasses: Object.freeze(culledPasses),
    edges: Object.freeze(edges),
    lifetimes: Object.freeze(frozenLifetimes),
    resourceToSlot: Object.freeze(Object.fromEntries(resourceToSlot)),
    aliases: Object.freeze(frozenAliases),
    peakTargets: nextSlotId,
    reclaimedAt: Object.freeze(reclaimedAt),
  });
}

/**
 * Execute a compiled Render Graph against a transient target pool, allocating on first write
 * and reclaiming physical targets immediately after each resource's lastRead pass.
 * @param {ReturnType<typeof compileRenderGraph>} graph
 * @param {{ acquire: (spec: object | null, resource: string, slot: string) => unknown, release: (target: unknown, resource: string, slot: string) => void }} pool
 * @param {{ externalTargets?: Record<string, unknown>, state?: object }} [context]
 */
export function executeRenderGraph(graph, pool, { externalTargets = {}, state = {} } = {}) {
  if (!graph || !Array.isArray(graph.passes)) throw new TypeError('executeRenderGraph requires a compiled graph');
  if (!pool || typeof pool.acquire !== 'function' || typeof pool.release !== 'function') {
    throw new TypeError('executeRenderGraph requires a target pool with acquire() and release()');
  }

  /** @type {Map<string, unknown>} */
  const liveTargets = new Map(Object.entries(externalTargets));
  /** @type {Map<string, unknown>} */
  const slotTargets = new Map();
  const seenSlots = new Set();
  let acquiredCount = 0;
  let reusedCount = 0;
  let reclaimedCount = 0;
  const executed = [];

  try {
    for (let execIdx = 0; execIdx < graph.passes.length; execIdx++) {
      const pass = graph.passes[execIdx];
      const inputs = Object.create(null);
      for (const res of pass.reads) {
        inputs[res] = liveTargets.get(res) ?? null;
      }
      for (const res of pass.optionalReads) {
        if (liveTargets.has(res)) inputs[res] = liveTargets.get(res);
      }

      const outputs = Object.create(null);
      for (const res of pass.writes) {
        const life = graph.lifetimes[res];
        if (!life) {
          outputs[res] = liveTargets.get(res) ?? null;
          continue;
        }
        const slot = graph.resourceToSlot[res];
        let target = slotTargets.get(slot);
        if (target === undefined) {
          target = pool.acquire(life.spec, res, slot, pass);
          slotTargets.set(slot, target);
          if (seenSlots.has(slot)) reusedCount++;
          else {
            seenSlots.add(slot);
            acquiredCount++;
          }
        }
        liveTargets.set(res, target);
        outputs[res] = target;
      }

      pass.execute?.({ pass, inputs, outputs, state, execIndex: execIdx });
      executed.push(pass.id);

      const released = graph.reclaimedAt[pass.id] ?? [];
      for (const { resource, slot } of released) {
        const target = liveTargets.get(resource);
        liveTargets.delete(resource);
        if (target !== undefined && slotTargets.get(slot) === target) {
          pool.release(target, resource, slot);
          slotTargets.delete(slot);
          reclaimedCount++;
        }
      }
    }
  } finally {
    for (const [slot, target] of slotTargets) {
      pool.release(target, slot, slot);
      reclaimedCount++;
    }
    slotTargets.clear();
  }

  return Object.freeze({
    executed: Object.freeze(executed),
    acquiredCount,
    reusedCount,
    reclaimedCount,
    peakTargets: graph.peakTargets,
  });
}
