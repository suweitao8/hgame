import { createHash } from 'node:crypto';
import { cp, copyFile, lstat, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const manifestPath = '.hgame-pixi-build.json';
const safeName = /^[A-Za-z0-9_.-]+$/;
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

async function readPrevious() {
  try {
    const value = JSON.parse(await readFile(manifestPath, 'utf8'));
    return value?.schemaVersion === 1 && value.files && typeof value.files === 'object' ? value.files : {};
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return {};
    throw error;
  }
}

const seedDir = process.argv[2] === '--seed' ? process.argv[3] : null;
const files = await emittedFiles(seedDir || 'dist/assets');
if (!seedDir) {
  const previous = await readPrevious();
  await mkdir('assets', { recursive: true });
  await cp('dist/assets', 'assets', { recursive: true, force: true });
  await copyFile('dist/index.source.html', 'index.html');
  for (const [name, hash] of Object.entries(previous)) {
    if (!safeName.test(name) || Object.hasOwn(files, name) || !/^[a-f0-9]{64}$/.test(hash)) continue;
    const target = path.join('assets', name);
    try {
      const info = await lstat(target);
      if (info.isFile() && !info.isSymbolicLink() && digest(await readFile(target)) === hash) await unlink(target);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, files }, null, 2) + '\n');
