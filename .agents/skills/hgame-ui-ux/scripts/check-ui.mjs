#!/usr/bin/env node
// Zero-dependency minimalist Anti-Bloat UI/UX linter for HGame projects.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FORBIDDEN_PHRASES = [
  '操作说明', '玩法介绍', '游戏简介', '游戏说明', '操作指南', '玩法说明',
  '规则说明', '游戏规则', '新手教程', '新手教学', '玩法教学', '帮助说明', '游戏教程',
  '新手引导', '按键说明', '控制说明', '背景故事', '制作人员', '技术支持',
  '二次确认', '确认退出', '确认重开', '确定要', '是否确认',
  '鼠标拖动', '拖动旋转', '拖拽旋转', '滚轮缩放', '滚轮调速', '未命名网格', '为流畅预览已限制',
  'how to play', 'instructions', 'game controls', 'controls:',
  'drag to rotate', 'scroll to zoom', 'wheel to zoom',
  'powered by', 'made with', 'game description', 'tutorial:',
  'are you sure', 'rules:',
];

const IGNORE_JSON_FILES = new Set([
  'story.json', 'level.json', 'materials.json', 'model-slots.json',
  'game.config.json', 'engine.config.json', 'game.design.json', 'package.json', 'assets.manifest.json',
]);

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const CARD_CLASS_RE = /(?:\bcard\b|upgrade-card|shop-item|shop-card|perk-card|choice-card)/i;
const RULES_BUTTON_RE = /^(?:规则|规则说明|玩法|玩法说明|玩法介绍|操作说明|帮助|教程|新手教程|说明|help|rules|tutorial|guide|how to play|[?？])$/i;
const DEBUG_CONTAINER_RE = /\b(?:debug|debug-panel|bench-panel|devtools|dev-tools)\b/i;
const TOUCH_CONTAINER_RE = /\b(?:mobile|touch|touch-controls|joystick|arcade-pad|gamepad)\b/i;
const BLOCKING_MODAL_ATTR_RE = /\b(?:tutorial|guide|rules|howto|how-to-play|help|onboarding|confirm)[-_]?(?:modal|dialog|popup|overlay)\b/i;
const BLOCKING_DIALOG_ROLE_RE = /\b(?:tutorial|guide|rules|howto|how-to-play|help|onboarding|confirm)\b/i;
const TITLE_OVERLAY_RE = /\b(?:title|title-screen|start-screen|start-overlay|splash|landing)\b/i;
const GAMEOVER_OVERLAY_RE = /\b(?:gameover|game-over|result|results|summary|victory|defeat|settlement)\b/i;
const PAUSE_OVERLAY_RE = /\b(?:pause|paused|pause-menu|pause-overlay)\b/i;
const CHOICE_OVERLAY_RE = /\b(?:levelup|level-up|upgrade|upgrades|shop|store|event|choice|choices|draft|modal|dialog|panel)\b/i;

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

function getAttr(attrs, name) {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = re.exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
}

function hasBoolAttr(attrs, name) {
  const re = new RegExp(`(?:^|\\s)${name}(?=\\s|$|=)`, 'i');
  return re.test(attrs);
}

function isHiddenByAttrs(attrs) {
  if (hasBoolAttr(attrs, 'hidden')) return true;
  const style = getAttr(attrs, 'style');
  return Boolean(style && /display\s*:\s*none\b/i.test(style));
}

