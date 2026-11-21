import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const BUILT_DIR = path.join(ROOT, 'built');
const AUDIT_PATH = path.join(BUILT_DIR, 'audit_report.json');
const MAT_TABLE_PATH = path.join(BUILT_DIR, 'materials', 'material_table.json');
const DECALS_TABLE_PATH = path.join(BUILT_DIR, 'decals', 'decals_table.json');
const FOLIAGE_TABLE_PATH = path.join(BUILT_DIR, 'foliage', 'foliage_table.json');
const CATALOG_PATH = path.join(BUILT_DIR, 'catalog.json');
const BROWSER_HTML_PATH = path.join(BUILT_DIR, 'browser.html');

function generateBrowserHtml(catalog) {
  const matSlots = (catalog.materials || []).map((m) => m.slot);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>hgame-assets-cn v5.0 资产母库检视器</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, "Microsoft YaHei", sans-serif; background: #101612; color: #e2eae2; display: grid; grid-template-columns: 340px 1fr; height: 100vh; }
    aside { border-right: 1px solid #243227; display: flex; flex-direction: column; overflow: hidden; background: #141c16; }
    header { padding: 12px 14px; border-bottom: 1px solid #243227; }
    header h1 { margin: 0 0 8px; font-size: 14px; font-weight: 700; color: #9cd49e; }
    input, select { width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid #2d3d30; background: #0d120f; color: #e2eae2; margin-bottom: 6px; font-size: 12px; }
    #list { flex: 1; overflow-y: auto; padding: 6px; }
    .item { width: 100%; text-align: left; background: transparent; border: 1px solid transparent; color: inherit; padding: 8px 10px; border-radius: 6px; cursor: pointer; display: block; margin-bottom: 4px; }
    .item:hover { background: #1b271e; }
    .item.active { background: #223526; border-color: #4f8f54; }
    .item small { display: block; color: #8da290; font-size: 11px; margin-top: 2px; }
    main { display: flex; flex-direction: column; position: relative; }
    #toolbar { display: flex; gap: 10px; align-items: center; padding: 10px 14px; border-bottom: 1px solid #243227; background: #141c16; font-size: 12px; flex-wrap: wrap; }
    #toolbar select { width: auto; margin: 0; }
    #info { margin-left: auto; color: #9cb39e; }
    #stage { flex: 1; display: grid; place-items: center; padding: 20px; overflow: auto; }
    pre { background: #0c110e; border: 1px solid #243227; border-radius: 8px; padding: 14px; max-width: 820px; width: 100%; overflow: auto; font-size: 12px; line-height: 1.5; }
  </style>
</head>
<body>
  <aside>
    <header>
      <h1>hgame-assets-cn v5.0 (${catalog.models.length} 模型 · ${matSlots.length} PBR)</h1>
      <input id="q" type="search" placeholder="搜索模型 ID / 标签 / 象限..." />
      <select id="tier"><option value="all">全部等级</option><option>T0</option><option>T0_BACKDROP</option><option>T1</option><option>T2</option><option>T3</option><option>T4</option></select>
    </header>
    <div id="list"></div>
  </aside>
  <main>
    <div id="toolbar">
      <span>材质槽位：</span>
      <select id="slotOverride">${matSlots.map((s) => `<option value="${s}">${s}</option>`).join('')}</select>
      <span>LOD 级别：</span>
      <select id="lodSelect"><option value="0">LOD0</option><option value="1">LOD1</option><option value="2">LOD2</option></select>
      <span id="info"></span>
    </div>
    <div id="stage"><pre id="metaView">请选择左侧模型查看单 GLB 多级 LOD 元数据。</pre></div>
  </main>
  <script>
    const MODELS = ${JSON.stringify(catalog.models)};
    const listEl = document.getElementById('list');
    const qEl = document.getElementById('q');
    const tierEl = document.getElementById('tier');
    const lodEl = document.getElementById('lodSelect');
    const infoEl = document.getElementById('info');
    const metaEl = document.getElementById('metaView');
    let selectedId = MODELS[0]?.id || '';
    function render() {
      const q = qEl.value.trim().toLowerCase();
      const t = tierEl.value;
      const items = MODELS.filter(m => (t === 'all' || m.tier === t) && (!q || m.id.toLowerCase().includes(q) || (m.tags || []).join(',').toLowerCase().includes(q) || (m.quadrants || []).join(',').toLowerCase().includes(q)));
      listEl.innerHTML = '';
      for (const m of items) {
        const b = document.createElement('button');
        b.className = 'item' + (m.id === selectedId ? ' active' : '');
        const lodSummary = (m.lods || []).map(l => 'L' + l.level + ':' + l.tris).join(' / ');
        b.innerHTML = '<strong>' + m.id + '</strong><small>' + m.tier + ' · ' + lodSummary + ' · ' + (m.fileKB || 0) + ' KB</small>';
        b.onclick = () => { selectedId = m.id; show(m); render(); };
        listEl.appendChild(b);
      }
      const active = MODELS.find(m => m.id === selectedId);
      if (active) show(active);
    }
    function show(m) {
      const lvl = Number(lodEl.value);
      const lod = (m.lods || []).find(l => l.level === lvl) || m.lods?.[0] || {};
      infoEl.textContent = m.id + ' | ' + m.tier + ' | ' + (lod.node || 'mesh_lod0') + ': ' + (lod.tris || 0) + ' tris, ' + (lod.gpuVerts || 0) + ' verts | ' + (m.fileKB || 0) + ' KB';
      metaEl.textContent = JSON.stringify(m, null, 2);
    }
    qEl.oninput = render;
    tierEl.onchange = render;
    lodEl.onchange = render;
    render();
  </script>
</body>
</html>`;
}

async function main() {
  if (!existsSync(AUDIT_PATH)) {
    throw new Error('Missing audit_report.json. Run npm run assets:audit first.');
  }
  const audit = JSON.parse(await readFile(AUDIT_PATH, 'utf8'));
  if (audit.failed > 0) {
    throw new Error(`Audit reported ${audit.failed} FAIL asset(s). Fix before building catalog.`);
  }

  const models = [];
  for (const r of audit.results) {
    if (r.status !== 'PASS') continue;
    const metaPath = path.join(BUILT_DIR, r.path.replace(/\.glb$/i, '.meta.json'));
    if (!existsSync(metaPath)) continue;
    models.push(JSON.parse(await readFile(metaPath, 'utf8')));
  }

  const matTable = existsSync(MAT_TABLE_PATH) ? JSON.parse(await readFile(MAT_TABLE_PATH, 'utf8')) : { materials: [], hdri: [] };
  const decalsTable = existsSync(DECALS_TABLE_PATH) ? JSON.parse(await readFile(DECALS_TABLE_PATH, 'utf8')) : { atlases: [] };
  const foliageTable = existsSync(FOLIAGE_TABLE_PATH) ? JSON.parse(await readFile(FOLIAGE_TABLE_PATH, 'utf8')) : { slots: [] };

  const catalog = {
    version: '5.0.0',
    generatedAt: new Date().toISOString(),
    stats: {
      modelCount: models.length,
      materialLayerCount: matTable.layerCount || matTable.materials.length,
      hdriCount: (matTable.hdri || []).length,
      decalAtlasCount: (decalsTable.atlases || []).length,
      foliageSlotCount: (foliageTable.slots || []).length,
    },
    materials: matTable.materials,
    hdri: matTable.hdri || [],
    decals: decalsTable.atlases || [],
    foliage: foliageTable.slots || [],
    models,
  };

  await writeFile(CATALOG_PATH, JSON.stringify(catalog, null, 2));
  await writeFile(BROWSER_HTML_PATH, generateBrowserHtml(catalog));
  console.log(`[catalog:build] Wrote v5.0 catalog.json (${models.length} single-GLB multi-LOD models, ${catalog.stats.materialLayerCount} material layers) & browser.html`);
}

main().catch((err) => {
  console.error('[catalog:build] FAILED:', err);
  process.exit(1);
});
