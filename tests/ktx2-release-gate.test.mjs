import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { encodeKtx2Container, convertPngToKtx2, encodePng, runAssetCli } from '../scripts/process-assets.mjs';
import {
  auditKtx2Textures,
  buildToktxArgs,
  expectedMipLevels,
  inspectKtx2,
  isToktxRequired,
  missingToktxMessage,
  resolveToktxBin,
  VK_FORMAT,
} from '../scripts/lib/toktx.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const createGame = path.join(root, 'scripts', 'create-game.mjs');
const packageGame = path.join(root, 'scripts', 'package-game.mjs');

/** KTX2 v2 header with the given identifying fields and one payload byte. */
function ktx2Header({ vkFormat, width, height, levelCount }) {
  const out = Buffer.alloc(81);
  Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]).copy(out, 0);
  out.writeUInt32LE(vkFormat, 12);
  out.writeUInt32LE(width, 20);
  out.writeUInt32LE(height, 24);
  out.writeUInt32LE(levelCount, 40);
  return out;
}

function solidPng(size) {
  const rgba = new Uint8Array(size * size * 4).fill(255);
  return encodePng({ width: size, height: size, data: rgba });
}

/** Stands in for toktx: records the call and writes a compressed container sized like the input PNG. */
function stubToktx() {
  const calls = [];
  const exec = (bin, args) => {
    calls.push({ bin, args });
    const output = args[args.length - 2];
    const input = fs.readFileSync(args[args.length - 1]);
    const width = input.readUInt32BE(16);
    const height = input.readUInt32BE(20);
    fs.writeFileSync(output, ktx2Header({
      vkFormat: args.includes('uastc') ? VK_FORMAT.ASTC_4x4_UNORM_BLOCK : VK_FORMAT.ETC2_R8G8B8A8_UNORM_BLOCK,
      width,
      height,
      levelCount: args.includes('--genmipmap') ? expectedMipLevels(width, height) : 1,
    }));
    return { status: 0, stdout: '', stderr: '' };
  };
  return { calls, exec };
}

function withTempDir(prefix, run) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return run(tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('inspectKtx2 classifies compressed formats and mip chains', () => {
  const raw = encodeKtx2Container({ width: 8, height: 8, data: new Uint8Array(8 * 8 * 4) });
  assert.deepEqual(inspectKtx2(raw), {
    vkFormat: VK_FORMAT.R8G8B8A8_UNORM, pixelWidth: 8, pixelHeight: 8, levelCount: 1,
    compressed: false, fullMipChain: false,
  });

  const uastc = inspectKtx2(ktx2Header({ vkFormat: VK_FORMAT.ASTC_4x4_UNORM_BLOCK, width: 256, height: 256, levelCount: 9 }));
  assert.equal(uastc.compressed, true);
  assert.equal(uastc.fullMipChain, true);
  assert.equal(inspectKtx2(ktx2Header({ vkFormat: VK_FORMAT.ETC2_R8G8B8_UNORM_BLOCK, width: 4, height: 4, levelCount: 3 })).compressed, true);
  assert.equal(inspectKtx2(ktx2Header({ vkFormat: VK_FORMAT.ETC2_R8G8B8A8_UNORM_BLOCK, width: 256, height: 256, levelCount: 4 })).fullMipChain, false);

  assert.deepEqual(
    [expectedMipLevels(1, 1), expectedMipLevels(4, 4), expectedMipLevels(256, 128), expectedMipLevels(100, 64)],
    [1, 3, 9, 7],
  );
  assert.throws(() => inspectKtx2(Buffer.alloc(40)), /KTX2 v2 container/);
});

test('buildToktxArgs encodes colour as ETC1S sRGB and normal/roughness maps as UASTC linear', () => {
  assert.deepEqual(
    buildToktxArgs({ input: 'a.png', output: 'a.ktx2' }),
    ['--t2', '--encode', 'etc1s', '--qlevel', '160', '--clevel', '2', '--assign_oetf', 'srgb', '--genmipmap', 'a.ktx2', 'a.png'],
  );
  assert.deepEqual(
    buildToktxArgs({ input: 'n.png', output: 'n.ktx2', kind: 'normal_rm', uastcQuality: 3 }),
    ['--t2', '--encode', 'uastc', '--uastc_quality', '3', '--zcmp', '18', '--assign_oetf', 'linear', '--genmipmap', 'n.ktx2', 'n.png'],
  );
});

test('resolveToktxBin prefers TOKTX_BIN, then .hgame.local.json, then PATH', () => {
  withTempDir('hgame-toktx-', (tmp) => {
    const exe = process.platform === 'win32' ? 'toktx.exe' : 'toktx';
    const onPath = path.join(tmp, 'bin', exe);
    const configured = path.join(tmp, 'cfg', exe);
    const explicit = path.join(tmp, 'explicit', exe);
    for (const file of [onPath, configured, explicit]) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '');
    }
    const configPath = path.join(tmp, '.hgame.local.json');
    fs.writeFileSync(configPath, JSON.stringify({ toktxPath: configured }));
    const missingConfig = path.join(tmp, 'missing.json');
    const env = { PATH: path.dirname(onPath) };

    assert.equal(resolveToktxBin({ env: {}, configPath: missingConfig }), null);
    assert.equal(resolveToktxBin({ env: {}, configPath }), path.resolve(configured));
    assert.equal(resolveToktxBin({ env, configPath: missingConfig }), path.resolve(onPath));
    assert.equal(resolveToktxBin({ env: { ...env, TOKTX_BIN: explicit }, configPath }), path.resolve(explicit));
    // A stale TOKTX_BIN does not hide the remaining candidates.
    assert.equal(
      resolveToktxBin({ env: { ...env, TOKTX_BIN: path.join(tmp, 'gone', exe) }, configPath }),
      path.resolve(configured),
    );
  });

  assert.equal(isToktxRequired({ env: {} }), false);
  assert.equal(isToktxRequired({ env: { HGAME_REQUIRE_TOKTX: '0' } }), false);
  assert.equal(isToktxRequired({ env: { HGAME_REQUIRE_TOKTX: '1' } }), true);
  assert.equal(isToktxRequired({ env: { HGAME_REQUIRE_TOKTX: 'true' } }), true);
  assert.match(missingToktxMessage('albedo.ktx2'), /required to encode albedo\.ktx2.*TOKTX_BIN/);
});

