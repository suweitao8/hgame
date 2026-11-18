import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';
import { createGameApplication, Entity, Scene } from '../assets/runtime/index.js';
import { createModel3DProvider } from '../assets/runtime/integrations/model3d.js';

function monitor(resource) {
  let calls = 0;
  resource.addEventListener('dispose', () => { calls++; });
  return () => calls;
}

test('Model3D keeps replaced assets usable and disposes shared owned resources once', async () => {
  const provider = createModel3DProvider({ THREE });
  const texture = new THREE.Texture();
  const material = new THREE.MeshBasicMaterial({ map: texture, alphaMap: texture });
  const first = new THREE.BoxGeometry();
  const second = new THREE.BoxGeometry();
  const borrowed = new THREE.BoxGeometry();
  const counts = [first, second, material, texture, borrowed].map(monitor);
  const oldModel = new THREE.Group();
  oldModel.add(new THREE.Mesh(first, material), new THREE.Mesh(first, material));
  provider.registerAsset('hero', { scene: oldModel, owned: true });
  const instance = await provider.instantiate('hero');
  provider.registerAsset('hero', { scene: new THREE.Mesh(second, material), owned: true });
  provider.registerAsset('borrowed', { scene: new THREE.Mesh(borrowed) });
  assert.equal(instance.root.children[0].geometry, first);
  assert.equal((await provider.instantiate('hero')).root.geometry, second);
  assert.deepEqual(counts.map(count => count()), [0, 0, 0, 0, 0]);
  assert.equal(await provider.dispose(), true);
  assert.deepEqual(counts.map(count => count()), [1, 1, 1, 1, 0]);
  assert.equal(await provider.dispose(), false);
  borrowed.dispose();
});

test('Model3D disposal drains a superseded load and does not return a disposed asset', async () => {
  const loaderStarted = Promise.withResolvers();
  const loaded = Promise.withResolvers();
  const slowGeometry = new THREE.BoxGeometry();
  const replacementGeometry = new THREE.BoxGeometry();
  const sharedMaterial = new THREE.MeshBasicMaterial();
  const slowCount = monitor(slowGeometry);
  const replacementCount = monitor(replacementGeometry);
  const materialCount = monitor(sharedMaterial);
  const provider = createModel3DProvider({ THREE, loader: { loadAsync: () => {
    loaderStarted.resolve();
    return loaded.promise;
  } } });
  const pending = provider.load('hero.glb');
  await loaderStarted.promise;
  provider.registerAsset('hero.glb', { scene: new THREE.Mesh(replacementGeometry, sharedMaterial), owned: true });
  const rejected = assert.rejects(pending, /disposed/i);
  const teardown = provider.dispose();
  const replacementBeforeLoadFinishes = replacementCount();
  loaded.resolve({ scene: new THREE.Mesh(slowGeometry, sharedMaterial) });
  await rejected;
  assert.equal(await teardown, true);
  assert.equal(slowCount(), 1);
  assert.equal(replacementCount(), 1);
  assert.equal(replacementBeforeLoadFinishes, 1, 'ready models should release before waiting for a loader');
  assert.equal(materialCount(), 1, 'late and ready models share one material disposal');
});

test('Model3D cannot return a cached asset or produce a clone after disposal begins', async () => {
  const provider = createModel3DProvider({ THREE });
  provider.registerAsset('hero', { scene: new THREE.Group(), owned: true });
  const asset = provider.load('hero');
  const instance = provider.instantiate('hero');
  const rejected = [asset, instance].map(request => assert.rejects(request, /disposed/i));
  assert.equal(await provider.dispose(), true);
  await Promise.all(rejected);
});

test('Model3D continues releasing owned resources when one dispose listener throws', async () => {
  const provider = createModel3DProvider({ THREE });
  const failed = new THREE.BoxGeometry();
  const healthy = new THREE.BoxGeometry();
  const count = monitor(healthy);
  const error = new Error('geometry dispose listener');
  failed.addEventListener('dispose', () => { throw error; });
  const root = new THREE.Group();
  root.add(new THREE.Mesh(failed), new THREE.Mesh(healthy));
  provider.registerAsset('owned', { scene: root, owned: true });
  await assert.rejects(provider.dispose(), failure => failure === error || failure.errors?.includes(error));
  assert.equal(count(), 1);
  assert.equal(await provider.dispose(), false);
});

