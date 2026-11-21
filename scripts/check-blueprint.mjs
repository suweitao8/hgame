#!/usr/bin/env node
// Validate a 5-pillar game.design.json blueprint (Design, UI, Gameplay, Art, Audio) or emit a starter from an idea.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  createBlueprintFromIdea,
  defineGameBlueprint,
  evaluateBlueprintBalance,
  listArtThemes,
  listGenreArchetypes,
} from '../assets/runtime/kit/blueprint.js';

function parseArgs(argv) {
  const opts = { file: null, out: null, genre: 'action-2d', theme: 'scifi', id: 'demo-game', title: '新游戏', strictSlice: false, init: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--init') opts.init = true;
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--genre') opts.genre = argv[++i];
    else if (a === '--theme') opts.theme = argv[++i];
    else if (a === '--id') opts.id = argv[++i];
    else if (a === '--title') opts.title = argv[++i];
    else if (a === '--strict-slice') opts.strictSlice = true;
    else if (!a.startsWith('-') && !opts.file) opts.file = a;
    else throw new Error('Unknown or incomplete argument: ' + a);
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.init) {
    const bp = createBlueprintFromIdea({ id: opts.id, title: opts.title, genre: opts.genre, theme: opts.theme });
    const json = JSON.stringify(bp, null, 2) + '\n';
    if (opts.out) writeFileSync(path.resolve(opts.out), json);
    else process.stdout.write(json);
    return;
  }
  if (!opts.file) {
    console.error(`Usage:
  node scripts/check-blueprint.mjs <path/to/game.design.json> [--strict-slice]
  node scripts/check-blueprint.mjs --init --id <slug> --title "<名称>" --genre <${listGenreArchetypes().join('|')}> --theme <${listArtThemes().join('|')}> [--out game.design.json]`);
    process.exitCode = 1;
    return;
  }
  const raw = JSON.parse(readFileSync(path.resolve(opts.file), 'utf8'));
  const bp = defineGameBlueprint(raw);
  const report = evaluateBlueprintBalance(bp, { strictSlice: opts.strictSlice });
  console.log(JSON.stringify({ file: opts.file, meta: bp.meta, ...report }, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main();
