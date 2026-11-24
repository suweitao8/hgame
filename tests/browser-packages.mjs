#!/usr/bin/env node
// Exercise the ZIP output through the same renderer and input path as a regular snapshot.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parseZipEntries, runToyPreflight } from '../scripts/toy-preflight.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values: { chrome } } = parseArgs({ options: { chrome: { type: 'string' } } });
const artifactRoot = path.join(root, 'build', 'package-browser');
await mkdir(artifactRoot, { recursive: true });
const artifacts = await mkdtemp(path.join(artifactRoot, 'run-'));
const temporary = await mkdtemp(path.join(os.tmpdir(), 'hgame-browser-packages-'));
const project = path.join(temporary, 'release-probe');
const threeRuntime = ['three.module.js', 'three.core.js'].map(file => 'assets/vendor/three/' + file);
console.log('Packaged browser reports: ' + artifacts);

function run(script, args) {
  const child = spawnSync(process.execPath, [path.join(root, 'scripts', script), ...args], {
    cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
  });
  if (child.error) throw child.error;
  return child;
}

async function build(name, flags) {
  const child = run('package-game.mjs', [project, '--version', '1.0', '--tag', name, ...flags]);
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const result = JSON.parse(child.stdout);
  assert.equal(result.minified, name !== 'source', name + ' minification mode');
  const site = path.join(temporary, name);
  const entry = name === 'toy' ? 'toy/release-probe/index.html' : '';
  const archive = entry ? path.join(site, path.dirname(entry)) : site;
  const prefix = entry ? '' : result.releaseTag + '/';
  const entries = parseZipEntries(await readFile(result.zipPath));
  assert.ok(entries.has(prefix + 'index.html'), name + ' archive entry');
  if (name === 'toy') {
    const report = await runToyPreflight({ targetPath: result.zipPath, requireRootIndex: true });
    assert.equal(report.ok, true, JSON.stringify(report.findings));
  }
  const engineConfig = JSON.parse(entries.get(prefix + 'engine.config.json').toString('utf8'));
  assert.equal(engineConfig.physics, 'rapier3d');
  const bytes = threeRuntime.map(file => {
    const bytes = entries.get(prefix + file)?.length;
    assert.ok(bytes, name + ' archive missing ' + file);
    return bytes;
  });
  for (const [file, data] of entries) {
    const destination = path.resolve(archive, ...file.split('/'));
    const relative = path.relative(archive, destination);
    assert.ok(relative && relative !== '..' && !relative.startsWith('..' + path.sep) &&
      !path.isAbsolute(relative) && !file.includes(':'), 'invalid archive entry ' + file);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, data);
  }
  return { dir: path.resolve(site, prefix), entry, bytes };
}

async function render(name, { dir, entry }, baseline = '') {
  const png = path.join(artifacts, name + '.png');
  const child = run('snapshot.mjs', [
    dir, '--out', png, '--ready', '#game[data-engine-ready=true]', '--steps', '120', '--keys', 'd:300',
    '--eval', String.raw`({
      entry: location.pathname,
      resources: performance.getEntriesByType('resource').map(entry => new URL(entry.name).pathname)
        .filter(file => /\/(three\.(module|core)\.js|rapier3d\.wasm)$/.test(file)),
      bloomStages: window.__packageBloomStages(),
    })`,
    ...(entry ? ['--entry', entry] : []),
    ...(baseline ? ['--baseline', baseline, '--threshold', '0'] : []),
    ...(chrome ? ['--chrome', chrome] : []),
  ]);
  await writeFile(path.join(artifacts, name + '.json'), child.stdout || JSON.stringify({ error: child.stderr }));
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const report = JSON.parse(child.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.eval.entry, '/' + entry);
  assert.deepEqual(report.eval.resources.map(file => path.posix.basename(file)).sort(),
    ['rapier3d.wasm', 'three.core.js', 'three.module.js'], name + ' runtime requests');
  assert.deepEqual(report.eval.bloomStages, [
    'bloom-prefilter', 'bloom-downsample-1', 'bloom-downsample-2', 'bloom-downsample-3',
    'bloom-upsample-2', 'bloom-upsample-1', 'bloom-upsample-0',
  ], name + ' package executes the full Bloom graph');
  if (baseline) assert.equal(report.baseline.diffRatio, 0);
  console.log(JSON.stringify({ name, hash: report.sha256, diffRatio: report.baseline?.diffRatio ?? null }));
  return png;
}

try {
  const generated = run('create-game.mjs', [
    project, '--profile', '3d', '--quality', 'high', '--with', 'physics3d', '--no-git',
  ]);
  assert.equal(generated.status, 0, generated.stderr || generated.stdout);
  const presentationPath = path.join(project, 'src', 'presentation.json');
  const presentation = JSON.parse(await readFile(presentationPath, 'utf8'));
  presentation.renderer.post3d = true;
  await writeFile(presentationPath, JSON.stringify(presentation));
  const main = path.join(project, 'src', 'main.js');
  await writeFile(main, (await readFile(main, 'utf8')) + `
window.__packageBloomStages = () => renderer.getExecutedRenderGraph().executed.filter(id => id.startsWith('bloom-'));
`);
  const source = await build('source', ['--no-minify']);
  const baseline = await render('source', source);
  for (const [name, flags] of [
    ['standard', []],
    ['toy', ['--target', 'toy', '--slug', 'release-probe', '--no-toy-sdk']],
  ]) {
    const candidate = await build(name, flags);
    assert.ok(candidate.bytes.every((size, index) => size < source.bytes[index]), name + ' Three.js release size');
    await render(name, candidate, baseline);
  }
} finally {
  await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
