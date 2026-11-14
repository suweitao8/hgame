import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Prefer the project's own vendored runtime; fall back to the repo runtime so tests run without a build step.
const here = fileURLToPath(new URL('.', import.meta.url));
const vendored = fileURLToPath(new URL('../vendor/hgame/', import.meta.url));
const repo = fileURLToPath(new URL('../../../assets/runtime/', import.meta.url));
export const runtimeDir = existsSync(vendored + 'index.js') ? vendored : repo;
export const loadRuntime = (rel = 'index.js') => import(pathToFileURL(runtimeDir + rel).href);
export { here };
