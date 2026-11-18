import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFile, lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { hashPixiSources, matchPixiBuildBytes, readPixiBuildManifest } from './assets.mjs';

const manifestPath = '.hgame-pixi-build.json';
const safeName = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

// Track only the flat Vite output; art and manually authored files are never owned.
async function emittedFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = {};
  for (const entry of entries) {
    if (!entry.isFile() || !safeName.test(entry.name)) continue;
    files[entry.name] = digest(await readFile(path.join(dir, entry.name)));
  }
  return files;
}

const seedDir = process.argv[2] === '--seed' ? process.argv[3] : null;
const sourceHash = await hashPixiSources(process.cwd());
if (process.argv[2] === '--build') {
  const build = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { stdio: 'inherit', windowsHide: true });
  if (build.error) throw build.error;
  if (build.status !== 0) process.exit(build.status || 1);
  if (await hashPixiSources(process.cwd()) !== sourceHash) throw new Error('Pixi source changed during compilation. Rebuild before publishing.');
}
const files = await emittedFiles(seedDir || 'dist/assets');
if (!seedDir) {
  const { files: previous } = await readPixiBuildManifest(process.cwd());
  await mkdir('assets', { recursive: true });
  const pending = [];
  for (const [name, hash] of Object.entries(files)) {
    const target = path.join('assets', name);
    try {
      const info = await lstat(target);
      if (!info.isFile()) throw new Error('Pixi output collides with an existing project path: ' + target);
      const current = await readFile(target);
      if (digest(current) === hash) continue;
      if (!matchPixiBuildBytes(name, current, hash) && !matchPixiBuildBytes(name, current, previous.get(name))) {
        throw new Error('Pixi output would overwrite an authored asset: ' + target);
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    pending.push([name, target]);
  }
  for (const [name, target] of pending) await copyFile(path.join('dist/assets', name), target);
  await copyFile('dist/index.source.html', 'dist/index.install.html');
  await rename('dist/index.install.html', 'index.html');
  for (const [name, hash] of previous) {
    if (Object.hasOwn(files, name)) continue;
    const target = path.join('assets', name);
    try {
      const info = await lstat(target);
      if (info.isFile() && matchPixiBuildBytes(name, await readFile(target), hash)) await unlink(target);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, sourceHash, files }, null, 2) + '\n');
