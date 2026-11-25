import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { casObjectPath, readAssetManifest, resolveAssetStoreDir, shouldIgnoreForAssetTracking } from '../assets.mjs';

const CONFIG = 'minigame.config.json';
const HOST_MODULE = fileURLToPath(new URL('./minigame-host.mjs', import.meta.url));
const SDK_MODULE = fileURLToPath(new URL('./minigame-sdk.mjs', import.meta.url));
const SIZE_MIB = { wechat: 4, douyin: 20, taptap: 60, bilibili: 30 };
const HOST_GLOBAL = { wechat: 'wx', douyin: 'tt', taptap: 'tap', bilibili: 'bl' };
const MEDIA_EXTENSIONS = new Set([
  '.aac', '.bin', '.flac', '.gif', '.glb', '.gltf', '.jpeg', '.jpg', '.json', '.ktx', '.ktx2',
  '.m4a', '.mp3', '.mp4', '.ogg', '.otf', '.png', '.svg', '.ttf', '.txt', '.wav', '.webp', '.woff', '.woff2',
]);
const DOUYIN_UNLISTED_EXTENSIONS = new Set(['.ktx2', '.webp', '.woff2']);
const BILIBILI_MEDIA_EXTENSIONS = new Set([
  '.bin', '.gif', '.jpeg', '.jpg', '.json', '.ktx', '.m4a', '.mp3', '.mp4',
  '.ogg', '.png', '.svg', '.ttf', '.txt', '.wav', '.webp',
]);
const PROJECT_CODE = /\.(?:[cm]?[jt]s|json)$/i;
const PRIVATE_ASSETS = new Set(['private', 'library', 'material-library']);

