import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectFiles, lintFiles } from '../.agents/skills/hgame-ui-ux/scripts/check-ui.mjs';
import { computeUnionArea, evaluateUiAudit } from '../scripts/lib/snapshot-ui-audit.mjs';
import { createI18n, createPanelStack, createVirtualList } from '../assets/runtime/ui/index.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const checkUiScript = path.join(root, '.agents', 'skills', 'hgame-ui-ux', 'scripts', 'check-ui.mjs');
const createGameScript = path.join(root, 'scripts', 'create-game.mjs');

test('lintFiles passes clean minimalist UI fixtures without false positives', () => {
  const report = lintFiles([
    {
      rel: 'index.html',
      content: [
        '<!doctype html><html><body>',
        '<canvas id="game"></canvas>',
        '<div id="hud">',
        '  <div class="bars"><div id="hp"><i></i></div></div>',
        '  <span id="score">×12</span>',
        '  <button id="pause" type="button" aria-label="暂停">⏸</button>',
        '</div>',
        '<div id="mobile"><button id="dash">冲</button><button id="skill">震</button></div>',
        '<div id="debug" hidden><button id="bench">压测</button><button id="spawn">刷怪</button></div>',
        '<div id="title" hidden><button id="play" type="button">开始</button></div>',
        '<div id="levelup" hidden>',
        '  <button type="button" class="card"><span>⚔️ 狂暴</span><em class="pos">+25% 攻速</em></button>',
        '  <button type="button" class="card"><span>🛡 铁壁</span><em class="pos">+10 护甲</em></button>',
        '</div>',
        '<div id="gameover" hidden>',
        '  <button id="restart" type="button">再来一局</button>',
        '  <button id="home" type="button" aria-label="主页">⌂</button>',
        '</div>',
        '</body></html>',
      ].join('\n'),
    },
    {
      rel: 'src/main.js',
      content: [
        'const statusText = "HP 3";',
        'const fake = "confirm(1) alert(2) prompt(3)";',
        'const tpl = `HP ${99} ×${12}`;',
        'const service = { confirm(id) { return Boolean(id); }, async alert() {} };',
        'class ActionHandler { confirm() { return true; } }',
        'function confirm() { return false; }',
        'service.confirm(1);',
        'service?.confirm(2);',
        'new ActionHandler().confirm();',
        'const ok = confirm; // reference without invocation',
      ].join('\n'),
    },
  ]);

  assert.equal(report.pass, true, JSON.stringify(report.violations));
  assert.equal(report.violationCount, 0);
});

test('lintFiles catches every Anti-Bloat violation rule accurately', () => {
  const report = lintFiles([
    {
      rel: 'index.html',
      content: [
        '<!doctype html><html><body>',
        '<p class="subtitle">操作说明：按 WASD 移动即可。</p>',
        '<div class="card"><strong>剑气</strong><button type="button">选择</button></div>',
        '<div id="hud">',
        '  <button id="pause" type="button">暂停</button>',
        '  <button id="rules" type="button">规则说明</button>',
        '</div>',
        '<div id="debug">FPS 60</div>',
        '<div id="tutorial-modal" hidden></div>',
        '<div id="title-screen"><button id="start">立即开始游戏</button><button id="help">?</button></div>',
        '<div id="gameover" hidden><button>再来一局</button><button>分享</button><button>返回</button></div>',
        '<footer>Powered by HGame</footer>',
        '</body></html>',
      ].join('\n'),
    },
    {
      rel: 'src/ui.js',
      content: [
        'const tip = "How to play: collect orbs to level up and survive.";',
        'function notify() { showToast("升级成功"); }',
        'function ask() { return window.confirm("确定要退出吗"); }',
        'function ask2() { return prompt("Name"); }',
        'const tpl = `${alert("boom")}`;',
      ].join('\n'),
    },
  ]);

  const rules = new Set(report.violations.map(v => v.rule));
  for (const expectedRule of [
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
  ]) {
    assert.ok(rules.has(expectedRule), `Expected rule "${expectedRule}" in ${JSON.stringify([...rules])}`);
  }

  const modalViolations = report.violations.filter(v => v.rule === 'blocking-modal');
  assert.ok(modalViolations.some(v => v.file === 'index.html' && v.line === 9));
  assert.ok(modalViolations.some(v => v.file === 'src/ui.js' && v.line === 3));
  assert.ok(modalViolations.some(v => v.file === 'src/ui.js' && v.line === 4));
  assert.ok(modalViolations.some(v => v.file === 'src/ui.js' && v.line === 5));
});

