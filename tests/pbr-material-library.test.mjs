import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../assets/optional/three/three.module.js';
import { loadCuratedPbrLibrary } from '../assets/runtime/integrations/pbr-material-library.js';

const image = (hex, extension = 'png') => `textures/${hex.repeat(64)}.${extension}`;
const catalog = {
  version: 1,
  materials: [
    { id: 'stone', name: 'Stone', category: 'masonry', color: image('a', 'webp'), normal: image('b'), orm: image('c'), tileSize: 1 },
    { id: 'brick', name: 'Brick', category: 'masonry', color: image('a', 'webp'), normal: image('b'), orm: image('c'), tileSize: 1 },
  ],
};

function makeTexture() {
  return new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1, THREE.RGBAFormat);
}

test('curated PBR loader validates catalogs, shares texture URLs and disposes owned resources', async () => {
  const urls = [];
  const textures = [];
  const loader = {
    async loadAsync(url) {
      urls.push(url);
      const texture = makeTexture();
      textures.push(texture);
      return texture;
    },
  };
  const lib = await loadCuratedPbrLibrary({
    THREE,
    catalogUrl: 'http://localhost:4176/assets/pbr-materials/catalog.json',
    fetchJson: async url => {
      assert.equal(url, 'http://localhost:4176/assets/pbr-materials/catalog.json');
      return catalog;
    },
    textureLoader: loader,
  });

  assert.deepEqual(lib.list().map(item => item.id), ['stone', 'brick']);
  const stone = await lib.get('stone');
  assert.equal(await lib.get('stone'), stone);
  const brick = await lib.get('brick');
  assert.notEqual(brick, stone);
  assert.equal(urls.length, 3, 'shared content paths load once');
  assert.deepEqual(textures.map(texture => texture.colorSpace), [
    THREE.SRGBColorSpace, THREE.NoColorSpace, THREE.NoColorSpace,
  ]);
  assert.deepEqual(lib.stats, { materials: 2, textures: 3, entries: 2 });

  await assert.rejects(lib.get('missing'), /Unknown curated material/);
  await assert.rejects(lib.get('stone', { tileSize: 0 }), /Invalid PBR parameter/);
  await lib.dispose();
  assert.deepEqual(lib.stats, { materials: 0, textures: 0, entries: 2 });
  assert.equal(stone.userData.pbr.maps.color, textures[0]);
  await assert.rejects(lib.get('stone'), /disposed/);
});

test('curated PBR loader rejects unsafe paths, duplicate IDs and non-HTTP catalog URLs', async () => {
  const base = {
    THREE,
    catalogUrl: 'http://localhost/catalog.json',
    textureLoader: { async loadAsync() { return makeTexture(); } },
  };
  await assert.rejects(loadCuratedPbrLibrary({
    ...base,
    fetchJson: async () => ({ version: 1, materials: [{ ...catalog.materials[0], color: '../secret.png' }] }),
  }), /Invalid or duplicate/);
  await assert.rejects(loadCuratedPbrLibrary({
    ...base,
    fetchJson: async () => ({ version: 1, materials: [catalog.materials[0], catalog.materials[0]] }),
  }), /Invalid or duplicate/);
  await assert.rejects(loadCuratedPbrLibrary({
    ...base,
    catalogUrl: 'file:///private/catalog.json',
    fetchJson: async () => catalog,
  }), /HTTP\(S\)/);
});
