import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..', '..', '..');

function findLocalConfigFile(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, '.hgame.local.json');
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const repoCandidate = path.join(repoRoot, '.hgame.local.json');
  if (existsSync(repoCandidate)) return repoCandidate;
  return null;
}

/**
 * Resolves local RE paths strictly from env vars or gitignored `.hgame.local.json`,
 * never from hardcoded machine-specific literals.
 */
export function resolveReConfig(startDir = process.cwd()) {
  let fileConfig = {};
  const configPath = findLocalConfigFile(startDir);
  if (configPath) {
    try {
      fileConfig = JSON.parse(readFileSync(configPath, 'utf8')) || {};
    } catch {
      fileConfig = {};
    }
  }

  const envToolchain = process.env.HGAME_RE_TOOLCHAIN?.trim();
  const envWorkspace = process.env.HGAME_RE_WORKSPACE?.trim();
  const envGamesRoot = process.env.HGAME_GAMES_ROOT?.trim();

  const rawToolchain = envToolchain || (typeof fileConfig.reToolchainPath === 'string' ? fileConfig.reToolchainPath.trim() : '');
  const rawWorkspace = envWorkspace || (typeof fileConfig.reWorkspaceDir === 'string' ? fileConfig.reWorkspaceDir.trim() : '');
  const rawGamesRoot = envGamesRoot || (typeof fileConfig.gamesRootDir === 'string' ? fileConfig.gamesRootDir.trim() : '');

  return {
    configPath,
    reToolchainPath: rawToolchain ? path.resolve(rawToolchain) : null,
    reWorkspaceDir: rawWorkspace ? path.resolve(rawWorkspace) : path.join(repoRoot, '.re-workspace'),
    gamesRootDir: rawGamesRoot ? path.resolve(rawGamesRoot) : null,
  };
}
