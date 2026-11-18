#!/usr/bin/env node
// Zero-dependency minimalist zero-prose UI/UX linter for HGame projects.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FORBIDDEN_PHRASES = [
  '操作说明', '玩法介绍', '游戏简介', '游戏说明', '操作指南', '玩法说明',
  '新手引导', '按键说明', '控制说明', '背景故事', '制作人员', '技术支持',
  'how to play', 'instructions', 'game controls', 'controls:',
  'powered by', 'made with', 'game description', 'tutorial:',
];

const IGNORE_JSON_FILES = new Set([
  'story.json', 'level.json', 'materials.json', 'model-slots.json',
  'game.config.json', 'engine.config.json', 'package.json', 'assets.manifest.json',
]);

function parseArgs(argv) {
  let dir = '';
  let demo = false;
  let maxCardChars = 18;
  let maxBtnHanzi = 4;
  let maxProseChars = 22;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir' || a === '--game' || a === '-d') dir = argv[++i] ?? '';
    else if (a === '--demo') demo = true;
    else if (a === '--max-card-chars') maxCardChars = Math.max(8, parseInt(argv[++i] ?? '18', 10) || 18);
    else if (a === '--max-btn-hanzi') maxBtnHanzi = Math.max(2, parseInt(argv[++i] ?? '4', 10) || 4);
    else if (a === '--max-prose-chars') maxProseChars = Math.max(12, parseInt(argv[++i] ?? '22', 10) || 22);
    else if (!a.startsWith('-') && !dir) dir = a;
  }
  return { dir, demo, maxCardChars, maxBtnHanzi, maxProseChars };
}

