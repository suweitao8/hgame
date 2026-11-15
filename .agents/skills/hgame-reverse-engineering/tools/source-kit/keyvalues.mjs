#!/usr/bin/env node
// Generic Valve KeyValues (KV1 text) parser & numeric normalizer.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export function parseKV(text) {
  let i = 0;
  const n = text.length;

  function skipWs() {
    while (i < n) {
      const c = text[i];
      if (c === '/' && text[i + 1] === '/') {
        while (i < n && text[i] !== '\n') i++;
      } else if (c === '/' && text[i + 1] === '*') {
        i += 2;
        while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++;
        i += 2;
      } else if (c === '\n' || c === ' ' || c === '\t' || c === '\r') {
        i++;
      } else {
        break;
      }
    }
  }

  function readToken() {
    skipWs();
    if (i >= n) return null;
    if (text[i] === '"') {
      i++;
      let out = '';
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\' && (text[i + 1] === '"' || text[i + 1] === '\\')) {
          out += text[i + 1];
          i += 2;
        } else {
          out += text[i];
          i++;
        }
      }
      if (text[i] === '"') i++;
      return out;
    }
    const start = i;
    while (i < n && !['\n', ' ', '\t', '\r', '{', '}'].includes(text[i])) i++;
    return i === start ? null : text.slice(start, i);
  }

  function parseBlock() {
    const obj = {};
    while (true) {
      skipWs();
      if (i >= n) break;
      if (text[i] === '}') {
        i++;
        break;
      }
      const key = readToken();
      if (key === null) {
        i++;
        continue;
      }
      skipWs();
      if (text[i] === '{') {
        i++;
        obj[key] = parseBlock();
      } else {
        const val = readToken();
        obj[key] = val === null ? '' : val;
      }
    }
    return obj;
  }

  return parseBlock();
}

export function coerceScalar(raw) {
  if (typeof raw !== 'string') return raw;
  const t = raw.trim();
  if (/^-?\d+(?:\.\d+)?$/.test(t)) {
    const n = Number(t);
    if (Number.isFinite(n)) return n;
  }
  return raw;
}

export function normalizeKvWeaponScripts(scriptsDir, options = {}) {
  if (!existsSync(scriptsDir)) return {};
  const maxEntries = options.maxEntries ?? 64;
  const out = {};
  const files = readdirSync(scriptsDir)
    .filter((f) => /^weapon_.*\.txt$/i.test(f))
    .sort()
    .slice(0, maxEntries);

  for (const file of files) {
    const full = path.join(scriptsDir, file);
    if (!statSync(full).isFile()) continue;
    const id = file.replace(/^weapon_/i, '').replace(/\.txt$/i, '');
    const parsed = parseKV(readFileSync(full, 'utf8'));
    const root = parsed.WeaponData || parsed;
    const normalized = {};
    for (const [k, v] of Object.entries(root)) {
      if (v && typeof v === 'object') continue;
      normalized[k] = coerceScalar(v);
    }
    out[id] = normalized;
  }
  return out;
}