test('an application reports an asynchronous Model3D disposal failure through diagnostics', async () => {
  const provider = createModel3DProvider({ THREE });
  const failed = new THREE.BoxGeometry();
  failed.addEventListener('dispose', () => { throw new Error('broken model teardown'); });
  provider.registerAsset('mesh', { scene: new THREE.Mesh(failed), owned: true });
  let releasedRenderer = false;
  const app = createGameApplication({ project: { profile: '3d', physics: 'none', features: ['scene', 'model3d'] },
    renderer: { render() {}, dispose() { releasedRenderer = true; } } });
  await app.installFeatures({ model3d: provider });
  assert.equal(app.dispose(), true);
  assert.equal(releasedRenderer, true);
  await new Promise(resolve => setImmediate(resolve));
  const diagnostics = app.platform.diagnostics.snapshot();
  assert.equal(diagnostics.errorCount, 1);
  assert.equal(diagnostics.lastError.context.service, 'model3d');
});

test('destroying an inactive Model3D component before awake is safe', async () => {
  const provider = createModel3DProvider({ THREE });
  const entity = new Entity({ active: false });
  const component = entity.addComponent(provider.createComponent({ root: new THREE.Group() }));
  assert.equal(component.modelRoot, undefined);
  assert.equal(entity.destroy(), true);
  assert.equal(await provider.dispose(), true);
});

function skinnedMesh() {
  const geometry = new THREE.BoxGeometry();
  const vertices = geometry.getAttribute('position').count;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(vertices * 4), 4));
  const weights = new Float32Array(vertices * 4);
  for (let i = 0; i < vertices; i++) weights[i * 4] = 1;
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  const bone = new THREE.Bone();
  mesh.add(bone);
  mesh.bind(new THREE.Skeleton([bone]));
  mesh.skeleton.computeBoneTexture();
  return mesh;
}

test('destroying a cloned Model3D component releases its private bone texture only', async () => {
  const mesh = skinnedMesh();
  const sourceTexture = monitor(mesh.skeleton.boneTexture);
  const sourceGeometry = monitor(mesh.geometry);
  const provider = createModel3DProvider({ THREE });
  const asset = provider.registerAsset('rig', { scene: mesh, owned: true });
  const scene = new Scene('playing');
  const entity = scene.add(new Entity());
  const cloned = entity.addComponent(provider.createComponent({ asset }));
  const borrowed = scene.add(new Entity());
  borrowed.addComponent(provider.createComponent({ root: mesh }));
  scene._setActive(true);
  const clonedSkeleton = cloned.modelRoot.skeleton;
  assert.notEqual(clonedSkeleton, mesh.skeleton);
  clonedSkeleton.computeBoneTexture();
  const cloneTexture = monitor(clonedSkeleton.boneTexture);
  entity.destroy();
  borrowed.destroy();
  assert.deepEqual([cloneTexture(), sourceTexture(), sourceGeometry()], [1, 0, 0]);
  await provider.dispose();
  assert.deepEqual([cloneTexture(), sourceTexture(), sourceGeometry()], [1, 1, 1]);
});

test('custom model cloners retain ownership of their skeleton and borrowed bone texture', async () => {
  const mesh = skinnedMesh();
  const sourceTexture = monitor(mesh.skeleton.boneTexture);
  const provider = createModel3DProvider({ THREE, cloneSkeleton(source) {
    const clone = source.clone();
    clone.skeleton = source.skeleton.clone();
    clone.skeleton.boneTexture = source.skeleton.boneTexture;
    return clone;
  } });
  const asset = provider.registerAsset('external', { scene: mesh });
  const scene = new Scene('playing');
  const entity = scene.add(new Entity());
  const component = entity.addComponent(provider.createComponent({ asset }));
  scene._setActive(true);
  const clonedSkeleton = component.modelRoot.skeleton;
  assert.notEqual(clonedSkeleton, mesh.skeleton);
  entity.destroy();
  await provider.dispose();
  assert.equal(clonedSkeleton.boneTexture, mesh.skeleton.boneTexture);
  assert.equal(sourceTexture(), 0);
  mesh.skeleton.dispose();
});

test('a bone texture shared across owned skeletons and a material is disposed once', async () => {
  const provider = createModel3DProvider({ THREE });
  const texture = new THREE.DataTexture(new Float32Array(16), 2, 2, THREE.RGBAFormat, THREE.FloatType);
  const count = monitor(texture);
  const root = new THREE.Group();
  const skeletons = [new THREE.Skeleton(), new THREE.Skeleton()];
  for (const skeleton of skeletons) {
    const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ map: texture }));
    skeleton.boneTexture = texture;
    mesh.skeleton = skeleton;
    root.add(mesh);
  }
  provider.registerAsset('shared', { scene: root, owned: true });
  await provider.dispose();
  assert.equal(count(), 1);
  assert.deepEqual(skeletons.map(skeleton => skeleton.boneTexture), [null, null]);
});
