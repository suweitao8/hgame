import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defineProject } from '../../assets/runtime/core/config.js';
import { PIXI_BUNDLER_PATH } from '../assets.mjs';
import { THREE_FILES } from '../project-profiles.mjs';

export const ENGINE_SYNC_MANIFEST = '.hgame-sync.json';

export const ENGINE_MANAGED_SCRIPTS = Object.freeze([
  'query-api.mjs',
  'package-game.mjs',
  'project-profiles.mjs',
  'toy-preflight.mjs',
  'assets.mjs',
]);

const PIXI2D_PRESETS = new Set(['2d', 'pixi2d', 'horde']);

function toPosix(rel) {
  return rel.split(path.sep).join('/');
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

async function readJsonOptional(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function collectFilesMap(dir, relPrefix, filter = null) {
  const result = new Map();
  if (!(await exists(dir))) return result;
  async function walk(currDir, currRel) {
    const entries = await readdir(currDir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(currDir, entry.name);
      const rel = currRel ? `${currRel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(abs, rel);
      } else if (entry.isFile()) {
        if (filter && !filter(rel, abs)) continue;
        result.set(rel, await readFile(abs));
      }
    }
  }
  await walk(dir, relPrefix);
  return result;
}

/**
 * Reads local HGame repo metadata (version + git commit/dirty state when `.git` exists).
 * @param {string} repoRoot
 */
export async function getEngineMetadata(repoRoot) {
  const versionPath = path.join(repoRoot, 'assets', 'runtime', 'VERSION');
  const engineVersion = (await readFile(versionPath, 'utf8')).trim();
  let engineCommit = null;
  let engineDirty = null;
  if (fs.existsSync(path.join(repoRoot, '.git'))) {
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', windowsHide: true });
    if (head.status === 0) engineCommit = head.stdout.trim();
    const status = spawnSync('git', ['status', '--porcelain', '--', 'assets/runtime', 'types', 'assets/optional/three', 'scripts', 'docs/api/API-INDEX.json'], {
      cwd: repoRoot, encoding: 'utf8', windowsHide: true,
    });
    if (status.status === 0) engineDirty = status.stdout.trim().length > 0;
  }
  return { engineVersion, engineCommit, engineDirty };
}

/**
 * Resolves the external HTML games root from `--root`, env vars, or `.hgame.local.json`.
 * @param {string} repoRoot
 * @param {string|null} [explicitRoot]
 */
export async function resolveGamesRoot(repoRoot, explicitRoot = null) {
  if (explicitRoot) return path.resolve(explicitRoot);
  if (process.env.HGAME_GAMES_ROOT) return path.resolve(process.env.HGAME_GAMES_ROOT);
  if (process.env.WEBASSET_HTML_GAMES_ROOT) return path.resolve(process.env.WEBASSET_HTML_GAMES_ROOT);
  const localCfg = await readJsonOptional(path.join(repoRoot, '.hgame.local.json'));
  if (localCfg?.gamesRootDir) return path.resolve(repoRoot, localCfg.gamesRootDir);
  return null;
}

/**
 * Resolves the starter entry recorded in `docs/api/API-INDEX.json` or inferred from project layout.
 */
async function resolveProjectEntry(targetDir, explicitEntry = null) {
  if (explicitEntry) return explicitEntry;
  const existingIndex = await readJsonOptional(path.join(targetDir, 'docs', 'api', 'API-INDEX.json'));
  if (typeof existingIndex?.projectEntry === 'string' && existingIndex.projectEntry) {
    return existingIndex.projectEntry;
  }
  const projectMeta = await readJsonOptional(path.join(targetDir, 'hgame.project.json'));
  if (projectMeta?.preset === 'horde' && await exists(path.join(targetDir, 'src', 'horde.js'))) {
    return 'src/horde.js';
  }
  if (await exists(path.join(targetDir, 'src', 'bare.js')) && !(await exists(path.join(targetDir, 'src', 'main.js')))) {
    return 'src/bare.js';
  }
  return 'src/main.js';
}

function isPixi2dManagedProject(targetDir, projectMeta) {
  if (projectMeta?.preset && PIXI2D_PRESETS.has(projectMeta.preset)) return true;
  if (fs.existsSync(path.join(targetDir, 'index.source.html')) && fs.existsSync(path.join(targetDir, PIXI_BUNDLER_PATH))) {
    return true;
  }
  return false;
}

function shouldIncludeVendorThree(targetDir, recipe, gameConfig, pkg) {
  if (recipe.profile !== '3d') return false;
  if (fs.existsSync(path.join(targetDir, 'assets', 'vendor', 'three'))) return true;
  if (gameConfig?.standalone === false && pkg?.dependencies?.three) return false;
  return true;
}

/**
 * Builds the authoritative map of engine-managed files (`relPosixPath -> Buffer`) for a game recipe.
 */
export async function buildExpectedEngineFiles({
  repoRoot,
  recipe,
  projectEntry = 'src/main.js',
  includePixi2dScripts = false,
  includeVendorThree = recipe.profile === '3d',
}) {
  const expected = new Map();
  const runtimeDir = path.join(repoRoot, 'assets', 'runtime');
  const typesDir = path.join(repoRoot, 'types');
  const optionalThreeDir = path.join(repoRoot, 'assets', 'optional', 'three');
  const scriptsDir = path.join(repoRoot, 'scripts');

  const runtimeFiles = await collectFilesMap(runtimeDir, 'vendor/hgame');
  for (const [rel, buf] of runtimeFiles) {
    if (rel.startsWith('vendor/hgame/vendor/rapier2d/') && recipe.physics !== 'rapier2d') continue;
    if (rel.startsWith('vendor/hgame/vendor/rapier3d/') && recipe.physics !== 'rapier3d') continue;
    if (rel.startsWith('vendor/hgame/vendor/') && !['rapier2d', 'rapier3d'].includes(recipe.physics)) continue;
    expected.set(rel, buf);
  }

  const typeFiles = await collectFilesMap(typesDir, 'vendor/hgame', rel => rel.endsWith('.d.ts'));
  for (const [rel, buf] of typeFiles) {
    expected.set(rel, buf);
  }

  if (includeVendorThree) {
    for (const file of THREE_FILES) {
      const rel = toPosix(path.join('assets/vendor/three', file));
      expected.set(rel, await readFile(path.join(optionalThreeDir, file)));
    }
  }

  for (const script of ENGINE_MANAGED_SCRIPTS) {
    expected.set(`scripts/${script}`, await readFile(path.join(scriptsDir, script)));
  }

  if (includePixi2dScripts) {
    const pixiDir = path.join(repoRoot, 'assets', 'profiles', 'pixi2d');
    expected.set('scripts/install-pixi-build.mjs', await readFile(path.join(pixiDir, 'install-build.mjs')));
    expected.set(PIXI_BUNDLER_PATH, await readFile(path.join(pixiDir, 'bundle.mjs')));
  }

  const apiIndexRaw = JSON.parse(await readFile(path.join(repoRoot, 'docs', 'api', 'API-INDEX.json'), 'utf8'));
  expected.set('docs/api/API-INDEX.json', Buffer.from(JSON.stringify({ ...apiIndexRaw, projectEntry }) + '\n'));

  return expected;
}

/**
 * Inspects current managed paths on disk in `targetDir` against `expected` and optional `.hgame-sync.json`.
 */
export async function inspectProjectEngineSync({
  repoRoot,
  targetDir,
  recipe = null,
  projectEntry = null,
  includePixi2dScripts = null,
}) {
  const absDir = path.resolve(targetDir);
  const engineConfigPath = path.join(absDir, 'engine.config.json');
  const rawConfig = recipe ?? await readJsonOptional(engineConfigPath);
  if (!rawConfig) {
    return {
      projectDir: absDir,
      name: path.basename(absDir),
      managed: false,
      status: 'non-hgame',
      reason: 'Missing engine.config.json',
    };
  }

  let parsedRecipe;
  try {
    parsedRecipe = defineProject(rawConfig);
  } catch (err) {
    return {
      projectDir: absDir,
      name: path.basename(absDir),
      managed: false,
      status: 'invalid-config',
      reason: err.message,
    };
  }

  const projectMeta = await readJsonOptional(path.join(absDir, 'hgame.project.json'));
  const gameConfig = await readJsonOptional(path.join(absDir, 'game.config.json'));
  const pkgJson = await readJsonOptional(path.join(absDir, 'package.json'));
  const prevSync = await readJsonOptional(path.join(absDir, ENGINE_SYNC_MANIFEST));
  const resolvedEntry = await resolveProjectEntry(absDir, projectEntry);
  const pixi2d = includePixi2dScripts ?? isPixi2dManagedProject(absDir, projectMeta);
  const includeVendorThree = shouldIncludeVendorThree(absDir, parsedRecipe, gameConfig, pkgJson);

  const expected = await buildExpectedEngineFiles({
    repoRoot,
    recipe: parsedRecipe,
    projectEntry: resolvedEntry,
    includePixi2dScripts: pixi2d,
    includeVendorThree,
  });

  // Collect actual files inside the 100%-owned vendor directories plus explicit managed files.
  const actual = new Map();
  for (const ownedDir of ['vendor/hgame', 'assets/vendor/three']) {
    const found = await collectFilesMap(path.join(absDir, ownedDir), ownedDir);
    for (const [rel, buf] of found) actual.set(rel, buf);
  }
  const explicitPaths = new Set([
    'docs/api/API-INDEX.json',
    ...ENGINE_MANAGED_SCRIPTS.map(s => `scripts/${s}`),
    ...(pixi2d ? ['scripts/install-pixi-build.mjs', PIXI_BUNDLER_PATH] : []),
  ]);
  for (const rel of explicitPaths) {
    const abs = path.join(absDir, rel);
    if (await exists(abs)) actual.set(rel, await readFile(abs));
  }

  const added = [];
  const updated = [];
  const unchanged = [];
  const removed = [];
  const localEdits = [];
  const prevHashes = prevSync?.files ?? null;

  for (const [rel, buf] of expected) {
    const curBuf = actual.get(rel);
    if (!curBuf) {
      added.push(rel);
      continue;
    }
    const expHash = sha256(buf);
    const curHash = sha256(curBuf);
    if (expHash === curHash) {
      unchanged.push(rel);
    } else {
      updated.push(rel);
      if (prevHashes && Object.hasOwn(prevHashes, rel) && prevHashes[rel] !== curHash) {
        localEdits.push({ path: rel, kind: 'modified' });
      }
    }
  }

  for (const [rel, curBuf] of actual) {
    if (expected.has(rel)) continue;
    removed.push(rel);
    if (prevHashes) {
      const curHash = sha256(curBuf);
      if (!Object.hasOwn(prevHashes, rel) || prevHashes[rel] !== curHash) {
        localEdits.push({ path: rel, kind: 'extra' });
      }
    }
  }

  let status = 'up-to-date';
  if (localEdits.length > 0) status = 'local-edits';
  else if (added.length > 0 || updated.length > 0 || removed.length > 0) {
    status = prevSync ? 'outdated' : 'legacy-untracked';
  } else if (!prevSync) {
    status = 'legacy-untracked';
  }

  return {
    projectDir: absDir,
    name: gameConfig?.id ?? path.basename(absDir),
    managed: true,
    status,
    profile: parsedRecipe.profile,
    physics: parsedRecipe.physics,
    pixi2d,
    includeVendorThree,
    projectEntry: resolvedEntry,
    recordedEngineVersion: prevSync?.engineVersion ?? null,
    recordedEngineCommit: prevSync?.engineCommit ?? null,
    counts: {
      expected: expected.size,
      actual: actual.size,
      added: added.length,
      updated: updated.length,
      removed: removed.length,
      unchanged: unchanged.length,
      localEdits: localEdits.length,
    },
    added,
    updated,
    removed,
    localEdits,
    expected,
    hasSyncManifest: Boolean(prevSync),
  };
}

/**
 * Writes engine-managed files + `.hgame-sync.json` into `targetDir` without touching game code.
 */
export async function syncEngineFilesToProject({
  repoRoot,
  targetDir,
  recipe = null,
  projectEntry = null,
  includePixi2dScripts = null,
  dryRun = false,
  force = false,
  rebuildPixi = true,
  metadata = null,
}) {
  const inspection = await inspectProjectEngineSync({
    repoRoot,
    targetDir,
    recipe,
    projectEntry,
    includePixi2dScripts,
  });
  if (!inspection.managed) return inspection;
  if (inspection.localEdits.length > 0 && !force) {
    const preview = inspection.localEdits.slice(0, 5).map(e => `${e.kind}:${e.path}`).join(', ');
    throw new Error(
      `Refusing to overwrite locally modified engine files in ${inspection.name} (${preview}). Re-run with --force to overwrite.`,
    );
  }

  const meta = metadata ?? await getEngineMetadata(repoRoot);
  const hasChanges = inspection.added.length > 0 || inspection.updated.length > 0 ||
    inspection.removed.length > 0 || !inspection.hasSyncManifest;

  let pixiRebuilt = false;
  let pixiRebuildSkippedReason = null;

  if (!dryRun) {
    for (const rel of inspection.removed) {
      await rm(path.join(inspection.projectDir, rel), { force: true });
    }
    for (const rel of [...inspection.added, ...inspection.updated]) {
      const dest = path.join(inspection.projectDir, rel);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, inspection.expected.get(rel));
    }

    // Prune empty subdirectories left inside vendor/hgame or assets/vendor/three
    for (const ownedDir of ['vendor/hgame', 'assets/vendor/three']) {
      await pruneEmptyDirs(path.join(inspection.projectDir, ownedDir));
    }

    const fileHashes = {};
    for (const [rel, buf] of [...inspection.expected.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      fileHashes[rel] = sha256(buf);
    }

    const syncManifest = {
      schemaVersion: 1,
      engine: 'HGame',
      engineVersion: meta.engineVersion,
      engineCommit: meta.engineCommit,
      engineDirty: meta.engineDirty,
      syncedAt: new Date().toISOString(),
      managedRoots: [
        'vendor/hgame',
        ...(inspection.includeVendorThree ? ['assets/vendor/three'] : []),
        'docs/api/API-INDEX.json',
        ...ENGINE_MANAGED_SCRIPTS.map(s => `scripts/${s}`),
        ...(inspection.pixi2d ? ['scripts/install-pixi-build.mjs', PIXI_BUNDLER_PATH] : []),
      ],
      files: fileHashes,
    };
    await writeFile(
      path.join(inspection.projectDir, ENGINE_SYNC_MANIFEST),
      JSON.stringify(syncManifest, null, 2) + '\n',
    );

    if (rebuildPixi && inspection.pixi2d && (inspection.added.length > 0 || inspection.updated.length > 0 || inspection.removed.length > 0)) {
      const hasEsbuild = await exists(path.join(inspection.projectDir, 'node_modules', 'esbuild', 'package.json'));
      const hasInstaller = await exists(path.join(inspection.projectDir, 'scripts', 'install-pixi-build.mjs'));
      const hasSourceHtml = await exists(path.join(inspection.projectDir, 'index.source.html'));
      if (hasEsbuild && hasInstaller && hasSourceHtml) {
        const build = spawnSync(process.execPath, ['scripts/install-pixi-build.mjs', '--build'], {
          cwd: inspection.projectDir, encoding: 'utf8', windowsHide: true,
        });
        if (build.error) throw build.error;
        if (build.status !== 0) {
          throw new Error(`Pixi rebuild failed in ${inspection.name}: ${build.stderr || build.stdout}`);
        }
        pixiRebuilt = true;
      } else {
        pixiRebuildSkippedReason = !hasEsbuild ? 'missing node_modules/esbuild' : 'missing index.source.html or installer';
      }
    }
  }

  return {
    ...inspection,
    expected: undefined,
    synced: !dryRun && hasChanges,
    dryRun,
    engineVersion: meta.engineVersion,
    engineCommit: meta.engineCommit,
    pixiRebuilt,
    pixiRebuildSkippedReason,
  };
}

async function pruneEmptyDirs(dir) {
  if (!(await exists(dir))) return;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await pruneEmptyDirs(path.join(dir, entry.name));
    }
  }
  const remaining = await readdir(dir);
  if (remaining.length === 0) {
    await rm(dir, { recursive: true, force: true });
  }
}
