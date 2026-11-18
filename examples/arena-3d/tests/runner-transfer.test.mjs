import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import * as THREE from '../../../assets/optional/three/three.module.js';
import { transferRunnerClips } from '../src/runner-transfer.js';

function rig(name, angle, rootY) {
  const root = new THREE.Group();
  const bone = new THREE.Bone();
  bone.name = name;
  bone.position.y = rootY;
  bone.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
  root.add(bone);
  return { root, bone };
}

test('runner animation transfer keeps the target rest pose and reuses the source motion', () => {
  const source = rig('Hip', 0.2, 0.4);
  const target = rig('Pivot', -0.5, 1.2);
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.8);
  const clip = new THREE.AnimationClip('Jump', 1, [
    new THREE.QuaternionKeyframeTrack('Hip.quaternion', [0, 1], [...source.bone.quaternion.toArray(), ...rotation.toArray()]),
    new THREE.VectorKeyframeTrack('Hip.position', [0, 1], [0, 0.4, 0, 0, 0.8, 0]),
  ]);
  const original = clip.tracks.map(track => [...track.values]);
  const [converted] = transferRunnerClips(THREE, { scene: source.root, animations: [clip] },
    target.root, { bones: { Hip: 'Pivot' }, root: 'Hip', motionScale: 1.5 });
  const mixer = new THREE.AnimationMixer(target.root);
  const action = mixer.clipAction(converted).setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  mixer.update(0);
  assert.ok(Math.abs(target.bone.position.y - 1.2) < 1e-6);
  assert.ok(target.bone.quaternion.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.5)) < 1e-6);
  mixer.update(1);
  assert.ok(Math.abs(target.bone.position.y - 1.8) < 1e-6);
  assert.ok(target.bone.quaternion.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.1)) < 1e-6);
  assert.deepEqual(clip.tracks.map(track => [...track.values]), original);
});

test('runner transfer reports an unmapped or ambiguous rig before mounting', () => {
  const source = rig('Hip', 0, 0);
  const clip = new THREE.AnimationClip('Spin', 1, [
    new THREE.QuaternionKeyframeTrack('Hip.quaternion', [0], [0, 0, 0, 1]),
  ]);
  const target = rig('Pivot', 0, 0);
  const asset = { scene: source.root, animations: [clip] };
  assert.throws(() => transferRunnerClips(THREE, asset, target.root, { bones: {} }), /Spin.*Hip/);
  target.root.add(rig('Pivot', 0, 0).bone);
  assert.throws(() => transferRunnerClips(THREE, asset, target.root, { bones: { Hip: 'Pivot' } }), /Pivot.*ambiguous/);
});

test('authoring bone names use the same sanitizer as the GLTF loader', () => {
  const source = rig('ArmL', 0, 0);
  const target = rig('VaneLeft', 0, 0);
  const spin = new THREE.AnimationClip('Spin', 1, [
    new THREE.QuaternionKeyframeTrack('ArmL.quaternion', [0], [0, 0, 0, 1]),
  ]);
  const [clip] = transferRunnerClips(THREE, { scene: source.root, animations: [spin] },
    target.root, { bones: { 'Arm.L': 'Vane.Left' } });
  assert.equal(clip.tracks[0].name, 'VaneLeft.quaternion');
});

test('shipped Scout binds the five original clips with vendored GLTFLoader', async t => {
  const three = new URL('../../../assets/optional/three/three.module.js', import.meta.url);
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      return next(specifier === 'three' ? three.href : specifier, context);
    },
  });
  t.after(() => hooks.deregister());
  const previousProgress = globalThis.ProgressEvent;
  if (!previousProgress) globalThis.ProgressEvent = Event;
  t.after(() => { if (!previousProgress) delete globalThis.ProgressEvent; });
  const { GLTFLoader } = await import('../../../assets/optional/three/jsm/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const base = new URL('../', import.meta.url);
  const parse = async file => loader.parseAsync(await readFile(new URL(file, base), 'utf8'), '');
  const spec = JSON.parse(await readFile(new URL('src/assets/scout.json', base), 'utf8'));
  const [source, target] = await Promise.all([parse(spec.transfer.source), parse(spec.path)]);
  assert.equal(target.animations.length, 0);
  const converted = transferRunnerClips(THREE, source, target.scene, spec.transfer);
  assert.deepEqual(converted.map(clip => clip.name).sort(), ['Hit', 'Idle', 'Jump', 'Run', 'Spin']);
  const mixer = new THREE.AnimationMixer(target.scene);
  const strut = target.scene.getObjectByName('StrutLeft');
  const rest = strut.quaternion.clone();
  mixer.clipAction(converted.find(clip => clip.name === 'Run')).play();
  mixer.update(0.3);
  assert.ok(strut.quaternion.angleTo(rest) > 0.05);
  mixer.stopAllAction();
});
