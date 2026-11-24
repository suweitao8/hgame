// Scorecard A2 evidence: RenderGraph compiler (ordering, lifetimes, aliasing, dead-pass pruning) + physical RT pool.
// Headless note: real-GPU pipeline wiring (pipeline.js / three.js adapter) is browser-only; pure graph logic is tested here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compileRenderGraph, executeRenderGraph, createPhysicalRenderTargetPool3D }
  from '../assets/runtime/integrations/post3d/render-graph.js';

const SPEC = { width: 64, height: 32, format: 'rgba16f' };
const passes = () => [
  // Registered out of order on purpose: graph must sort by dependency.
  { id: 'post', reads: ['lit'], writes: ['post'], transientSpecs: { post: SPEC } },
  { id: 'present', reads: ['post'], writes: ['screen'], sideEffect: true },
  { id: 'geometry', reads: [], writes: ['gbuf'], transientSpecs: { gbuf: SPEC } },
  { id: 'shadow', writes: ['shadowmap'], transientSpecs: { shadowmap: { width: 128, height: 128, depthTexture: true } } },
  { id: 'light', reads: ['gbuf', 'shadowmap'], writes: ['lit'], transientSpecs: { lit: SPEC } },
];
const OPTS = { externalOutputs: ['screen'] };

test('geometry/shadow/decal/post passes are scheduled in one deterministic dependency order', () => {
  const g1 = compileRenderGraph(passes(), OPTS);
  const g2 = compileRenderGraph(passes(), OPTS);
  assert.deepEqual(g1.order, g2.order, 'deterministic');
  const pos = id => g1.order.indexOf(id);
  assert.ok(pos('geometry') < pos('light'));
  assert.ok(pos('shadow') < pos('light'));
  assert.ok(pos('light') < pos('post'));
  assert.ok(pos('post') < pos('present'));
  assert.ok(g1.edges.some(e => e.from === 'shadow' && e.to === 'light' && e.resource === 'shadowmap'));
});

test('graph rejects missing inputs, duplicate ids, and dependency cycles', () => {
  assert.throws(() => compileRenderGraph([{ id: 'a', reads: ['nope'], writes: ['x'] }]), /missing input/);
  assert.doesNotThrow(() => compileRenderGraph([{ id: 'a', reads: ['nope'], writes: ['x'] }], { externalInputs: ['nope'] }));
  assert.throws(() => compileRenderGraph([{ id: 'a', writes: ['x'] }, { id: 'a', writes: ['y'] }]), /Duplicate/);
  assert.throws(() => compileRenderGraph([
    { id: 'a', reads: ['y'], writes: ['x'] }, { id: 'b', reads: ['x'], writes: ['y'] },
  ]), /cycle/);
});

test('pruneDeadPasses culls passes that never reach an external output or side effect', () => {
  const withDead = [...passes(), { id: 'orphanBloom', reads: ['lit'], writes: ['bloom'], transientSpecs: { bloom: SPEC } }];
  const kept = compileRenderGraph(withDead, { ...OPTS, pruneDeadPasses: true });
  assert.deepEqual([...kept.culledPasses], ['orphanBloom']);
  assert.ok(!kept.order.includes('orphanBloom'));
  const notPruned = compileRenderGraph(withDead, OPTS);
  assert.ok(notPruned.order.includes('orphanBloom'));
  // disabled passes are dropped entirely
  const disabled = compileRenderGraph([...passes(), { id: 'off', enabled: false, writes: ['q'] }], OPTS);
  assert.ok(!disabled.order.includes('off'));
});

test('lifetime-based aliasing: same-spec transients with disjoint lifetimes share a physical slot', () => {
  const chain = [
    { id: 'p1', writes: ['a'], transientSpecs: { a: SPEC } },
    { id: 'p2', reads: ['a'], writes: ['b'], transientSpecs: { b: SPEC } },
    { id: 'p3', reads: ['b'], writes: ['c'], transientSpecs: { c: SPEC } },
    { id: 'p4', reads: ['c'], writes: ['d'], transientSpecs: { d: SPEC } },
    { id: 'p5', reads: ['d'], writes: ['screen'], sideEffect: true },
  ];
  const g = compileRenderGraph(chain, OPTS);
  assert.equal(g.peakTargets, 2, 'four transients ping-pong over two physical targets');
  assert.equal(g.resourceToSlot.a, g.resourceToSlot.c);
  assert.equal(g.resourceToSlot.b, g.resourceToSlot.d);
  assert.notEqual(g.resourceToSlot.a, g.resourceToSlot.b, 'overlapping lifetimes never share');
  assert.equal(g.lifetimes.a.firstWrite, 0);
  assert.equal(g.lifetimes.a.lastRead, 1);

  // different specs never alias
  const mixed = compileRenderGraph([
    { id: 'p1', writes: ['a'], transientSpecs: { a: SPEC } },
    { id: 'p2', reads: ['a'], writes: ['b'], transientSpecs: { b: { width: 8, height: 8 } } },
    { id: 'p3', reads: ['b'], writes: ['screen'], sideEffect: true },
  ], OPTS);
  assert.notEqual(mixed.resourceToSlot.a, mixed.resourceToSlot.b);
});

test('executeRenderGraph + physical RT pool: acquires fewer targets than resources, reclaims all, passes see inputs', () => {
  const g = compileRenderGraph([
    { id: 'p1', writes: ['a'], transientSpecs: { a: SPEC } },
    { id: 'p2', reads: ['a'], writes: ['b'], transientSpecs: { b: SPEC } },
    { id: 'p3', reads: ['b'], writes: ['c'], transientSpecs: { c: SPEC } },
    { id: 'p4', reads: ['c'], writes: ['screen'], sideEffect: true },
  ], OPTS);
  const pool = createPhysicalRenderTargetPool3D(null);
  const seen = {};
  const executors = new Map(['p1', 'p2', 'p3', 'p4'].map(id => [id, ctx => {
    seen[id] = { in: { ...ctx.inputs }, out: { ...ctx.outputs } };
  }]));
  const r1 = executeRenderGraph(g, pool, { executors, externalTargets: { screen: { name: 'screen' } } });
  assert.deepEqual([...r1.executed], ['p1', 'p2', 'p3', 'p4']);
  assert.equal(pool.getStats().allocations, 2);
  assert.equal(pool.getStats().activeCount, 0, 'every target released after use');
  assert.equal(seen.p2.in.a, seen.p1.out.a, 'consumer receives producer target');
  assert.equal(seen.p3.out.c, seen.p1.out.a, 'c aliases a physical target');
  // second frame reuses pooled targets (zero new allocations)
  executeRenderGraph(g, pool, { executors, externalTargets: { screen: {} } });
  assert.equal(pool.getStats().allocations, 2);
  assert.ok(pool.getStats().reuses >= 2);
  assert.ok(pool.getStats().estimatedSavedBytes > 0);
});

test('pool evicts idle targets after maxIdleFrames and disposes them', () => {
  const pool = createPhysicalRenderTargetPool3D(null, { maxIdleFrames: 2 });
  const rt = pool.acquire(SPEC, 'x');
  let disposed = 0;
  rt.dispose = () => { disposed++; };
  pool.release(rt);
  pool.beginFrame(); pool.beginFrame();
  assert.equal(disposed, 0);
  pool.beginFrame();
  assert.equal(disposed, 1);
  assert.equal(pool.getStats().freeCount, 0);
  const rt2 = pool.acquire(SPEC, 'x');
  assert.notEqual(rt2, rt);
});
