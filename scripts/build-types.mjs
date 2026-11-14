#!/usr/bin/env node
// Generate (or --check) public .d.ts declarations for assets/runtime into types/.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, mkdtempSync, rmSync, mkdirSync, cpSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const check = process.argv.includes('--check');
const typesDir = path.join(root, 'types');
const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');

function listSources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.name === 'vendor' ? []
    : e.isDirectory() ? listSources(path.join(dir, e.name)) : /\.m?js$/.test(e.name) ? [path.join(dir, e.name)] : []);
}
function emit(outDir) {
  const r = spawnSync(process.execPath, [tsc, '--allowJs', '--declaration', '--emitDeclarationOnly', '--skipLibCheck',
    '--target', 'es2022', '--module', 'esnext', '--moduleResolution', 'bundler',
    '--outDir', outDir, '--rootDir', path.join(root, 'assets', 'runtime'),
    ...listSources(path.join(root, 'assets', 'runtime'))], { encoding: 'utf8' });
  if (r.status !== 0) { process.stderr.write(r.stdout + r.stderr); process.exit(r.status || 1); }
  rmSync(path.join(outDir, 'vendor'), { recursive: true, force: true }); // vendored WASM typings are not ours
}
function walk(dir, base = dir, out = new Map()) {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walk(p, base, out);
    else out.set(path.relative(base, p).replaceAll('\\', '/'), readFileSync(p, 'utf8').replace(/\r\n/g, '\n'));
  }
  return out;
}

const tmp = mkdtempSync(path.join(os.tmpdir(), 'hgame-types-'));
try {
  emit(tmp);
  if (check) {
    const a = walk(tmp), b = existsSync(typesDir) ? walk(typesDir) : new Map();
    const diff = [...new Set([...a.keys(), ...b.keys()])].filter(k => a.get(k) !== b.get(k));
    if (diff.length) { console.error(`types/ is stale (${diff.length} files): ${diff.slice(0, 5).join(', ')}\nRun: npm run build:types`); process.exit(1); }
    console.log(`types/ up to date (${a.size} files)`);
  } else {
    rmSync(typesDir, { recursive: true, force: true });
    mkdirSync(typesDir, { recursive: true });
    cpSync(tmp, typesDir, { recursive: true });
    console.log(`wrote ${walk(typesDir).size} declaration files to types/`);
  }
} finally { rmSync(tmp, { recursive: true, force: true }); }