function isRelativeFile(value) {
  return typeof value === 'string' && !/[\\:%?#<>|"*\x00-\x1f]/.test(value) &&
    value.split('/').every(part => part && !part.startsWith('.') && !/[. ]$/.test(part));
}

function within(root, file) {
  const relative = path.relative(root, file);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

function isAsset(file) {
  return isRelativeFile(file) && MEDIA_EXTENSIONS.has(path.posix.extname(file).toLowerCase()) &&
    !shouldIgnoreForAssetTracking(file) && !file.toLowerCase().split('/').some(part => PRIVATE_ASSETS.has(part));
}

async function loadConfig(projectDir, target) {
  let config;
  try {
    const file = await realpath(path.join(projectDir, CONFIG));
    if (path.dirname(file) !== projectDir) throw new Error('must resolve inside the project root');
    config = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Add minigame.config.json declaring an entry under src/ that exports start(host). See MINIGAME-PACKAGING.md.');
    throw new Error(CONFIG + ': ' + error.message, { cause: error });
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new TypeError(CONFIG + ' must be a JSON object');
  for (const key of Object.keys(config)) {
    if (!['entry', 'deviceOrientation', 'assets'].includes(key)) throw new Error(CONFIG + ' has an unknown field: ' + key);
  }
  const { entry, deviceOrientation = 'portrait', assets = [] } = config;
  if (!isRelativeFile(entry) || !entry.startsWith('src/') || !/\.[cm]?[jt]s$/i.test(entry)) {
    throw new Error(CONFIG + ' entry must be a JavaScript or TypeScript file under src/');
  }
  if (!['portrait', 'landscape'].includes(deviceOrientation)) {
    throw new Error(CONFIG + ' deviceOrientation must be portrait or landscape');
  }
  if (!Array.isArray(assets)) throw new TypeError(CONFIG + ' assets must be an array of file paths');
  const unique = new Set();
  const destinations = new Set();
  const assetAliases = {};
  for (const file of assets) {
    if (typeof file !== 'string' || !file.startsWith('assets/') || !isAsset(file.slice('assets/'.length))) {
      throw new Error(CONFIG + ' contains an unsupported package asset: ' + JSON.stringify(file));
    }
    const extension = path.posix.extname(file).toLowerCase();
    if (target === 'douyin' && DOUYIN_UNLISTED_EXTENSIONS.has(extension)) {
      throw new Error('douyin upload does not list the format for ' + file + '. Use a supported format such as PNG, WOFF or KTX.');
    }
    if (target === 'bilibili' && !BILIBILI_MEDIA_EXTENSIONS.has(extension)) {
      throw new Error('Bilibili upload does not support the format for ' + file + '.');
    }
    const normalized = file.toLowerCase();
    if (unique.has(normalized)) throw new Error(CONFIG + ' has a duplicate asset path: ' + file);
    unique.add(normalized);
    // The Bilibili compiler consumes .json files, so runtime reads use an allowed text file.
    if (target === 'bilibili' && extension === '.json') assetAliases[file] = file + '.txt';
    const destination = assetAliases[file] ?? file;
    if (destinations.has(destination.toLowerCase())) throw new Error('Bilibili asset ' + destination + ' conflicts with another packaged file');
    destinations.add(destination.toLowerCase());
  }
  return { entry, assets: assets.slice().sort(), assetAliases, deviceOrientation };
}

async function canonicalIfExists(file) {
  try {
    return await realpath(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function compileGame({ projectDir, engineRoot, entry, target, game, assets, assetAliases, minify }) {
  let esbuild;
  try {
    const requireFrom = createRequire(path.join(engineRoot || projectDir, 'package.json'));
    esbuild = requireFrom('esbuild');
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    const requireFromProject = createRequire(path.join(projectDir, 'package.json'));
    try {
      esbuild = requireFromProject('esbuild');
    } catch (fallback) {
      if (fallback.code !== 'MODULE_NOT_FOUND') throw fallback;
      throw new Error('Native mini-game packaging requires esbuild. Run npm ci in HGame or install esbuild in this game project.', { cause: fallback });
    }
  }

  const sourceRoot = await canonicalIfExists(path.join(projectDir, 'src'));
  if (!sourceRoot || !within(projectDir, sourceRoot)) throw new Error(CONFIG + ' entry requires a src/ directory inside the project');
  const vendoredRuntime = await canonicalIfExists(path.join(projectDir, 'vendor/hgame'));
  if (vendoredRuntime && !within(projectDir, vendoredRuntime)) throw new Error('vendor/hgame must resolve inside the game project');
  const runtimeRoot = vendoredRuntime ?? (engineRoot && await canonicalIfExists(path.join(engineRoot, 'assets/runtime')));
  const moduleRoots = runtimeRoot ? [sourceRoot, runtimeRoot] : [sourceRoot];
  const entryFile = await canonicalIfExists(path.join(projectDir, entry));
  if (!entryFile || !within(sourceRoot, entryFile)) throw new Error(CONFIG + ' entry is missing or outside src/: ' + entry);
  const hostFile = await realpath(HOST_MODULE);
  const sdkFile = await realpath(SDK_MODULE);
  const global = HOST_GLOBAL[target];
  const bootstrap = [
    'import {createMinigameHost} from "hgame:minigame-host";',
    'const api = typeof ' + global + ' !== "undefined" ? ' + global + ' :',
    '  typeof GameGlobal !== "undefined" ? GameGlobal.' + global + ' : undefined;',
    'export const host = createMinigameHost(api, ' + JSON.stringify(target) + ', ' +
      JSON.stringify(game) + ', ' + JSON.stringify(assets) + ', ' + JSON.stringify(assetAliases) + ');',
  ].join('\n');
  const contents = [
    'import {host} from "hgame:minigame-bootstrap";',
    'import {start} from ' + JSON.stringify('./' + entry) + ';',
    'Promise.resolve(start(host))',
    '  .catch(error => setTimeout(() => { throw error; }, 0));',
  ].join('\n');
  const result = await esbuild.build({
    absWorkingDir: projectDir,
    stdin: { contents, sourcefile: 'hgame-minigame-entry.js', resolveDir: projectDir },
    outfile: 'game.js',
    bundle: true,
    inject: [hostFile],
    format: 'iife',
    platform: 'browser',
    target: target === 'bilibili' ? 'es2016' : 'es2018',
    tsconfigRaw: {},
    write: false,
    minify,
    legalComments: 'inline',
    metafile: true,
    logLevel: 'silent',
    logOverride: {
      'unsupported-dynamic-import': 'error',
      'unsupported-require-call': 'error',
      'empty-import-meta': 'error',
      'direct-eval': 'error',
    },
    plugins: [{
      name: 'hgame-native-files',
      setup(build) {
        build.onResolve({ filter: /^hgame:minigame-host$/ }, () => ({ path: hostFile }));
        build.onResolve({ filter: /^hgame:minigame-bootstrap$/ }, () => ({
          path: 'bootstrap', namespace: 'hgame-native-bootstrap',
        }));
        build.onLoad({ filter: /.*/, namespace: 'hgame-native-bootstrap' }, () => ({ contents: bootstrap }));
        // The scheduler loads Rapier only on request. Keep its browser-specific WASM loader out of native builds.
        build.onResolve({ filter: /^\.\.\/physics\/rapier[23]d\.js$/ }, args => {
          if (runtimeRoot && args.kind === 'dynamic-import' &&
              args.importer === path.join(runtimeRoot, 'core', 'application.js')) {
            return { path: args.path, namespace: 'hgame-native-unavailable-physics' };
          }
        });
        build.onLoad({ filter: /.*/, namespace: 'hgame-native-unavailable-physics' }, args => {
          const dimension = args.path.endsWith('2d.js') ? '2D' : '3D';
          return { contents: 'export class RapierPhysicsWorld' + dimension + ' {}\n' +
            'throw new Error("Rapier ' + dimension + ' requires a native mini-game WASM adapter.");' };
        });
        build.onResolve({ filter: /^@hgame\// }, args => {
          const file = args.path.slice('@hgame/'.length);
          if (!runtimeRoot || !isRelativeFile(file) || !PROJECT_CODE.test(file)) {
            return { errors: [{ text: 'Cannot resolve HGame runtime module ' + args.path }] };
          }
          return { path: path.join(runtimeRoot, file) };
        });
        build.onLoad({ filter: /.*/, namespace: 'file' }, async args => {
          const file = await canonicalIfExists(args.path);
          if (file === hostFile || file === sdkFile) return;
          const root = file && moduleRoots.find(dir => within(dir, file));
          const relative = root && path.relative(root, file).split(path.sep).join('/');
          if (!relative || !PROJECT_CODE.test(relative) || !isRelativeFile(relative) ||
              relative.split('/').includes('node_modules')) {
            return { errors: [{ text: 'Unsupported native mini-game module: ' + path.relative(projectDir, args.path) +
              '. Bundle JS/TS or JSON from src/ or the HGame runtime and use host.assets for media.' }] };
          }
        });
      },
    }],
  });
  const [bundle] = result.outputFiles;
  const output = Object.values(result.metafile.outputs)[0];
  if (output.imports.length) {
    throw new Error('Native mini-game bundle has unresolved imports: ' + output.imports.map(item => item.path).join(', '));
  }
  if (result.outputFiles.length !== 1 || !bundle.path.endsWith(path.sep + 'game.js')) {
    throw new Error('Expected a single native game.js bundle');
  }
  return bundle.contents;
}

async function getAsset(projectDir, assetsRoot, storeDir, manifest, relative) {
  const source = await canonicalIfExists(path.join(projectDir, relative));
  if (source) {
    if (!assetsRoot || !within(assetsRoot, source) ||
        !isAsset(path.relative(assetsRoot, source).split(path.sep).join('/')) || !(await stat(source)).isFile()) {
      throw new Error('Package asset must be a file inside assets/: ' + relative);
    }
    return { source };
  }
  const key = relative.slice('assets/'.length);
  const digest = Object.hasOwn(manifest, key) ? manifest[key]?.sha256 : null;
  if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/i.test(digest)) {
    throw new Error('Missing package asset ' + relative + '. Restore it or add it to the HGame asset store.');
  }
  const object = casObjectPath(storeDir, digest);
  try {
    if ((await lstat(object)).isFile()) return { source: object, digest: digest.toLowerCase() };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  throw new Error('Missing package asset ' + relative + ' in the HGame asset store (SHA-256 ' + digest + ')');
}

function threePartVersion(value, platform) {
  const version = value.trim().replace(/^[vV]/, '');
  if (!/^\d+(?:\.\d+){0,2}$/.test(version)) throw new Error(platform + ' version must be numeric, for example 1.2.0');
  const [major, minor = '0', patch = '0'] = version.split('.');
  return [major, minor, patch].join('.');
}

export async function assembleMinigame({ stage, projectDir, engineRoot, target, appid, assetStore, minify, game }) {
  projectDir = await realpath(projectDir);
  const { entry, assets, assetAliases, deviceOrientation } = await loadConfig(projectDir, target);
  if (target === 'bilibili' && appid === undefined) throw new Error('Bilibili requires --appid <mini-game-appid>');
  if (appid !== undefined && (typeof appid !== 'string' || !/^[a-z0-9_-]+$/i.test(appid))) {
    throw new Error('--appid must be a platform AppID');
  }
  const [bundle, license] = await Promise.all([
    compileGame({ projectDir, engineRoot, entry, target, game, assets, assetAliases, minify }),
    readFile(new URL('./hgame-license.txt', import.meta.url)).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return readFile(new URL('../../LICENSE', import.meta.url));
    }),
  ]);
  const project = target === 'wechat'
    ? { compileType: 'game', miniprogramRoot: './', appid: appid ?? 'touristappid' }
    : { ...(appid === undefined ? {} : { appid }), setting: { es6: true } };
  project.projectname = game.name;
  if (assets.length) project.packOptions = { include: [{ type: 'folder', value: 'assets' }] };
  const gameOptions = { deviceOrientation };
  if (target === 'taptap') {
    project.compileType = 'game';
    gameOptions.productName = game.name;
    gameOptions.productVersion = threePartVersion(game.version, 'TapTap');
    if (appid !== undefined) gameOptions.appId = appid;
  }
  if (target === 'bilibili') {
    gameOptions.appId = appid;
    gameOptions.version = threePartVersion(game.version, 'Bilibili');
  }
  const json = data => Buffer.from(JSON.stringify(data, null, 2) + '\n');
  const files = new Map([
    ['game.js', bundle],
    ['game.json', json(gameOptions)],
    ['LICENSE.txt', license],
  ]);
  if (target !== 'bilibili') files.set('project.config.json', json(project));
  let bytes = Array.from(files.values()).reduce((total, file) => total + file.length, 0);
  const limit = SIZE_MIB[target] * 1024 * 1024;
  const checkSize = () => {
    if (bytes > limit) throw new Error(target + ' package exceeds ' + SIZE_MIB[target] +
      ' MiB (' + bytes + ' bytes). Reduce the code or listed assets in ' + CONFIG + '.');
  };
  checkSize();
  if (assets.length) {
    const assetsRoot = await canonicalIfExists(path.join(projectDir, 'assets'));
    if (assetsRoot && !within(projectDir, assetsRoot)) throw new Error('assets/ must resolve inside the game project');
    const { assets: manifest } = await readAssetManifest(projectDir);
    const storeDir = resolveAssetStoreDir(assetStore);
    for (const relative of assets) {
      const { source, digest } = await getAsset(projectDir, assetsRoot, storeDir, manifest, relative);
      const info = await stat(source);
      bytes += info.size;
      checkSize();
      const data = await readFile(source);
      bytes += data.length - info.size;
      checkSize();
      if (digest && createHash('sha256').update(data).digest('hex') !== digest) {
        throw new Error('Package asset ' + relative + ' does not match its SHA-256: ' + digest);
      }
      files.set(assetAliases[relative] ?? relative, data);
    }
  }
  for (const [relative, data] of files) {
    const destination = path.join(stage, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, data);
  }
  return { deviceOrientation, assetCount: assets.length, packageLimitBytes: limit };
}