function lineAt(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

function countHanzi(str) {
  const m = str.match(/[\u4e00-\u9fff]/g);
  return m ? m.length : 0;
}

function stripTagsAndExpr(str) {
  return str
    .replace(/\$\{[^}]*\}/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-zA-Z0-9#]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clip(str, len = 64) {
  const s = str.replace(/\s+/g, ' ').trim();
  return s.length > len ? s.slice(0, len - 1) + '…' : s;
}

// Blank JS comments while preserving newlines so line numbers stay exact.
function stripJsCommentsPreserveLines(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === "'" || ch === '"' || ch === '`') {
      const q = ch;
      out += ch;
      i++;
      while (i < n) {
        const c = src[i];
        out += c;
        if (c === '\\' && i + 1 < n) {
          out += src[i + 1];
          i += 2;
          continue;
        }
        if (c === q) { i++; break; }
        i++;
      }
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (ch === '/' && next === '*') {
      out += '  ';
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < n) { out += '  '; i += 2; }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function checkForbiddenPhrases(text, rawSource, file, baseOffset, violations) {
  const lower = text.toLowerCase();
  for (const phrase of FORBIDDEN_PHRASES) {
    let idx = lower.indexOf(phrase);
    while (idx !== -1) {
      violations.push({
        file,
        line: lineAt(rawSource, baseOffset + idx),
        rule: 'forbidden-prose-keyword',
        message: `Forbidden instructional/website copy "${phrase}"`,
        snippet: clip(text.slice(Math.max(0, idx - 12), idx + phrase.length + 24)),
      });
      idx = lower.indexOf(phrase, idx + phrase.length);
    }
  }
}

function checkHtmlMarkup(html, rawSource, file, baseOffset, opts, violations) {
  const cleanHtml = html.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '));

  // 1. Explanatory <p> / <footer> / subtitle / tutorial prose tags
  const proseTagRe = /<(p|footer)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = proseTagRe.exec(cleanHtml)) !== null) {
    const tag = m[1].toLowerCase();
    const inner = stripTagsAndExpr(m[3]);
    if (!inner) continue;
    violations.push({
      file,
      line: lineAt(rawSource, baseOffset + m.index),
      rule: 'prose-paragraph-tag',
      message: `Disallowed <${tag}> prose block in game UI`,
      snippet: clip(inner),
    });
  }

  const subtitleClassRe = /<[a-z0-9]+\b[^>]*(?:class|id)=["'][^"']*\b(?:subtitle|tagline|instructions|how-to-play|tutorial|guide-text)\b[^"']*["'][^>]*>([\s\S]*?)<\/[a-z0-9]+>/gi;
  while ((m = subtitleClassRe.exec(cleanHtml)) !== null) {
    const inner = stripTagsAndExpr(m[1]);
    if (!inner) continue;
    violations.push({
      file,
      line: lineAt(rawSource, baseOffset + m.index),
      rule: 'prose-paragraph-tag',
      message: 'Disallowed subtitle/instructional UI container',
      snippet: clip(inner),
    });
  }

  // 2. Card-nested redundant buttons: <div class="...card...">...<button ...>...</button>
  const cardOpenRe = /<(div|li|section|article)\b[^>]*(?:class|id)=["'][^"']*(?:\bcard\b|upgrade-card|shop-item|shop-card|perk-card|choice-card)[^"']*["'][^>]*>/gi;
  while ((m = cardOpenRe.exec(cleanHtml)) !== null) {
    const openEnd = m.index + m[0].length;
    const tag = m[1].toLowerCase();
    const closeRe = new RegExp(`</?${tag}\\b`, 'gi');
    closeRe.lastIndex = openEnd;
    let depth = 1;
    let endIdx = cleanHtml.length;
    let tm;
    while ((tm = closeRe.exec(cleanHtml)) !== null) {
      if (tm[0].startsWith('</')) depth--;
      else depth++;
      if (depth === 0) { endIdx = tm.index; break; }
    }
    const body = cleanHtml.slice(openEnd, endIdx);
    const nestedBtn = /<button\b[^>]*>([\s\S]*?)<\/button>/i.exec(body);
    if (nestedBtn) {
      violations.push({
        file,
        line: lineAt(rawSource, baseOffset + openEnd + nestedBtn.index),
        rule: 'card-nested-button',
        message: 'Card must be clickable as a whole; remove nested <button>',
        snippet: clip(nestedBtn[0]),
      });
    }
    const cardText = stripTagsAndExpr(body);
    if (cardText.includes('。') || countHanzi(cardText) > opts.maxCardChars) {
      violations.push({
        file,
        line: lineAt(rawSource, baseOffset + m.index),
        rule: 'long-ui-prose',
        message: `Card text exceeds ${opts.maxCardChars} hanzi or uses full sentences`,
        snippet: clip(cardText),
      });
    }
  }

  // 3. Button text length <= 4 hanzi (strip parenthetical key hint e.g. (U))
  const btnRe = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
  while ((m = btnRe.exec(cleanHtml)) !== null) {
    const attrs = m[1];
    if (/\bcard\b/i.test(attrs)) continue; // whole-card button checked above
    const rawLabel = stripTagsAndExpr(m[2]).replace(/\s*\([A-Za-z0-9]+\)\s*$/g, '').trim();
    const hanzi = countHanzi(rawLabel);
    const words = rawLabel ? rawLabel.split(/\s+/).filter(Boolean) : [];
    if (hanzi > opts.maxBtnHanzi || (hanzi === 0 && words.length > 2 && rawLabel.length > 14)) {
      violations.push({
        file,
        line: lineAt(rawSource, baseOffset + m.index),
        rule: 'button-text-too-long',
        message: `Button label exceeds ${opts.maxBtnHanzi} hanzi (or 2 short words)`,
        snippet: clip(rawLabel),
      });
    }
  }

  // 4. Toast container markup
  const toastRe = /<[a-z0-9]+\b[^>]*(?:class|id)=["'][^"']*\btoast\b[^"']*["'][^>]*>/gi;
  while ((m = toastRe.exec(cleanHtml)) !== null) {
    violations.push({
      file,
      line: lineAt(rawSource, baseOffset + m.index),
      rule: 'toast-notification',
      message: 'Avoid toast text bars; convey state via createVfxSystem + audio.playSynth',
      snippet: clip(m[0]),
    });
  }
}

function isIgnorableCodeString(str, contextBefore) {
  if (!str) return true;
  if (/\bthrow\s+new\s+(?:Error|TypeError|RangeError|AggregateError)\s*\(\s*$/.test(contextBefore)) return true;
  if (/\bthrow\s+new\s+AggregateError\s*\(\s*\[[^\]]*\]\s*,\s*$/.test(contextBefore)) return true;
  if (/^\s*(?:import|export)\b[^;]*\bfrom\s*$/.test(contextBefore)) return true;
  if (/\b(?:fetch|import|require)\s*\(\s*$/.test(contextBefore)) return true;
  if (/^(?:\.{0,2}\/|https?:\/\/|data:|#[0-9a-fA-F]{3,8}$)/.test(str)) return true;
  if (/^(?:uniform|attribute|varying|precision|void main|gl_Position|#version)\b/m.test(str)) return true;
  if (/^[a-zA-Z0-9_.,:;\/\-+\s=#%()*[\]]+$/.test(str) && !/\s+[a-z]{2,}\s+[a-z]{2,}\s+[a-z]{2,}/.test(str)) return true;
  return false;
}

function checkUiProseString(str, rawSource, file, offset, opts, violations) {
  const text = stripTagsAndExpr(str);
  if (!text) return;
  checkForbiddenPhrases(text, rawSource, file, offset, violations);

  const hanzi = countHanzi(text);
  if (hanzi > 0) {
    if (/[。！？]/.test(text) && hanzi >= 8) {
      violations.push({
        file,
        line: lineAt(rawSource, offset),
        rule: 'long-ui-prose',
        message: 'Full prose sentence with sentence punctuation is forbidden in UI',
        snippet: clip(text),
      });
      return;
    }
    if (hanzi > opts.maxProseChars) {
      violations.push({
        file,
        line: lineAt(rawSource, offset),
        rule: 'long-ui-prose',
        message: `UI string has ${hanzi} hanzi (> ${opts.maxProseChars} max outside story.json)`,
        snippet: clip(text),
      });
    }
    return;
  }

  const enWords = text.match(/[A-Za-z]{2,}/g) || [];
  if (enWords.length >= 7 && text.length > 40 && /[a-z]/.test(text)) {
    violations.push({
      file,
      line: lineAt(rawSource, offset),
      rule: 'long-ui-prose',
      message: `UI English prose string (${enWords.length} words) exceeds minimalist limit`,
      snippet: clip(text),
    });
  }
}

function scanHtmlFile(file, content, opts, violations) {
  const withoutScripts = content
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, m => m.replace(/[^\n]/g, ' '))
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, m => m.replace(/[^\n]/g, ' '));
  checkForbiddenPhrases(withoutScripts, content, file, 0, violations);
  checkHtmlMarkup(withoutScripts, content, file, 0, opts, violations);

  // Scan visible text segments between tags (outside <title>)
  const noHead = withoutScripts.replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, m => m.replace(/[^\n]/g, ' '));
  const stripped = noHead
    .replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '))
    .replace(/<[^>]+>/g, m => m.replace(/[^\n]/g, ' '));
  const lines = stripped.split('\n');
  for (let idx = 0; idx < lines.length; idx++) {
    const seg = lines[idx].trim();
    if (!seg) continue;
    const hanzi = countHanzi(seg);
    const enWords = seg.match(/[A-Za-z]{2,}/g) || [];
    if ((hanzi > opts.maxProseChars) || (/[。！？]/.test(seg) && hanzi >= 8) || (enWords.length >= 7 && seg.length > 40)) {
      violations.push({
        file,
        line: idx + 1,
        rule: 'long-ui-prose',
        message: 'Overlong visible HTML prose block',
        snippet: clip(seg),
      });
    }
  }
}

function scanCssFile(file, content, violations) {
  const toastRe = /(?:^|[\s,}])(?:\.toast|#toast)\b/gm;
  let m;
  while ((m = toastRe.exec(content)) !== null) {
    violations.push({
      file,
      line: lineAt(content, m.index),
      rule: 'toast-notification',
      message: 'Toast UI selector detected; use VFX + audio instead of toast text bars',
      snippet: clip(m[0]),
    });
  }
}

function scanJsFile(file, content, opts, violations) {
  const code = stripJsCommentsPreserveLines(content);

  // Detect toast helper calls
  const toastCallRe = /\b(?:showToast|createToast|pushToast)\s*\(/g;
  let m;
  while ((m = toastCallRe.exec(code)) !== null) {
    violations.push({
      file,
      line: lineAt(content, m.index),
      rule: 'toast-notification',
      message: 'Toast call detected; convey state with createVfxSystem + audio.playSynth',
      snippet: clip(m[0]),
    });
  }

  // Extract string literals ('...', "...", `...`)
  let i = 0;
  const n = code.length;
  while (i < n) {
    const ch = code[i];
    if (ch !== "'" && ch !== '"' && ch !== '`') { i++; continue; }
    const q = ch;
    const start = i;
    const contextBefore = code.slice(Math.max(0, start - 60), start);
    i++;
    let lit = '';
    while (i < n) {
      const c = code[i];
      if (c === '\\' && i + 1 < n) {
        lit += c + code[i + 1];
        i += 2;
        continue;
      }
      if (c === q) { i++; break; }
      lit += c;
      i++;
    }
    if (isIgnorableCodeString(lit, contextBefore)) continue;
    if (/<[a-zA-Z][^>]*>/.test(lit)) {
      checkHtmlMarkup(lit, content, file, start + 1, opts, violations);
    }
    checkUiProseString(lit, content, file, start + 1, opts, violations);
  }
}

function scanJsonFile(file, content, opts, violations) {
  const strRe = /"((?:\\.|[^"\\])*)"\s*(?:[:,\]}])/g;
  let m;
  while ((m = strRe.exec(content)) !== null) {
    const val = m[1];
    checkUiProseString(val, content, file, m.index + 1, { ...opts, maxProseChars: opts.maxCardChars }, violations);
  }
}

function collectFiles(rootDir) {
  const files = [];
  for (const name of ['index.html', 'style.css']) {
    const abs = path.join(rootDir, name);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      files.push({ rel: name, abs, content: fs.readFileSync(abs, 'utf8') });
    }
  }
  const srcRoot = path.join(rootDir, 'src');
  if (fs.existsSync(srcRoot) && fs.statSync(srcRoot).isDirectory()) {
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'vendor' || entry.name.startsWith('.')) continue;
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(abs); continue; }
        const rel = path.relative(rootDir, abs).replace(/\\/g, '/');
        const ext = path.extname(entry.name).toLowerCase();
        const lower = entry.name.toLowerCase();
        if (ext === '.json' && (IGNORE_JSON_FILES.has(lower) || lower.includes('story'))) continue;
        if (['.html', '.css', '.js', '.mjs', '.ts', '.jsx', '.tsx', '.json'].includes(ext)) {
          files.push({ rel, abs, content: fs.readFileSync(abs, 'utf8') });
        }
      }
    };
    walk(srcRoot);
  }
  return files;
}

export function lintFiles(files, opts = { maxCardChars: 18, maxBtnHanzi: 4, maxProseChars: 22 }) {
  const violations = [];
  for (const f of files) {
    const ext = path.extname(f.rel).toLowerCase();
    if (ext === '.html') scanHtmlFile(f.rel, f.content, opts, violations);
    else if (ext === '.css') scanCssFile(f.rel, f.content, violations);
    else if (ext === '.json') scanJsonFile(f.rel, f.content, opts, violations);
    else scanJsFile(f.rel, f.content, opts, violations);
  }
  return {
    scannedFiles: files.map(f => f.rel),
    violationCount: violations.length,
    violations,
    pass: violations.length === 0,
  };
}

function runDemo(opts) {
  const cleanFiles = [
    {
      rel: 'index.html',
      content: [
        '<!doctype html><html><body>',
        '<canvas id="game"></canvas>',
        '<button id="pause" aria-label="Pause">⏸</button>',
        '<div id="levelup" hidden>',
        '  <button type="button" class="card"><span>⚔️ 狂暴</span><em class="pos">+25% 攻速</em></button>',
        '</div>',
        '</body></html>',
      ].join('\n'),
    },
    {
      rel: 'src/main.js',
      content: [
        'const label = "⚔️ 狂暴 +25% 攻速";',
        'const debug = location.search.includes("debug=1");',
      ].join('\n'),
    },
  ];

  const badFiles = [
    {
      rel: 'index.html',
      content: [
        '<!doctype html><html><body>',
        '<h1>Demo</h1>',
        '<p class="subtitle">操作说明：使用 WASD 移动并击败所有敌人即可获得最终胜利。</p>',
        '<div class="card"><strong>风暴之刃</strong><button type="button">选择</button></div>',
        '<button id="start">立即开始游戏</button>',
        '<footer>Powered by HGame</footer>',
        '</body></html>',
      ].join('\n'),
    },
    {
      rel: 'src/ui.js',
      content: [
        'const tip = "How to play: collect orbs to level up and survive.";',
        'function notify() { showToast("升级成功"); }',
      ].join('\n'),
    },
  ];

  const clean = lintFiles(cleanFiles, opts);
  const bad = lintFiles(badFiles, opts);
  const rulesFound = new Set(bad.violations.map(v => v.rule));
  const expected = ['forbidden-prose-keyword', 'prose-paragraph-tag', 'card-nested-button', 'button-text-too-long', 'long-ui-prose', 'toast-notification'];
  const missingRules = expected.filter(r => !rulesFound.has(r));
  const demoPass = clean.pass && !bad.pass && missingRules.length === 0 && bad.violations.every(v => v.line > 0);
  console.log(JSON.stringify({
    demo: true,
    pass: demoPass,
    cleanPass: clean.pass,
    badViolationsCaught: bad.violationCount,
    rulesCaught: [...rulesFound],
    missingRules,
    sampleViolations: bad.violations,
  }, null, 2));
  if (!demoPass) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (args.demo) {
    runDemo(args);
  } else if (!args.dir) {
    console.error('Usage: node check-ui.mjs --dir <game-dir> | --demo');
    process.exit(1);
  } else {
    const target = path.resolve(args.dir);
    if (!fs.existsSync(target)) {
      console.error(`Directory not found: ${target}`);
      process.exit(1);
    }
    const report = lintFiles(collectFiles(target), args);
    console.log(JSON.stringify(report, null, 2));
    if (!report.pass) process.exit(1);
  }
}
