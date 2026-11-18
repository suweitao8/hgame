#!/usr/bin/env node
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import posixPath from 'node:path/posix';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

export const TOY_MAX_INDEX_HTML_BYTES = 1024 * 1024;
export const TOY_LARGE_DOC_BYTES = 12 * 1024 * 1024;
export const TOY_MAX_IMAGE_EDGE = 10000;
export const TOY_MAX_ICON_BYTES = 512 * 1024;
export const TOY_MAX_ICON_EDGE = 1024;
export const TOY_SLUG_RE = /^[A-Za-z0-9_-]{1,64}$/;

const CONTENTHASH_RE = /[-._][A-Za-z0-9_-]*[0-9_-][A-Za-z0-9_-]*\.(?:js|css)$/;
const RATE_LIMITED_METHODS = [
  'getCloudStorage',
  'setCloudStorage',
  'removeCloudStorage',
  'getSharedStorage',
  'setSharedStorage',
  'removeSharedStorage',
  'submitScore',
  'getRankList',
  'getMyRank',
  'checkInputSafety',
];
const RATE_LIMITED_CALL_RE = new RegExp(`\\.\\s*(?:${RATE_LIMITED_METHODS.join('|')})\\s*\\(`, 'g');
const POLL_RE = /\bsetInterval\s*\([^;{}]*$/;
const LOOP_RE = /\b(?:for|while)\s*\([^)]*\)\s*(?:\{[^}]*)?$|\bdo\s*\{[^}]*$/;
const HIGH_FREQ_RE = /\b(?:requestAnimationFrame|onFrame|fixedUpdate|update|render)\s*(?:\([^;{}]*$|(?:=>\s*\{|:\s*function\s*\([^)]*\)\s*\{|\([^)]*\)\s*(?:=>\s*)?\{)[^;{}]*$)/;
const AUDIO_VIDEO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.mp4', '.webm', '.mov']);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const FORBIDDEN_TOP_OR_PATH_RE = /(?:^|\/)(?:\.git|\.agents|\.re-workspace|node_modules|__MACOSX)(?:\/|$)/i;
const BILIBILI_OWNED_HOSTS = /(?:^|\.)(?:bilibili\.com|hdslb\.com|b23\.tv|bilivideo\.com)$/i;
const HOST_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

function normalizePosix(rel) {
  return rel.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function isIgnoredUrl(url) {
  const s = url.trim();
  if (!s) return true;
  const lower = s.toLowerCase();
  return (
    s.startsWith('#') ||
    lower.startsWith('javascript:') ||
    lower.startsWith('mailto:') ||
    lower.startsWith('tel:') ||
    lower.startsWith('data:') ||
    lower.startsWith('blob:') ||
    lower.startsWith('about:') ||
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('//') ||
    s.includes('{{') ||
    s.includes('${')
  );
}

function resolveRelativeRef(fromRel, rawUrl) {
  const clean = rawUrl.trim().split('#', 1)[0].split('?', 1)[0];
  let decoded = clean;
  try { decoded = decodeURIComponent(clean); } catch {}
  const dir = posixPath.dirname(fromRel);
  const joined = dir === '.' ? decoded : `${dir}/${decoded}`;
  return posixPath.normalize(joined);
}

// Library banners are informational text, not network requests. Restrict these
// exclusions to known message shapes; URLs elsewhere, including the same hosts,
// remain candidates for EXTERNAL_SERVICE_ACCESS.
function omitKnownLibraryNotices(code) {
  return code
    .replace(/\/\*!\s*\*\s*(?:GSAP|CSSPlugin)\s+[\d.]+[\s\S]*?\*\//g, '')
    .replace(/not found\. https:\/\/gsap\.com(?=["'])/g, 'not found.')
    .replace(/`%c\s+%c\s+%c\s+%c\s+%c PixiJS %c v\$\{[\w$]+\} \(\$\{[\w$]+\}\) https?:\/\/www\.pixijs\.com\/\s*`/g, '``')
    .replace(/`PixiJS \$\{[\w$]+\} - \$\{[\w$]+\} - https?:\/\/www\.pixijs\.com\/`/g, '``');
}

/** Parse PKZIP buffer into Map<posixPath, Buffer>. */
export function parseZipEntries(zipBuffer) {
  let eocdOffset = -1;
  for (let i = zipBuffer.length - 22; i >= Math.max(0, zipBuffer.length - 65558); i--) {
    if (zipBuffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('Invalid ZIP archive: EOCD signature not found');
  const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  const centralOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
  const entries = new Map();
  let ptr = centralOffset;
  for (let idx = 0; idx < totalEntries; idx++) {
    if (zipBuffer.readUInt32LE(ptr) !== 0x02014b50) throw new Error('Invalid ZIP central directory entry');
    const method = zipBuffer.readUInt16LE(ptr + 10);
    const compSize = zipBuffer.readUInt32LE(ptr + 20);
    const nameLen = zipBuffer.readUInt16LE(ptr + 28);
    const extraLen = zipBuffer.readUInt16LE(ptr + 30);
    const commentLen = zipBuffer.readUInt16LE(ptr + 32);
    const localOffset = zipBuffer.readUInt32LE(ptr + 42);
    const rawName = zipBuffer.subarray(ptr + 46, ptr + 46 + nameLen).toString('utf8');
    ptr += 46 + nameLen + extraLen + commentLen;
    if (rawName.endsWith('/')) continue;
    const norm = normalizePosix(rawName);
    if (!norm || norm.includes('..') || norm.includes('\0')) continue;
    const lNameLen = zipBuffer.readUInt16LE(localOffset + 26);
    const lExtraLen = zipBuffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const payload = zipBuffer.subarray(start, start + compSize);
    const data = method === 8 ? zlib.inflateRawSync(payload) : method === 0 ? payload : null;
    if (!data) throw new Error(`Unsupported ZIP compression method ${method} for ${norm}`);
    entries.set(norm, data);
  }
  return entries;
}

/** Read PNG/JPEG/GIF/WebP dimensions without external libraries. */
export function getImageDimensions(buf) {
  if (!buf || buf.length < 16) return null;
  // PNG
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), format: 'png' };
  }
  // GIF
  if (buf.length >= 10 && buf.subarray(0, 4).toString('ascii') === 'GIF8') {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8), format: 'gif' };
  }
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      i += 2;
      if (marker === 0xd8 || marker === 0xd9) continue;
      if (i + 2 > buf.length) return null;
      const len = buf.readUInt16BE(i);
      if (len < 2 || i + len > buf.length) return null;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { height: buf.readUInt16BE(i + 3), width: buf.readUInt16BE(i + 5), format: 'jpeg' };
      }
      i += len;
    }
    return null;
  }
  // WebP
  if (buf.length >= 30 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    const chunk = buf.subarray(12, 16).toString('ascii');
    if (chunk === 'VP8 ' && buf.length >= 30) {
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff, format: 'webp' };
    }
    if (chunk === 'VP8L' && buf.length >= 25) {
      const b0 = buf[21], b1 = buf[22], b2 = buf[23], b3 = buf[24];
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      return { width, height, format: 'webp' };
    }
    if (chunk === 'VP8X' && buf.length >= 30) {
      const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      return { width, height, format: 'webp' };
    }
  }
  return null;
}