test('convertPngToKtx2 encodes with toktx by default and never falls back when toktx fails', () => {
  withTempDir('hgame-ktx2-encode-', (tmp) => {
    const pngPath = path.join(tmp, 'albedo.png');
    const outPath = path.join(tmp, 'albedo.ktx2');
    const nrmPath = path.join(tmp, 'normal_rm.ktx2');
    fs.writeFileSync(pngPath, solidPng(32));

    const stub = stubToktx();
    const res = convertPngToKtx2(pngPath, outPath, { toktxBin: 'toktx', exec: stub.exec });
    assert.equal(res.encoder, 'toktx');
    assert.equal(res.warning, null);
    assert.deepEqual(stub.calls[0], { bin: 'toktx', args: buildToktxArgs({ input: pngPath, output: outPath }) });
    const encoded = inspectKtx2(fs.readFileSync(outPath));
    assert.deepEqual([encoded.compressed, encoded.fullMipChain], [true, true]);

    convertPngToKtx2(pngPath, nrmPath, { kind: 'normal_rm', toktxBin: 'toktx', exec: stub.exec });
    assert.ok(stub.calls[1].args.includes('uastc'));

    fs.rmSync(outPath);
    assert.throws(
      () => convertPngToKtx2(pngPath, outPath, { toktxBin: 'toktx', exec: () => ({ status: 2, stderr: 'unsupported input' }) }),
      /toktx failed \(exit 2\) on albedo\.png: unsupported input/,
    );
    assert.equal(fs.existsSync(outPath), false, 'a failing toktx must not leave an uncompressed file behind');
  });
});

test('a missing toktx warns and falls back for development, but is an error when required', () => {
  withTempDir('hgame-ktx2-missing-', (tmp) => {
    const pngPath = path.join(tmp, 'albedo.png');
    const outPath = path.join(tmp, 'albedo.ktx2');
    fs.writeFileSync(pngPath, solidPng(8));

    const warnings = [];
    const res = convertPngToKtx2(pngPath, outPath, { toktxBin: null, warn: (message) => warnings.push(message) });
    assert.equal(res.encoder, 'built-in-ktx2');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /uncompressed single-level/);
    assert.match(res.warning, /release packaging rejects/);
    assert.equal(inspectKtx2(fs.readFileSync(outPath)).compressed, false);

    assert.throws(
      () => convertPngToKtx2(pngPath, outPath, { toktxBin: null, requireToktx: true }),
      /toktx \(KTX-Software\) is required/,
    );
    assert.throws(
      () => convertPngToKtx2(pngPath, outPath, {
        toktxBin: null, requireToktx: isToktxRequired({ env: { HGAME_REQUIRE_TOKTX: '1' } }),
      }),
      /required to encode albedo\.ktx2/,
    );

    // Opting out of toktx is a deliberate choice, so it stays silent.
    const silent = [];
    convertPngToKtx2(pngPath, outPath, { preferToktx: false, warn: (message) => silent.push(message) });
    assert.equal(silent.length, 0);

    const cliOut = path.join(tmp, 'cli.ktx2');
    const cli = runAssetCli(['--ktx2', pngPath, '--out', cliOut, '--no-toktx']);
    assert.equal(cli.encoder, 'built-in-ktx2');
    assert.equal(inspectKtx2(fs.readFileSync(cliOut)).pixelWidth, 8);
  });
});

