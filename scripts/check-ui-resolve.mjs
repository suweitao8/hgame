import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const localCheckUi = path.join(scriptDir, 'check-ui.mjs');
const skillCheckUi = path.resolve(scriptDir, '..', '.agents', 'skills', 'hgame-ui-ux', 'scripts', 'check-ui.mjs');
const target = existsSync(localCheckUi) ? localCheckUi : skillCheckUi;

if (!existsSync(target)) {
  throw new Error('Cannot locate check-ui.mjs in scripts/ or .agents/skills/hgame-ui-ux/scripts/');
}

const mod = await import(pathToFileURL(target).href);
export const collectFiles = mod.collectFiles;
export const lintFiles = mod.lintFiles;
