import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

/**
 * Finds an explicit or system Chromium/Edge binary if Playwright's bundled headless shell is absent.
 * @param {string} [explicitPath]
 * @returns {string | null}
 */
export function findChromeExecutable(explicitPath = '') {
  if (explicitPath && existsSync(explicitPath)) return explicitPath;
  if (process.env.HGAME_CHROME && existsSync(process.env.HGAME_CHROME)) return process.env.HGAME_CHROME;
  return CHROME_CANDIDATES.find(existsSync) ?? null;
}

/**
 * Launches Chromium preferring explicit `--chrome` / `HGAME_CHROME`, then Playwright's bundled
 * headless shell, and finally system Chrome/Edge only when Playwright's binary is absent.
 * @param {import('playwright-core').BrowserType} chromium
 * @param {{ executablePath?: string, args?: string[] }} [options]
 */
export async function launchChromium(chromium, { executablePath = '', args = [] } = {}) {
  const settings = { headless: true, args };
  const explicit = (executablePath && existsSync(executablePath))
    ? executablePath
    : (process.env.HGAME_CHROME && existsSync(process.env.HGAME_CHROME))
      ? process.env.HGAME_CHROME
      : '';
  if (explicit) {
    return chromium.launch({ ...settings, executablePath: explicit });
  }
  try {
    return await chromium.launch(settings);
  } catch (error) {
    const fallback = findChromeExecutable('');
    if (!fallback || !String(error?.message || '').includes("Executable doesn't exist at ")) throw error;
    return chromium.launch({ ...settings, executablePath: fallback });
  }
}

function tryRequirePlaywright(fromPath) {
  try {
    const req = createRequire(fromPath);
    return req('playwright-core');
  } catch {
    return null;
  }
}

function readLocalHGameRoot(dir) {
  const cfgPath = path.join(dir, '.hgame.local.json');
  if (!existsSync(cfgPath)) return null;
  try {
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    if (typeof cfg?.hgameRoot === 'string' && cfg.hgameRoot) return path.resolve(dir, cfg.hgameRoot);
    if (typeof cfg?.playwrightPath === 'string' && cfg.playwrightPath) return path.resolve(dir, cfg.playwrightPath);
  } catch { /* ignore malformed optional local file */ }
  return null;
}

/**
 * Resolves `playwright-core` from the local project, parent directories, `HGAME_ROOT`, or a sibling `HGame` checkout.
 * @param {string} importMetaUrl
 * @param {{ cwd?: string }} [options]
 */
export function resolvePlaywright(importMetaUrl, { cwd = process.cwd() } = {}) {
  const direct = tryRequirePlaywright(importMetaUrl);
  if (direct) return direct;

  const cwdMod = tryRequirePlaywright(path.join(path.resolve(cwd), 'package.json'));
  if (cwdMod) return cwdMod;

  const envCandidates = [
    process.env.HGAME_PLAYWRIGHT,
    process.env.HGAME_ROOT ? path.join(process.env.HGAME_ROOT, 'node_modules', 'playwright-core') : '',
  ].filter(Boolean);

  for (const candidate of envCandidates) {
    const resolved = path.resolve(candidate);
    const mod = tryRequirePlaywright(path.join(resolved, 'package.json')) ?? tryRequirePlaywright(resolved);
    if (mod) return mod;
  }

  const seeds = [path.resolve(cwd), path.dirname(fileURLToPath(importMetaUrl))];
  for (const seed of seeds) {
    let cur = seed;
    for (let depth = 0; depth < 6; depth++) {
      const localCfgTarget = readLocalHGameRoot(cur);
      if (localCfgTarget) {
        const mod = tryRequirePlaywright(path.join(localCfgTarget, 'package.json'))
          ?? tryRequirePlaywright(path.join(localCfgTarget, 'node_modules', 'playwright-core', 'package.json'));
        if (mod) return mod;
      }
      for (const pkgPath of [
        path.join(cur, 'node_modules', 'playwright-core', 'package.json'),
        path.join(cur, 'HGame', 'node_modules', 'playwright-core', 'package.json'),
      ]) {
        if (existsSync(pkgPath)) {
          const mod = tryRequirePlaywright(pkgPath);
          if (mod) return mod;
        }
      }
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }

  throw new Error(
    'playwright-core not found. Run from the HGame repo ("npm run accept -- <game-dir>"), install playwright-core, or set HGAME_ROOT.',
  );
}