function getIdAndClass(attrs) {
  return `${getAttr(attrs, 'id') ?? ''} ${getAttr(attrs, 'class') ?? ''}`.trim();
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

// Blank JS comments and string/template text while preserving template ${...} expressions and line numbers.
function stripJsCommentsAndStringsPreserveLines(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  const templateStack = [];

  const blankChar = c => (c === '\n' ? '\n' : ' ');

  function scanTemplateText() {
    while (i < n) {
      const c = src[i];
      if (c === '\\' && i + 1 < n) {
        out += blankChar(c) + blankChar(src[i + 1]);
        i += 2;
        continue;
      }
      if (c === '`') {
        out += ' ';
        i++;
        return;
      }
      if (c === '$' && src[i + 1] === '{') {
        out += '  ';
        i += 2;
        templateStack.push({ braceDepth: 1 });
        return;
      }
      out += blankChar(c);
      i++;
    }
  }

  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];

    if (templateStack.length > 0) {
      if (ch === '{') {
        templateStack[templateStack.length - 1].braceDepth++;
        out += ch;
        i++;
        continue;
      }
      if (ch === '}') {
        const top = templateStack[templateStack.length - 1];
        top.braceDepth--;
        if (top.braceDepth === 0) {
          templateStack.pop();
          out += ' ';
          i++;
          scanTemplateText();
          continue;
        }
        out += ch;
        i++;
        continue;
      }
    }

    if (ch === "'" || ch === '"') {
      const q = ch;
      out += ' ';
      i++;
      while (i < n) {
        const c = src[i];
        if (c === '\\' && i + 1 < n) {
          out += blankChar(c) + blankChar(src[i + 1]);
          i += 2;
          continue;
        }
        out += blankChar(c);
        i++;
        if (c === q) break;
      }
      continue;
    }

    if (ch === '`') {
      out += ' ';
      i++;
      scanTemplateText();
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
        out += blankChar(src[i]);
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

function findMatchingParen(code, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < code.length; i++) {
    const ch = code[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
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

  // 1. Explanatory <p> / <footer> / subtitle / tutorial prose tags & blocking modals
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

  const blockingModalOffsets = new Set();
  const openContainerRe = /<([a-z0-9-]+)\b([^>]*)>/gi;
  while ((m = openContainerRe.exec(cleanHtml)) !== null) {
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    const idClass = getIdAndClass(attrs);
    if (!idClass && tag !== 'dialog') continue;

    if (BLOCKING_MODAL_ATTR_RE.test(idClass) || (tag === 'dialog' && BLOCKING_DIALOG_ROLE_RE.test(idClass))) {
      blockingModalOffsets.add(m.index);
      violations.push({
        file,
        line: lineAt(rawSource, baseOffset + m.index),
        rule: 'blocking-modal',
        message: 'Disallowed tutorial/rules/confirm modal container in game UI',
        snippet: clip(m[0]),
      });
    }

    if (['div', 'section', 'aside', 'form', 'nav'].includes(tag) && DEBUG_CONTAINER_RE.test(idClass) && !isHiddenByAttrs(attrs)) {
      violations.push({
        file,
        line: lineAt(rawSource, baseOffset + m.index),
        rule: 'visible-debug-panel',
        message: 'Debug/bench panel must default to hidden (toggle via ` or ?debug=1)',
        snippet: clip(m[0]),
      });
    }
  }

  const subtitleClassRe = /<[a-z0-9-]+\b[^>]*(?:class|id)=["'][^"']*\b(?:subtitle|tagline|instructions|how-to-play|tutorial|guide-text)\b[^"']*["'][^>]*>([\s\S]*?)<\/[a-z0-9-]+>/gi;
  while ((m = subtitleClassRe.exec(cleanHtml)) !== null) {
    if (blockingModalOffsets.has(m.index)) continue;
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

  // 3. Button text length <= 4 hanzi + standalone rules/help button ban
  const btnRe = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
  while ((m = btnRe.exec(cleanHtml)) !== null) {
    const attrs = m[1];
    if (/\bcard\b/i.test(attrs)) continue; // whole-card button checked above
    const rawLabel = stripTagsAndExpr(m[2]).replace(/\s*\([A-Za-z0-9]+\)\s*$/g, '').trim();
    const ariaLabel = (getAttr(attrs, 'aria-label') ?? '').trim();
    if (RULES_BUTTON_RE.test(rawLabel) || (ariaLabel && RULES_BUTTON_RE.test(ariaLabel))) {
      violations.push({
        file,
        line: lineAt(rawSource, baseOffset + m.index),
        rule: 'forbidden-rules-button',
        message: 'Standalone rules/help/tutorial button is forbidden',
        snippet: clip(rawLabel || ariaLabel || m[0]),
      });
    }
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

function classifyOverlayKind(tag, attrs, idClass) {
  if (tag === 'button' || tag === 'a' || tag === 'span') return null;
  if (TITLE_OVERLAY_RE.test(idClass)) return 'title';
  if (GAMEOVER_OVERLAY_RE.test(idClass)) return 'gameover';
  if (PAUSE_OVERLAY_RE.test(idClass)) return 'pause';
  if (CHOICE_OVERLAY_RE.test(idClass) || hasBoolAttr(attrs, 'data-panel')) return 'choice';
  return null;
}

function checkButtonQuotas(cleanHtml, rawSource, file, violations) {
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)(\/?)>/g;
  const stack = [];
  const overlayCounts = new Map();
  let hudButtons = 0;
  let m;

  while ((m = tagRe.exec(cleanHtml)) !== null) {
    const isClose = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = m[3] ?? '';
    const selfClosing = m[4] === '/' || VOID_TAGS.has(tag);

    if (isClose) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const idClass = getIdAndClass(attrs);
    const isHidden = isHiddenByAttrs(attrs);
    const isTouch = TOUCH_CONTAINER_RE.test(idClass) || hasBoolAttr(attrs, 'data-touch');
    const isDebug = DEBUG_CONTAINER_RE.test(idClass) || hasBoolAttr(attrs, 'data-debug');
    const isCardContainer = CARD_CLASS_RE.test(idClass);
    const overlayKind = classifyOverlayKind(tag, attrs, idClass);

    if (tag === 'button') {
      const isCard = isCardContainer;
      const ancestorHidden = stack.some(e => e.isHidden);
      const ancestorIgnored = stack.some(e => e.isTouch || e.isDebug || e.isCardContainer);
      let nearestOverlay = null;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].overlayKind) {
          nearestOverlay = stack[i];
          break;
        }
      }

      if (!isCard && !isHidden && !ancestorIgnored && !isTouch && !isDebug) {
        if (nearestOverlay) {
          const kind = nearestOverlay.overlayKind;
          if (kind === 'title' || kind === 'gameover' || kind === 'pause') {
            const limit = kind === 'title' ? 1 : 2;
            const nextCount = (overlayCounts.get(nearestOverlay.key) ?? 0) + 1;
            overlayCounts.set(nearestOverlay.key, nextCount);
            if (nextCount > limit) {
              violations.push({
                file,
                line: lineAt(rawSource, m.index),
                rule: 'overlay-button-quota',
                message: `${kind} overlay exceeds ${limit} button(s) (got ${nextCount})`,
                snippet: clip(m[0]),
              });
            }
          }
        } else if (!ancestorHidden) {
          hudButtons++;
          if (hudButtons > 1) {
            violations.push({
              file,
              line: lineAt(rawSource, m.index),
              rule: 'hud-button-quota',
              message: `In-game visible HUD exceeds 1 button (got ${hudButtons})`,
              snippet: clip(m[0]),
            });
          }
        }
      }
    }

    if (!selfClosing) {
      stack.push({
        key: m.index,
        tag,
        isHidden,
        isTouch,
        isDebug,
        isCardContainer,
        overlayKind,
      });
    }
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
  const cleanHtml = withoutScripts.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '));
  checkForbiddenPhrases(withoutScripts, content, file, 0, violations);
  checkHtmlMarkup(withoutScripts, content, file, 0, opts, violations);
  checkButtonQuotas(cleanHtml, content, file, violations);

  // Scan visible text segments between tags (outside <head>)
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
  const codeWithoutStrings = stripJsCommentsAndStringsPreserveLines(content);

  // Detect toast helper calls
  const toastCallRe = /\b(?:showToast|createToast|pushToast)\s*\(/g;
  let m;
  while ((m = toastCallRe.exec(codeWithoutStrings)) !== null) {
    violations.push({
      file,
      line: lineAt(content, m.index),
      rule: 'toast-notification',
      message: 'Toast call detected; convey state with createVfxSystem + audio.playSynth',
      snippet: clip(m[0]),
    });
  }

  // Detect blocking native confirm/alert/prompt calls
  const nativeModalRe = /(?:^|[^\w$.])((?:(?:window|globalThis|self)\s*\??\.\s*)?(confirm|alert|prompt))\s*\(/g;
  while ((m = nativeModalRe.exec(codeWithoutStrings)) !== null) {
    const callText = m[1];
    const fnName = m[2];
    const nameOffset = m.index + m[0].indexOf(callText);
    const beforeCall = codeWithoutStrings.slice(Math.max(0, nameOffset - 32), nameOffset);
    if (/\b(?:function(?:\s*\*)?|get|set)\s+$/.test(beforeCall)) continue;
    const openParenIdx = m.index + m[0].length - 1;
    const closeParenIdx = findMatchingParen(codeWithoutStrings, openParenIdx);
    if (closeParenIdx !== -1) {
      const afterParen = codeWithoutStrings.slice(closeParenIdx + 1).match(/^\s*(.)/);
      if (afterParen && afterParen[1] === '{') continue;
    }
    violations.push({
      file,
      line: lineAt(content, nameOffset),
      rule: 'blocking-modal',
      message: `Disallowed blocking ${fnName}() dialog in game UI`,
      snippet: clip(content.slice(nameOffset, nameOffset + 32).trim() || `${fnName}(...)`),
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

function isCompiledPixiHtml(rootDir, htmlContent) {
  const manifestPath = path.join(rootDir, '.hgame-pixi-build.json');
  if (!fs.existsSync(manifestPath)) return false;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const name of Object.keys(manifest?.files ?? {})) {
      if (name.endsWith('.js') && htmlContent.includes(`./assets/${name}`)) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

export function collectFiles(rootDir) {
  const files = [];
  const rootEntries = fs.readdirSync(rootDir, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const hasSourceHtml = rootEntries.some(name => name.toLowerCase() === 'index.source.html');
  for (const name of rootEntries) {
    const lower = name.toLowerCase();
    const ext = path.extname(lower);
    if (ext === '.css') {
      const abs = path.join(rootDir, name);
      files.push({ rel: name, abs, content: fs.readFileSync(abs, 'utf8') });
    } else if (ext === '.html') {
      const abs = path.join(rootDir, name);
      const content = fs.readFileSync(abs, 'utf8');
      if (hasSourceHtml && lower === 'index.html' && isCompiledPixiHtml(rootDir, content)) continue;
      files.push({ rel: name, abs, content });
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
        '<div id="hud"><button id="pause" aria-label="暂停">⏸</button></div>',
        '<div id="debug" hidden></div>',
        '<div id="levelup" hidden>',
        '  <button type="button" class="card"><span>⚔️ 狂暴</span><em class="pos">+25% 攻速</em></button>',
        '</div>',
        '<div id="gameover" hidden><button id="restart">再来一局</button></div>',
        '</body></html>',
      ].join('\n'),
    },
    {
      rel: 'src/main.js',
      content: [
        'const label = "⚔️ 狂暴 +25% 攻速";',
        'const debug = location.search.includes("debug=1");',
        'const safe = { confirm() { return true; } }; safe.confirm();',
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
        '<div id="hud"><button id="pause">⏸</button><button id="rules">规则说明</button></div>',
        '<div id="debug">FPS 60</div>',
        '<div id="tutorial-modal" hidden></div>',
        '<div id="title-screen"><button id="start">立即开始游戏</button><button id="help">帮助</button></div>',
        '<footer>Powered by HGame</footer>',
        '</body></html>',
      ].join('\n'),
    },
    {
      rel: 'src/ui.js',
      content: [
        'const tip = "How to play: collect orbs to level up and survive.";',
        'function notify() { showToast("升级成功"); }',
        'function resetCheck() { return confirm("确定要重开吗"); }',
      ].join('\n'),
    },
  ];

  const clean = lintFiles(cleanFiles, opts);
  const bad = lintFiles(badFiles, opts);
  const rulesFound = new Set(bad.violations.map(v => v.rule));
  const expected = [
    'forbidden-prose-keyword',
    'prose-paragraph-tag',
    'card-nested-button',
    'button-text-too-long',
    'long-ui-prose',
    'toast-notification',
    'blocking-modal',
    'forbidden-rules-button',
    'visible-debug-panel',
    'hud-button-quota',
    'overlay-button-quota',
  ];
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

/**
 * Audit runtime clickable button bounds in a mobile portrait viewport to enforce the
 * Bottom-Right Thumb-Arc Comfort Zone rule (avoid clickable controls in the top half).
 *
 * @param {Array<{ id?: string, selector?: string, y: number, height: number, x?: number, width?: number }>} buttons
 * @param {number} viewportHeight
 * @param {number} [minCenterRatio=0.5]
 */
export function auditPortraitThumbZone(buttons = [], viewportHeight = 844, minCenterRatio = 0.5) {
  const vh = Math.max(1, Number(viewportHeight) || 844);
  const threshold = vh * minCenterRatio;
  const violations = [];
  for (const btn of Array.isArray(buttons) ? buttons : []) {
    if (!btn || !Number.isFinite(btn.y) || !Number.isFinite(btn.height)) continue;
    const centerY = btn.y + btn.height * 0.5;
    if (centerY < threshold) {
      violations.push({
        rule: 'portrait-upper-half-button',
        id: btn.id ?? btn.selector ?? 'button',
        centerY: Number(centerY.toFixed(1)),
        thresholdY: Number(threshold.toFixed(1)),
      });
    }
  }
  return {
    pass: violations.length === 0,
    checked: Array.isArray(buttons) ? buttons.length : 0,
    thresholdY: threshold,
    violations,
  };
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
