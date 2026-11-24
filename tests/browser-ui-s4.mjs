#!/usr/bin/env node
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const modulePath = argv.indexOf('--playwright') >= 0 ? argv[argv.indexOf('--playwright') + 1] : 'playwright-core';
const executablePath = argv.indexOf('--chrome') >= 0 ? argv[argv.indexOf('--chrome') + 1] : undefined;
const require = createRequire(import.meta.url);
const { chromium } = require(modulePath);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const HARNESS_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8" /><link rel="icon" href="data:," /></head>
<body style="margin:0;background:#020617;">
  <div id="host" style="position:relative;width:480px;height:360px;">
    <canvas id="c" width="480" height="360"></canvas>
  </div>
  <script type="module">
    import {
      createCanvasUiRenderer,
      defineInputContext,
      createInputActionRouter,
    } from '/assets/runtime/index.js';
    import { bindUiUxDOM } from '/assets/runtime/integrations/ui-ux-dom.js';

    window.__runUiS4Bench = () => {
      const host = document.getElementById('host');
      const canvas = document.getElementById('c');
      const ctx = canvas.getContext('2d');
      const ui = createCanvasUiRenderer({ dpr: 1 });
      let lastClicked = null;
      const inputNode = { id: 'chatInput', type: 'textInput', height: 32, value: 'Hi', placeholder: 'MSG' };
      const tree = {
        id: 'panel',
        type: 'panel',
        bg: '#0f172a',
        padding: 12,
        gap: 8,
        children: [
          {
            id: 'lore',
            type: 'richText',
            height: 54,
            spans: [
              { text: '火焰伤害 ', color: '#f8fafc', weight: '700' },
              { text: '+250%', color: '#f97316', underline: true },
              ' across all enemies nearby',
            ],
          },
          {
            id: 'bagScroll',
            type: 'scrollView',
            height: 92,
            gap: 6,
            children: [
              { id: 'slot1', type: 'button', height: 48, text: '剑', onClick: () => { lastClicked = 'slot1'; } },
              { id: 'slot2', type: 'button', height: 48, text: '盾', onClick: () => { lastClicked = 'slot2'; } },
              { id: 'slot3', type: 'button', height: 48, text: '药水', onClick: () => { lastClicked = 'slot3'; } },
            ],
          },
          inputNode,
          { id: 'sfxSlider', type: 'slider', height: 22, value: 0.75 },
        ],
      };

      // Focus input & enter composing IME text before render
      ui.render(ctx, tree, 480, 360);
      ui.pointerDown(120, 190);
      ui.compositionUpdate('zh');
      ctx.clearRect(0, 0, 480, 360);
      ui.render(ctx, tree, 480, 360);
      ui.compositionEnd('中');

      // Count rendered non-background pixels inside richText box (top band y=12..66)
      const img = ctx.getImageData(12, 12, 440, 54).data;
      let nonBgPixels = 0;
      for (let i = 0; i < img.length; i += 4) {
        if (img[i] > 30 || img[i + 1] > 30 || img[i + 2] > 55) nonBgPixels++;
      }

      // Scroll scrollView downward and click newly exposed slot3
      const svScroll = ui.scroll(80, 120, 110);
      ctx.clearRect(0, 0, 480, 360);
      ui.render(ctx, tree, 480, 360);
      ui.pointerDown(120, 125);
      ui.pointerUp(120, 125);

      const ariaCount = ui.syncAriaTree(host);
      const roles = Array.from(host.querySelectorAll('[role]')).map(el => el.getAttribute('role'));
      const originalInput = host.querySelector('[data-node-id="chatInput"]');
      originalInput.focus();
      const inputValue = inputNode.value;
      inputNode.value += '!';
      ui.render(ctx, tree, 480, 360);
      ui.syncAriaTree(host);
      const syncedInput = host.querySelector('[data-node-id="chatInput"]');
      const focusStable = syncedInput === originalInput && document.activeElement === syncedInput;
      const ariaValueUpdated = syncedInput.getAttribute('aria-valuetext') === inputNode.value;
      ui.pointerDown(120, 125);
      const pointerSelection = ui.getState().focusedId;
      host.querySelector('[data-node-id="slot3"]').focus();
      const external = document.createElement('button');
      document.body.appendChild(external);
      external.focus();
      ui.syncAriaTree(host);
      const focusLeft = document.activeElement === external && ui.getState().focusedId === null;
      external.remove();
      syncedInput.focus();
      let focusTransitions = 0;
      syncedInput.addEventListener('blur', () => { focusTransitions++; });
      syncedInput.addEventListener('focus', () => { focusTransitions++; });
      const reordered = { ...tree, children: [inputNode, ...tree.children.filter(node => node !== inputNode)] };
      ui.render(ctx, reordered, 480, 360);
      ui.syncAriaTree(host);
      const focusReordered = document.activeElement === syncedInput && ui.getState().focusedId === 'chatInput';
      const reorderFocusTransitions = focusTransitions;
      ui.render(ctx, { ...reordered, children: reordered.children.slice(1) }, 480, 360);
      ui.syncAriaTree(host);
      const removedFocusCleared = !syncedInput.isConnected && ui.getState().focusedId === null;

      // Verify localStorage keybinding persistence across routers
      const down = new Set();
      const input = { isDown: code => down.has(code), pointer: { buttons: 0 } };
      const ctxDef = defineInputContext('combat', { priority: 5, actions: { atk: 'KeyJ' } });
      const r1 = createInputActionRouter({ input });
      r1.pushContext(ctxDef);
      r1.rebindAction('combat', 'atk', 'KeyK');
      const savedOk = r1.saveBindings(window.localStorage, 'hgame.test.s4.bindings');

      const r2 = createInputActionRouter({ input });
      r2.pushContext(ctxDef);
      const loaded = r2.loadBindings(window.localStorage, 'hgame.test.s4.bindings');
      down.add('KeyK');
      r2.update(1 / 60);
      const reboundTriggered = r2.isDown('atk');

      ui.dispose();
      window.localStorage.removeItem('hgame.test.s4.bindings');

      return {
        nonBgPixels,
        svScroll,
        lastClicked,
        inputValue,
        ariaCount,
        roles,
        focusStable,
        ariaValueUpdated,
        pointerSelection,
        focusLeft,
        focusReordered,
        reorderFocusTransitions,
        removedFocusCleared,
        savedOk,
        loaded,
        reboundTriggered,
      };
    };

    window.__prepareNativeFocus = (forwardNativeEvent = true) => {
      const host = document.getElementById('host');
      const canvas = document.getElementById('c');
      const ui = createCanvasUiRenderer({ dpr: 1 });
      const inputNode = { id: 'text-entry', type: 'textInput', width: 150, height: 32, value: '' };
      let clicks = 0;
      ui.render(canvas.getContext('2d'), {
        id: 'native-panel', type: 'panel', direction: 'column', children: [
          { id: 'action', type: 'button', width: 150, height: 32, text: 'Run', onClick: () => { clicks++; } },
          { id: 'description', type: 'label', width: 150, height: 32, text: 'Info' },
          inputNode,
        ],
      }, 480, 360);
      ui.syncAriaTree(host);
      canvas.addEventListener('pointerdown', ev => ui.pointerDown(ev.offsetX, ev.offsetY, forwardNativeEvent ? ev : undefined));
      canvas.addEventListener('pointerup', ev => ui.pointerUp(ev.offsetX, ev.offsetY));
      document.addEventListener('keydown', ev => ui.keyDown(ev.key));
      const decorated = document.createElement('div');
      decorated.dataset.uiTilt = '';
      decorated.tabIndex = 0;
      decorated.style.cssText = 'position:absolute; top:120px; left:8px';
      const field = document.createElement('input');
      field.id = 'game-settings';
      decorated.appendChild(field);
      host.appendChild(decorated);
      bindUiUxDOM({ root: host });
      window.__nativeFocus = () => ({
        native: document.activeElement.dataset.nodeId ?? null,
        fieldFocused: document.activeElement === field,
        canvas: ui.getState().focusedId,
        clicks,
        text: inputNode.value,
      });
    };
  </script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url, 'http://127.0.0.1');
    if (reqUrl.pathname === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (reqUrl.pathname === '/uis4.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(HARNESS_HTML);
      return;
    }
    const rel = decodeURIComponent(reqUrl.pathname.replace(/^\/+/, ''));
    const filePath = path.resolve(root, rel);
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const buf = await readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'content-type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();

let browser;
try {
  const launchOpts = {
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox'],
  };
  try {
    browser = await chromium.launch({ ...launchOpts, ...(!executablePath ? { channel: 'msedge' } : {}) });
  } catch {
    browser = await chromium.launch(launchOpts);
  }
  const page = await browser.newPage({ viewport: { width: 480, height: 360 } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(err?.message || String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('response', (res) => {
    if (res.status() >= 400) errors.push(`${res.status()} ${res.url()}`);
  });

  await page.goto(`http://127.0.0.1:${port}/uis4.html`, { waitUntil: 'networkidle' });
  assert.deepEqual(errors, [], 'Page load errors: ' + errors.join(' | '));

  const m = await page.evaluate(() => window.__runUiS4Bench());
  assert.deepEqual(errors, [], 'UI S4 runtime errors: ' + errors.join(' | '));
  assert.ok(m.nonBgPixels > 100, `richText must render pixels, got ${m.nonBgPixels}`);
  assert.ok(m.svScroll > 30, `scrollView must scroll, got ${m.svScroll}`);
  assert.equal(m.lastClicked, 'slot3');
  assert.equal(m.inputValue, 'Hi中');
  assert.ok(m.ariaCount >= 6);
  assert.ok(m.roles.includes('button'));
  assert.ok(m.roles.includes('textbox'));
  assert.ok(m.roles.includes('slider'));
  assert.equal(m.focusStable, true, 'the focused mirror persists through sync');
  assert.equal(m.ariaValueUpdated, true);
  assert.equal(m.pointerSelection, 'slot3', 'the two-coordinate pointer call keeps the Canvas selection');
  assert.equal(m.focusLeft, true, 'sync does not take focus from another control');
  assert.equal(m.focusReordered, true, 'reordering preserves native focus');
  assert.equal(m.reorderFocusTransitions, 0, 'reordering does not emit a blur or focus event');
  assert.equal(m.removedFocusCleared, true, 'removing the focused widget clears the Canvas selection');
  assert.equal(m.savedOk, true);
  assert.equal(m.loaded, 1);
  assert.equal(m.reboundTriggered, true);

  await page.evaluate(() => window.__prepareNativeFocus());
  await page.locator('#game-settings').focus();
  assert.equal(await page.evaluate(() => window.__nativeFocus().fieldFocused), true, 'the input keeps its own focus');
  await page.mouse.click(32, 16);
  assert.deepEqual(await page.evaluate(() => window.__nativeFocus()), {
    native: 'action', fieldFocused: false, canvas: 'action', clicks: 1, text: '',
  }, 'a real Canvas click keeps native focus and activates once');
  await page.mouse.click(32, 48);
  assert.deepEqual(await page.evaluate(() => window.__nativeFocus()), {
    native: null, fieldFocused: false, canvas: null, clicks: 1, text: '',
  }, 'a passive Canvas node clears both kinds of focus');
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(() => window.__prepareNativeFocus(false));
  await page.mouse.click(32, 80);
  await page.keyboard.press('q');
  assert.deepEqual(await page.evaluate(() => window.__nativeFocus()), {
    native: null, fieldFocused: false, canvas: 'text-entry', clicks: 0, text: 'q',
  }, 'an existing two-argument Canvas listener can still accept text after a click');
  assert.deepEqual(errors, [], 'Native focus runtime errors');

  console.log(JSON.stringify({ status: 'PASS', metrics: m }, null, 2));
} finally {
  await browser?.close();
  server.close();
}