async function loadPackageFiles(targetPath) {
  const abs = path.resolve(targetPath);
  const st = await stat(abs);
  const files = new Map();
  if (st.isDirectory()) {
    async function walk(curr, prefix) {
      const dirents = await readdir(curr, { withFileTypes: true });
      for (const d of dirents) {
        const nextRel = prefix ? `${prefix}/${d.name}` : d.name;
        const childAbs = path.join(curr, d.name);
        if (d.isDirectory()) {
          if (d.name === '.git' || d.name === 'node_modules' || d.name === '__MACOSX') {
            files.set(`${nextRel}/__marker__`, Buffer.alloc(0));
            continue;
          }
          await walk(childAbs, nextRel);
        } else if (d.isFile()) {
          files.set(normalizePosix(nextRel), await readFile(childAbs));
        }
      }
    }
    await walk(abs, '');
    return { kind: 'dir', abs, files };
  }
  if (st.isFile() && abs.toLowerCase().endsWith('.zip')) {
    const buf = await readFile(abs);
    return { kind: 'zip', abs, files: parseZipEntries(buf) };
  }
  if (st.isFile() && /\.html?$/i.test(abs)) {
    const buf = await readFile(abs);
    files.set('index.html', buf);
    return { kind: 'html', abs, files };
  }
  throw new Error(`Unsupported Toy package target: ${abs}`);
}

