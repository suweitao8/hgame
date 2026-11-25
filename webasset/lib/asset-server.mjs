import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { openAssetDb, resolveDefaultDbPath } from './asset-db.mjs';
import { buildCharacterSheetPrompt } from './character-image-prompt.mjs';
import { researchCharacterOnline } from './character-research.mjs';

const IMAGE_EXTENSIONS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif']);
const MODEL_EXTENSIONS = new Set(['.glb']);
const MODEL_MODES = new Set(['high', 'low']);
const MIME = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.glb': 'model/gltf-binary',
};
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_REFERENCE_IMAGES = 4;
const MAX_GENERATED_IMAGE_BYTES = 30 * 1024 * 1024;
const MAX_MODEL_BYTES = 150 * 1024 * 1024;
const MAX_CHARACTER_REQUEST_BYTES = 16 * 1024;
const UPLOAD_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const CHARACTER_GENDERS = new Set(['male', 'female']);
const GENERATION_MODES = new Set(['default', 'humanoid']);

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function sendJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

function toAssetUrl(relativePath) {
  const encoded = relativePath.split('/').map(encodeURIComponent).join('/');
  return '/files/images/' + encoded;
}

function toModelUrl(relativePath) {
  return '/files/models/' + relativePath.split('/').map(encodeURIComponent).join('/');
}

const AVATAR_MAX_SIZE = 256;

export function computeFilmAvatarCropRect(width, height) {
  const w = Math.max(1, Math.floor(Number(width) || 1));
  const h = Math.max(1, Math.floor(Number(height) || 1));
  const cellW = Math.max(1, Math.floor(w / 4));
  const cellH = Math.max(1, Math.floor(h / 2));
  const cellSize = Math.max(1, Math.min(cellW, cellH));
  // Offset slightly from top-left outer border (2%) and keep 92% width/height so
  // slightly shifted cell divider lines on the right/bottom edges are excluded.
  if (cellSize < 32) {
    return { left: 0, top: 0, width: cellSize, height: cellSize };
  }
  const offset = Math.floor(cellSize * 0.02);
  const size = Math.max(1, Math.min(cellSize - offset, Math.floor(cellSize * 0.92)));
  return {
    left: offset,
    top: offset,
    width: size,
    height: size,
  };
}

function findFilmGeneratedAsset(generatedAssets) {
  return (Array.isArray(generatedAssets) ? generatedAssets : [])
    .findLast(asset => asset?.mode !== 'humanoid');
}

function safeModelName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (!name || name.length > 120 || !/^[^\\/:*?"<>|\x00-\x1f]+\.glb$/i.test(name) || name.startsWith('.') || name.includes('..')) return null;
  return name;
}

function validateGlb(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 28 || buffer.toString('ascii', 0, 4) !== 'glTF'
    || buffer.readUInt32LE(4) !== 2 || buffer.readUInt32LE(8) !== buffer.length) throw new Error('INVALID_MODEL');
  const jsonSize = buffer.readUInt32LE(12);
  if (buffer.readUInt32LE(16) !== 0x4e4f534a || jsonSize < 2 || jsonSize > 24 * 1024 * 1024
    || jsonSize % 4 !== 0 || 20 + jsonSize > buffer.length) throw new Error('INVALID_MODEL');
  let model;
  try {
    model = JSON.parse(buffer.toString('utf8', 20, 20 + jsonSize).trim());
  } catch {
    throw new Error('INVALID_MODEL');
  }
  if (model?.asset?.version !== '2.0' || !Array.isArray(model.meshes) || !model.meshes.length) throw new Error('INVALID_MODEL');
  if (!Array.isArray(model.buffers) || model.buffers.length !== 1 || !Number.isSafeInteger(model.buffers[0].byteLength)) {
    throw new Error('INVALID_MODEL');
  }
  if (Array.isArray(model.buffers) && model.buffers.some(item => item.uri)) throw new Error('EXTERNAL_MODEL_ASSETS');
  if (Array.isArray(model.images) && model.images.some(item => item.uri && !/^data:image\/(png|jpeg|webp);base64,/i.test(item.uri))) {
    throw new Error('EXTERNAL_MODEL_ASSETS');
  }
  const binStart = 20 + jsonSize;
  if (binStart + 8 > buffer.length || buffer.readUInt32LE(binStart + 4) !== 0x004e4942
    || binStart + 8 + buffer.readUInt32LE(binStart) !== buffer.length
    || model.buffers[0].byteLength > buffer.readUInt32LE(binStart)) throw new Error('INVALID_MODEL');
}

function safeCatalogPath(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const segments = value.replaceAll('\\', '/').split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || segment.includes('\0'))) return null;
  return segments.join('/');
}

function cleanText(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function cleanStringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => cleanText(item).slice(0, 64))
    .filter(Boolean)
    .slice(0, 24);
}

function cleanUniqueStringList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(cleanStringList(value))].slice(0, 24);
}

function cleanResearch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const sources = [];
  const seen = new Set();
  for (const source of Array.isArray(value.sources) ? value.sources : []) {
    if (!source || typeof source !== 'object' || typeof source.url !== 'string') continue;
    let url;
    try {
      url = new URL(source.url);
    } catch {
      continue;
    }
    if (!['http:', 'https:'].includes(url.protocol) || seen.has(url.href)) continue;
    seen.add(url.href);
    sources.push({
      title: cleanText(source.title, url.hostname).slice(0, 180),
      url: url.href,
      domain: cleanText(source.domain, url.hostname).slice(0, 120),
      snippet: cleanText(source.snippet).slice(0, 420),
    });
    if (sources.length >= 6) break;
  }
  const researchedAt = typeof value.researchedAt === 'string' && !Number.isNaN(Date.parse(value.researchedAt))
    ? new Date(value.researchedAt).toISOString()
    : '';
  const summary = cleanText(value.summary).slice(0, 1200);
  if (!summary && !sources.length) return null;
  return { summary, sources, researchedAt };
}

function safeCharacterId(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/i.test(value) ? value : null;
}

