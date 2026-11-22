import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ART_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.svg', '.hdr', '.exr', '.ktx2',
  '.glb', '.gltf', '.bin', '.fbx', '.obj', '.mtl', '.blend',
  '.wav', '.mp3', '.ogg', '.flac', '.opus',
  '.json',
]);

const SKIP_FILENAMES = new Set(['.ds_store', 'thumbs.db']);

export const ART_SCAN_ROOTS = Object.freeze([
  { rel: 'assets/characters', domain: 'character' },
  { rel: 'assets/hgame', domain: 'hgame-media' },
  { rel: 'assets/pbr', domain: 'pbr' },
  { rel: 'assets/foliage', domain: 'foliage' },
  { rel: 'assets/models', domain: 'model' },
  { rel: 'public/assets/pbr', domain: 'pbr' },
  { rel: 'public/assets/models', domain: 'model' },
  { rel: 'public/assets/ui', domain: 'ui' },
  { rel: 'hgame-assets-cn/built', domain: 'hgame-cn' },
  { rel: 'hgame-assets-cn/raw', domain: 'hgame-cn' },
]);

function toPosix(relPath) {
  return relPath.split(path.sep).join('/');
}

export async function hashFileSha256(filePath) {
  const info = await stat(filePath);
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return {
    sha256: hash.digest('hex'),
    bytes: info.size,
    mtimeMs: Math.trunc(info.mtimeMs),
  };
}

function classifyCatalogEntry(relPosix, domain) {
  const lower = relPosix.toLowerCase();
  const ext = path.posix.extname(lower);
  let category = domain;
  let characterId = null;

  if (domain === 'character') {
    const m = /^assets\/characters\/([^/]+)\/(.+)$/.exec(lower);
    if (m) {
      characterId = m[1];
      const rest = m[2];
      if (rest.startsWith('images/')) category = 'reference';
      else if (rest.startsWith('generated/views/')) category = 'view-slice';
      else if (rest.startsWith('generated/')) category = 'generated';
      else if (rest.startsWith('models/high')) category = 'model-high';
      else if (rest.startsWith('models/low')) category = 'model-low';
      else if (rest.startsWith('models/')) category = 'model';
    }
  } else if (domain === 'hgame-cn') {
    if (lower.includes('/materials/')) category = 'material';
    else if (lower.includes('/decals/')) category = 'decal';
    else if (lower.includes('/foliage/')) category = 'foliage';
    else if (lower.includes('/models/')) category = 'model';
    else if (lower.includes('/pbr_cache/')) category = 'pbr-raw';
  } else if (ext === '.wav' || ext === '.mp3' || ext === '.ogg' || ext === '.flac' || ext === '.opus') {
    category = 'audio';
  } else if (ext === '.glb' || ext === '.gltf') {
    category = 'model';
  }
  return { category, characterId };
}

async function collectArtFiles(absDir, webassetRoot, out = []) {
  let entries;
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch (err) {
    if (err?.code === 'ENOENT') return out;
    throw err;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      await collectArtFiles(abs, webassetRoot, out);
    } else if (entry.isFile()) {
      const lower = entry.name.toLowerCase();
      if (SKIP_FILENAMES.has(lower)) continue;
      const ext = path.posix.extname(lower);
      if (!ART_EXTENSIONS.has(ext)) continue;
      out.push({ abs, relPosix: toPosix(path.relative(webassetRoot, abs)), ext });
    }
  }
  return out;
}

