import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { backup as sqliteBackup, DatabaseSync } from 'node:sqlite';
import { hashFileSha256 } from './asset-db.mjs';

function isInside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function casBlobPath(backupDir, sha256) {
  const clean = sha256.toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(clean)) {
    throw new RangeError(`Invalid sha256 digest: ${sha256}`);
  }
  return path.join(backupDir, 'cas', 'objects', clean.slice(0, 2), clean);
}

async function atomicWriteFile(dstPath, writer) {
  await mkdir(path.dirname(dstPath), { recursive: true });
  const tmp = `${dstPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writer(tmp);
    await rename(tmp, dstPath);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

async function ensureBlobInCas(srcAbs, sha256, bytes, backupDir) {
  const dst = casBlobPath(backupDir, sha256);
  try {
    const existing = await stat(dst);
    if (existing.isFile() && existing.size === bytes) {
      return { copied: false, dst };
    }
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
  await atomicWriteFile(dst, async tmp => {
    await pipeline(createReadStream(srcAbs), createWriteStream(tmp));
  });
  return { copied: true, dst };
}

export function resolveBackupDir({ hgameRoot = null, overrideDir = null } = {}) {
  if (overrideDir && String(overrideDir).trim()) {
    return path.resolve(String(overrideDir).trim());
  }
  if (process.env.HGAME_ASSET_BACKUP_DIR?.trim()) {
    return path.resolve(process.env.HGAME_ASSET_BACKUP_DIR.trim());
  }
  if (hgameRoot) {
    const localCfgPath = path.join(path.resolve(hgameRoot), '.hgame.local.json');
    if (existsSync(localCfgPath)) {
      try {
        const cfg = JSON.parse(readFileSync(localCfgPath, 'utf8'));
        if (typeof cfg?.assetBackupDir === 'string' && cfg.assetBackupDir.trim()) {
          return path.resolve(hgameRoot, cfg.assetBackupDir.trim());
        }
      } catch {
        // Ignore malformed local config and fall through to defaults.
      }
    }
  }
  if (process.platform === 'win32' && existsSync('D:\\')) {
    return path.join('D:\\', 'Backups', 'HGame-Assets');
  }
  return path.join(os.homedir(), '.hgame', 'asset-backups');
}

function makeSnapshotName(now = new Date()) {
  return now.toISOString().replaceAll(':', '-').replace('.', '-');
}

export async function createAssetBackup({
  webassetRoot,
  hgameRoot = null,
  assetDb,
  backupDir = null,
  notes = '',
  rehash = false,
  verify = true,
} = {}) {
  if (!webassetRoot || !assetDb) {
    throw new TypeError('webassetRoot and assetDb are required for createAssetBackup');
  }
  const absWebAsset = path.resolve(webassetRoot);
  const absBackup = resolveBackupDir({ hgameRoot, overrideDir: backupDir });
  const syncResult = await assetDb.syncArtCatalog({ webassetRoot: absWebAsset, rehash });

  const now = new Date();
  const snapshotId = randomUUID();
  const snapshotName = makeSnapshotName(now);
  const snapshotDir = path.join(absBackup, 'snapshots', snapshotName);
  const dbSnapshotPath = path.join(snapshotDir, 'assets.db');
  const dbLatestPath = path.join(absBackup, 'db', 'latest-assets.db');
  await mkdir(snapshotDir, { recursive: true });
  await mkdir(path.dirname(dbLatestPath), { recursive: true });

  // Online SQLite hot backup works safely even under live WAL traffic.
  const dbTmp = `${dbSnapshotPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await sqliteBackup(assetDb.db, dbTmp);
    await rename(dbTmp, dbSnapshotPath);
  } catch (err) {
    await rm(dbTmp, { force: true }).catch(() => {});
    throw err;
  }

  const dbHash = await hashFileSha256(dbSnapshotPath);
  await atomicWriteFile(`${dbSnapshotPath}.sha256`, async tmp => {
    await writeFile(tmp, `${dbHash.sha256}  assets.db\n`, 'utf8');
  });
  await atomicWriteFile(dbLatestPath, async tmp => {
    await pipeline(createReadStream(dbSnapshotPath), createWriteStream(tmp));
  });

  const activeRows = assetDb.db
    .prepare("SELECT rel_path, domain, category, sha256, bytes, mtime_ms FROM art_catalog_assets WHERE status = 'active' ORDER BY rel_path ASC")
    .all();

  let copied = 0;
  let reused = 0;
  let totalBytes = 0;
  const manifestEntries = [];

  for (const row of activeRows) {
    const absSrc = path.resolve(absWebAsset, ...row.rel_path.split('/'));
    if (!isInside(absWebAsset, absSrc)) continue;
    let st;
    try {
      st = await stat(absSrc);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    let sha256 = row.sha256;
    let bytes = row.bytes;
    if (st.size !== row.bytes || !sha256) {
      const rehashed = await hashFileSha256(absSrc);
      sha256 = rehashed.sha256;
      bytes = rehashed.bytes;
    }
    const res = await ensureBlobInCas(absSrc, sha256, bytes, absBackup);
    if (res.copied) copied += 1;
    else reused += 1;
    totalBytes += bytes;
    manifestEntries.push({
      relPath: row.rel_path,
      domain: row.domain,
      category: row.category,
      sha256,
      bytes,
      mtimeMs: Math.trunc(st.mtimeMs),
    });
  }

  const manifest = {
    schemaVersion: 1,
    snapshotId,
    snapshotName,
    createdAt: now.toISOString(),
    sourceRoot: absWebAsset,
    dbFile: 'assets.db',
    dbSha256: dbHash.sha256,
    dbBytes: dbHash.bytes,
    syncResult,
    stats: {
      filesTotal: manifestEntries.length,
      filesCopied: copied,
      filesReused: reused,
      totalBytes,
    },
    notes,
    files: manifestEntries,
  };

  await atomicWriteFile(path.join(snapshotDir, 'manifest.json'), async tmp => {
    await writeFile(tmp, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  });

  let verifyResult = null;
  if (verify) {
    verifyResult = await verifyBackupSnapshot({ backupDir: absBackup, snapshotName, deep: false });
    if (!verifyResult.ok) {
      throw new Error(`Backup verification failed for ${snapshotName}: ${JSON.stringify(verifyResult)}`);
    }
  }

  const latestPointer = {
    schemaVersion: 1,
    snapshotId,
    snapshotName,
    createdAt: now.toISOString(),
    dbSha256: dbHash.sha256,
    filesTotal: manifestEntries.length,
    totalBytes,
    verified: Boolean(verifyResult?.ok),
  };
  await atomicWriteFile(path.join(absBackup, 'latest.json'), async tmp => {
    await writeFile(tmp, JSON.stringify(latestPointer, null, 2) + '\n', 'utf8');
  });

  assetDb.recordBackupSnapshot({
    id: snapshotId,
    targetDir: absBackup,
    snapshotName,
    createdAt: now.toISOString(),
    dbBackupPath: dbSnapshotPath,
    dbSha256: dbHash.sha256,
    assetFilesTotal: manifestEntries.length,
    assetFilesCopied: copied,
    assetFilesReused: reused,
    totalBytes,
    verified: Boolean(verifyResult?.ok),
    notes,
  });

  return {
    ok: true,
    snapshotId,
    snapshotName,
    backupDir: absBackup,
    snapshotDir,
    dbBackupPath: dbSnapshotPath,
    dbSha256: dbHash.sha256,
    filesTotal: manifestEntries.length,
    filesCopied: copied,
    filesReused: reused,
    totalBytes,
    verified: Boolean(verifyResult?.ok),
    syncResult,
  };
}

export async function verifyBackupSnapshot({
  backupDir,
  hgameRoot = null,
  snapshotName = null,
  deep = false,
} = {}) {
  const absBackup = resolveBackupDir({ hgameRoot, overrideDir: backupDir });
  let targetName = snapshotName;
  if (!targetName) {
    const latest = JSON.parse(await readFile(path.join(absBackup, 'latest.json'), 'utf8'));
    targetName = latest.snapshotName;
  }
  const snapshotDir = path.join(absBackup, 'snapshots', targetName);
  const manifest = JSON.parse(await readFile(path.join(snapshotDir, 'manifest.json'), 'utf8'));
  const dbPath = path.join(snapshotDir, manifest.dbFile || 'assets.db');
  const dbHash = await hashFileSha256(dbPath);
  const dbShaOk = dbHash.sha256 === manifest.dbSha256;

  let sqliteIntegrity = 'unknown';
  let dbCheckOk = false;
  const checkDb = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const res = checkDb.prepare('PRAGMA integrity_check').get();
    sqliteIntegrity = res?.integrity_check || 'failed';
    dbCheckOk = sqliteIntegrity === 'ok';
  } finally {
    checkDb.close();
  }

  const missingBlobs = [];
  const corruptBlobs = [];
  let checkedBlobs = 0;

  for (const entry of manifest.files || []) {
    const blob = casBlobPath(absBackup, entry.sha256);
    let st;
    try {
      st = await stat(blob);
    } catch {
      missingBlobs.push({ relPath: entry.relPath, sha256: entry.sha256 });
      continue;
    }
    if (!st.isFile() || st.size !== entry.bytes) {
      corruptBlobs.push({ relPath: entry.relPath, reason: 'size', expected: entry.bytes, actual: st.size });
      continue;
    }
    if (deep) {
      const actual = await hashFileSha256(blob);
      if (actual.sha256 !== entry.sha256) {
        corruptBlobs.push({ relPath: entry.relPath, reason: 'sha256', expected: entry.sha256, actual: actual.sha256 });
        continue;
      }
    }
    checkedBlobs += 1;
  }

  return {
    ok: dbShaOk && dbCheckOk && missingBlobs.length === 0 && corruptBlobs.length === 0,
    backupDir: absBackup,
    snapshotName: targetName,
    dbShaOk,
    sqliteIntegrity,
    checkedBlobs,
    totalDeclared: (manifest.files || []).length,
    deep,
    missingBlobs,
    corruptBlobs,
  };
}

export async function listBackups({ backupDir = null, hgameRoot = null } = {}) {
  const absBackup = resolveBackupDir({ hgameRoot, overrideDir: backupDir });
  const snapshotsDir = path.join(absBackup, 'snapshots');
  let latest = null;
  try {
    latest = JSON.parse(await readFile(path.join(absBackup, 'latest.json'), 'utf8'));
  } catch {
    // No backups yet.
  }
  let dirs = [];
  try {
    dirs = (await readdir(snapshotsDir, { withFileTypes: true }))
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort((a, b) => b.localeCompare(a));
  } catch {
    dirs = [];
  }

  const snapshots = [];
  for (const name of dirs) {
    try {
      const manifest = JSON.parse(await readFile(path.join(snapshotsDir, name, 'manifest.json'), 'utf8'));
      snapshots.push({
        snapshotId: manifest.snapshotId,
        snapshotName: manifest.snapshotName,
        createdAt: manifest.createdAt,
        dbSha256: manifest.dbSha256,
        filesTotal: manifest.stats?.filesTotal ?? 0,
        filesCopied: manifest.stats?.filesCopied ?? 0,
        filesReused: manifest.stats?.filesReused ?? 0,
        totalBytes: manifest.stats?.totalBytes ?? 0,
        notes: manifest.notes || '',
      });
    } catch {
      snapshots.push({ snapshotName: name, corruptManifest: true });
    }
  }
  return { backupDir: absBackup, latest, snapshots };
}

export async function restoreAssetBackup({
  backupDir = null,
  hgameRoot = null,
  snapshotName = null,
  webassetRoot,
  dbPath,
  force = false,
} = {}) {
  if (!webassetRoot || !dbPath) {
    throw new TypeError('webassetRoot and dbPath are required for restoreAssetBackup');
  }
  const absBackup = resolveBackupDir({ hgameRoot, overrideDir: backupDir });
  const absWebAsset = path.resolve(webassetRoot);
  const absDb = path.resolve(dbPath);

  const verification = await verifyBackupSnapshot({ backupDir: absBackup, snapshotName, deep: true });
  if (!verification.ok) {
    throw new Error(`Refusing restore from failed backup verification: ${JSON.stringify(verification)}`);
  }

  const snapshotDir = path.join(absBackup, 'snapshots', verification.snapshotName);
  const manifest = JSON.parse(await readFile(path.join(snapshotDir, 'manifest.json'), 'utf8'));
  const backupDbPath = path.join(snapshotDir, manifest.dbFile || 'assets.db');

  await mkdir(path.dirname(absDb), { recursive: true });
  await rm(`${absDb}-wal`, { force: true }).catch(() => {});
  await rm(`${absDb}-shm`, { force: true }).catch(() => {});
  await atomicWriteFile(absDb, async tmp => {
    await pipeline(createReadStream(backupDbPath), createWriteStream(tmp));
  });

  let restored = 0;
  let skipped = 0;

  for (const entry of manifest.files || []) {
    const dst = path.resolve(absWebAsset, ...entry.relPath.split('/'));
    if (!isInside(absWebAsset, dst)) {
      throw new Error(`Unsafe restore path rejected: ${entry.relPath}`);
    }
    if (!force && existsSync(dst)) {
      try {
        const cur = await hashFileSha256(dst);
        if (cur.sha256 === entry.sha256 && cur.bytes === entry.bytes) {
          skipped += 1;
          continue;
        }
      } catch {
        // Restore over unreadable file.
      }
    }
    const blob = casBlobPath(absBackup, entry.sha256);
    await atomicWriteFile(dst, async tmp => {
      const hash = createHash('sha256');
      await new Promise((resolve, reject) => {
        const rs = createReadStream(blob);
        const ws = createWriteStream(tmp);
        rs.on('data', chunk => hash.update(chunk));
        rs.on('error', reject);
        ws.on('error', reject);
        ws.on('finish', resolve);
        rs.pipe(ws);
      });
      if (hash.digest('hex') !== entry.sha256) {
        throw new Error(`Restored file hash mismatch for ${entry.relPath}`);
      }
    });
    restored += 1;
  }

  return {
    ok: true,
    snapshotName: verification.snapshotName,
    backupDir: absBackup,
    webassetRoot: absWebAsset,
    dbPath: absDb,
    restored,
    skipped,
    totalFiles: (manifest.files || []).length,
  };
}

export async function pruneAssetBackups({ backupDir = null, hgameRoot = null, keep = 5, dryRun = true } = {}) {
  const absBackup = resolveBackupDir({ hgameRoot, overrideDir: backupDir });
  const { snapshots } = await listBackups({ backupDir: absBackup });
  const safeKeep = Math.max(1, Number(keep) || 5);
  const toKeep = snapshots.slice(0, safeKeep);
  const toRemove = snapshots.slice(safeKeep);

  if (!dryRun) {
    for (const snap of toRemove) {
      await rm(path.join(absBackup, 'snapshots', snap.snapshotName), { recursive: true, force: true });
    }
  }

  const referencedShas = new Set();
  for (const snap of toKeep) {
    try {
      const manifest = JSON.parse(await readFile(path.join(absBackup, 'snapshots', snap.snapshotName, 'manifest.json'), 'utf8'));
      for (const f of manifest.files || []) {
        if (f?.sha256) referencedShas.add(f.sha256.toLowerCase());
      }
    } catch {
      // Skip malformed manifest.
    }
  }

  const objectsDir = path.join(absBackup, 'cas', 'objects');
  let prunedBlobs = 0;
  let reclaimedBytes = 0;
  try {
    const prefixes = await readdir(objectsDir, { withFileTypes: true });
    for (const p of prefixes) {
      if (!p.isDirectory()) continue;
      const pDir = path.join(objectsDir, p.name);
      const blobs = await readdir(pDir, { withFileTypes: true });
      for (const b of blobs) {
        if (!b.isFile()) continue;
        const sha = b.name.toLowerCase();
        if (!/^[a-f0-9]{64}$/.test(sha) || referencedShas.has(sha)) continue;
        const absBlob = path.join(pDir, b.name);
        const st = await stat(absBlob);
        prunedBlobs += 1;
        reclaimedBytes += st.size;
        if (!dryRun) await rm(absBlob, { force: true });
      }
    }
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }

  return {
    backupDir: absBackup,
    dryRun,
    keptSnapshots: toKeep.length,
    removedSnapshots: toRemove.map(s => s.snapshotName),
    prunedBlobs,
    reclaimedBytes,
  };
}