test('auditKtx2Textures rejects uncompressed or mip-less release textures', () => {
  const passed = auditKtx2Textures([
    ['assets/pbr/albedo.ktx2', ktx2Header({ vkFormat: VK_FORMAT.ETC2_R8G8B8A8_UNORM_BLOCK, width: 256, height: 256, levelCount: 9 })],
    ['assets/pbr/normal_rm.ktx2', ktx2Header({ vkFormat: VK_FORMAT.ASTC_4x4_UNORM_BLOCK, width: 256, height: 256, levelCount: 9 })],
    ['assets/ui/icon.png', Buffer.alloc(16)],
  ]);
  assert.equal(passed.ok, true);
  assert.deepEqual(passed.files.map((file) => file.path), ['assets/pbr/albedo.ktx2', 'assets/pbr/normal_rm.ktx2']);

  const rejected = auditKtx2Textures([
    ['assets/raw.ktx2', encodeKtx2Container({ width: 8, height: 8, data: new Uint8Array(8 * 8 * 4) })],
    ['assets/nomip.ktx2', ktx2Header({ vkFormat: VK_FORMAT.ETC2_R8G8B8A8_UNORM_BLOCK, width: 64, height: 64, levelCount: 1 })],
    ['assets/tiny.ktx2', ktx2Header({ vkFormat: VK_FORMAT.ETC2_R8G8B8_UNORM_BLOCK, width: 4, height: 4, levelCount: 1 })],
    ['assets/broken.ktx2', Buffer.alloc(40)],
  ]);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.failures.length, 3);
  assert.match(rejected.failures[0], /assets\/raw\.ktx2.*uncompressed/);
  assert.match(rejected.failures[1], /assets\/nomip\.ktx2.*no mip chain/);
  assert.match(rejected.failures[2], /assets\/broken\.ktx2/);

  assert.deepEqual(auditKtx2Textures([['assets/only.png', Buffer.alloc(4)]]), { ok: true, files: [], failures: [] });
});

test('package-game refuses to write a release containing uncompressed KTX2 unless explicitly allowed', () => {
  withTempDir('hgame-ktx2-gate-', (tmp) => {
    const game = path.join(tmp, 'arena');
    const generated = spawnSync(process.execPath, [createGame, game, '--profile', '3d', '--bare', '--no-git'],
      { encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr || generated.stdout);

    const outDir = path.join(tmp, 'build');
    const texture = path.join(game, 'assets', 'pbr', 'albedo.ktx2');
    fs.mkdirSync(path.dirname(texture), { recursive: true });
    const build = (tag, options = []) => spawnSync(process.execPath,
      [packageGame, game, '--version', '1.0', '--tag', tag, '--out-dir', outDir, ...options], { encoding: 'utf8' });

    fs.writeFileSync(texture, encodeKtx2Container({ width: 8, height: 8, data: new Uint8Array(8 * 8 * 4) }));
    const blocked = build('blocked');
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /KTX2 release audit failed/);
    assert.match(blocked.stderr, /assets\/pbr\/albedo\.ktx2.*uncompressed/);
    assert.equal(fs.existsSync(path.join(outDir, 'blocked')), false, 'no release directory is written');
    assert.equal(fs.existsSync(path.join(outDir, 'blocked.zip')), false, 'no release zip is written');

    const allowed = build('allowed', ['--allow-uncompressed-ktx2']);
    assert.equal(allowed.status, 0, allowed.stderr || allowed.stdout);
    assert.equal(JSON.parse(allowed.stdout).ktx2, null);

    const compressed = ktx2Header({ vkFormat: VK_FORMAT.ETC2_R8G8B8A8_UNORM_BLOCK, width: 64, height: 64, levelCount: 7 });
    fs.writeFileSync(texture, compressed);
    const passed = build('passed');
    assert.equal(passed.status, 0, passed.stderr || passed.stdout);
    assert.deepEqual(JSON.parse(passed.stdout).ktx2, { files: 1, compressed: 1, fullMipChains: 1, bytes: compressed.length });
    assert.deepEqual(fs.readFileSync(path.join(outDir, 'passed', 'assets', 'pbr', 'albedo.ktx2')), compressed);
  });
});
