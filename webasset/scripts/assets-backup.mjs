#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createAssetBackup,
  listBackups,
  pruneAssetBackups,
  resolveBackupDir,
  restoreAssetBackup,
  verifyBackupSnapshot,
} from '../lib/asset-backup.mjs';
import { openAssetDb, resolveDefaultDbPath } from '../lib/asset-db.mjs';

const WEBASSET_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HGAME_ROOT = path.resolve(WEBASSET_ROOT, '..');

function printHelp() {
  console.log(`Usage: node webasset/scripts/assets-backup.mjs <command> [options]

Commands:
  backup [--target <dir>] [--notes <text>] [--rehash]   Create deduplicated CAS + SQLite hot backup snapshot
  verify [--target <dir>] [--snapshot <name>] [--deep]  Verify SQLite integrity & backed-up CAS blobs
  list [--target <dir>]                                 List available backup snapshots
  restore [--target <dir>] [--snapshot <name>] [--force] Restore SQLite DB & art files from backup
  prune [--target <dir>] [--keep <n>] [--apply]         Prune old snapshots & unreferenced CAS blobs (dry-run by default)`);
}

function parseArgs(argv) {
  const first = argv[0];
  if (!first || first === '--help' || first === '-h') return { command: first === '--help' || first === '-h' ? 'help' : 'backup', flags: {} };
  const hasExplicitCommand = !first.startsWith('-');
  const command = hasExplicitCommand ? first : 'backup';
  const start = hasExplicitCommand ? 1 : 0;
  const flags = { target: '', snapshot: '', notes: '', rehash: false, deep: false, force: false, keep: 5, apply: false, db: '' };
  for (let i = start; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--target') flags.target = argv[++i] || '';
    else if (a === '--snapshot') flags.snapshot = argv[++i] || '';
    else if (a === '--notes') flags.notes = argv[++i] || '';
    else if (a === '--db') flags.db = argv[++i] || '';
    else if (a === '--keep') flags.keep = Number(argv[++i]) || 5;
    else if (a === '--rehash') flags.rehash = true;
    else if (a === '--deep') flags.deep = true;
    else if (a === '--force') flags.force = true;
    else if (a === '--apply') flags.apply = true;
    else throw new Error(`Unknown flag: ${a}`);
  }
  return { command, flags };
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
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (command === 'help') {
    printHelp();
    return;
  }

  const backupDir = resolveBackupDir({ hgameRoot: HGAME_ROOT, overrideDir: flags.target || null });
  const dbPath = flags.db ? path.resolve(flags.db) : resolveDefaultDbPath(WEBASSET_ROOT);

  if (command === 'list') {
    const out = await listBackups({ backupDir, hgameRoot: HGAME_ROOT });
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (command === 'verify') {
    const out = await verifyBackupSnapshot({
      backupDir,
      hgameRoot: HGAME_ROOT,
      snapshotName: flags.snapshot || null,
      deep: flags.deep,
    });
    console.log(JSON.stringify(out, null, 2));
    if (!out.ok) process.exitCode = 1;
    return;
  }

  if (command === 'restore') {
    const out = await restoreAssetBackup({
      backupDir,
      hgameRoot: HGAME_ROOT,
      snapshotName: flags.snapshot || null,
      webassetRoot: WEBASSET_ROOT,
      dbPath,
      force: flags.force,
    });
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (command === 'prune') {
    const out = await pruneAssetBackups({
      backupDir,
      hgameRoot: HGAME_ROOT,
      keep: flags.keep,
      dryRun: !flags.apply,
    });
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (command === 'backup') {
    const db = openAssetDb(dbPath);
    try {
      seedLegacyCatalogs(db);
      const out = await createAssetBackup({
        webassetRoot: WEBASSET_ROOT,
        hgameRoot: HGAME_ROOT,
        assetDb: db,
        backupDir,
        notes: flags.notes,
        rehash: flags.rehash,
        verify: true,
      });
      console.log(JSON.stringify(out, null, 2));
    } finally {
      db.close();
    }
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch(err => {
  console.error(`assets-backup failed: ${err.message}`);
  process.exitCode = 1;
});
