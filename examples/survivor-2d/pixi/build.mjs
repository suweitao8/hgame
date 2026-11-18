import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pullAssets } from '../../../scripts/assets.mjs';

const projectRoot = fileURLToPath(new URL('./', import.meta.url));
const [directory, mode] = process.argv.slice(2);
const target = directory && path.resolve(directory);
if (!target || path.basename(target) !== 'ember-watch' || (mode && mode !== '--procedural')) {
  throw new Error('Pass the path to the generated ember-watch game directory.');
}

const game = JSON.parse(await readFile(path.join(target, 'game.config.json'), 'utf8'));
if (game.id !== 'ember-watch') throw new Error('Target belongs to a different game');
const profile = JSON.parse(await readFile(path.join(target, 'hgame.project.json'), 'utf8'));
if (profile.preset !== 'pixi2d') throw new Error('Generate ember-watch with the Pixi 2D preset first');
const files = [
  ['index.source.html', 'index.source.html'],
  ['watch.js', 'src/watch.js'],
  ['../src/sim', 'src/sim'],
  ['../src/meta.js', 'src/meta.js'],
];
for (const [source, destination] of files) {
  await cp(path.resolve(projectRoot, source), path.join(target, destination), { recursive: true, force: true });
}

// WebAsset serves assets/ from the game but reserves vendor/ for the shared runtime.
const hostVendor = path.join(target, 'assets', 'vendor', 'hgame');
await mkdir(hostVendor, { recursive: true });
const localVendor = path.join(target, 'vendor', 'hgame');
await cp(localVendor, hostVendor, { recursive: true, force: true });
if (mode === '--procedural') {
  await writeFile(path.join(target, 'assets', 'catalog.json'), '{ "schemaVersion": 1, "assets": {} }\n');
} else {
  for (const file of ['catalog.json', 'assets.manifest.json']) {
    const destination = file === 'catalog.json' ? path.join(target, 'assets', file) : path.join(target, file);
    await cp(path.join(projectRoot, file), destination);
  }
  const media = await pullAssets(target);
  if (!media.ok) throw new Error('Ember Watch art could not be restored. Supply its asset store or use --procedural.');
}
const result = spawnSync(process.execPath, ['scripts/install-pixi-build.mjs', '--build'], {
  cwd: target,
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