function safeImageName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (!name || name.length > 120 || name.startsWith('.') || name.includes('..') || /[\\/:*?"<>|\0\x00-\x1f]/.test(name)) return null;
  const extension = path.extname(name).toLowerCase();
  if (!UPLOAD_EXTENSIONS.has(extension)) return null;
  const stem = name.slice(0, -extension.length).trim();
  if (!stem || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) return null;
  return name;
}

function imageBufferMatchesExtension(buffer, extension) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  if (extension === '.png') return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (extension === '.jpg' || extension === '.jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (extension === '.webp') return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

export function extractCodexGeneratedImagePath(codexResult, codexHome) {
  const output = [codexResult?.stdout, codexResult?.stderr].filter(Boolean).join('\n');
  const marker = output.match(/GAMEHUB_GENERATED_IMAGE_PATH\s*[:=]\s*(.+)/i);
  const candidates = [];
  if (marker?.[1]) candidates.push(marker[1]);

  const pathPattern = /(?:[a-z]:[\\/]|\\\\|\/)[^\r\n"'<>|]*?\.(?:png|jpe?g|webp)\b/gi;
  for (const match of output.matchAll(pathPattern)) candidates.push(match[0]);

  const generatedRoot = path.resolve(codexHome, 'generated_images');
  for (const rawCandidate of candidates) {
    let candidate = rawCandidate.trim()
      .replace(/^(?:file:\/\/\/?)?/i, '')
      .replace(/^[\s"'`<(\[]+/, '')
      .replace(/[\s"'`>)\],;]+$/, '')
      .replace(/\\\\/g, '\\');
    if (/^\/[a-z]:[\\/]/i.test(candidate)) candidate = candidate.slice(1);
    if (!path.isAbsolute(candidate)) continue;
    const extension = path.extname(candidate).toLowerCase();
    if (!UPLOAD_EXTENSIONS.has(extension)) continue;
    const resolved = path.resolve(candidate);
    if (resolved === generatedRoot || !isInside(generatedRoot, resolved)) continue;
    return resolved;
  }

  return null;
}

async function resolveCodexInvocation() {
  const configured = process.env.CODEX_CLI_PATH?.trim();
  const pathDirectories = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const candidates = [];
  if (configured) {
    if (path.isAbsolute(configured)) {
      candidates.push(configured);
      if (process.platform === 'win32' && !path.extname(configured)) {
        candidates.push(`${configured}.cmd`, `${configured}.exe`);
      }
    } else if (process.platform === 'win32' && !path.extname(configured)) {
      candidates.push(...pathDirectories.flatMap(directory => [
        path.join(directory, `${configured}.cmd`),
        path.join(directory, `${configured}.exe`),
      ]));
    } else {
      candidates.push(...pathDirectories.map(directory => path.join(directory, configured)));
    }
  }
  for (const directory of pathDirectories) {
    if (process.platform === 'win32') {
      candidates.push(path.join(directory, 'codex.cmd'), path.join(directory, 'codex.exe'));
    } else {
      candidates.push(path.join(directory, 'codex'));
    }
  }

  for (const candidate of [...new Set(candidates)]) {
    const info = await stat(candidate).catch(() => null);
    if (!info?.isFile()) continue;
    const extension = path.extname(candidate).toLowerCase();
    if (process.platform === 'win32' && !extension) continue;
    if (extension === '.cmd' || extension === '.bat') {
      const scriptPath = path.join(path.dirname(candidate), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
      if ((await stat(scriptPath).catch(() => null))?.isFile()) {
        return { command: process.execPath, argsPrefix: [scriptPath] };
      }
      continue;
    }
    if (extension === '.js') return { command: process.execPath, argsPrefix: [candidate] };
    return { command: candidate, argsPrefix: [] };
  }

  throw Object.assign(new Error('没有找到 Codex CLI。请确认 Codex 已安装，或为 WebAsset 配置 CODEX_CLI_PATH。'), {
    code: 'CODEX_UNAVAILABLE',
  });
}

function runCodexImageGeneration({
  workspaceRoot,
  referencePaths,
  prompt,
  jobId,
  timeoutMs,
}) {
  return new Promise((resolve, reject) => {
    void resolveCodexInvocation().then(({ command, argsPrefix }) => {
      const imageToolCall = [
        'const result = await tools.image_gen__imagegen({',
        `  prompt: ${JSON.stringify(prompt)},`,
        `  referenced_image_paths: ${JSON.stringify(referencePaths)},`,
        '  transparent_background: false,',
        '});',
        'generatedImage(result);',
      ].join('\n');
      const task = [
        '这是一次经过用户明确授权的角色图片生成任务。请先读取当前 Codex 环境已安装的 imagegen Skill，并严格遵守它。',
        '必须使用 Codex 本会话内置 image_gen.imagegen 工具；在 functions.exec 代码中对应 tools.image_gen__imagegen。不要使用 scripts/image_gen.py、OpenAI API、API Key、ComfyUI 或任何其他生图后端。',
        '请在 functions.exec 中执行下面这段代码；代码载荷首行按 imagegen Skill 的格式添加 @exec 指令，将首次调用和后续等待均设为 120 秒。图像生成可能需要几分钟。',
        '```js',
        imageToolCall,
        '```',
        '输入图片路径已经通过 referenced_image_paths 提供。这些图片就是当前模式的全部且唯一视觉依据；生成「影视」时是原始参考图，生成「模型」时只能是已经定稿的「影视」AI 图。不得另找旧图或自行重新设计角色。',
        'imagegen Skill 会将原始图片保存到 $CODEX_HOME/generated_images/。当前 Codex CLI 使用只读沙盒，不要尝试复制、移动、重命名或写入任何文件，也不要扫描目录猜测旧图片。',
        '工具返回后，从本次 imagegen 工具结果中读取刚生成图片的确切绝对路径。在最终回复中必须单独输出一行：GAMEHUB_GENERATED_IMAGE_PATH=<该图片的绝对路径>。不要只输出 Markdown 图片链接或文件名。',
        `本次任务 ID：${jobId}。只报告本次工具刚生成的原图路径；不要选择任何历史生成图片。`,
      ].join('\n\n');
      const args = [
        ...argsPrefix,
        '--enable', 'image_generation',
        'exec',
        '--ephemeral',
        '--sandbox', 'read-only',
        '-C', workspaceRoot,
        task,
      ];

      let child;
      let stdout = '';
      let stderr = '';
      let settled = false;
      const appendTail = (current, chunk) => (current + chunk.toString('utf8')).slice(-12000);
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(value);
      };

      const timer = setTimeout(() => {
        child?.kill();
        finish(Object.assign(new Error('Codex 生图超过 12 分钟，已停止本次任务。'), { code: 'CODEX_TIMEOUT' }));
      }, timeoutMs);
      timer.unref?.();

      try {
        child = spawn(command, args, {
          cwd: workspaceRoot,
          env: process.env,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) {
        finish(Object.assign(new Error(error.message || '无法启动 Codex CLI。'), { code: 'CODEX_UNAVAILABLE' }));
        return;
      }

      child.stdout?.on('data', chunk => { stdout = appendTail(stdout, chunk); });
      child.stderr?.on('data', chunk => { stderr = appendTail(stderr, chunk); });
      child.once('error', error => {
        finish(Object.assign(new Error(error.message || '无法启动 Codex CLI。'), {
          code: error.code === 'ENOENT' ? 'CODEX_UNAVAILABLE' : 'CODEX_FAILED',
        }));
      });
      child.once('close', code => {
        if (settled) return;
        if (code === 0) finish(null, { stdout, stderr });
        else {
          const details = [stderr, stdout].filter(Boolean).join('\n').trim().slice(-1600);
          finish(Object.assign(new Error(details || `Codex CLI 退出，代码：${code ?? 'unknown'}`), { code: 'CODEX_FAILED' }));
        }
      });
    }).catch(error => reject(error));
  });
}

function readRequestBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
      } else if (!tooLarge) {
        chunks.push(chunk);
      }
    });
    request.on('end', () => {
      if (tooLarge) reject(Object.assign(new Error('TOO_LARGE'), { code: 'TOO_LARGE' }));
      else resolve(Buffer.concat(chunks));
    });
    request.on('aborted', () => reject(new Error('REQUEST_ABORTED')));
    request.on('error', reject);
  });
}

async function writeCatalogAtomic(catalogPath, catalog) {
  await mkdir(path.dirname(catalogPath), { recursive: true });
  const temporaryPath = `${catalogPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(catalog, null, 2) + '\n', { flag: 'wx' });
    await rename(temporaryPath, catalogPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

function defaultDbPathForRoot(imageRoot) {
  const parent = path.dirname(imageRoot);
  if (path.basename(imageRoot) === 'assets' && existsSync(path.join(parent, 'server.mjs'))) {
    return resolveDefaultDbPath(parent);
  }
  return path.join(parent, 'assets.db');
}

export function createAssetHandler({
  imageRoot,
  characterCatalog,
  assetDb = null,
  dbPath = null,
  researchCharacter = researchCharacterOnline,
  generateCharacterImage = runCodexImageGeneration,
  imageGenerationTimeoutMs = 12 * 60 * 1000,
  codexHome = process.env.CODEX_HOME?.trim() || path.join(homedir(), '.codex'),
}) {
  if (!imageRoot || !characterCatalog) {
    throw new TypeError('imageRoot and characterCatalog are required.');
  }

  const root = path.resolve(imageRoot);
  const catalogPath = path.resolve(characterCatalog);
  const workspaceRoot = path.dirname(root);
  const codexHomeRoot = path.resolve(codexHome);
  let ownedDb = null;
  let indexPromise;
  let mutationQueue = Promise.resolve();
  const generationJobs = new Map();
  let activeGenerationJobId = null;
  const avatarCache = new Map();

  function getDb() {
    if (assetDb) return assetDb;
    if (!ownedDb) {
      ownedDb = openAssetDb(dbPath || defaultDbPathForRoot(root));
    }
    return ownedDb;
  }

  async function ensureDbReady() {
    const db = getDb();
    if (db.countCharacters() === 0 && existsSync(catalogPath)) {
      const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
      if (!catalog || !Array.isArray(catalog.characters)) throw new Error('INVALID_CATALOG');
      db.importCharacterCatalogIfEmpty(catalog, root);
    }
    return db;
  }

  async function syncCatalogSnapshot(db) {
    await writeCatalogAtomic(catalogPath, db.exportCharacterCatalogJson());
  }

  function withMutationLock(work) {
    const result = mutationQueue.then(work, work);
    mutationQueue = result.catch(() => {});
    return result;
  }

  async function createCharacter(input) {
    return withMutationLock(async () => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('BAD_BODY');
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (!name || name.length > 64 || /[\x00-\x1f\x7f]/.test(name)) throw new Error('BAD_NAME');
      const gender = input.gender === undefined || input.gender === null || input.gender === ''
        ? ''
        : typeof input.gender === 'string' ? input.gender : null;
      if (gender === null || (gender && !CHARACTER_GENDERS.has(gender))) throw new Error('BAD_GENDER');
      for (const field of ['keywords', 'aliases', 'props', 'personality']) {
        if (input[field] !== undefined && !Array.isArray(input[field])) throw new Error('BAD_LIST');
      }

      const keywords = cleanUniqueStringList(input.keywords).slice(0, 12);
      const aliases = cleanUniqueStringList(input.aliases);
      const props = cleanUniqueStringList(input.props);
      const personality = cleanUniqueStringList(input.personality);
      const research = input.research === undefined ? null : cleanResearch(input.research);
      if (input.research !== undefined && input.research !== null && !research) throw new Error('BAD_RESEARCH');

      const db = await ensureDbReady();
      if (db.findCharacterByName(name)) {
        throw new Error('NAME_EXISTS');
      }

      const character = db.insertCharacter({
        id: `character-${randomUUID()}`,
        name,
        gender,
        keywords,
        aliases,
        props,
        personality,
        ...(research ? { research } : {}),
      });
      await syncCatalogSnapshot(db);
      indexPromise = null;
      return { ok: true, character };
    });
  }

  async function renameCharacter(idValue, input) {
    return withMutationLock(async () => {
      const characterId = safeCharacterId(idValue);
      if (!characterId) throw new Error('BAD_CHARACTER');
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('BAD_BODY');
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (!name || name.length > 64 || /[\x00-\x1f\x7f]/.test(name)) throw new Error('BAD_NAME');

      const db = await ensureDbReady();
      const existing = db.getCharacter(characterId);
      if (!existing) throw new Error('CHARACTER_NOT_FOUND');

      const duplicate = db.findCharacterByName(name);
      if (duplicate && duplicate.id !== characterId) {
        throw new Error('NAME_EXISTS');
      }

      if (existing.name === name) {
        return { ok: true, character: existing };
      }

      const character = db.renameCharacter(characterId, name);
      await syncCatalogSnapshot(db);
      indexPromise = null;
      for (const job of generationJobs.values()) {
        if (job.characterId === characterId) job.characterName = character.name;
      }
      return { ok: true, character };
    });
  }

  async function supplementCharacter(input, options) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('BAD_BODY');
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name || name.length > 64 || /[\x00-\x1f\x7f]/.test(name)) throw new Error('BAD_NAME');
    if (input.keywords !== undefined && !Array.isArray(input.keywords)) throw new Error('BAD_LIST');
    const keywords = cleanUniqueStringList(input.keywords).slice(0, 12);
    return researchCharacter({ name, keywords }, options);
  }

  function publicGenerationJob(job) {
    return {
      id: job.id,
      characterId: job.characterId,
      characterName: job.characterName,
      mode: job.mode,
      status: job.status,
      message: job.message,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      ...(job.result ? { result: job.result } : {}),
      ...(job.error ? { error: job.error } : {}),
    };
  }

  async function runGenerationJob(job, character, referenceAssets) {
    try {
      job.status = 'running';
      job.message = 'Codex 正在读取参考图并生成角色设定稿，通常需要几分钟……';
      job.updatedAt = new Date().toISOString();

      const referencePaths = referenceAssets.map(asset => path.resolve(root, ...asset.path.split('/')));
      const codexResult = await generateCharacterImage({
        workspaceRoot,
        character,
        referencePaths,
        prompt: buildCharacterSheetPrompt(character, { mode: job.mode }),
        codexHome: codexHomeRoot,
        jobId: job.id,
        timeoutMs: imageGenerationTimeoutMs,
      });

      const generatedImagePath = extractCodexGeneratedImagePath(codexResult, codexHomeRoot);
      if (!generatedImagePath) {
        const details = [codexResult?.stderr, codexResult?.stdout].filter(Boolean).join('\n').trim().slice(-1200);
        throw Object.assign(new Error(details
          ? `Codex 已生成任务结束，但没有返回可识别的原图路径。执行结果：${details}`
          : 'Codex 已生成任务结束，但没有返回原图路径。'), {
          code: 'NO_GENERATED_IMAGE_PATH',
        });
      }

      let generatedImagesRoot;
      try {
        generatedImagesRoot = await realpath(path.join(codexHomeRoot, 'generated_images'));
      } catch {
        throw Object.assign(new Error(`找不到 Codex 原图目录：${path.join(codexHomeRoot, 'generated_images')}`), {
          code: 'CODEX_IMAGE_DIRECTORY_MISSING',
        });
      }
      let generatedImageRealPath;
      try {
        generatedImageRealPath = await realpath(generatedImagePath);
      } catch {
        throw Object.assign(new Error(`Codex 返回的原图文件不存在：${generatedImagePath}`), { code: 'NO_GENERATED_IMAGE' });
      }
      if (!isInside(generatedImagesRoot, generatedImageRealPath)) {
        throw Object.assign(new Error('Codex 返回的图片不在 CODEX_HOME/generated_images 目录内，已拒绝读取。'), {
          code: 'INVALID_GENERATED_IMAGE_PATH',
        });
      }
      const generatedInfo = await stat(generatedImageRealPath);
      if (!generatedInfo.isFile()) {
        throw Object.assign(new Error('Codex 返回的生成图片路径不是文件。'), { code: 'NO_GENERATED_IMAGE' });
      }
      if (generatedInfo.size <= 0 || generatedInfo.size > MAX_GENERATED_IMAGE_BYTES) {
        throw Object.assign(new Error('生成图片为空或超过 30MB。'), { code: 'TOO_LARGE' });
      }
      if (generatedInfo.mtimeMs < Date.parse(job.createdAt) - 5000) {
        throw Object.assign(new Error('Codex 返回的图片不是本次任务新生成的文件，已拒绝导入历史图片。'), {
          code: 'STALE_GENERATED_IMAGE',
        });
      }

      const generatedName = path.basename(generatedImageRealPath);
      const extension = path.extname(generatedName).toLowerCase();
      const data = await readFile(generatedImageRealPath);
      if (!data.length || data.length > MAX_GENERATED_IMAGE_BYTES) {
        throw Object.assign(new Error('生成图片为空或超过 30MB。'), { code: 'TOO_LARGE' });
      }
      if (!imageBufferMatchesExtension(data, extension)) {
        throw Object.assign(new Error('生成文件内容与图片扩展名不匹配。'), { code: 'INVALID_IMAGE' });
      }

      const fileName = `codex-${Date.now()}-${job.id.slice(0, 8)}${extension}`;
      const saved = await addCharacterGeneratedImage(job.characterId, fileName, data, job.mode);
      job.status = 'completed';
      job.message = '生成完成，图片已自动保存到当前角色。';
      job.result = { name: saved.name, path: saved.path, url: saved.url, createdAt: saved.createdAt };
    } catch (error) {
      job.status = 'failed';
      job.error = {
        code: error?.code || 'GENERATION_FAILED',
        message: (error?.message || '角色图片生成失败。').slice(0, 1800),
      };
      job.message = job.error.message;
    } finally {
      job.updatedAt = new Date().toISOString();
      if (activeGenerationJobId === job.id) activeGenerationJobId = null;
    }
  }

  async function startCharacterImageGeneration(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('BAD_BODY');
    const characterId = safeCharacterId(input.characterId);
    if (!characterId) throw new Error('BAD_CHARACTER');
    const mode = input.mode === undefined ? 'default' : input.mode;
    if (!GENERATION_MODES.has(mode)) throw new Error('BAD_MODE');

    if (activeGenerationJobId) {
      const activeJob = generationJobs.get(activeGenerationJobId);
      if (activeJob && ['queued', 'running'].includes(activeJob.status)) throw new Error('GENERATION_IN_PROGRESS');
      activeGenerationJobId = null;
    }

    const { characters } = await getIndex();
    const character = characters.find(entry => entry.id === characterId);
    if (!character) throw new Error('CHARACTER_NOT_FOUND');
    let referenceAssets;
    if (mode === 'humanoid') {
      const film = (character.generatedAssets || []).findLast(asset =>
        (asset.mode === 'humanoid' ? 'humanoid' : 'default') === 'default'
        && UPLOAD_EXTENSIONS.has(path.extname(asset.path).toLowerCase())
      );
      if (!film) throw new Error('NO_FILM_IMAGE');
      referenceAssets = [film];
    } else {
      referenceAssets = character.assets
        .filter(asset => UPLOAD_EXTENSIONS.has(path.extname(asset.path).toLowerCase()))
        .slice(0, MAX_REFERENCE_IMAGES);
      if (!referenceAssets.length) throw new Error('NO_REFERENCE_IMAGES');
    }

    const now = new Date().toISOString();
    const job = {
      id: randomUUID(),
      characterId,
      characterName: character.name,
      mode,
      status: 'queued',
      message: '已创建生图任务，正在准备参考图……',
      createdAt: now,
      updatedAt: now,
      result: null,
      error: null,
    };
    generationJobs.set(job.id, job);
    activeGenerationJobId = job.id;

    for (const [id, previous] of generationJobs) {
      if (id !== job.id && !['queued', 'running'].includes(previous.status)
        && Date.now() - Date.parse(previous.updatedAt) > 30 * 60 * 1000) {
        generationJobs.delete(id);
      }
    }

    void runGenerationJob(job, character, referenceAssets);
    return { ok: true, job: publicGenerationJob(job) };
  }

  function findGenerationJob({ jobId, characterId }) {
    if (jobId) return generationJobs.get(jobId) || null;
    if (!characterId) return activeGenerationJobId ? generationJobs.get(activeGenerationJobId) || null : null;
    return [...generationJobs.values()].reverse().find(job => job.characterId === characterId
      && ['queued', 'running'].includes(job.status)) || null;
  }

  async function countExistingCharacterImages(characterId, assets) {
    const rootReal = await realpath(root);
    let count = 0;
    for (const asset of Array.isArray(assets) ? assets : []) {
      const name = safeImageName(asset?.name);
      if (!name || asset.path !== `characters/${characterId}/images/${name}`) continue;
      try {
        const target = path.resolve(root, ...asset.path.split('/'));
        const targetReal = await realpath(target);
        const info = await stat(targetReal);
        if (isInside(rootReal, targetReal) && info.isFile()) count += 1;
      } catch {
        // Missing catalog entries do not consume an image slot.
      }
    }
    return count;
  }

  async function addCharacterImage(characterIdValue, nameValue, data) {
    return withMutationLock(async () => {
      const characterId = safeCharacterId(characterIdValue);
      if (!characterId) throw new Error('BAD_CHARACTER');
      const name = safeImageName(nameValue);
      if (!name) throw new Error('BAD_NAME');
      if (!Buffer.isBuffer(data) || data.length === 0) throw new Error('EMPTY');
      if (data.length > MAX_IMAGE_BYTES) throw new Error('TOO_LARGE');

      const extension = path.extname(name).toLowerCase();
      if (!imageBufferMatchesExtension(data, extension)) throw new Error('INVALID_IMAGE');

      const db = await ensureDbReady();
      const character = db.getCharacter(characterId);
      if (!character) throw new Error('CHARACTER_NOT_FOUND');
      const assets = Array.isArray(character.assets) ? character.assets : [];

      const relativePath = `characters/${characterId}/images/${name}`;
      if (assets.some(asset => asset?.path === relativePath || asset?.name === name)) throw new Error('EXISTS');
      const existingCount = await countExistingCharacterImages(characterId, assets);
      if (existingCount >= MAX_REFERENCE_IMAGES) throw new Error('REFERENCE_LIMIT_REACHED');

      const rootReal = await realpath(root);
      const imageDirectory = path.resolve(root, 'characters', characterId, 'images');
      if (!isInside(root, imageDirectory)) throw new Error('ESCAPE');
      await mkdir(imageDirectory, { recursive: true });
      const directoryReal = await realpath(imageDirectory);
      if (!isInside(rootReal, directoryReal)) throw new Error('ESCAPE');
      const targetPath = path.join(directoryReal, name);
      const targetRelative = path.relative(rootReal, targetPath).split(path.sep).join('/');
      if (targetRelative !== relativePath) throw new Error('ESCAPE');

      const sha256 = createHash('sha256').update(data).digest('hex');
      let created = false;
      try {
        await writeFile(targetPath, data, { flag: 'wx' });
        created = true;
        db.addCharacterReferenceAsset(characterId, { name, relPath: relativePath, sha256, bytes: data.length });
        await syncCatalogSnapshot(db);
      } catch (error) {
        if (created) await unlink(targetPath).catch(() => {});
        if (error?.code === 'EEXIST') throw new Error('EXISTS');
        throw error;
      }

      indexPromise = null;
      return { ok: true, characterId, name, path: relativePath, remaining: existingCount + 1 };
    });
  }

  async function addCharacterModel(characterIdValue, modeValue, nameValue, data) {
    return withMutationLock(async () => {
      const characterId = safeCharacterId(characterIdValue);
      if (!characterId) throw new Error('BAD_CHARACTER');
      if (!MODEL_MODES.has(modeValue)) throw new Error('BAD_MODE');
      const name = safeModelName(nameValue);
      if (!name) throw new Error('BAD_NAME');
      if (!Buffer.isBuffer(data) || !data.length) throw new Error('EMPTY');
      if (data.length > MAX_MODEL_BYTES) throw new Error('TOO_LARGE');
      validateGlb(data);

      const db = await ensureDbReady();
      const character = db.getCharacter(characterId);
      if (!character) throw new Error('CHARACTER_NOT_FOUND');
      const rootReal = await realpath(root);
      const directory = path.resolve(root, 'characters', characterId, 'models');
      if (!isInside(root, directory)) throw new Error('ESCAPE');
      await mkdir(directory, { recursive: true });
      const directoryReal = await realpath(directory);
      if (!isInside(rootReal, directoryReal)) throw new Error('ESCAPE');

      const fileName = `${modeValue}-${randomUUID()}.glb`;
      const relativePath = `characters/${characterId}/models/${fileName}`;
      const target = path.join(directoryReal, fileName);
      const previous = character.models?.[modeValue];
      const updatedAt = new Date().toISOString();
      const sha256 = createHash('sha256').update(data).digest('hex');
      let created = false;
      try {
        await writeFile(target, data, { flag: 'wx' });
        created = true;
        db.upsertCharacterModel(characterId, modeValue, {
          name, relPath: relativePath, sha256, bytes: data.length, updatedAt,
        });
        await syncCatalogSnapshot(db);
      } catch (error) {
        if (created) await unlink(target).catch(() => {});
        throw error;
      }
      // The catalog switch is committed before retiring the old file.
      const previousPath = safeCatalogPath(previous?.path);
      if (previousPath?.startsWith(`characters/${characterId}/models/`)
        && MODEL_EXTENSIONS.has(path.extname(previousPath).toLowerCase())) {
        try {
          const oldReal = await realpath(path.resolve(root, ...previousPath.split('/')));
          if (isInside(directoryReal, oldReal) && oldReal !== target) await unlink(oldReal);
        } catch { /* missing old model is harmless */ }
      }
      indexPromise = null;
      return {
        ok: true,
        characterId,
        mode: modeValue,
        name,
        path: relativePath,
        bytes: data.length,
        updatedAt,
        url: toModelUrl(relativePath),
      };
    });
  }

  async function addCharacterGeneratedImage(characterIdValue, nameValue, data, mode = 'default') {
    return withMutationLock(async () => {
      const characterId = safeCharacterId(characterIdValue);
      if (!characterId) throw new Error('BAD_CHARACTER');
      const name = safeImageName(nameValue);
      if (!name) throw new Error('BAD_NAME');
      if (!Buffer.isBuffer(data) || data.length === 0) throw new Error('EMPTY');
      if (data.length > MAX_GENERATED_IMAGE_BYTES) throw new Error('TOO_LARGE');

      const extension = path.extname(name).toLowerCase();
      if (!imageBufferMatchesExtension(data, extension)) throw new Error('INVALID_IMAGE');

      const db = await ensureDbReady();
      const character = db.getCharacter(characterId);
      if (!character) throw new Error('CHARACTER_NOT_FOUND');
      const previousAssets = Array.isArray(character.generatedAssets) ? character.generatedAssets : [];
      const sameMode = asset => (asset.mode === 'humanoid' ? 'humanoid' : 'default') === mode;

      const relativePath = `characters/${characterId}/generated/${name}`;
      if (previousAssets.some(asset => asset?.path === relativePath || asset?.name === name)) {
        throw new Error('EXISTS');
      }

      const rootReal = await realpath(root);
      const generatedDirectory = path.resolve(root, 'characters', characterId, 'generated');
      if (!isInside(root, generatedDirectory)) throw new Error('ESCAPE');
      await mkdir(generatedDirectory, { recursive: true });
      const directoryReal = await realpath(generatedDirectory);
      if (!isInside(rootReal, directoryReal)) throw new Error('ESCAPE');
      const targetPath = path.join(directoryReal, name);
      const targetRelative = path.relative(rootReal, targetPath).split(path.sep).join('/');
      if (targetRelative !== relativePath) throw new Error('ESCAPE');

      const createdAt = new Date().toISOString();
      const sha256 = createHash('sha256').update(data).digest('hex');
      let created = false;
      try {
        await writeFile(targetPath, data, { flag: 'wx' });
        created = true;
        db.replaceCharacterGeneratedAsset(characterId, mode, {
          name, relPath: relativePath, sha256, bytes: data.length, createdAt,
        });
        await syncCatalogSnapshot(db);
      } catch (error) {
        if (created) await unlink(targetPath).catch(() => {});
        if (error?.code === 'EEXIST') throw new Error('EXISTS');
        throw error;
      }

      // Retain the other form. Retire only the former image of this mode.
      for (const previous of previousAssets.filter(sameMode)) {
        const previousName = safeImageName(previous?.name);
        if (!previousName) continue;
        const previousRelative = `characters/${characterId}/generated/${previousName}`;
        if (previous?.path !== previousRelative || previousRelative === relativePath) continue;
        const previousPath = path.resolve(root, ...previousRelative.split('/'));
        if (!isInside(root, previousPath)) continue;
        try {
          const previousReal = await realpath(previousPath);
          if (!isInside(rootReal, previousReal)) continue;
          if ((await stat(previousReal)).isFile()) await unlink(previousReal);
        } catch {
          // A missing or stale previous file must not invalidate the new image.
        }
      }

      indexPromise = null;
      return {
        ok: true,
        characterId,
        name,
        path: relativePath,
        url: toAssetUrl(relativePath),
        createdAt,
      };
    });
  }

  async function deleteCharacterImage(characterIdValue, nameValue) {
    return withMutationLock(async () => {
      const characterId = safeCharacterId(characterIdValue);
      if (!characterId) throw new Error('BAD_CHARACTER');
      const name = safeImageName(nameValue);
      if (!name) throw new Error('BAD_NAME');

      const db = await ensureDbReady();
      const character = db.getCharacter(characterId);
      if (!character) throw new Error('CHARACTER_NOT_FOUND');
      const relativePath = `characters/${characterId}/images/${name}`;
      const assetIndex = (character.assets || []).findIndex(asset => asset?.name === name && asset?.path === relativePath);
      if (assetIndex < 0) throw new Error('NOT_FOUND');

      const rootReal = await realpath(root);
      const targetPath = path.resolve(root, ...relativePath.split('/'));
      if (!isInside(root, targetPath)) throw new Error('ESCAPE');
      let targetReal;
      try {
        targetReal = await realpath(targetPath);
      } catch (error) {
        if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') throw new Error('NOT_FOUND');
        throw error;
      }
      if (!isInside(rootReal, targetReal)) throw new Error('ESCAPE');
      const info = await stat(targetReal);
      if (!info.isFile()) throw new Error('NOT_FOUND');

      const tombstone = `${targetReal}.${randomUUID()}.deleting`;
      await rename(targetReal, tombstone);
      try {
        db.deleteCharacterReferenceAsset(characterId, name, relativePath);
        await syncCatalogSnapshot(db);
      } catch (error) {
        await rename(tombstone, targetReal).catch(() => {});
        throw error;
      }
      await unlink(tombstone).catch(() => {});
      const updatedChar = db.getCharacter(characterId);
      indexPromise = null;
      return {
        ok: true,
        characterId,
        name,
        remaining: await countExistingCharacterImages(characterId, updatedChar?.assets || []),
      };
    });
  }

  async function getIndex() {
    if (!indexPromise) {
      indexPromise = Promise.all([
        realpath(root),
        ensureDbReady(),
      ]).then(async ([rootReal, db]) => {
        const rawCharacters = db.listCharacters();
        const allowedFiles = new Map();
        const characters = [];
        for (const entry of rawCharacters) {
          if (!entry || typeof entry.id !== 'string' || typeof entry.name !== 'string') continue;
          async function resolveImageEntries(entries, defaultKind) {
            const resolved = [];
            for (const asset of Array.isArray(entries) ? entries : []) {
              const relativePath = safeCatalogPath(asset?.path);
              if (!relativePath) continue;
              const extension = path.extname(relativePath).toLowerCase();
              if (!IMAGE_EXTENSIONS.has(extension)) continue;

              const target = path.resolve(root, ...relativePath.split('/'));
              if (!isInside(root, target)) continue;
              try {
                const targetReal = await realpath(target);
                const info = await stat(targetReal);
                if (!isInside(rootReal, targetReal) || !info.isFile()) continue;
                allowedFiles.set(relativePath, { path: targetReal, extension, kind: 'image' });
                resolved.push({
                  name: cleanText(asset.name, path.basename(relativePath)),
                  path: relativePath,
                  kind: cleanText(asset.kind, defaultKind),
                  ...(defaultKind === 'ai-generated'
                    ? { mode: asset.mode === 'humanoid' ? 'humanoid' : 'default' }
                    : {}),
                  sourcePath: cleanText(asset.sourcePath),
                  createdAt: cleanText(asset.createdAt),
                  url: toAssetUrl(relativePath),
                });
              } catch {
                // Keep the catalog resilient while an image is temporarily absent.
              }
            }
            return resolved;
          }

          const assets = await resolveImageEntries(entry.assets, 'reference');
          const generatedAssets = await resolveImageEntries(entry.generatedAssets, 'ai-generated');
          const models = {};
          for (const mode of MODEL_MODES) {
            const asset = entry.models?.[mode];
            const relativePath = safeCatalogPath(asset?.path);
            if (!relativePath?.startsWith(`characters/${entry.id}/models/`)
              || path.extname(relativePath).toLowerCase() !== '.glb') continue;
            const target = path.resolve(root, ...relativePath.split('/'));
            if (!isInside(root, target)) continue;
            try {
              const targetReal = await realpath(target);
              const info = await stat(targetReal);
              if (!isInside(rootReal, targetReal) || !info.isFile() || info.size > MAX_MODEL_BYTES) continue;
              allowedFiles.set(relativePath, { path: targetReal, extension: '.glb', kind: 'model' });
              models[mode] = {
                name: cleanText(asset.name, path.basename(relativePath)),
                path: relativePath,
                url: toModelUrl(relativePath),
                bytes: info.size,
                updatedAt: cleanText(asset.updatedAt),
              };
            } catch { /* missing 3D files should not break the character list */ }
          }

          const filmAsset = findFilmGeneratedAsset(generatedAssets);
          const avatarUrl = filmAsset
            ? `/api/character-avatar?characterId=${encodeURIComponent(entry.id)}&v=${encodeURIComponent(filmAsset.name)}`
            : '';

          characters.push({
            id: entry.id,
            name: entry.name,
            gender: CHARACTER_GENDERS.has(entry.gender) ? entry.gender : '',
            keywords: cleanStringList(entry.keywords).slice(0, 12),
            aliases: Array.isArray(entry.aliases)
              ? entry.aliases.filter(alias => typeof alias === 'string' && alias.trim())
              : [],
            props: cleanStringList(entry.props),
            personality: cleanStringList(entry.personality),
            research: cleanResearch(entry.research),
            assets,
            generatedAssets,
            models,
            ...(avatarUrl ? { avatarUrl } : {}),
          });
        }

        return {
          characters,
          allowedFiles,
          categories: [
            { id: 'characters:all', type: 'characters', name: '角色', count: characters.length },
          ],
        };
      }).catch(error => {
        indexPromise = null;
        throw error;
      });
    }
    return indexPromise;
  }

  async function serveRegisteredFile(request, response, encodedRelativePath, kind = 'image') {
    let segments;
    try {
      segments = encodedRelativePath.split('/').map(decodeURIComponent);
    } catch {
      response.writeHead(400);
      response.end('Bad Request');
      return;
    }
    if (segments.some(segment => !segment || segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\') || segment.includes('\0'))) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }

    const relativePath = segments.join('/');
    const { allowedFiles } = await getIndex();
    const file = allowedFiles.get(relativePath);
    if (!file || file.kind !== kind) {
      response.writeHead(404);
      response.end('Not Found');
      return;
    }

    try {
      const [rootReal, targetReal] = await Promise.all([realpath(root), realpath(file.path)]);
      const info = await stat(targetReal);
      if (!isInside(rootReal, targetReal) || !info.isFile()) {
        response.writeHead(404);
        response.end('Not Found');
        return;
      }
      response.writeHead(200, {
        'Content-Type': MIME[file.extension],
        'Content-Length': info.size,
        'Cache-Control': kind === 'model' ? 'private, no-store' : 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      });
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      const stream = createReadStream(targetReal);
      stream.on('error', () => response.destroy());
      stream.pipe(response);
    } catch {
      response.writeHead(404);
      response.end('Not Found');
    }
  }

  async function serveCharacterAvatar(request, response, characterIdValue) {
    const characterId = safeCharacterId(characterIdValue);
    if (!characterId) {
      sendJson(response, 400, { error: 'BAD_CHARACTER', message: '角色编号不合法。' });
      return;
    }

    const { characters, allowedFiles } = await getIndex();
    const character = characters.find(entry => entry.id === characterId);
    const filmAsset = findFilmGeneratedAsset(character?.generatedAssets);
    const file = filmAsset ? allowedFiles.get(filmAsset.path) : null;
    if (!character || !file || file.kind !== 'image') {
      response.writeHead(404);
      response.end('Not Found');
      return;
    }

    try {
      const [rootReal, targetReal] = await Promise.all([realpath(root), realpath(file.path)]);
      const info = await stat(targetReal);
      if (!isInside(rootReal, targetReal) || !info.isFile()) {
        response.writeHead(404);
        response.end('Not Found');
        return;
      }

      const cacheKey = `${targetReal}:${info.mtimeMs}:${info.size}`;
      let buffer = avatarCache.get(cacheKey);
      if (!buffer) {
        const meta = await sharp(targetReal).metadata();
        const crop = computeFilmAvatarCropRect(meta.width, meta.height);
        const targetSize = Math.min(AVATAR_MAX_SIZE, crop.width);
        buffer = await sharp(targetReal)
          .extract(crop)
          .resize(targetSize, targetSize, { kernel: sharp.kernel.lanczos3 })
          .png({ compressionLevel: 6 })
          .toBuffer();
        if (avatarCache.size >= 128) avatarCache.delete(avatarCache.keys().next().value);
        avatarCache.set(cacheKey, buffer);
      }

      response.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': buffer.length,
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      });
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      response.end(buffer);
    } catch {
      response.writeHead(404);
      response.end('Not Found');
    }
  }

  const handler = async (request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        Allow: 'GET, HEAD, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Methods': 'GET, HEAD, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      response.end();
      return;
    }
    if (!['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD, POST, PATCH, DELETE, OPTIONS' });
      response.end('Method Not Allowed');
      return;
    }

    let url;
    try {
      url = new URL(request.url || '/', 'http://127.0.0.1');
    } catch {
      response.writeHead(400);
      response.end('Bad Request');
      return;
    }

    if (url.pathname === '/api/categories') {
      try {
        const { categories } = await getIndex();
        sendJson(response, 200, { categories });
      } catch {
        sendJson(response, 500, { error: 'Unable to read the character catalog.' });
      }
      return;
    }

    if (url.pathname === '/api/characters/research') {
      if (request.method !== 'POST') {
        response.writeHead(405, { Allow: 'POST, OPTIONS' });
        response.end('Method Not Allowed');
        return;
      }
      try {
        const body = await readRequestBody(request, MAX_CHARACTER_REQUEST_BYTES);
        let input;
        try {
          input = JSON.parse(body.toString('utf8'));
        } catch {
          throw Object.assign(new Error('角色资料格式不正确。'), { code: 'BAD_JSON' });
        }
        const controller = new AbortController();
        response.once('close', () => {
          if (!response.writableEnded) controller.abort();
        });
        const result = await supplementCharacter(input, { signal: controller.signal });
        if (!response.destroyed && !response.writableEnded) sendJson(response, 200, { ok: true, ...result });
      } catch (error) {
        if (response.destroyed || response.writableEnded) return;
        const code = error?.code || error?.message || 'ERROR';
        const errors = {
          TOO_LARGE: [413, '角色资料不能超过 16KB。'],
          BAD_JSON: [400, '角色资料格式不正确。'],
          BAD_BODY: [400, '请填写有效的角色资料。'],
          BAD_NAME: [400, '请先填写有效的角色名称。'],
          BAD_LIST: [400, '辅助关键词必须使用列表格式。'],
          CODEX_UNAVAILABLE: [503, error.message],
          CODEX_FAILED: [502, error.message],
          CODEX_TIMEOUT: [504, error.message],
          CODEX_OUTPUT_TOO_LARGE: [502, error.message],
          NO_SEARCH_RESULTS: [502, error.message],
          INVALID_RESEARCH_RESPONSE: [502, error.message],
        };
        const [status, message] = errors[code] || [500, 'AI 联网补充资料失败。'];
        sendJson(response, status, { error: code, message });
      }
      return;
    }

    const isCharacterDetailPath = url.pathname.startsWith('/api/characters/') && url.pathname !== '/api/characters/research';
    if (url.pathname === '/api/characters' || isCharacterDetailPath) {
      const pathCharacterId = isCharacterDetailPath
        ? (() => {
            try {
              return decodeURIComponent(url.pathname.slice('/api/characters/'.length));
            } catch {
              return '';
            }
          })()
        : null;

      if (request.method === 'POST' && !isCharacterDetailPath) {
        try {
          const body = await readRequestBody(request, MAX_CHARACTER_REQUEST_BYTES);
          let input;
          try {
            input = JSON.parse(body.toString('utf8'));
          } catch {
            throw new Error('BAD_JSON');
          }
          sendJson(response, 201, await createCharacter(input));
        } catch (error) {
          const code = error?.message || 'ERROR';
          const errors = {
            TOO_LARGE: [413, '角色资料不能超过 16KB。'],
            BAD_JSON: [400, '角色资料格式不正确。'],
            BAD_BODY: [400, '请填写有效的角色资料。'],
            BAD_NAME: [400, '角色名称不能为空，且不能超过 64 个字符。'],
            BAD_GENDER: [400, '性别只能填写男或女，或留空等待 AI 判断。'],
            BAD_LIST: [400, '辅助关键词、别名、道具和性格必须使用列表格式。'],
            BAD_RESEARCH: [400, 'AI 搜索资料格式不正确。'],
            NAME_EXISTS: [409, '已经存在同名角色。'],
          };
          const [status, message] = errors[code] || [500, '新增角色失败。'];
          sendJson(response, status, { error: code, message });
        }
        return;
      }

      if (request.method === 'PATCH') {
        try {
          const body = await readRequestBody(request, MAX_CHARACTER_REQUEST_BYTES);
          let input;
          try {
            input = JSON.parse(body.toString('utf8'));
          } catch {
            throw new Error('BAD_JSON');
          }
          const characterId = isCharacterDetailPath
            ? pathCharacterId
            : (input && typeof input === 'object' && !Array.isArray(input)
              ? (input.characterId ?? input.id ?? url.searchParams.get('characterId'))
              : url.searchParams.get('characterId'));
          sendJson(response, 200, await renameCharacter(characterId, input));
        } catch (error) {
          const code = error?.message || 'ERROR';
          const errors = {
            TOO_LARGE: [413, '角色资料不能超过 16KB。'],
            BAD_JSON: [400, '角色资料格式不正确。'],
            BAD_BODY: [400, '请填写有效的角色资料。'],
            BAD_CHARACTER: [400, '角色编号不合法。'],
            BAD_NAME: [400, '角色名称不能为空，且不能超过 64 个字符。'],
            CHARACTER_NOT_FOUND: [404, '找不到该角色。'],
            NAME_EXISTS: [409, '已经存在同名角色。'],
          };
          const [status, message] = errors[code] || [500, '角色改名失败。'];
          sendJson(response, status, { error: code, message });
        }
        return;
      }

      response.writeHead(405, { Allow: isCharacterDetailPath ? 'PATCH, OPTIONS' : 'POST, PATCH, OPTIONS' });
      response.end('Method Not Allowed');
      return;
    }

    if (url.pathname === '/api/character-avatar') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD, OPTIONS' });
        response.end('Method Not Allowed');
        return;
      }
      await serveCharacterAvatar(request, response, url.searchParams.get('characterId'));
      return;
    }

    if (url.pathname === '/api/character-image-prompt') {
      if (request.method !== 'GET') {
        response.writeHead(405, { Allow: 'GET, OPTIONS' });
        response.end('Method Not Allowed');
        return;
      }
      try {
        const characterId = safeCharacterId(url.searchParams.get('characterId'));
        if (!characterId) throw new Error('BAD_CHARACTER');
        const { characters } = await getIndex();
        const character = characters.find(entry => entry.id === characterId);
        if (!character) throw new Error('CHARACTER_NOT_FOUND');
        const mode = url.searchParams.get('mode') || 'default';
        if (!GENERATION_MODES.has(mode)) throw new Error('BAD_MODE');
        sendJson(response, 200, { characterId, mode, prompt: buildCharacterSheetPrompt(character, { mode }) });
      } catch (error) {
        const code = error?.message || 'ERROR';
        const errors = {
          BAD_CHARACTER: [400, '角色编号不合法。'],
          BAD_MODE: [400, '角色生图形态不合法。'],
          CHARACTER_NOT_FOUND: [404, '找不到该角色。'],
        };
        const [status, message] = errors[code] || [500, '无法生成角色提示词。'];
        sendJson(response, status, { error: code, message });
      }
      return;
    }

    if (url.pathname === '/api/character-images/generate') {
      if (request.method === 'POST') {
        try {
          const body = await readRequestBody(request, MAX_CHARACTER_REQUEST_BYTES);
          let input;
          try {
            input = JSON.parse(body.toString('utf8'));
          } catch {
            throw new Error('BAD_JSON');
          }
          const result = await startCharacterImageGeneration(input);
          sendJson(response, 202, result);
        } catch (error) {
          const code = error?.code || error?.message || 'ERROR';
          const errors = {
            TOO_LARGE: [413, '生图请求不能超过 16KB。'],
            BAD_JSON: [400, '生图请求格式不正确。'],
            BAD_BODY: [400, '请先选择一个角色。'],
            BAD_CHARACTER: [400, '角色编号不合法。'],
            BAD_MODE: [400, '角色生图形态不合法。'],
            CHARACTER_NOT_FOUND: [404, '找不到该角色。'],
            NO_REFERENCE_IMAGES: [409, '该角色还没有可用的参考图，请先添加 PNG、JPG 或 WebP 图片。'],
            NO_FILM_IMAGE: [409, '请先生成「影视」AI 图；「模型」参考图只能以影视图为唯一标准。'],
            GENERATION_IN_PROGRESS: [409, '已有角色正在生图，请等待当前任务完成。'],
          };
          const [status, message] = errors[code] || [500, '无法启动角色生图任务。'];
          sendJson(response, status, { error: code, message });
        }
        return;
      }

      if (request.method === 'GET') {
        const jobId = url.searchParams.get('jobId') || '';
        const characterIdValue = url.searchParams.get('characterId') || '';
        if (jobId && !/^[0-9a-f-]{36}$/i.test(jobId)) {
          sendJson(response, 400, { error: 'BAD_JOB', message: '生图任务编号不合法。' });
          return;
        }
        const characterId = characterIdValue ? safeCharacterId(characterIdValue) : '';
        if (characterIdValue && !characterId) {
          sendJson(response, 400, { error: 'BAD_CHARACTER', message: '角色编号不合法。' });
          return;
        }
        const job = findGenerationJob({ jobId, characterId });
        if (jobId && !job) {
          sendJson(response, 404, { error: 'JOB_NOT_FOUND', message: '找不到该生图任务。' });
          return;
        }
        sendJson(response, 200, { job: job ? publicGenerationJob(job) : null });
        return;
      }

      response.writeHead(405, { Allow: 'GET, POST, OPTIONS' });
      response.end('Method Not Allowed');
      return;
    }

    if (url.pathname === '/api/character-models') {
      if (request.method !== 'POST') {
        response.writeHead(405, { Allow: 'POST, OPTIONS' });
        response.end('Method Not Allowed');
        return;
      }
      try {
        const body = await readRequestBody(request, MAX_MODEL_BYTES);
        const result = await addCharacterModel(
          url.searchParams.get('characterId'), url.searchParams.get('mode'), url.searchParams.get('name'), body,
        );
        sendJson(response, 201, result);
      } catch (error) {
        const code = error?.code || error?.message || 'ERROR';
        const errors = {
          TOO_LARGE: [413, 'GLB 模型不能超过 150MB。'],
          EMPTY: [400, '模型文件为空。'],
          BAD_CHARACTER: [400, '角色编号不合法。'],
          BAD_MODE: [400, '模型类型必须为高模或低模。'],
          BAD_NAME: [400, '只能上传有效的 .glb 模型文件。'],
          INVALID_MODEL: [400, 'GLB 格式不合法，请导出 glTF 2.0 的二进制 GLB。'],
          EXTERNAL_MODEL_ASSETS: [400, '请把贴图和网格数据内嵌到 GLB 文件中。'],
          CHARACTER_NOT_FOUND: [404, '角色不存在。'],
          ESCAPE: [400, '模型保存路径不合法。'],
        };
        const [status, message] = errors[code] || [500, '保存模型失败。'];
        sendJson(response, status, { error: code, message });
      }
      return;
    }

    if (url.pathname === '/api/character-generated-images') {
      if (request.method === 'POST') {
        try {
          const body = await readRequestBody(request, MAX_GENERATED_IMAGE_BYTES);
          const modeParam = url.searchParams.get('mode');
          const mode = modeParam === 'humanoid' ? 'humanoid' : 'default';
          const result = await addCharacterGeneratedImage(
            url.searchParams.get('characterId'),
            url.searchParams.get('name'),
            body,
            mode,
          );
          sendJson(response, 201, result);
        } catch (error) {
          const code = error?.message || 'ERROR';
          const errors = {
            BAD_CHARACTER: [400, '角色编号不合法。'],
            BAD_NAME: [400, '文件名或格式不合法，仅支持 PNG、JPG、JPEG、WebP。'],
            EMPTY: [400, '图片数据为空。'],
            INVALID_IMAGE: [400, '文件内容与图片格式不匹配。'],
            TOO_LARGE: [413, 'AI 生成图片不能超过 30MB。'],
            CHARACTER_NOT_FOUND: [404, '找不到该角色。'],
            EXISTS: [409, '该角色已有同名 AI 生成图。'],
            ESCAPE: [400, '图片保存路径不合法。'],
          };
          const [status, message] = errors[code] || [500, '保存 AI 生成图失败。'];
          sendJson(response, status, { error: code, message });
        }
        return;
      }

      response.writeHead(405, { Allow: 'POST, OPTIONS' });
      response.end('Method Not Allowed');
      return;
    }

    if (url.pathname === '/api/assets') {
      if (request.method === 'POST') {
        let body;
        try {
          body = await readRequestBody(request, MAX_IMAGE_BYTES);
          const result = await addCharacterImage(url.searchParams.get('characterId'), url.searchParams.get('name'), body);
          sendJson(response, 201, result);
        } catch (error) {
          const code = error?.message || 'ERROR';
          const errors = {
            BAD_CHARACTER: [400, '角色编号不合法。'],
            BAD_NAME: [400, '文件名或格式不合法，仅支持 PNG、JPG、JPEG、WebP。'],
            EMPTY: [400, '图片数据为空。'],
            INVALID_IMAGE: [400, '文件内容与图片格式不匹配。'],
            TOO_LARGE: [413, '单张图片不能超过 25MB。'],
            CHARACTER_NOT_FOUND: [404, '找不到该角色。'],
            EXISTS: [409, '该角色已有同名图片。'],
            REFERENCE_LIMIT_REACHED: [409, `每个角色最多保留 ${MAX_REFERENCE_IMAGES} 张参考图，请先删除旧图。`],
          };
          const [status, message] = errors[code] || [500, '添加图片失败。'];
          sendJson(response, status, { error: code, message });
        }
        return;
      }

      if (request.method === 'DELETE') {
        try {
          const result = await deleteCharacterImage(url.searchParams.get('characterId'), url.searchParams.get('name'));
          sendJson(response, 200, result);
        } catch (error) {
          const code = error?.message || 'ERROR';
          const errors = {
            BAD_CHARACTER: [400, '角色编号不合法。'],
            BAD_NAME: [400, '文件名或格式不合法。'],
            CHARACTER_NOT_FOUND: [404, '找不到该角色。'],
            NOT_FOUND: [404, '找不到该图片。'],
            ESCAPE: [400, '图片路径不合法。'],
          };
          const [status, message] = errors[code] || [500, '删除图片失败。'];
          sendJson(response, status, { error: code, message });
        }
        return;
      }

      try {
        const { characters } = await getIndex();
        const category = url.searchParams.get('category') || 'characters:all';
        const query = (url.searchParams.get('q') || '').trim().toLocaleLowerCase();
        const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') || '0', 10) || 0);
        const limit = Math.min(120, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '60', 10) || 60));

        let source;
        if (category === 'characters:all') source = characters;
        else if (category.startsWith('characters:')) source = characters.filter(item => item.id === category.slice(11));
        else {
          sendJson(response, 400, { error: 'Only character assets are available.' });
          return;
        }

        const filtered = query
          ? source.filter(item => [item.id, item.name, ...item.keywords, ...item.aliases].join(' ').toLocaleLowerCase().includes(query))
          : source;
        sendJson(response, 200, {
          category,
          total: filtered.length,
          offset,
          limit,
          items: filtered.slice(offset, offset + limit),
        });
      } catch {
        sendJson(response, 500, { error: 'Unable to read character assets.' });
      }
      return;
    }

    if (url.pathname.startsWith('/files/images/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD' });
        response.end('Method Not Allowed');
        return;
      }
      await serveRegisteredFile(request, response, url.pathname.slice('/files/images/'.length), 'image');
      return;
    }
    if (url.pathname.startsWith('/files/models/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD' });
        response.end('Method Not Allowed');
        return;
      }
      await serveRegisteredFile(request, response, url.pathname.slice('/files/models/'.length), 'model');
      return;
    }

    response.writeHead(404);
    response.end('Not Found');
  };

  handler.getDb = getDb;
  handler.ensureDbReady = ensureDbReady;
  handler.close = () => {
    if (ownedDb) {
      ownedDb.close();
      ownedDb = null;
    }
  };
  return handler;
}

export function createAssetServer(options) {
  const handler = createAssetHandler(options);
  const server = createServer(handler);
  server.on('close', () => handler.close?.());
  return server;
}
