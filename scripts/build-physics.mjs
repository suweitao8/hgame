#!/usr/bin/env node
/** Rebuild the pinned deterministic Rapier ESM/WASM files in assets/runtime/vendor. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = path.join(root, 'assets', 'runtime');
const expectedVersion = '0.21.0';
const requested = process.argv.includes('--2d') ? ['2d'] :
  process.argv.includes('--3d') ? ['3d'] : ['2d', '3d'];
const checkOnly = process.argv.includes('--check');

for (const dimension of requested) {
  const packageName = `@dimforge/rapier${dimension}-deterministic`;
  const packageRoot = path.join(root, 'node_modules', '@dimforge', `rapier${dimension}-deterministic`);
  const packageJsonPath = path.join(packageRoot, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`${packageName} is missing. Run npm ci before rebuilding physics.`);
  }
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  if (packageJson.version !== expectedVersion) {
    throw new Error(`${packageName} must be ${expectedVersion}, received ${packageJson.version}`);
  }

  const glueName = `rapier_wasm${dimension}_bg`;
  const wasmSource = path.join(packageRoot, `${glueName}.wasm`);
  const wasmBytes = fs.readFileSync(wasmSource);
  const exports = WebAssembly.Module.exports(new WebAssembly.Module(wasmBytes)).map(item => item.name);
  if (!exports.every(name => /^[A-Za-z_$][\w$]*$/.test(name))) {
    throw new Error(`Unexpected ${packageName} WASM export name`);
  }

  const target = path.join(runtime, 'vendor', `rapier${dimension}`);
  const outputJs = path.join(target, `rapier${dimension}.mjs`);
  const outputWasm = path.join(target, `rapier${dimension}.wasm`);
  const wasmFilter = new RegExp(`${glueName}\\.wasm$`);
  const result = await build({
    entryPoints: [path.join(packageRoot, 'rapier.js')],
    outdir: target,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    external: ['node:fs/promises'],
    write: false,
    sourcemap: false,
    minify: false,
    plugins: [{
      name: 'hgame-deterministic-rapier-wasm',
      setup(plugin) {
        plugin.onLoad({ filter: wasmFilter }, () => ({
          loader: 'js',
          resolveDir: packageRoot,
          contents: `import * as rapierGlue from './${glueName}.js';
const location = new URL('./rapier${dimension}.wasm', import.meta.url);
let bytes;
if (location.protocol === 'file:') {
  bytes = await (await import('node:fs/promises')).readFile(location);
} else {
  const response = await fetch(location);
  if (!response.ok) throw new Error('HGame Rapier${dimension} WASM HTTP ' + response.status);
  bytes = await response.arrayBuffer();
}
const instance = await WebAssembly.instantiate(bytes, { './${glueName}.js': rapierGlue });
const wasmExports = instance.instance.exports;
${exports.map(name => `export const ${name} = wasmExports.${name};`).join('\n')}
`,
        }));
      },
    }],
    logLevel: 'silent',
  });
  const bundled = result.outputFiles.find(file => file.path.endsWith('.js'))?.contents;
  if (!bundled) throw new Error(`Could not bundle ${packageName}`);
  const javascript = Buffer.concat([
    Buffer.from(`/* ${packageName}@${expectedVersion}; Apache-2.0. */\n`),
    Buffer.from(bundled),
  ]);

  if (checkOnly) {
    if (!fs.existsSync(outputJs) || !fs.existsSync(outputWasm) ||
        !fs.readFileSync(outputJs).equals(javascript) ||
        !fs.readFileSync(outputWasm).equals(wasmBytes)) {
      throw new Error(`HGame Rapier${dimension} vendor bundle is stale; run npm run build:physics`);
    }
    console.log(`${packageName}@${expectedVersion}: vendor bundle verified`);
    continue;
  }

  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(outputJs, javascript);
  fs.writeFileSync(outputWasm, wasmBytes);
  console.log(`${packageName}@${expectedVersion}: ${(javascript.length / 1024).toFixed(0)} KiB JS + ${(wasmBytes.length / 1024 / 1024).toFixed(2)} MiB WASM`);
}

const licensePath = path.join(runtime, 'vendor', 'LICENSE-rapier.txt');
if (checkOnly) {
  if (!fs.existsSync(licensePath)) throw new Error('Missing Apache-2.0 Rapier license in runtime vendor directory');
} else {
  fs.copyFileSync(
    path.join(root, 'node_modules', '@dimforge', 'rapier3d-deterministic', 'LICENSE'),
    licensePath,
  );
}