function enclosingRatePrefixes(text, pos) {
  const prefixes = [];
  const lookbackStart = Math.max(0, pos - 4000);
  const slice = text.slice(lookbackStart, pos);
  let braceDepth = 0;
  let parenDepth = 0;
  for (let i = slice.length - 1; i >= 0 && prefixes.length < 8; i--) {
    const ch = slice[i];
    if (ch === '}') braceDepth++;
    else if (ch === '{') {
      if (braceDepth > 0) braceDepth--;
      else prefixes.push(slice.slice(Math.max(0, i - 200), i + 1));
    } else if (ch === ')') parenDepth++;
    else if (ch === '(') {
      if (parenDepth > 0) parenDepth--;
      else prefixes.push(slice.slice(Math.max(0, i - 160), i + 1));
    }
  }
  return prefixes;
}

/**
 * Run Bilibili Toy preflight checks against a directory, ZIP archive, or single HTML file.
 * @param {object} options
 * @param {string} options.targetPath
 * @param {string} [options.slug]
 * @param {string} [options.poster]
 * @param {string} [options.icon]
 * @param {boolean} [options.requireRootIndex=false]
 * @param {boolean} [options.requirePoster=false]
 */
export async function runToyPreflight({
  targetPath,
  slug,
  poster,
  icon,
  requireRootIndex = false,
  requirePoster = false,
} = {}) {
  const findings = [];
  const capabilities = new Set();
  const externalDomains = new Set();
  const error = (file, message, rule) => findings.push({ severity: 'ERROR', file, message, rule });
  const warn = (file, message, rule) => findings.push({ severity: 'WARN', file, message, rule });

  if (slug !== undefined && slug !== null && slug !== '') {
    if (!TOY_SLUG_RE.test(slug)) {
      error('slug', `Invalid slug "${slug}": must match ^[A-Za-z0-9_-]{1,64}$`, 'invalid-slug');
    }
  }

  if (poster) {
    const pAbs = path.resolve(poster);
    let okFile = false;
    try { okFile = (await stat(pAbs)).isFile(); } catch {}
    if (!okFile) {
      error('poster', `Poster file not found: ${pAbs}`, 'missing-poster');
    } else if (!/\.(?:png|jpe?g)$/i.test(pAbs)) {
      error('poster', 'Poster must be .png, .jpg, or .jpeg', 'poster-format');
    } else {
      const dims = getImageDimensions(await readFile(pAbs));
      if (!dims || (dims.format !== 'png' && dims.format !== 'jpeg')) {
        error('poster', 'Poster content is not a valid PNG/JPEG image', 'poster-corrupt');
      } else {
        if (dims.width >= TOY_MAX_IMAGE_EDGE || dims.height >= TOY_MAX_IMAGE_EDGE) {
          error('poster', `Poster dimensions ${dims.width}x${dims.height} exceed <10000px limit`, 'image-edge-limit');
        }
        if (dims.height > dims.width) {
          warn('poster', `Portrait poster (${dims.width}x${dims.height}) may crop poorly; 4:3 landscape is preferred`, 'poster-ratio');
        } else if (Math.abs(dims.width / dims.height - 4 / 3) > 0.08) {
          warn('poster', `4:3 landscape poster is preferred; found ${dims.width}x${dims.height}`, 'poster-ratio');
        }
      }
    }
  } else if (requirePoster) {
    error('poster', 'Poster is required for toy create', 'missing-poster');
  }

  if (icon) {
    const iAbs = path.resolve(icon);
    let okFile = false;
    try { okFile = (await stat(iAbs)).isFile(); } catch {}
    if (!okFile) {
      error('icon', `Icon file not found: ${iAbs}`, 'missing-icon');
    } else if (!/\.(?:png|jpe?g)$/i.test(iAbs)) {
      error('icon', 'Icon must be .png, .jpg, or .jpeg', 'icon-format');
    } else {
      const buf = await readFile(iAbs);
      if (buf.length > TOY_MAX_ICON_BYTES) {
        error('icon', `Icon size ${buf.length} bytes exceeds 512KB limit`, 'icon-size');
      }
      const dims = getImageDimensions(buf);
      if (!dims || (dims.format !== 'png' && dims.format !== 'jpeg')) {
        error('icon', 'Icon content is not a valid PNG/JPEG image', 'icon-corrupt');
      } else if (dims.width > TOY_MAX_ICON_EDGE || dims.height > TOY_MAX_ICON_EDGE) {
        error('icon', `Icon dimensions ${dims.width}x${dims.height} exceed 1024x1024px limit`, 'icon-edge-limit');
      }
    }
  }

  const pkg = await loadPackageFiles(targetPath);
  const allPaths = [...pkg.files.keys()].filter(p => !p.endsWith('/__marker__'));
  const hasRealFile = rel => pkg.files.has(rel);

  for (const rel of pkg.files.keys()) {
    const cleanRel = rel.replace(/\/__marker__$/, '');
    if (FORBIDDEN_TOP_OR_PATH_RE.test(cleanRel)) {
      error(cleanRel, 'Package contains forbidden workspace/VCS/dependency clutter (.git, node_modules, __MACOSX, .agents)', 'forbidden-clutter');
    } else if (posixPath.basename(cleanRel).toLowerCase() === 'toy.yaml') {
      error(cleanRel, 'Legacy toy.yaml must not be bundled in the upload package', 'forbidden-toy-yaml');
    } else if (posixPath.basename(cleanRel).toLowerCase() === '.ds_store') {
      warn(cleanRel, 'Remove .DS_Store from upload package', 'ds-store');
    }
  }

  // Locate entry index.html
  let entryIndex = null;
  if (hasRealFile('index.html')) {
    entryIndex = 'index.html';
  } else if (!requireRootIndex) {
    const level1 = allPaths.filter(p => /^[^/]+\/index\.html$/i.test(p));
    if (level1.length === 1) {
      entryIndex = level1[0];
    } else if (level1.length > 1) {
      error('.', `Ambiguous multiple first-level index.html entries: ${level1.join(', ')}`, 'ambiguous-index');
    }
  }
  if (!entryIndex) {
    error('.', requireRootIndex ? 'Missing root index.html' : 'Missing index.html at package root or single first-level directory', 'missing-index');
  }

  if (hasRealFile('package.json') && allPaths.some(p => /^(?:src|app|pages)\//i.test(p))) {
    warn('.', 'Package contains package.json alongside src/; upload built static output rather than source root', 'framework-source-root');
  }

  if (entryIndex) {
    const entryBytes = pkg.files.get(entryIndex).length;
    if (entryBytes > TOY_MAX_INDEX_HTML_BYTES) {
      error(entryIndex, `Entry index.html is ${(entryBytes / (1024 * 1024)).toFixed(2)} MB (over 1 MB hard limit, rejected with 307000)`, 'entry-index-over-1mb');
    }
  }

  let usesRateLimited = false;
  let handlesRateLimit307044 = false;
  let totalBytes = 0;

  const checkLocalRef = (fromRel, rawUrl) => {
    if (isIgnoredUrl(rawUrl)) {
      const m = /^(?:https?:)?\/\/([^/:?#]+)/i.exec(rawUrl.trim());
      if (m && !BILIBILI_OWNED_HOSTS.test(m[1]) && m[1] !== '127.0.0.1' && m[1] !== 'localhost') {
        externalDomains.add(m[1].toLowerCase());
        capabilities.add('EXTERNAL_SERVICE_ACCESS');
      }
      return;
    }
    if (rawUrl.length > 512) return;
    if (rawUrl.trim().startsWith('/')) {
      error(fromRel, `Root-relative resource path fails under /toy/<slug>/: ${rawUrl}`, 'root-relative-path');
      return;
    }
    const target = resolveRelativeRef(fromRel, rawUrl);
    if (target.startsWith('../')) {
      warn(fromRel, `Resource points outside package root: ${rawUrl}`, 'outside-package-ref');
      return;
    }
    if (target && !hasRealFile(target)) {
      error(fromRel, `Referenced local resource not found: ${rawUrl} -> ${target}`, 'missing-local-ref');
    }
  };

  const scanRateLimits = (rel, code) => {
    RATE_LIMITED_CALL_RE.lastIndex = 0;
    let m;
    while ((m = RATE_LIMITED_CALL_RE.exec(code)) !== null) {
      usesRateLimited = true;
      const method = m[0].replace(/^\.\s*|\s*\($/g, '');
      const prefixes = enclosingRatePrefixes(code, m.index);
      const immediate = code.slice(Math.max(0, m.index - 200), m.index);
      if (prefixes.some(p => POLL_RE.test(p))) {
        warn(rel, `${method}() inside setInterval/polling burns shared Toy quota`, 'rate-limit-poll');
      }
      if (/\b(?:for|while)\s*\([^)]*\)\s*$/.test(immediate) || prefixes.some(p => LOOP_RE.test(p))) {
        warn(rel, `${method}() inside loop; batch multiple keys per request instead`, 'rate-limit-loop');
      }
      if (prefixes.some(p => HIGH_FREQ_RE.test(p))) {
        warn(rel, `${method}() inside high-frequency frame/update callback; persist only at checkpoints`, 'rate-limit-high-freq');
      }
    }
    if (code.includes('307044')) handlesRateLimit307044 = true;
    if (/\bcheckInputSafety\b/.test(code)) capabilities.add('USER_CONTENT_INPUT');
    if (/\b(?:getChargeUnlock|openChargePanel)\b/.test(code)) {
      capabilities.add('CHARGE_UNLOCK');
      const lowCharge = /\b(?:getChargeUnlock|openChargePanel)\s*\(\s*\{\s*minPrice\s*:\s*(\d+)/g;
      let cm;
      while ((cm = lowCharge.exec(code)) !== null) {
        if (Number(cm[1]) < 1200) {
          warn(rel, `minPrice=${cm[1]} is below 1200 fen (12 RMB); 6 RMB tier does not unlock Toy content`, 'charge-min-price');
        }
      }
    }
    let extMatch;
    const extUrlRe = /(?:https?:\/\/|["'`]\s*\/\/)([A-Za-z0-9.-]+)/g;
    const externalScan = omitKnownLibraryNotices(code);
    while ((extMatch = extUrlRe.exec(externalScan)) !== null) {
      const host = extMatch[1].toLowerCase().replace(/\.$/, '');
      // Shader chunks commonly start with //---- separators inside strings.
      if (!host.split('.').every(label => HOST_LABEL_RE.test(label))) continue;
      if (!BILIBILI_OWNED_HOSTS.test(host) && host !== '127.0.0.1' && host !== 'localhost' && host !== 'www.w3.org') {
        externalDomains.add(host);
        capabilities.add('EXTERNAL_SERVICE_ACCESS');
      }
    }
  };

  for (const rel of allPaths) {
    const buf = pkg.files.get(rel);
    totalBytes += buf.length;
    const ext = posixPath.extname(rel).toLowerCase();

    if (AUDIO_VIDEO_EXTS.has(ext)) {
      capabilities.add('AUDIO_VIDEO_UPLOAD');
    }

    if (IMAGE_EXTS.has(ext)) {
      const dims = getImageDimensions(buf);
      if (dims && (dims.width >= TOY_MAX_IMAGE_EDGE || dims.height >= TOY_MAX_IMAGE_EDGE)) {
        error(rel, `Image dimensions ${dims.width}x${dims.height} exceed Toy limit (< 10000px)`, 'image-edge-limit');
      }
    }

    if (ext === '.html' || ext === '.htm') {
      if (rel !== entryIndex && buf.length >= TOY_LARGE_DOC_BYTES) {
        warn(rel, `HTML document is ${(buf.length / (1024 * 1024)).toFixed(2)} MB (>= 12 MB slows first load)`, 'large-html-doc');
      }
      const text = buf.toString('utf8');
      if (!/<title[^>]*>[\s\S]*?<\/title>/i.test(text)) {
        warn(rel, 'Missing <title>; Toy title cannot be inferred automatically', 'missing-title');
      }
      if (/(?:window\.)?location(?:\.href)?\s*=\s*["']\//.test(text)) {
        error(rel, 'Root-relative JS navigation found; use relative paths under /toy/<slug>/', 'root-relative-nav');
      }
      for (const mut of ['location.hash', 'history.pushState', 'history.replaceState']) {
        if (text.includes(mut)) warn(rel, `URL mutation "${mut}" may affect Toy navigation or sharing`, 'url-mutation');
      }
      if (/<(?:input|textarea)\b/i.test(text)) {
        capabilities.add('USER_CONTENT_INPUT');
      }

      const attrRe = /\b(?:src|href|poster|data)\s*=\s*(["'])([^"']+)\1/gi;
      let m;
      while ((m = attrRe.exec(text)) !== null) checkLocalRef(rel, m[2]);
      const srcsetRe = /\bsrcset\s*=\s*(["'])([^"']+)\1/gi;
      while ((m = srcsetRe.exec(text)) !== null) {
        for (const part of m[2].split(',')) {
          const candidate = part.trim().split(/\s+/)[0];
          if (candidate) checkLocalRef(rel, candidate);
        }
      }
      const styleBlockRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
      while ((m = styleBlockRe.exec(text)) !== null) {
        const urlRe = /url\(\s*(["']?)([^'")]+)\1\s*\)/gi;
        let um;
        while ((um = urlRe.exec(m[1])) !== null) checkLocalRef(rel, um[2]);
      }
      const styleAttrRe = /\bstyle\s*=\s*(["'])([\s\S]*?)\1/gi;
      while ((m = styleAttrRe.exec(text)) !== null) {
        const urlRe = /url\(\s*(["']?)([^'")]+)\1\s*\)/gi;
        let um;
        while ((um = urlRe.exec(m[2])) !== null) checkLocalRef(rel, um[2]);
      }
      const scriptRe = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
      while ((m = scriptRe.exec(text)) !== null) scanRateLimits(rel, m[1]);
    } else if (ext === '.css') {
      const css = buf.toString('utf8');
      const urlRe = /url\(\s*(["']?)([^'")]+)\1\s*\)/gi;
      let um;
      while ((um = urlRe.exec(css)) !== null) checkLocalRef(rel, um[2]);
    } else if (ext === '.js' || ext === '.mjs') {
      const js = buf.toString('utf8');
      if (/(?:window\.)?location(?:\.href)?\s*=\s*["']\//.test(js)) {
        error(rel, 'Root-relative JS navigation found; use relative paths under /toy/<slug>/', 'root-relative-nav');
      }
      scanRateLimits(rel, js);
    }
  }

  if (usesRateLimited && !handlesRateLimit307044) {
    warn('.', 'Toy cloud storage/leaderboard calls detected without explicit 307044 backoff handling', 'missing-307044-handling');
  }

  // Contenthash check matching official toy_doctor.py
  const hashAssets = allPaths.filter(p => /\.(?:js|css)$/i.test(p) && !/\.min\.(?:js|css)$/i.test(p));
  if (hashAssets.length >= 2 && !hashAssets.some(p => CONTENTHASH_RE.test(posixPath.basename(p)))) {
    warn('.', `${hashAssets.length} JS/CSS assets lack contenthash filenames (e.g. main-<hash>.js); updates will force full re-download`, 'missing-contenthash');
  }

  if (totalBytes > 20 * 1024 * 1024) {
    capabilities.add('LARGE_PACKAGE_UPLOAD');
  }

  const errors = findings.filter(f => f.severity === 'ERROR');
  const warnings = findings.filter(f => f.severity === 'WARN');

  return {
    ok: errors.length === 0,
    target: pkg.abs,
    kind: pkg.kind,
    entryIndex,
    fileCount: allPaths.length,
    totalBytes,
    errorCount: errors.length,
    warningCount: warnings.length,
    requiredCapabilities: [...capabilities].sort(),
    externalDomains: [...externalDomains].sort(),
    findings,
  };
}

function parseCliArgs(argv) {
  const opts = {
    targetPath: '',
    slug: undefined,
    poster: undefined,
    icon: undefined,
    requireRootIndex: false,
    requirePoster: false,
    json: true,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--slug') opts.slug = argv[++i];
    else if (a === '--poster') opts.poster = argv[++i];
    else if (a === '--icon') opts.icon = argv[++i];
    else if (a === '--require-root-index') opts.requireRootIndex = true;
    else if (a === '--require-poster') opts.requirePoster = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--text') opts.json = false;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (!a.startsWith('-') && !opts.targetPath) opts.targetPath = a;
    else throw new Error(`Unknown or incomplete argument: ${a}`);
  }
  return opts;
}

async function main() {
  const opts = parseCliArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('Usage: node scripts/toy-preflight.mjs <dir|zip|html> [--slug <slug>] [--poster <file>] [--icon <file>] [--require-root-index] [--require-poster] [--json|--text]');
    return;
  }
  const report = await runToyPreflight({
    targetPath: opts.targetPath || process.cwd(),
    slug: opts.slug,
    poster: opts.poster,
    icon: opts.icon,
    requireRootIndex: opts.requireRootIndex,
    requirePoster: opts.requirePoster,
  });
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const f of report.findings) {
      console.log(`${f.severity}: ${f.file}: ${f.message}`);
    }
    if (report.requiredCapabilities.length) {
      console.log(`CAPABILITIES: ${report.requiredCapabilities.join(', ')}`);
    }
    console.log(report.ok
      ? `OK: Toy preflight passed with ${report.warningCount} warning(s)`
      : `FAILED: ${report.errorCount} error(s), ${report.warningCount} warning(s)`);
  }
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('Toy preflight failed: ' + err.message);
    process.exitCode = 1;
  });
}
