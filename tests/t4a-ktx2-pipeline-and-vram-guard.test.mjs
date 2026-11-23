import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createStreamingResidencyPolicy, createVramMipGuard, parseKtx2Header } from '../assets/runtime/index.js';
import { encodePng, encodeKtx2Container, convertPngToKtx2, runAssetCli } from '../scripts/process-assets.mjs';

test('Phase T4-A: KTX2 offline container encoder and PNG->KTX2 CLI round-trip cleanly', () => {
  const w = 8;
  const h = 8;
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 64; rgba[i + 1] = 196; rgba[i + 2] = 255; rgba[i + 3] = 255;
  }

  const ktxBuf = encodeKtx2Container({ width: w, height: h, data: rgba });
  const header = parseKtx2Header(ktxBuf);
  assert.equal(header.vkFormat, 37);
  assert.equal(header.pixelWidth, 8);
  assert.equal(header.pixelHeight, 8);
  assert.equal(header.faceCount, 1);
  assert.equal(header.levelCount, 1);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hgame-ktx2-'));
  try {
    const pngPath = path.join(tmpDir, 'albedo.png');
    const outPath = path.join(tmpDir, 'albedo.ktx2');
    fs.writeFileSync(pngPath, encodePng({ width: w, height: h, data: rgba }));

    const conv = convertPngToKtx2(pngPath, outPath, { preferToktx: false });
    assert.equal(conv.width, 8);
    assert.equal(conv.height, 8);
    assert.equal(conv.encoder, 'built-in-ktx2');
    assert.equal(fs.existsSync(outPath), true);

    const parsed = parseKtx2Header(fs.readFileSync(outPath));
    assert.equal(parsed.pixelWidth, 8);
    assert.equal(parsed.pixelHeight, 8);

    const cliOut = path.join(tmpDir, 'cli.ktx2');
    const cliRes = runAssetCli(['--ktx2', pngPath, '--out', cliOut]);
    assert.equal(cliRes.outputPath, cliOut);
    assert.equal(parseKtx2Header(fs.readFileSync(cliOut)).pixelWidth, 8);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Phase T4-A: createVramMipGuard escalates mip bias on soft/hard pressure and recovers cleanly', () => {
  const policy = createStreamingResidencyPolicy({ maxBytes: 1024 * 1024, nearDistance: 10, midDistance: 30, farDistance: 60 });
  policy.register('heroTex', { position: { x: 0, y: 0, z: 0 }, baseBytes: 512 * 1024, priority: 10 });
  policy.update({ x: 0, y: 0, z: 0 });
  assert.equal(policy.getEntry('heroTex').mipBias, 0);

  const transitions = [];
  const guard = createVramMipGuard({
    streamingPolicy: policy,
    budgetBytes: 100 * 1024 * 1024,
    softRatio: 0.8,
    hardRatio: 0.92,
    onMipBiasChange: (evt) => transitions.push(evt),
  });

  // Healthy (< 68MB)
  assert.equal(guard.step(40 * 1024 * 1024).state, 'healthy');
  assert.equal(policy.getEntry('heroTex').mipBias, 0);

  // Soft degrade (>= 80MB)
  const soft = guard.step(82 * 1024 * 1024);
  assert.equal(soft.state, 'soft-degrade');
  assert.equal(soft.mipBiasOffset, 1);
  assert.equal(soft.changed, true);
  policy.update({ x: 0, y: 0, z: 0 });
  assert.equal(policy.getEntry('heroTex').mipBias, 1);

  // Hard degrade (>= 92MB)
  const hard = guard.step(95 * 1024 * 1024);
  assert.equal(hard.state, 'hard-degrade');
  assert.equal(hard.mipBiasOffset, 2);
  policy.update({ x: 0, y: 0, z: 0 });
  assert.equal(policy.getEntry('heroTex').mipBias, 2);

  // Hysteresis hold at 75MB (above soft * 0.85 = 68MB)
  assert.equal(guard.step(75 * 1024 * 1024).mipBiasOffset, 2);

  // Full recovery below 68MB
  const rec = guard.step(50 * 1024 * 1024);
  assert.equal(rec.state, 'healthy');
  assert.equal(rec.mipBiasOffset, 0);
  policy.update({ x: 0, y: 0, z: 0 });
  assert.equal(policy.getEntry('heroTex').mipBias, 0);
  assert.equal(transitions.length, 3);
});
