import { cp, lstat, mkdir, readFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const hgameRoot = path.resolve(projectRoot, '..');
const engineRoot = path.join(hgameRoot, 'assets', 'runtime');
const defaultGamesRoot = process.env.WEBASSET_HTML_GAMES_ROOT || path.resolve(hgameRoot, '..', 'HTML');

function argumentsFrom(argv) {
  const result = { gamesRoot: defaultGamesRoot, project: '', force: false };
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index];
    if (item === '--force') result.force = true;
    else if (item === '--project' || item === '--games-root') {
      const value = argv[++index];
      if (!value) throw new Error(item + ' requires a path');
      result[item === '--project' ? 'project' : 'gamesRoot'] = value;
    } else {
      throw new Error('Unknown argument: ' + item);
    }
  }
  if (!result.project) throw new Error('Usage: npm run hgame:install -- --project <game-folder> [--force]');
  return result;
}

async function main() {
  const options = argumentsFrom(process.argv.slice(2));
  const [gamesRoot, project] = await Promise.all([realpath(options.gamesRoot), realpath(options.project)]);
  if (path.dirname(project).toLowerCase() !== gamesRoot.toLowerCase()) {
    throw new Error('The target must be one direct game folder inside the HTML games root.');
  }
  const vendor = path.join(project, 'vendor');
  const destination = path.join(vendor, 'hgame');
  for (const parent of [vendor, destination]) {
    try {
      const info = await lstat(parent);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Refusing to write through a non-directory or symbolic link: ' + parent);
      if (parent === destination && !options.force) {
        let version = '';
        try { version = (await readFile(path.join(destination, 'VERSION'), 'utf8')).trim(); } catch { /* custom install */ }
        throw new Error('An engine copy already exists (' + (version || 'unknown version') + '). Use --force only when intentionally replacing it.');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  let physics = 'none';
  try {
    physics = JSON.parse(await readFile(path.join(project, 'engine.config.json'), 'utf8')).physics ?? 'none';
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (options.force) await rm(destination, { recursive: true, force: true });
  await mkdir(vendor, { recursive: true });
  await cp(engineRoot, destination, { recursive: true, errorOnExist: true, force: false });
  for (const dimension of ['2d', '3d']) {
    if (physics !== 'rapier' + dimension) await rm(path.join(destination, 'vendor', 'rapier' + dimension), { recursive: true, force: true });
  }
  if (!['rapier2d', 'rapier3d'].includes(physics)) await rm(path.join(destination, 'vendor'), { recursive: true, force: true });
  console.log('Installed HGame into ' + destination);
}

main().catch(error => {
  console.error('HGame install failed: ' + error.message);
  process.exitCode = 1;
});