test('collectFiles discovers index.source.html and custom root CSS, skipping only manifest-verified compiled index.html', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-collect-ui-'));
  try {
    await mkdir(path.join(tmp, 'src'), { recursive: true });
    await writeFile(
      path.join(tmp, '.hgame-pixi-build.json'),
      JSON.stringify({ schemaVersion: 1, files: { 'index-abc123.js': 'deadbeef' } }),
    );
    await writeFile(
      path.join(tmp, 'index.html'),
      '<div id="debug">compiled</div><script type="module" src="./assets/index-abc123.js"></script>',
    );
    await writeFile(path.join(tmp, 'index.source.html'), '<canvas id="game"></canvas>');
    await writeFile(path.join(tmp, 'vault.css'), '.toast { color: red; }');
    await writeFile(path.join(tmp, 'src', 'main.js'), 'export const ok = 1;');

    const files = collectFiles(tmp);
    const rels = files.map(f => f.rel);
    assert.ok(rels.includes('index.source.html'));
    assert.ok(rels.includes('vault.css'));
    assert.ok(rels.includes('src/main.js'));
    assert.equal(rels.includes('index.html'), false);

    const lint = lintFiles(files);
    assert.equal(lint.pass, false);
    assert.equal(lint.violations[0].file, 'vault.css');
    assert.equal(lint.violations[0].rule, 'toast-notification');

    // Hand-edited index.html no longer matching .hgame-pixi-build.json is still linted.
    await writeFile(path.join(tmp, 'index.html'), '<p>操作说明：手动修改的页面。</p>');
    const editedFiles = collectFiles(tmp);
    assert.ok(editedFiles.map(f => f.rel).includes('index.html'));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('all reference examples and generated starters pass check-ui.mjs', async () => {
  for (const ex of ['survivor-2d', 'arena-3d', 'signal-vault']) {
    const res = spawnSync(process.execPath, [checkUiScript, '--dir', path.join(root, 'examples', ex)], { encoding: 'utf8' });
    assert.equal(res.status, 0, `${ex}: ${res.stdout}\n${res.stderr}`);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.pass, true);
    if (ex === 'signal-vault') {
      assert.ok(parsed.scannedFiles.includes('index.source.html'));
      assert.ok(parsed.scannedFiles.includes('vault.css'));
    }
  }

  const tmp = await mkdtemp(path.join(os.tmpdir(), 'hgame-starters-ui-'));
  try {
    const cases = [
      ['p-pixi2d', ['--profile', '2d']],
      ['p-canvas2d', ['--profile', '2d', '--renderer', 'canvas2d']],
      ['p-horde', ['--preset', 'horde']],
      ['p-3d', ['--profile', '3d']],
      ['p-ui', ['--profile', 'ui']],
    ];
    for (const [slug, flags] of cases) {
      const dir = path.join(tmp, slug);
      const gen = spawnSync(process.execPath, [createGameScript, dir, ...flags, '--no-git'], { encoding: 'utf8' });
      assert.equal(gen.status, 0, `${slug}: ${gen.stderr}`);
      const lint = spawnSync(process.execPath, [checkUiScript, '--dir', dir], { encoding: 'utf8' });
      assert.equal(lint.status, 0, `${slug}: ${lint.stdout}\n${lint.stderr}`);
      assert.equal(JSON.parse(lint.stdout).pass, true);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('computeUnionArea computes exact 2D sweep-line union for disjoint, overlapping, nested, and invalid rects', () => {
  assert.equal(computeUnionArea([]), 0);
  assert.equal(computeUnionArea([{ left: 10, top: 10, right: 10, bottom: 20 }, null]), 0);
  assert.equal(
    computeUnionArea([
      { left: 0, top: 0, right: 10, bottom: 10 },
      { left: 20, top: 0, right: 30, bottom: 10 },
    ]),
    200,
  );
  // Two 10x10 squares overlapping by 5x5 -> 100 + 100 - 25 = 175
  assert.equal(
    computeUnionArea([
      { left: 0, top: 0, right: 10, bottom: 10 },
      { left: 5, top: 5, right: 15, bottom: 15 },
    ]),
    175,
  );
  // Nested rect inside outer rect -> outer area only
  assert.equal(
    computeUnionArea([
      { left: 0, top: 0, right: 20, bottom: 10 },
      { left: 2, top: 2, right: 8, bottom: 8 },
    ]),
    200,
  );
});

test('evaluateUiAudit enforces HUD area, button quota, modal bypass, and debug gating', () => {
  assert.deepEqual(
    evaluateUiAudit({ hudAreaRatio: 0.04, visibleButtons: 1, debugVisible: false, modalActive: false }),
    [],
  );

  const failed = evaluateUiAudit({ hudAreaRatio: 0.14, visibleButtons: 2, debugVisible: true, modalActive: false });
  assert.equal(failed.length, 3);

  assert.deepEqual(
    evaluateUiAudit({ hudAreaRatio: 0.85, visibleButtons: 3, debugVisible: false, modalActive: true }),
    [],
  );

  assert.deepEqual(
    evaluateUiAudit({ hudAreaRatio: 0.04, visibleButtons: 0, debugVisible: true, modalActive: false }, { allowDebug: true }),
    [],
  );
});

test('documented 15-ui-kit snippet APIs execute cleanly', () => {
  const stack = createPanelStack({
    panels: {
      shop: { modal: true, exclusive: true, closeOnCancel: true, closeOnBackdrop: true },
    },
  });
  stack.push('shop');
  assert.equal(stack.hasModal(), true);
  assert.equal(stack.handleCancel(), true);
  assert.equal(stack.hasModal(), false);

  const list = createVirtualList({ itemHeight: 64, viewportHeight: 480, columns: 4 });
  list.setCount(10000);
  list.scrollTo(128);
  const win = list.getVisibleRange();
  assert.ok(win.endIndex > win.startIndex);
  assert.ok(win.totalHeight > 0);

  const i18n = createI18n({ locale: 'zh', fallbackLocale: 'en', messages: { zh: { hp: '♥ {v}' }, en: { hp: 'HP {v}' } } });
  assert.equal(i18n.t('hp', { v: 120 }), '♥ 120');
});
