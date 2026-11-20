#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const tscBin = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');

// 1. Strict TypeScript check
const tscRun = spawnSync(
  process.execPath,
  [tscBin, '--noEmit', '-p', path.join(root, 'tsconfig.realistic-pcg.json')],
  { encoding: 'utf8' }
);
if (tscRun.status !== 0) {
  process.stderr.write(tscRun.stdout + tscRun.stderr);
  process.exit(tscRun.status || 1);
}

// 2. Build (or check) browser bundle for demos/lookdev-realistic-3d/app.js
const outFile = path.join(root, 'demos', 'lookdev-realistic-3d', 'app.js');
const result = await esbuild.build({
  entryPoints: [path.join(root, 'demos', 'lookdev-realistic-3d', 'main.ts')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  external: ['three', 'three/*'],
  outfile: outFile,
  write: !checkOnly,
  sourcemap: false,
});

if (checkOnly) {
  const built = result.outputFiles?.[0]?.text ?? '';
  const current = readFileSync(outFile, 'utf8');
  if (built !== current) {
    console.error('demos/lookdev-realistic-3d/app.js is stale. Run: npm run build:realistic-pcg');
    process.exit(1);
  }
  console.log('realistic-pcg typecheck & bundle up to date.');
} else {
  console.log('Built demos/lookdev-realistic-3d/app.js and passed strict TypeScript check.');
}
