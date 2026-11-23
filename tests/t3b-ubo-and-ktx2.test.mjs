import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from '../assets/optional/three/three.module.js';
import {
  KTX2_MAGIC,
  detectCompressedTextureSupport,
  parseKtx2Header,
  selectOptimalTextureVariant,
  createCompressedTextureFromMipData,
} from '../assets/runtime/index.js';
import { createMaterialBatchRegistry3D, createComposableMaterial3D } from '../assets/runtime/integrations/material-graph3d.js';

test('Phase T3-B: createMaterialBatchRegistry3D attaches UniformsGroup UBO with real THREE and safely falls back without THREE', () => {
  const noThreeBatch = createMaterialBatchRegistry3D({ uTime: 0, uFogDensity: 0.01 });
  assert.equal(noThreeBatch.uboGroup, null);
  assert.equal(noThreeBatch.getStats().uboEnabled, false);
  noThreeBatch.updateFrame(0.05);
  assert.ok(Math.abs(noThreeBatch.sharedBlock.get('uTime') - 0.05) < 1e-6);

  const uboBatch = createMaterialBatchRegistry3D({ uTime: 0, uFogDensity: 0.02 }, { THREE });
  assert.ok(uboBatch.uboGroup && uboBatch.uboGroup.isUniformsGroup);
  assert.equal(uboBatch.getStats().uboEnabled, true);
  assert.equal(uboBatch.getStats().uboGroupName, 'HGamePerFrameUBO');

  const mat = createComposableMaterial3D(THREE, { color: 0x38bdf8, sharedBlock: uboBatch.sharedBlock });
  assert.equal(uboBatch.register(mat), true);
  assert.ok(Array.isArray(mat.uniformsGroups) && mat.uniformsGroups.includes(uboBatch.uboGroup));
  assert.equal(typeof mat.onBeforeCompile, 'function');

  uboBatch.updateFrame(0.016, { uFogDensity: 0.04 });
  assert.ok(Math.abs(uboBatch.uboGroup.uniforms[0].value - 0.016) < 1e-6);
  assert.ok(Math.abs(uboBatch.uboGroup.uniforms[1].value - 0.04) < 1e-6);

  assert.equal(uboBatch.unregister(mat), true);
  assert.equal(mat.uniformsGroups.includes(uboBatch.uboGroup), false);
});

test('Phase T3-B: KTX2 header parsing, WebGL extension detection, and variant priority selection work end-to-end', () => {
  const buf = new ArrayBuffer(80);
  const bytes = new Uint8Array(buf);
  bytes.set(KTX2_MAGIC, 0);
  const view = new DataView(buf);
  view.setUint32(12, 165, true); // vkFormat (e.g. ASTC_4x4)
  view.setUint32(16, 1, true);   // typeSize
  view.setUint32(20, 1024, true); // pixelWidth
  view.setUint32(24, 1024, true); // pixelHeight
  view.setUint32(28, 0, true);    // pixelDepth
  view.setUint32(32, 0, true);    // layerCount
  view.setUint32(36, 1, true);    // faceCount
  view.setUint32(40, 11, true);   // levelCount
  view.setUint32(44, 1, true);    // supercompressionScheme (BasisLZ)

  const header = parseKtx2Header(buf);
  assert.equal(header.vkFormat, 165);
  assert.equal(header.pixelWidth, 1024);
  assert.equal(header.pixelHeight, 1024);
  assert.equal(header.levelCount, 11);
  assert.equal(header.supercompressionScheme, 1);

  assert.throws(() => parseKtx2Header(new ArrayBuffer(32)), /Truncated KTX2/);
  assert.throws(() => parseKtx2Header(new ArrayBuffer(80)), /Invalid KTX2 magic/);

  const mockMobileGl = {
    MAX_TEXTURE_SIZE: 0x0d33,
    getExtension(name) {
      return name === 'WEBGL_compressed_texture_astc' || name === 'WEBGL_compressed_texture_etc' ? {} : null;
    },
    getParameter() { return 4096; },
  };
  const support = detectCompressedTextureSupport(mockMobileGl);
  assert.equal(support.astc, true);
  assert.equal(support.etc2, true);
  assert.equal(support.preferred, 'astc');
  assert.equal(support.vramSavingsRatio, 4.0);
  assert.equal(support.maxTextureSize, 4096);

  const chosenAstc = selectOptimalTextureVariant({
    astc: 'tex.astc.ktx2',
    etc2: 'tex.etc2.ktx2',
    fallback: 'tex.webp',
  }, support);
  assert.equal(chosenAstc.format, 'astc');
  assert.equal(chosenAstc.url, 'tex.astc.ktx2');
  assert.equal(chosenAstc.compressed, true);

  const chosenFallback = selectOptimalTextureVariant({ fallback: 'tex.webp' }, detectCompressedTextureSupport(null));
  assert.equal(chosenFallback.format, 'fallback');
  assert.equal(chosenFallback.compressed, false);

  const desc = createCompressedTextureFromMipData(null, { width: 512, height: 512, format: 0x93b0, mipmaps: [{}, {}] });
  assert.equal(desc.mipCount, 2);
});
