#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openAssetDb, resolveDefaultDbPath } from '../lib/asset-db.mjs';

const WEBASSET_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function printHelp() {
  console.log(`Usage: node webasset/scripts/assets-db.mjs <command> [options]

Commands:
  sync [--rehash]                Import catalogs if needed and scan/hash all art assets into SQLite
  status                         Show SQLite DB summary (characters, domains, file counts, bytes, backups)
  search [query] [--domain <d>]  Search indexed art assets in SQLite
  verify [--deep]                Verify active art files on disk match SQLite size (and sha256 with --deep)
  export-json [--out <path>]     Export characters catalog JSON snapshot from SQLite`);
}

function parseArgs(argv) {
  const command = argv[0] || 'status';
  if (command === '--help' || command === '-h') return { command: 'help', positionals: [], flags: {} };
  const positionals = [];
  const flags = { rehash: false, deep: false, domain: '', category: '', ext: '', out: '', db: '', limit: 50 };
  for (let i = 1; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--rehash') flags.rehash = true;
    else if (a === '--deep') flags.deep = true;
    else if (a === '--domain') flags.domain = argv[++i] || '';
    else if (a === '--category') flags.category = argv[++i] || '';
    else if (a === '--ext') flags.ext = argv[++i] || '';
    else if (a === '--out') flags.out = argv[++i] || '';
    else if (a === '--db') flags.db = argv[++i] || '';
    else if (a === '--limit') flags.limit = Number(argv[++i]) || 50;
    else if (a.startsWith('-')) throw new Error(`Unknown flag: ${a}`);
    else positionals.push(a);
  }
  return { command, positionals, flags };
}

function seedLegacyCatalogs(db) {
  const charCatalog = path.join(WEBASSET_ROOT, 'assets', 'characters', 'index.json');
  if (db.countCharacters() === 0 && existsSync(charCatalog)) {
    const parsed = JSON.parse(readFileSync(charCatalog, 'utf8'));
    db.importCharacterCatalogIfEmpty(parsed, path.join(WEBASSET_ROOT, 'assets'));
  }
  const hgameCatalog = path.join(WEBASSET_ROOT, 'assets', 'hgame', 'index.json');
  if (db.countHGameAssets() === 0 && existsSync(hgameCatalog)) {
    const parsed = JSON.parse(readFileSync(hgameCatalog, 'utf8'));
    db.importHGameIndexIfEmpty(parsed, path.join(WEBASSET_ROOT, 'assets', 'hgame'));
  }
}

async function main() {
  const { command, positionals, flags } = parseArgs(process.argv.slice(2));
  if (command === 'help') {
    printHelp();
    return;
  }

  const dbPath = flags.db ? path.resolve(flags.db) : resolveDefaultDbPath(WEBASSET_ROOT);
  const db = openAssetDb(dbPath);
  try {
    seedLegacyCatalogs(db);

    if (command === 'sync') {
      const syncResult = await db.syncArtCatalog({ webassetRoot: WEBASSET_ROOT, rehash: flags.rehash });
      console.log(JSON.stringify({ ok: true, dbPath, syncResult, summary: db.getArtSummary() }, null, 2));
      return;
    }

    if (command === 'status') {
      console.log(JSON.stringify(db.getArtSummary(), null, 2));
      return;
    }

    if (command === 'search') {
      const result = db.searchArtAssets({
        query: positionals[0] || '',
        domain: flags.domain,
        category: flags.category,
        ext: flags.ext,
        limit: flags.limit,
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (command === 'verify') {
      const result = await db.verifyArtCatalog({ webassetRoot: WEBASSET_ROOT, deep: flags.deep });
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 1;
      return;
    }

    if (command === 'export-json') {
      const outPath = flags.out
        ? path.resolve(flags.out)
        : path.join(WEBASSET_ROOT, 'assets', 'characters', 'index.json');
      const data = db.exportCharacterCatalogJson();
      writeFileSync(outPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
      console.log(JSON.stringify({ ok: true, outPath, characters: data.characters.length }, null, 2));
      return;
    }

    throw new Error(`Unknown command: ${command}`);
  } finally {
    db.close();
  }
}

main().catch(err => {
  console.error(`assets-db failed: ${err.message}`);
  process.exitCode = 1;
});
