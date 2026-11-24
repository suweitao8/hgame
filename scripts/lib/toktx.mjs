import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Shared KTX-Software `toktx` helpers for the offline texture pipeline: binary lookup,
// encode arguments and the KTX2 header audit behind the release packaging gate.

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const KTX2_MAGIC = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
const KTX2_HEADER_BYTES = 80;

/** vkFormat values as stored at byte 12 of a KTX2 header. */
export const VK_FORMAT = Object.freeze({
  R8G8B8A8_UNORM: 37,              // raw RGBA8: what the built-in container writer emits
  ETC2_R8G8B8_UNORM_BLOCK: 147,    // ETC1S without alpha
  ASTC_4x4_UNORM_BLOCK: 157,       // UASTC
  ETC2_R8G8B8A8_UNORM_BLOCK: 163,  // ETC1S with alpha
});
const COMPRESSED_FORMATS = new Set([
  VK_FORMAT.ETC2_R8G8B8_UNORM_BLOCK,
  VK_FORMAT.ASTC_4x4_UNORM_BLOCK,
  VK_FORMAT.ETC2_R8G8B8A8_UNORM_BLOCK,
]);

export const TOKTX_INSTALL_HINT = 'Install KTX-Software (https://github.com/KhronosGroup/KTX-Software), '
  + 'put toktx on PATH, or set TOKTX_BIN / "toktxPath" in .hgame.local.json.';

/** Level count of a complete mip chain down to 1x1 for the given pixel size. */
export function expectedMipLevels(width, height) {
  const longest = Math.max(1, Math.floor(Number(width) || 1), Math.floor(Number(height) || 1));
  return 32 - Math.clz32(longest);
}

/**
 * Read the identifying fields of a KTX2 v2 container.
 * @param {Buffer} buffer
 * @returns {{ vkFormat: number, pixelWidth: number, pixelHeight: number, levelCount: number, compressed: boolean, fullMipChain: boolean }}
 */
export function inspectKtx2(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < KTX2_HEADER_BYTES || !buffer.subarray(0, 12).equals(KTX2_MAGIC)) {
    throw new TypeError('inspectKtx2 requires a KTX2 v2 container of at least 80 bytes');
  }
  const vkFormat = buffer.readUInt32LE(12);
  const pixelWidth = buffer.readUInt32LE(20);
  const pixelHeight = buffer.readUInt32LE(24);
  const levelCount = buffer.readUInt32LE(40);
  return {
    vkFormat,
    pixelWidth,
    pixelHeight,
    levelCount,
    compressed: COMPRESSED_FORMATS.has(vkFormat),
    fullMipChain: levelCount >= expectedMipLevels(pixelWidth, pixelHeight),
  };
}

export function missingToktxMessage(subject = 'compressed KTX2 textures') {
  return `toktx (KTX-Software) is required to encode ${subject} but was not found. ${TOKTX_INSTALL_HINT}`;
}

/** `HGAME_REQUIRE_TOKTX=1` turns a missing toktx into a hard error instead of a development fallback. */
export function isToktxRequired({ env = process.env } = {}) {
  const flag = String(env.HGAME_REQUIRE_TOKTX ?? '').trim().toLowerCase();
  return flag === '1' || flag === 'true';
}

/** @param {string} configPath @param {string} key */
function readLocalConfigValue(configPath, key) {
  try {
    const value = JSON.parse(fs.readFileSync(configPath, 'utf8'))?.[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Locate the toktx binary: `TOKTX_BIN`, then `toktxPath` in `.hgame.local.json`, then PATH.
 * @param {{ env?: NodeJS.ProcessEnv, configPath?: string }} [options]
 * @returns {string | null}
 */
export function resolveToktxBin({ env = process.env, configPath = path.join(REPO_ROOT, '.hgame.local.json') } = {}) {
  const exe = process.platform === 'win32' ? 'toktx.exe' : 'toktx';
  const candidates = [env.TOKTX_BIN, readLocalConfigValue(configPath, 'toktxPath')];
  for (const dir of String(env.PATH || '').split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir.replace(/^"|"$/g, ''), exe));
  }
  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = path.resolve(candidate);
    try {
      if (fs.statSync(resolved).isFile()) return resolved;
    } catch {
      // keep looking
    }
  }
  return null;
}

/**
 * toktx arguments for one texture. Colour maps encode ETC1S (sRGB), normal / roughness-metallic
 * maps encode UASTC (linear); both get a complete mip chain.
 * @param {{ input: string, output: string, kind?: 'color' | 'normal_rm', qlevel?: number, clevel?: number, uastcQuality?: number, zcmp?: number }} spec
 */
export function buildToktxArgs({
  input, output, kind = 'color', qlevel = 160, clevel = 2, uastcQuality = 2, zcmp = 18,
}) {
  const encode = kind === 'normal_rm'
    ? ['--encode', 'uastc', '--uastc_quality', String(uastcQuality), '--zcmp', String(zcmp), '--assign_oetf', 'linear']
    : ['--encode', 'etc1s', '--qlevel', String(qlevel), '--clevel', String(clevel), '--assign_oetf', 'srgb'];
  return ['--t2', ...encode, '--genmipmap', output, input];
}

/**
 * Encode one texture with toktx. A toktx that is present but fails is a hard error: falling back to
 * an uncompressed container here is exactly what the release gate exists to stop.
 * @param {string} toktxBin
 * @param {Parameters<typeof buildToktxArgs>[0] & { exec?: typeof spawnSync }} spec
 */
export function encodeKtx2WithToktx(toktxBin, { exec = spawnSync, ...spec }) {
  const { input } = spec;
  const result = exec(toktxBin, buildToktxArgs(spec), { encoding: 'utf8' });
  if (result.error) throw new Error(`toktx could not be started for ${input}: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim().split(/\r?\n/).slice(-3).join(' | ');
    throw new Error(`toktx failed (exit ${result.status}) on ${path.basename(input)}${detail ? `: ${detail}` : ''}`);
  }
  return { encoder: 'toktx', kind: spec.kind ?? 'color' };
}

/**
 * Audit packaged KTX2 files. Release textures must be genuinely compressed and, once large
 * enough to alias, carry a mip chain.
 * @param {Iterable<[string, Buffer]>} entries `[relativePath, bytes]` pairs of the packaged files
 * @param {{ minMipSize?: number }} [options] Longest side from which a mip chain is required
 */
export function auditKtx2Textures(entries, { minMipSize = 8 } = {}) {
  const files = [];
  const failures = [];
  for (const [rel, data] of entries) {
    if (!/\.ktx2$/i.test(rel)) continue;
    let info;
    try {
      info = inspectKtx2(data);
    } catch (error) {
      failures.push(`${rel}: ${error.message}`);
      continue;
    }
    files.push({ path: rel, bytes: data.length, ...info });
    if (!info.compressed) {
      failures.push(`${rel}: vkFormat ${info.vkFormat} is uncompressed (release KTX2 must be ETC1S or UASTC)`);
    } else if (Math.max(info.pixelWidth, info.pixelHeight) >= minMipSize && info.levelCount < 2) {
      failures.push(`${rel}: ${info.pixelWidth}x${info.pixelHeight} has no mip chain (${info.levelCount} level)`);
    }
  }
  return {
    ok: failures.length === 0,
    files,
    failures,
  };
}
