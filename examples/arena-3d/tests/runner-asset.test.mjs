import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadRunnerView, validateRunnerClips } from '../src/runner-view.js';

const bindings = { idle: 'Idle', run: 'Run', jump: 'Jump', spin: 'Spin', hit: 'Hit' };
const clips = Object.values(bindings).map(name => ({ name, duration: 1 }));

test('the authored runner ships with its rig, material data, and gameplay clips', async () => {
  const source = await readFile(new URL('../src/assets/runner.gltf', import.meta.url), 'utf8');
  const model = JSON.parse(source);
  assert.equal(model.asset.version, '2.0');
  assert.ok(model.skins.some(skin => skin.joints.length >= 7));
  assert.deepEqual(model.animations.map(clip => clip.name).sort(), ['Hit', 'Idle', 'Jump', 'Run', 'Spin']);
  assert.ok(model.buffers.every(buffer => buffer.uri.startsWith('data:application/octet-stream;base64,')));
  const vertices = new Set(model.meshes.flatMap(mesh => mesh.primitives.map(primitive => primitive.attributes.POSITION)));
  const vertexCount = [...vertices].reduce((sum, accessor) => sum + model.accessors[accessor].count, 0);
  assert.ok(vertexCount > 0 && vertexCount <= 3000, `runner vertex count: ${vertexCount}`);
});

test('runner clip validation names missing and ambiguous replacement bindings', () => {
  assert.deepEqual(validateRunnerClips(clips, bindings), bindings);
  assert.throws(() => validateRunnerClips(clips, { ...bindings, hit: 'Damage' }), /hit.*Damage.*Idle.*Hit/i);
  assert.throws(() => validateRunnerClips([...clips, clips[0]], bindings), /idle.*Idle.*ambiguous/i);
});

test('the procedural runner survives an invisible model or failed component attachment', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ path: 'hero.gltf', clips: bindings }) }));
  const trace = [];
  let destroyed = false;
  const actor = { addComponent() { throw new Error('broken rig activation'); }, destroy() { destroyed = true; } };
  const view = { provider: { load: async () => ({ animations: clips }), inspect: () => ({ meshCount: 0 }), createComponent: () => ({}) },
    scene: { add: () => actor }, Entity: class {}, record: event => trace.push(event), getTick: () => 0 };
  assert.equal(await loadRunnerView(view), null);
  assert.match(trace.at(-1).details.reason, /no renderable meshes/);
  assert.equal(destroyed, false);
  view.provider.inspect = () => ({ meshCount: 1 });
  assert.equal(await loadRunnerView(view), null);
  assert.match(trace.at(-1).details.reason, /broken rig activation/);
  assert.equal(destroyed, true);
  assert.ok(trace.every(event => event.type === 'asset.failed'));
});

test('shared clips only emit the spin notify when spinning and the fatal hit still plays', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ path: 'hero.gltf', clips: { ...bindings, spin: 'Run' } }) }));
  const trace = [];
  let notify;
  const runner = await loadRunnerView({
    provider: {
      load: async () => ({ animations: clips }), inspect: () => ({ meshCount: 1 }),
      createComponent: options => { notify = options.onNotify; return { play: () => true, updateTransform() {} }; },
    },
    scene: { add: () => ({ addComponent() {} }) }, Entity: class {}, record: event => trace.push(event), getTick: () => 0,
  });
  const player = { x: 0, y: 0, z: 0, vx: 2, vz: 0, yaw: 0, grounded: true, invuln: 0, spinT: 0 };
  runner.sync(player, { tick: 1, over: false }, 0.6);
  notify({ clipName: 'Run', name: 'spin.arc' });
  assert.equal(trace.some(event => event.type === 'animation.notify'), false);
  runner.sync({ ...player, spinT: 0.25 }, { tick: 2, over: false }, 0.6);
  notify({ clipName: 'Run', name: 'spin.arc' });
  assert.equal(trace.some(event => event.type === 'animation.notify'), true);
  runner.sync({ ...player, invuln: 0.6 }, { tick: 3, over: true }, 0.6);
  assert.equal(runner.role, 'hit');
});
