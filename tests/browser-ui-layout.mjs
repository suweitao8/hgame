#!/usr/bin/env node
// Real-browser check for the UI layout additions: wrapped rows, grids, auto-fit button text and
// wrapped labels are rendered with real font metrics at 960x540 and 360x800, and every drawn text
// is checked against the box it was drawn into. Screenshots go to build/ui-layout/.
//
//   node tests/browser-ui-layout.mjs [--chrome <path>]
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium, resolvePlaywright } from '../scripts/lib/playwright-resolve.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const outputDir = path.join(root, 'build', 'ui-layout');

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
  <div id="host" style="position:relative;">
    <canvas id="c"></canvas>
  </div>
  <script type="module">
    import { createCanvasUiRenderer } from '/assets/runtime/index.js';

    const CHIP_TEXT = [
      '火焰伤害 +12%', '冰霜', '暴击率提升百分之十五', '生命恢复', '护盾穿透',
      '超长的芯片标签根本放不下', '攻速', '范围扩大', '吸血', '减速抵抗 +8', '闪避', '连击',
    ];
    const chip = (text, index) => ({
      id: 'chip' + index, type: 'button', width: [96, 72, 132][index % 3], height: 36, fontSize: 13, radius: 18, text,
    });

    window.__runUiLayout = async ({ name, width, height }) => {
      const host = document.getElementById('host');
      const canvas = document.getElementById('c');
      host.style.width = width + 'px';
      host.style.height = height + 'px';
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      const ctx = canvas.getContext('2d');
      const drawn = [];
      const realFillText = ctx.fillText.bind(ctx);
      ctx.fillText = (text, x, y) => {
        drawn.push({ text, x, y, font: ctx.font, align: ctx.textAlign });
        realFillText(text, x, y);
      };

      const ui = createCanvasUiRenderer({ dpr: 1 });
      const clicks = [];
      const chips = CHIP_TEXT.map(chip).map(node => ({ ...node, onClick: () => clicks.push(node.id) }));
      const cell = (index) => ({
        id: 'cell' + index, type: 'button', text: (index + 1) + ' 号装备的名称特别长',
        bg: '#0f766e', radius: 10, fontSize: 14, onClick: () => clicks.push('cell' + index),
      });
      const grid = { id: 'grid', display: 'grid', columns: width > 600 ? 4 : 3, gap: 8, height: 232, padding: 8, children: Array.from({ length: 12 }, (_, i) => cell(i)) };
      const description = {
        id: 'description', type: 'label', wrap: true, height: 76, fontSize: 13, lineHeight: 1.4, text: 'Ignite every enemy in the arena and recover 生命值 for each burn tick. 每次灼烧都有几率触发暴击。',
      };
      const limited = {
        id: 'limited', type: 'label', wrap: true, maxLines: 2, height: 40, fontSize: 13,
        text: '这条说明只显示两行，其余内容用省略号结尾，超出部分不再绘制。装备之后角色会立即获得对应的属性加成，并且在战斗中持续生效直到本局结束为止。',
      };
      const panel = (id, extra, children) => ({ id, type: 'panel', bg: 'rgba(15, 23, 42, 0.88)', radius: 12, padding: 12, gap: 10, direction: 'column', ...extra, children });
      const chipRowBase = { id: 'chips', direction: 'row', flexWrap: 'wrap', gap: 8, alignContent: 'start', children: chips };
      // The row has no intrinsic height, so it is laid out once to learn how tall its chips are.
      const chipRowWidth = width > 600 ? 520 - 24 : width - 32;
      const measured = ui.layout({ ...chipRowBase, height: 1e6 }, chipRowWidth, 1e6);
      const chipRow = { ...chipRowBase, height: Math.max(...measured.children.map(child => child.y + child.height)) - measured.y };
      const tree = width > 600
        ? {
            id: 'root', direction: 'row', gap: 12, padding: 12,
            children: [
              panel('left', { width: 520 }, [
                { id: 'title', type: 'label', height: 28, fontSize: 20, text: '武器库', color: '#f8fafc' },
                chipRow,
                description,
                { id: 'confirm', type: 'button', height: 48, fontSize: 16, text: '确认装备并立即进入下一场战斗', onClick: () => clicks.push('confirm') },
              ]),
              panel('right', { flexGrow: 1 }, [grid]),
            ],
          }
        : {
            id: 'root', direction: 'column', gap: 12, padding: 16,
            children: [
              { id: 'title', type: 'label', height: 28, fontSize: 20, text: '武器库', color: '#f8fafc' },
              chipRow,
              description,
              limited,
              grid,
              { id: 'confirm', type: 'button', height: 48, fontSize: 16, text: '确认装备并立即进入下一场战斗', onClick: () => clicks.push('confirm') },
            ],
          };

      ctx.clearRect(0, 0, width, height);
      drawn.length = 0;
      const layout = ui.render(ctx, tree, width, height);

      const nodes = new Map();
      const collect = (rect, src, parent) => {
        nodes.set(src.id ?? rect.id, { rect, src, parent });
        (rect.children ?? []).forEach((child, i) => collect(child, src.children[i], rect));
      };
      collect(layout, tree, null);

      const problems = [];
      const TOLERANCE = 0.5;
      const inside = (inner, outer) => inner.x >= outer.x - TOLERANCE && inner.y >= outer.y - TOLERANCE
        && inner.x + inner.width <= outer.x + outer.width + TOLERANCE
        && inner.y + inner.height <= outer.y + outer.height + TOLERANCE;
      const overlap = (a, b) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > TOLERANCE
        && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > TOLERANCE;

      // Boxes: every child stays inside its parent and siblings do not overlap.
      const visit = (rect, src) => {
        (rect.children ?? []).forEach((child, i) => {
          if (!inside(child, rect)) problems.push('overflow: ' + (src.children[i].id ?? i) + ' leaves ' + (src.id ?? 'root'));
          for (let j = i + 1; j < rect.children.length; j++) {
            if (overlap(child, rect.children[j])) problems.push('overlap: ' + (src.children[i].id ?? i) + ' / ' + (src.children[j].id ?? j));
          }
          visit(child, src.children[i]);
        });
      };
      visit(layout, tree);

      // Text: each draw is matched to the leaf it was drawn into and must fit that leaf.
      const leaves = [...nodes.values()].filter(entry => entry.src.type === 'button' || entry.src.type === 'label');
      const fontSizes = [];
      const linesPerLabel = {};
      for (const draw of drawn) {
        const leaf = leaves.find(entry => draw.x >= entry.rect.x - 1 && draw.x <= entry.rect.x + entry.rect.width + 1
          && draw.y >= entry.rect.y - 1 && draw.y <= entry.rect.y + entry.rect.height + 1);
        if (!leaf) { problems.push('text outside any box: ' + draw.text); continue; }
        const isButton = leaf.src.type === 'button';
        const inset = isButton ? 8 : (leaf.src.wrap === true ? 2 : 0);
        ctx.font = draw.font;
        ctx.textAlign = draw.align;
        ctx.textBaseline = 'middle';
        const metrics = ctx.measureText(draw.text);
        const left = draw.align === 'center' ? draw.x - metrics.width / 2 : (draw.align === 'right' ? draw.x - metrics.width : draw.x);
        const top = draw.y - metrics.actualBoundingBoxAscent;
        const bottom = draw.y + metrics.actualBoundingBoxDescent;
        const box = leaf.rect;
        if (left < box.x + inset - TOLERANCE || left + metrics.width > box.x + box.width - inset + TOLERANCE) {
          problems.push('text wider than its box: ' + leaf.src.id + ' "' + draw.text + '"');
        }
        if (top < box.y - TOLERANCE || bottom > box.y + box.height + TOLERANCE) {
          problems.push('text taller than its box: ' + leaf.src.id + ' "' + draw.text + '"');
        }
        if (isButton) fontSizes.push(Number((draw.font.match(/([0-9.]+)px/) ?? [0, 0])[1]));
        linesPerLabel[leaf.src.id] = (linesPerLabel[leaf.src.id] ?? 0) + 1;
      }

      // Clicks: a chip on the second row and a cell in the last row of the grid.
      const secondRowChip = chips.find(node => nodes.get(node.id).rect.y > nodes.get('chip0').rect.y + 10);
      const lastRowCell = grid.children[12 - grid.columns];
      const center = (id) => {
        const rect = nodes.get(id).rect;
        return [rect.x + rect.width / 2, rect.y + rect.height / 2];
      };
      for (const id of [secondRowChip.id, lastRowCell.id, 'confirm']) {
        const [px, py] = center(id);
        ui.pointerDown(px, py);
        ui.pointerUp(px, py);
      }
      // A wrapped chip is drawn once more so that the screenshot shows the click feedback.
      drawn.length = 0;
      ctx.clearRect(0, 0, width, height);
      ui.render(ctx, tree, width, height);
      ui.dispose();

      return {
        name,
        width,
        height,
        problems,
        clicks,
        expectedClicks: [secondRowChip.id, lastRowCell.id, 'confirm'],
        chipRows: new Set(chips.map(node => Math.round(nodes.get(node.id).rect.y))).size,
        gridColumns: grid.columns,
        buttonFontSizes: [...new Set(fontSizes)].sort((a, b) => a - b),
        linesPerLabel,
        buttonTexts: [...new Set(drawn.map(draw => draw.text).filter(text => text.includes('号装备') || text.startsWith('确认') || text.startsWith('超长') || text.startsWith('暴击')))],
      };
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
    if (reqUrl.pathname === '/ui-layout.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(HARNESS_HTML);
      return;
    }
    const filePath = path.resolve(root, decodeURIComponent(reqUrl.pathname.replace(/^\/+/, '')));
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const buf = await readFile(filePath);
    res.writeHead(200, { 'content-type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
});

const VIEWPORTS = [
  { name: 'landscape-960x540', width: 960, height: 540 },
  { name: 'portrait-360x800', width: 360, height: 800 },
];

async function main() {
  await mkdir(outputDir, { recursive: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const { chromium } = resolvePlaywright(import.meta.url, { cwd: root });
  const browser = await launchChromium(chromium, { executablePath: arg('--chrome', ''), args: ['--no-sandbox'] });
  const results = [];
  try {
    for (const viewport of VIEWPORTS) {
      const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error?.message || String(error)));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('response', (response) => {
        if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
      });
      await page.goto(`http://127.0.0.1:${port}/ui-layout.html`, { waitUntil: 'networkidle' });
      assert.deepEqual(errors, [], `${viewport.name} page load errors: ${errors.join(' | ')}`);
      const result = await page.evaluate((spec) => window.__runUiLayout(spec), viewport);
      assert.deepEqual(errors, [], `${viewport.name} runtime errors: ${errors.join(' | ')}`);
      await page.screenshot({ path: path.join(outputDir, `${viewport.name}.png`) });
      results.push(result);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(JSON.stringify({ screenshots: outputDir, results }, null, 2));
  for (const result of results) {
    assert.deepEqual(result.problems, [], `${result.name}: ${result.problems.slice(0, 8).join('; ')}`);
    assert.deepEqual(result.clicks, result.expectedClicks, `${result.name}: wrapped and grid children are clickable`);
    assert.ok(result.chipRows >= 2, `${result.name}: the chips wrap onto several rows`);
    assert.ok(result.buttonFontSizes.length >= 2, `${result.name}: button text scales to more than one size`);
    assert.ok(result.buttonTexts.some((text) => text.endsWith('…')), `${result.name}: a long label ends with an ellipsis`);
  }
  // The narrow screen fits fewer chips per row than the wide one.
  const [landscape, portrait] = results;
  assert.ok(portrait.chipRows > landscape.chipRows, `portrait wraps into more rows (${portrait.chipRows}) than landscape (${landscape.chipRows})`);
  assert.deepEqual([landscape.gridColumns, portrait.gridColumns], [4, 3]);
  console.log('browser-ui-layout: OK');
}

main().catch((error) => {
  console.error('browser-ui-layout FAILED:', error.message);
  process.exitCode = 1;
});
