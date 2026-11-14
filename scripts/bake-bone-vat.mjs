#!/usr/bin/env node
/**
 * Offline Bone-VAT baker CLI for HGame 1.0.0.
 *
 * Bakes rigged `.glb` / `.gltf` AnimationClips into a compact IEEE-754 HalfFloat
 * `"HVAT"` binary asset (`.vat.bin`) ready for zero-stall `decodeBoneVatBinary` + `createBoneVatCrowd3D`.
 *
 * Usage:
 *   node scripts/bake-bone-vat.mjs <input.glb|gltf> [--out <output.vat.bin>] [--fps 30] [--json <summary.json>]
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bakeBoneVatData, encodeBoneVatBinary } from '../assets/runtime/integrations/model3d/bone-vat.js';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const threeDir = path.join(repoRoot, 'assets', 'optional', 'three');

function parseArgs(argv) {
  const opts = {
    input: '',
    out: '',
    fps: 30,
    json: '',
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out' || a === '-o') opts.out = argv[++i] || '';
    else if (a === '--fps') opts.fps = Number(argv[++i]);
    else if (a === '--json') opts.json = argv[++i] || '';
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (!a.startsWith('-') && !opts.input) opts.input = a;
    else throw new Error(`Unknown or incomplete argument: ${a}`);
  }
  if (!opts.help && !opts.input) {
    throw new Error('Usage: node scripts/bake-bone-vat.mjs <input.glb|gltf> [--out <output.vat.bin>] [--fps 30] [--json <summary.json>]');
  }
  if (!Number.isFinite(opts.fps) || opts.fps < 4 || opts.fps > 60) {
    throw new RangeError('--fps must be between 4 and 60');
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('Usage: node scripts/bake-bone-vat.mjs <input.glb|gltf> [--out <output.vat.bin>] [--fps 30] [--json <summary.json>]');
    return;
  }

  const inputPath = path.resolve(opts.input);
  const inputDir = path.dirname(inputPath);
  const defaultOut = inputPath.replace(/\.(?:glb|gltf)$/i, '') + '.vat.bin';
  const outPath = path.resolve(opts.out || defaultOut);

  // Polyfill minimal globals needed by Three.js GLTFLoader in Node without external packages.
  globalThis.self ??= globalThis;
  globalThis.createImageBitmap ??= async () => ({ width: 1, height: 1, close() {} });

  const threeBaseUrl = pathToFileURL(threeDir + path.sep).href;
  const loaderHook = `
    export function resolve(specifier, context, nextResolve) {
      if (specifier === 'three') {
        return { url: '${threeBaseUrl}three.module.js', shortCircuit: true };
      }
      if (specifier.startsWith('three/addons/')) {
        return { url: '${threeBaseUrl}jsm/' + specifier.slice('three/addons/'.length), shortCircuit: true };
      }
      return nextResolve(specifier, context);
    }
  `;
  register('data:text/javascript,' + encodeURIComponent(loaderHook));

  const THREE = await import(threeBaseUrl + 'three.module.js');
  const { GLTFLoader } = await import(threeBaseUrl + 'jsm/loaders/GLTFLoader.js');

  // Offline bake needs only geometry, skeleton, and animation tracks; bypass texture raster decoding.
  if (THREE.ImageBitmapLoader?.prototype) {
    THREE.ImageBitmapLoader.prototype.load = function (_url, onLoad) {
      const stub = { width: 1, height: 1, close() {} };
      queueMicrotask(() => onLoad?.(stub));
      return stub;
    };
  }
  if (THREE.FileLoader?.prototype) {
    THREE.FileLoader.prototype.load = function (url, onLoad, _onProgress, onError) {
      const cleanUrl = decodeURIComponent(String(url));
      if (cleanUrl.startsWith('data:')) {
        const comma = cleanUrl.indexOf(',');
        const header = cleanUrl.slice(5, comma);
        const body = cleanUrl.slice(comma + 1);
        const buf = header.includes(';base64') ? Buffer.from(body, 'base64') : Buffer.from(body, 'utf8');
        queueMicrotask(() => onLoad?.(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
        return;
      }
      const resolved = path.isAbsolute(cleanUrl) ? cleanUrl : path.resolve(inputDir, cleanUrl);
      readFile(resolved)
        .then((buf) => {
          if (this.responseType === 'json') onLoad?.(JSON.parse(buf.toString('utf8')));
          else if (this.responseType === 'text' || !this.responseType) onLoad?.(buf.toString('utf8'));
          else onLoad?.(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
        })
        .catch((err) => onError?.(err));
    };
  }

  const raw = await readFile(inputPath);
  const loader = new GLTFLoader();
  const isGltfText = /\.gltf$/i.test(inputPath);
  const parsePayload = isGltfText
    ? raw.toString('utf8')
    : raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);

  const gltf = await new Promise((resolve, reject) => {
    loader.parse(parsePayload, '', resolve, reject);
  });

  const baked = bakeBoneVatData(THREE, {
    asset: { scene: gltf.scene, animations: gltf.animations ?? [] },
    sampleFps: opts.fps,
  });
  const binBuf = encodeBoneVatBinary(baked);

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, new Uint8Array(binBuf));

  const summary = {
    input: inputPath,
    output: outPath,
    boneCount: baked.boneCount,
    width: baked.width,
    height: baked.height,
    totalFrames: baked.totalFrames,
    sampleFps: baked.sampleFps,
    clips: baked.clips,
    byteLength: binBuf.byteLength,
  };

  if (opts.json) {
    const jsonPath = path.resolve(opts.json);
    await mkdir(path.dirname(jsonPath), { recursive: true });
    await writeFile(jsonPath, JSON.stringify(summary, null, 2) + '\n');
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error('Bone-VAT bake failed: ' + err.message);
  process.exitCode = 1;
});
