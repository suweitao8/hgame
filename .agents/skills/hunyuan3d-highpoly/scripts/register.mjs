#!/usr/bin/env node
// Register a downloaded GLB as a character model via the WebAsset server API.
// The server writes the file, updates its in-memory + on-disk catalog, and retires
// the old model file. NEVER hand-edit index.json — the running server would not see it
// (2026-11-21: stale catalog showed old models in the UI until restart).
// usage: node register.mjs <characterId> <high|low> <glbPath> [displayName]
import { readFileSync } from 'node:fs';

const [charId, mode, glbPath, name] = process.argv.slice(2);
if (!charId || !mode || !glbPath) {
  console.error('usage: node register.mjs <characterId> <high|low> <glbPath> [displayName]');
  process.exit(1);
}
const displayName = name || `${charId}_hunyuan3d_mv_${mode}.glb`;
const url = `http://127.0.0.1:4174/api/character-models?characterId=${encodeURIComponent(charId)}`
  + `&mode=${encodeURIComponent(mode)}&name=${encodeURIComponent(displayName)}`;
const res = await fetch(url, { method: 'POST', body: readFileSync(glbPath) });
const body = await res.json();
console.log(JSON.stringify(body, null, 2));
if (!res.ok || !body.ok) process.exit(2);
