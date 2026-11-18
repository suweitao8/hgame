import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { hashPixiSources, matchPixiBuildBytes, PIXI_BUNDLER_PATH, readPixiBuildManifest } from './assets.mjs';

const manifestPath = '.hgame-pixi-build.json';
const safeName = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

// Track only the flat compiler output; art and manually authored files are never owned.
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
let sourceHash = await hashPixiSources(process.cwd());
async function install(output, files) {
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
  for (const [name, target] of pending) await copyFile(path.join(output, 'assets', name), target);
  await rename(path.join(output, 'index.source.html'), 'index.html');
  for (const [name, hash] of previous) {
    if (Object.hasOwn(files, name)) continue;
    const target = path.join('assets', name);
    try {
      const info = await lstat(target);
      if (info.isFile() && matchPixiBuildBytes(name, await readFile(target), hash)) await unlink(target);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

let files;
let inputs = [];
if (seedDir) {
  files = await emittedFiles(seedDir);
} else {
  if (process.argv[2] !== '--build') throw new Error('Use --build or --seed <assets-directory>');
  const { buildPixi } = await import('./' + path.basename(PIXI_BUNDLER_PATH));
  await mkdir('dist', { recursive: true });
  const output = await mkdtemp(path.resolve('dist/.pixi-'));
  try {
    inputs = await buildPixi({ projectDir: process.cwd(), htmlEntries: ['index.source.html'], outputDir: output });
    if (await hashPixiSources(process.cwd()) !== sourceHash) throw new Error('Pixi source changed during compilation. Rebuild before publishing.');
    sourceHash = await hashPixiSources(process.cwd(), inputs);
    files = await emittedFiles(path.join(output, 'assets'));
    await install(output, files);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
}
await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, sourceHash, inputs, files }, null, 2) + '\n');