function parseJsonSafe(raw, fallback) {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function initSchema(db) {
  db.exec('PRAGMA busy_timeout = 5000;');
  const currentMode = db.prepare('PRAGMA journal_mode').get()?.journal_mode;
  if (String(currentMode || '').toLowerCase() !== 'wal') {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  db.exec(`
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      gender TEXT NOT NULL DEFAULT '',
      keywords_json TEXT NOT NULL DEFAULT '[]',
      aliases_json TEXT NOT NULL DEFAULT '[]',
      props_json TEXT NOT NULL DEFAULT '[]',
      personality_json TEXT NOT NULL DEFAULT '[]',
      research_json TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_characters_name ON characters(name);

    CREATE TABLE IF NOT EXISTS character_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      slot TEXT NOT NULL,
      name TEXT NOT NULL,
      rel_path TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT '',
      source_path TEXT NOT NULL DEFAULT '',
      sha256 TEXT NOT NULL DEFAULT '',
      bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_char_assets_char ON character_assets(character_id, slot);

    CREATE TABLE IF NOT EXISTS hgame_assets (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      rel_path TEXT NOT NULL UNIQUE,
      sha256 TEXT NOT NULL DEFAULT '',
      bytes INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_hgame_assets_kind ON hgame_assets(kind);

    CREATE TABLE IF NOT EXISTS art_catalog_assets (
      rel_path TEXT PRIMARY KEY,
      domain TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      character_id TEXT,
      sha256 TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      mtime_ms INTEGER NOT NULL,
      ext TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      first_seen_at TEXT NOT NULL,
      last_verified_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE INDEX IF NOT EXISTS idx_art_catalog_domain ON art_catalog_assets(domain, status);
    CREATE INDEX IF NOT EXISTS idx_art_catalog_char ON art_catalog_assets(character_id);
    CREATE INDEX IF NOT EXISTS idx_art_catalog_sha ON art_catalog_assets(sha256);

    CREATE TABLE IF NOT EXISTS backup_snapshots (
      id TEXT PRIMARY KEY,
      target_dir TEXT NOT NULL,
      snapshot_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      db_backup_path TEXT NOT NULL,
      db_sha256 TEXT NOT NULL,
      asset_files_total INTEGER NOT NULL,
      asset_files_copied INTEGER NOT NULL,
      asset_files_reused INTEGER NOT NULL,
      total_bytes INTEGER NOT NULL,
      verified INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT ''
    );
  `);

  db.prepare(`INSERT OR IGNORE INTO meta (key, value) VALUES ('schemaVersion', '1')`).run();
}

export function resolveDefaultDbPath(webassetRoot) {
  if (process.env.WEBASSET_DB_PATH?.trim()) {
    return path.resolve(process.env.WEBASSET_DB_PATH.trim());
  }
  return path.join(path.resolve(webassetRoot), 'data', 'assets.db');
}

export function openAssetDb(dbPath) {
  const absPath = path.resolve(dbPath);
  mkdirSync(path.dirname(absPath), { recursive: true });
  const db = new DatabaseSync(absPath);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      initSchema(db);
      break;
    } catch (err) {
      if (!/locked|busy/i.test(err?.message || '') || attempt === 4) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1));
    }
  }

  function withTransaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
      throw err;
    }
  }

  function countCharacters() {
    return db.prepare('SELECT COUNT(*) AS count FROM characters').get().count;
  }

  function countHGameAssets() {
    return db.prepare('SELECT COUNT(*) AS count FROM hgame_assets').get().count;
  }

  function fileStatsSync(baseRoot, relPosix) {
    if (!baseRoot || !relPosix) return { sha256: '', bytes: 0 };
    const abs = path.resolve(baseRoot, ...relPosix.split('/'));
    if (!existsSync(abs)) return { sha256: '', bytes: 0 };
    try {
      const st = statSync(abs);
      if (!st.isFile()) return { sha256: '', bytes: 0 };
      return { sha256: '', bytes: st.size };
    } catch {
      return { sha256: '', bytes: 0 };
    }
  }

  function importCharacterCatalogIfEmpty(catalogObj, imageRoot) {
    if (!catalogObj || !Array.isArray(catalogObj.characters)) return 0;

    const now = new Date().toISOString();
    const insertChar = db.prepare(`
      INSERT OR IGNORE INTO characters (
        id, name, gender, keywords_json, aliases_json, props_json, personality_json,
        research_json, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertAsset = db.prepare(`
      INSERT OR IGNORE INTO character_assets (
        character_id, slot, name, rel_path, kind, mode, source_path, sha256, bytes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let imported = 0;
    withTransaction(() => {
      if (countCharacters() > 0) return;
      catalogObj.characters.forEach((entry, idx) => {
        if (!entry || typeof entry.id !== 'string' || typeof entry.name !== 'string') return;
        insertChar.run(
          entry.id,
          entry.name,
          typeof entry.gender === 'string' ? entry.gender : '',
          JSON.stringify(Array.isArray(entry.keywords) ? entry.keywords : []),
          JSON.stringify(Array.isArray(entry.aliases) ? entry.aliases : []),
          JSON.stringify(Array.isArray(entry.props) ? entry.props : []),
          JSON.stringify(Array.isArray(entry.personality) ? entry.personality : []),
          entry.research ? JSON.stringify(entry.research) : null,
          idx,
          now,
          now,
        );

        for (const asset of Array.isArray(entry.assets) ? entry.assets : []) {
          if (!asset?.path) continue;
          const rel = String(asset.path).replaceAll('\\', '/');
          const { bytes } = fileStatsSync(imageRoot, rel);
          insertAsset.run(
            entry.id,
            'reference',
            asset.name || path.posix.basename(rel),
            rel,
            asset.kind || 'reference',
            '',
            asset.sourcePath || '',
            asset.sha256 || '',
            asset.bytes || bytes,
            asset.createdAt || now,
            now,
          );
        }

        for (const asset of Array.isArray(entry.generatedAssets) ? entry.generatedAssets : []) {
          if (!asset?.path) continue;
          const rel = String(asset.path).replaceAll('\\', '/');
          const { bytes } = fileStatsSync(imageRoot, rel);
          const mode = asset.mode === 'humanoid' ? 'humanoid' : 'default';
          insertAsset.run(
            entry.id,
            'generated',
            asset.name || path.posix.basename(rel),
            rel,
            asset.kind || 'ai-generated',
            mode,
            asset.sourcePath || '',
            asset.sha256 || '',
            asset.bytes || bytes,
            asset.createdAt || now,
            now,
          );
        }

        for (const mode of ['high', 'low']) {
          const m = entry.models?.[mode];
          if (!m?.path) continue;
          const rel = String(m.path).replaceAll('\\', '/');
          const { bytes } = fileStatsSync(imageRoot, rel);
          insertAsset.run(
            entry.id,
            `model_${mode}`,
            m.name || path.posix.basename(rel),
            rel,
            mode,
            mode,
            '',
            m.sha256 || '',
            m.bytes || bytes,
            m.updatedAt || now,
            m.updatedAt || now,
          );
        }
        imported += 1;
      });
    });

    return imported;
  }

  function hydrateCharacter(row, assetRows) {
    const assets = [];
    const generatedAssets = [];
    const models = {};

    for (const a of assetRows) {
      if (a.slot === 'reference') {
        assets.push({
          name: a.name,
          path: a.rel_path,
          kind: a.kind || 'reference',
          ...(a.source_path ? { sourcePath: a.source_path } : {}),
          ...(a.created_at ? { createdAt: a.created_at } : {}),
        });
      } else if (a.slot === 'generated') {
        generatedAssets.push({
          name: a.name,
          path: a.rel_path,
          kind: a.kind || 'ai-generated',
          mode: a.mode === 'humanoid' ? 'humanoid' : 'default',
          ...(a.source_path ? { sourcePath: a.source_path } : {}),
          ...(a.created_at ? { created_at: a.created_at, createdAt: a.created_at } : {}),
        });
      } else if (a.slot === 'model_high' || a.slot === 'model_low') {
        const mode = a.slot === 'model_high' ? 'high' : 'low';
        models[mode] = {
          name: a.name,
          path: a.rel_path,
          bytes: a.bytes,
          updatedAt: a.updated_at,
        };
      }
    }

    for (const g of generatedAssets) {
      delete g.created_at;
    }

    const out = {
      id: row.id,
      name: row.name,
      gender: row.gender || '',
      keywords: parseJsonSafe(row.keywords_json, []),
      aliases: parseJsonSafe(row.aliases_json, []),
      props: parseJsonSafe(row.props_json, []),
      personality: parseJsonSafe(row.personality_json, []),
      ...(row.research_json ? { research: parseJsonSafe(row.research_json, null) } : {}),
      assets,
      generatedAssets,
      ...(Object.keys(models).length ? { models } : {}),
    };
    return out;
  }

  function listCharacters() {
    const charRows = db.prepare('SELECT * FROM characters ORDER BY sort_order ASC, rowid ASC').all();
    const allAssets = db.prepare('SELECT * FROM character_assets ORDER BY id ASC').all();
    const byChar = new Map();
    for (const a of allAssets) {
      let arr = byChar.get(a.character_id);
      if (!arr) {
        arr = [];
        byChar.set(a.character_id, arr);
      }
      arr.push(a);
    }
    return charRows.map(row => hydrateCharacter(row, byChar.get(row.id) || []));
  }

  function getCharacter(id) {
    const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
    if (!row) return null;
    const assets = db.prepare('SELECT * FROM character_assets WHERE character_id = ? ORDER BY id ASC').all(id);
    return hydrateCharacter(row, assets);
  }

  function findCharacterByName(name) {
    const target = name.trim().toLocaleLowerCase();
    const rows = db.prepare('SELECT id, name FROM characters').all();
    return rows.find(r => r.name.trim().toLocaleLowerCase() === target) || null;
  }

  function insertCharacter(character) {
    const now = new Date().toISOString();
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM characters').get().m;
    db.prepare(`
      INSERT INTO characters (
        id, name, gender, keywords_json, aliases_json, props_json, personality_json,
        research_json, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      character.id,
      character.name,
      character.gender || '',
      JSON.stringify(character.keywords || []),
      JSON.stringify(character.aliases || []),
      JSON.stringify(character.props || []),
      JSON.stringify(character.personality || []),
      character.research ? JSON.stringify(character.research) : null,
      maxOrder + 1,
      now,
      now,
    );
    return getCharacter(character.id);
  }

  function addCharacterReferenceAsset(characterId, { name, relPath, sha256 = '', bytes = 0 }) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO character_assets (
        character_id, slot, name, rel_path, kind, mode, source_path, sha256, bytes, created_at, updated_at
      ) VALUES (?, 'reference', ?, ?, 'reference', '', '', ?, ?, ?, ?)
    `).run(characterId, name, relPath, sha256, bytes, now, now);
    db.prepare('UPDATE characters SET updated_at = ? WHERE id = ?').run(now, characterId);
  }

  function deleteCharacterReferenceAsset(characterId, name, relPath) {
    const now = new Date().toISOString();
    const info = db.prepare(`
      DELETE FROM character_assets
      WHERE character_id = ? AND slot = 'reference' AND name = ? AND rel_path = ?
    `).run(characterId, name, relPath);
    if (info.changes > 0) {
      db.prepare('UPDATE characters SET updated_at = ? WHERE id = ?').run(now, characterId);
    }
    return info.changes;
  }

  function replaceCharacterGeneratedAsset(characterId, mode, { name, relPath, sha256 = '', bytes = 0, createdAt }) {
    const now = createdAt || new Date().toISOString();
    const normalizedMode = mode === 'humanoid' ? 'humanoid' : 'default';
    return withTransaction(() => {
      const previous = db.prepare(`
        SELECT * FROM character_assets
        WHERE character_id = ? AND slot = 'generated' AND mode = ?
      `).all(characterId, normalizedMode);
      db.prepare(`
        DELETE FROM character_assets
        WHERE character_id = ? AND slot = 'generated' AND mode = ?
      `).run(characterId, normalizedMode);
      db.prepare(`
        INSERT INTO character_assets (
          character_id, slot, name, rel_path, kind, mode, source_path, sha256, bytes, created_at, updated_at
        ) VALUES (?, 'generated', ?, ?, 'ai-generated', ?, '', ?, ?, ?, ?)
      `).run(characterId, name, relPath, normalizedMode, sha256, bytes, now, now);
      db.prepare('UPDATE characters SET updated_at = ? WHERE id = ?').run(now, characterId);
      return previous;
    });
  }

  function upsertCharacterModel(characterId, mode, { name, relPath, sha256 = '', bytes = 0, updatedAt }) {
    const now = updatedAt || new Date().toISOString();
    const slot = mode === 'high' ? 'model_high' : 'model_low';
    return withTransaction(() => {
      const previous = db.prepare(`
        SELECT * FROM character_assets
        WHERE character_id = ? AND slot = ?
      `).all(characterId, slot);
      db.prepare(`
        DELETE FROM character_assets
        WHERE character_id = ? AND slot = ?
      `).run(characterId, slot);
      db.prepare(`
        INSERT INTO character_assets (
          character_id, slot, name, rel_path, kind, mode, source_path, sha256, bytes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?)
      `).run(characterId, slot, name, relPath, mode, mode, sha256, bytes, now, now);
      db.prepare('UPDATE characters SET updated_at = ? WHERE id = ?').run(now, characterId);
      return previous;
    });
  }

  function exportCharacterCatalogJson() {
    return {
      schemaVersion: 3,
      characters: listCharacters(),
    };
  }

  function importHGameIndexIfEmpty(indexObj, hgameAssetRoot) {
    if (!indexObj || countHGameAssets() > 0) return 0;
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO hgame_assets (
        id, kind, name, rel_path, sha256, bytes, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let count = 0;
    withTransaction(() => {
      for (const item of Array.isArray(indexObj.spritesheets) ? indexObj.spritesheets : []) {
        if (!item?.id || !item?.path) continue;
        const { bytes } = fileStatsSync(hgameAssetRoot, item.path);
        stmt.run(
          item.id,
          'spritesheet',
          item.name || path.posix.basename(item.path),
          item.path,
          item.sha256 || '',
          item.bytes || bytes,
          JSON.stringify({
            columns: item.columns ?? 3,
            rows: item.rows ?? 3,
            fps: item.fps ?? 8,
            inset: item.inset ?? 0,
            loop: item.loop !== false,
          }),
          item.createdAt || now,
          now,
        );
        count += 1;
      }
      for (const item of Array.isArray(indexObj.audio) ? indexObj.audio : []) {
        if (!item?.id || !item?.path) continue;
        const { bytes } = fileStatsSync(hgameAssetRoot, item.path);
        stmt.run(
          item.id,
          'audio',
          item.name || path.posix.basename(item.path),
          item.path,
          item.sha256 || '',
          item.bytes || bytes,
          JSON.stringify({ category: item.category || 'sfx' }),
          item.createdAt || now,
          now,
        );
        count += 1;
      }
    });
    return count;
  }

  function listHGameAssets(toFileUrl = p => `/files/hgame/${p}`) {
    const rows = db.prepare('SELECT * FROM hgame_assets ORDER BY created_at ASC, rowid ASC').all();
    const spritesheets = [];
    const audio = [];
    for (const row of rows) {
      const meta = parseJsonSafe(row.metadata_json, {});
      if (row.kind === 'spritesheet') {
        spritesheets.push({
          id: row.id,
          name: row.name,
          columns: meta.columns ?? 3,
          rows: meta.rows ?? 3,
          fps: meta.fps ?? 8,
          inset: meta.inset ?? 0,
          loop: meta.loop !== false,
          path: row.rel_path,
          url: toFileUrl(row.rel_path),
          createdAt: row.created_at,
        });
      } else if (row.kind === 'audio') {
        audio.push({
          id: row.id,
          name: row.name,
          category: meta.category || 'sfx',
          bytes: row.bytes,
          path: row.rel_path,
          url: toFileUrl(row.rel_path),
          createdAt: row.created_at,
        });
      }
    }
    return {
      schemaVersion: 1,
      models: [],
      spritesheets,
      vfx: [],
      materials: [],
      audio,
    };
  }

  function insertHGameAsset({ id, kind, name, relPath, sha256 = '', bytes = 0, metadata = {}, createdAt }) {
    const now = createdAt || new Date().toISOString();
    db.prepare(`
      INSERT INTO hgame_assets (id, kind, name, rel_path, sha256, bytes, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, kind, name, relPath, sha256, bytes, JSON.stringify(metadata), now, now);
  }

  function updateHGameSpritesheet(id, patch) {
    const row = db.prepare(`SELECT * FROM hgame_assets WHERE id = ? AND kind = 'spritesheet'`).get(id);
    if (!row) return null;
    const meta = parseJsonSafe(row.metadata_json, {});
    const nextName = patch.name ?? row.name;
    const nextMeta = {
      columns: patch.columns ?? meta.columns ?? 3,
      rows: patch.rows ?? meta.rows ?? 3,
      fps: patch.fps ?? meta.fps ?? 8,
      inset: patch.inset ?? meta.inset ?? 0,
      loop: patch.loop !== undefined ? Boolean(patch.loop) : (meta.loop !== false),
    };
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE hgame_assets SET name = ?, metadata_json = ?, updated_at = ? WHERE id = ?
    `).run(nextName, JSON.stringify(nextMeta), now, id);
    return {
      id: row.id,
      name: nextName,
      ...nextMeta,
      path: row.rel_path,
      createdAt: row.created_at,
    };
  }

  function deleteHGameAsset(kind, id) {
    const dbKind = kind === 'spritesheets' ? 'spritesheet' : kind;
    const row = db.prepare('SELECT * FROM hgame_assets WHERE id = ? AND kind = ?').get(id, dbKind);
    if (!row) return null;
    db.prepare('DELETE FROM hgame_assets WHERE id = ?').run(id);
    return row;
  }

  async function syncArtCatalog({ webassetRoot, rehash = false, roots = ART_SCAN_ROOTS } = {}) {
    const rootAbs = path.resolve(webassetRoot);
    const existingRows = db.prepare('SELECT rel_path, sha256, bytes, mtime_ms, status FROM art_catalog_assets').all();
    const existingMap = new Map(existingRows.map(r => [r.rel_path, r]));
    const seen = new Set();
    const now = new Date().toISOString();

    const collected = [];
    for (const spec of roots) {
      const absDir = path.join(rootAbs, ...spec.rel.split('/'));
      const files = await collectArtFiles(absDir, rootAbs);
      for (const f of files) {
        collected.push({ ...f, domain: spec.domain });
      }
    }

    const toUpsert = [];
    let added = 0;
    let updated = 0;
    let unchanged = 0;

    for (const item of collected) {
      seen.add(item.relPosix);
      const st = await stat(item.abs);
      const bytes = st.size;
      const mtimeMs = Math.trunc(st.mtimeMs);
      const prev = existingMap.get(item.relPosix);

      let sha256;
      if (!rehash && prev && prev.bytes === bytes && prev.mtime_ms === mtimeMs && prev.sha256) {
        sha256 = prev.sha256;
        if (prev.status === 'active') unchanged += 1;
        else updated += 1;
      } else {
        const hashed = await hashFileSha256(item.abs);
        sha256 = hashed.sha256;
        if (!prev) added += 1;
        else updated += 1;
      }

      const { category, characterId } = classifyCatalogEntry(item.relPosix, item.domain);
      toUpsert.push({
        relPath: item.relPosix,
        domain: item.domain,
        category,
        characterId,
        sha256,
        bytes,
        mtimeMs,
        ext: item.ext,
      });
    }

    let missing = 0;
    const upsertStmt = db.prepare(`
      INSERT INTO art_catalog_assets (
        rel_path, domain, category, character_id, sha256, bytes, mtime_ms, ext, metadata_json,
        first_seen_at, last_verified_at, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, 'active')
      ON CONFLICT(rel_path) DO UPDATE SET
        domain = excluded.domain,
        category = excluded.category,
        character_id = excluded.character_id,
        sha256 = excluded.sha256,
        bytes = excluded.bytes,
        mtime_ms = excluded.mtime_ms,
        ext = excluded.ext,
        last_verified_at = excluded.last_verified_at,
        status = 'active'
    `);
    const markMissingStmt = db.prepare(`
      UPDATE art_catalog_assets SET status = 'missing', last_verified_at = ? WHERE rel_path = ?
    `);

    withTransaction(() => {
      for (const row of toUpsert) {
        upsertStmt.run(
          row.relPath, row.domain, row.category, row.characterId,
          row.sha256, row.bytes, row.mtimeMs, row.ext, now, now,
        );
      }
      for (const prev of existingRows) {
        if (!seen.has(prev.rel_path) && prev.status !== 'missing') {
          markMissingStmt.run(now, prev.rel_path);
          missing += 1;
        }
      }
    });

    return {
      totalScanned: collected.length,
      added,
      updated,
      unchanged,
      missing,
      syncedAt: now,
    };
  }

  async function verifyArtCatalog({ webassetRoot, deep = false } = {}) {
    const rootAbs = path.resolve(webassetRoot);
    const rows = db.prepare("SELECT rel_path, sha256, bytes FROM art_catalog_assets WHERE status = 'active' ORDER BY rel_path ASC").all();
    let okCount = 0;
    const missingFiles = [];
    const mismatchFiles = [];

    for (const row of rows) {
      const abs = path.resolve(rootAbs, ...row.rel_path.split('/'));
      let st;
      try {
        st = await stat(abs);
      } catch {
        missingFiles.push(row.rel_path);
        continue;
      }
      if (!st.isFile()) {
        missingFiles.push(row.rel_path);
        continue;
      }
      if (st.size !== row.bytes) {
        mismatchFiles.push({ relPath: row.rel_path, reason: 'size', expectedBytes: row.bytes, actualBytes: st.size });
        continue;
      }
      if (deep) {
        const hashed = await hashFileSha256(abs);
        if (hashed.sha256 !== row.sha256) {
          mismatchFiles.push({ relPath: row.rel_path, reason: 'sha256', expectedSha256: row.sha256, actualSha256: hashed.sha256 });
          continue;
        }
      }
      okCount += 1;
    }

    return {
      ok: missingFiles.length === 0 && mismatchFiles.length === 0,
      checked: rows.length,
      okCount,
      deep,
      missingFiles,
      mismatchFiles,
    };
  }

  function searchArtAssets({ query = '', domain = '', category = '', ext = '', status = 'active', limit = 100, offset = 0 } = {}) {
    const clauses = [];
    const params = [];
    if (status) {
      clauses.push('status = ?');
      params.push(status);
    }
    if (domain) {
      clauses.push('domain = ?');
      params.push(domain);
    }
    if (category) {
      clauses.push('category = ?');
      params.push(category);
    }
    if (ext) {
      clauses.push('ext = ?');
      params.push(ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`);
    }
    if (query.trim()) {
      clauses.push('(LOWER(rel_path) LIKE ? OR LOWER(COALESCE(character_id, \'\')) LIKE ? OR sha256 LIKE ?)');
      const like = `%${query.trim().toLowerCase()}%`;
      params.push(like, like, `${query.trim().toLowerCase()}%`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS count FROM art_catalog_assets ${where}`).get(...params).count;
    const safeLimit = Math.min(500, Math.max(1, Number(limit) || 100));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const items = db.prepare(`
      SELECT rel_path, domain, category, character_id, sha256, bytes, mtime_ms, ext, first_seen_at, last_verified_at, status
      FROM art_catalog_assets ${where}
      ORDER BY rel_path ASC
      LIMIT ? OFFSET ?
    `).all(...params, safeLimit, safeOffset);
    return { total, offset: safeOffset, limit: safeLimit, items };
  }

  function getArtSummary() {
    const byDomain = db.prepare(`
      SELECT domain, status, COUNT(*) AS files, COALESCE(SUM(bytes), 0) AS bytes
      FROM art_catalog_assets
      GROUP BY domain, status
      ORDER BY domain ASC
    `).all();
    const totals = db.prepare(`
      SELECT COUNT(*) AS files, COALESCE(SUM(bytes), 0) AS bytes
      FROM art_catalog_assets WHERE status = 'active'
    `).get();
    const characterCount = countCharacters();
    const characterAssetCount = db.prepare('SELECT COUNT(*) AS count FROM character_assets').get().count;
    const hgameAssetCount = countHGameAssets();
    const latestBackup = db.prepare('SELECT * FROM backup_snapshots ORDER BY created_at DESC LIMIT 1').get() || null;

    return {
      dbPath: absPath,
      schemaVersion: 1,
      characters: characterCount,
      characterAssets: characterAssetCount,
      hgameMediaAssets: hgameAssetCount,
      artCatalog: {
        activeFiles: totals.files,
        activeBytes: totals.bytes,
        byDomain,
      },
      latestBackup,
    };
  }

  function recordBackupSnapshot(snapshot) {
    db.prepare(`
      INSERT INTO backup_snapshots (
        id, target_dir, snapshot_name, created_at, db_backup_path, db_sha256,
        asset_files_total, asset_files_copied, asset_files_reused, total_bytes, verified, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      snapshot.id,
      snapshot.targetDir,
      snapshot.snapshotName,
      snapshot.createdAt,
      snapshot.dbBackupPath,
      snapshot.dbSha256,
      snapshot.assetFilesTotal,
      snapshot.assetFilesCopied,
      snapshot.assetFilesReused,
      snapshot.totalBytes,
      snapshot.verified ? 1 : 0,
      snapshot.notes || '',
    );
  }

  function listBackupSnapshots(limit = 20) {
    return db.prepare('SELECT * FROM backup_snapshots ORDER BY created_at DESC LIMIT ?').all(Math.max(1, limit));
  }

  function markSnapshotVerified(id, verified) {
    db.prepare('UPDATE backup_snapshots SET verified = ? WHERE id = ?').run(verified ? 1 : 0, id);
  }

  function close() {
    db.close();
  }

  return {
    db,
    dbPath: absPath,
    withTransaction,
    countCharacters,
    countHGameAssets,
    importCharacterCatalogIfEmpty,
    listCharacters,
    getCharacter,
    findCharacterByName,
    insertCharacter,
    addCharacterReferenceAsset,
    deleteCharacterReferenceAsset,
    replaceCharacterGeneratedAsset,
    upsertCharacterModel,
    exportCharacterCatalogJson,
    importHGameIndexIfEmpty,
    listHGameAssets,
    insertHGameAsset,
    updateHGameSpritesheet,
    deleteHGameAsset,
    syncArtCatalog,
    verifyArtCatalog,
    searchArtAssets,
    getArtSummary,
    recordBackupSnapshot,
    listBackupSnapshots,
    markSnapshotVerified,
    close,
  };
}
