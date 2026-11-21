import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MANIFEST_PATH = path.join(ROOT, 'manifests', 'decals.manifest.json');
const OUT_DIR = path.join(ROOT, 'built', 'decals');

const FONT_STACK = 'Noto Sans SC, Microsoft YaHei, PingFang SC, SimHei, sans-serif';

function escXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildShopSignsSvg(atlasDef) {
  const [w, h] = atlasDef.pcSize;
  const cols = atlasDef.cols;
  const rows = atlasDef.rows;
  const cw = w / cols;
  const ch = h / rows;

  const colorParts = [];
  const emissiveParts = [];

  atlasDef.items.forEach((item, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = col * cw;
    const y = row * ch;
    const pad = 6;
    const ix = x + pad;
    const iy = y + pad;
    const iw = cw - pad * 2;
    const ih = ch - pad * 2;

    const mainSize = item.text.length >= 7 ? 28 : item.text.length >= 5 ? 32 : 38;
    const subSize = 15;

    // Frame, bolts, weathering drip
    colorParts.push(`
      <g>
        <rect x="${ix}" y="${iy}" width="${iw}" height="${ih}" rx="6" fill="${item.bg}" stroke="#30343a" stroke-width="4"/>
        <rect x="${ix + 5}" y="${iy + 5}" width="${iw - 10}" height="${ih - 10}" rx="3" fill="none" stroke="${item.accent}" stroke-width="2" stroke-opacity="0.75"/>
        <circle cx="${ix + 10}" cy="${iy + 10}" r="2.5" fill="#9aa0a6"/>
        <circle cx="${ix + iw - 10}" cy="${iy + 10}" r="2.5" fill="#9aa0a6"/>
        <circle cx="${ix + 10}" cy="${iy + ih - 10}" r="2.5" fill="#9aa0a6"/>
        <circle cx="${ix + iw - 10}" cy="${iy + ih - 10}" r="2.5" fill="#9aa0a6"/>
        <rect x="${ix}" y="${iy}" width="${iw}" height="${ih * 0.16}" fill="#000000" fill-opacity="0.16"/>
        <text x="${x + cw / 2}" y="${y + ch * 0.49}" text-anchor="middle" dominant-baseline="central" font-family="${FONT_STACK}" font-weight="800" font-size="${mainSize}" fill="${item.fg}">${escXml(item.text)}</text>
        <text x="${x + cw / 2}" y="${y + ch * 0.77}" text-anchor="middle" dominant-baseline="central" font-family="${FONT_STACK}" font-weight="600" font-size="${subSize}" fill="${item.accent}">${escXml(item.sub || '')}</text>
      </g>
    `);

    const tubeJitter = ((idx * 37) % 5) * 0.05;
    emissiveParts.push(`
      <g>
        <rect x="${ix + 4}" y="${iy + 4}" width="${iw - 8}" height="${ih - 8}" rx="4" fill="${item.bg}" fill-opacity="${0.48 - tubeJitter}"/>
        <rect x="${ix + 8}" y="${iy + ih * 0.35}" width="${iw - 16}" height="${ih * 0.25}" fill="#ffffff" fill-opacity="0.1"/>
        <text x="${x + cw / 2}" y="${y + ch * 0.49}" text-anchor="middle" dominant-baseline="central" font-family="${FONT_STACK}" font-weight="800" font-size="${mainSize}" fill="${item.fg}" fill-opacity="0.96">${escXml(item.text)}</text>
        <text x="${x + cw / 2}" y="${y + ch * 0.77}" text-anchor="middle" dominant-baseline="central" font-family="${FONT_STACK}" font-weight="600" font-size="${subSize}" fill="${item.accent}" fill-opacity="0.9">${escXml(item.sub || '')}</text>
      </g>
    `);
  });

  const colorSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#1b1d20"/>${colorParts.join('')}</svg>`;
  const emissiveSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#000000"/>${emissiveParts.join('')}</svg>`;
  return { colorSvg, emissiveSvg };
}

function buildMunicipalSignsSvg(atlasDef) {
  const [w, h] = atlasDef.pcSize;
  const cw = w / 4;
  const ch = h / 4;
  const cell = (col, row, content) => `<g transform="translate(${col * cw},${row * ch})">${content}</g>`;

  const parts = [
    // Row 0: Blue national road signs
    cell(0, 0, `<rect x="12" y="40" width="232" height="176" rx="8" fill="#0d47a1" stroke="#ffffff" stroke-width="5"/><text x="128" y="102" text-anchor="middle" font-family="${FONT_STACK}" font-weight="700" font-size="34" fill="#ffffff">中山大道</text><line x1="28" y1="130" x2="228" y2="130" stroke="#ffffff" stroke-width="2"/><text x="128" y="168" text-anchor="middle" font-family="${FONT_STACK}" font-weight="600" font-size="22" fill="#e3f2fd">ZHONGSHAN AVE</text>`),
    cell(1, 0, `<rect x="12" y="40" width="232" height="176" rx="8" fill="#0d47a1" stroke="#ffffff" stroke-width="5"/><text x="128" y="96" text-anchor="middle" font-family="${FONT_STACK}" font-weight="700" font-size="30" fill="#ffffff">← 火车站 2km</text><text x="128" y="152" text-anchor="middle" font-family="${FONT_STACK}" font-weight="700" font-size="30" fill="#ffffff">工业园区 5km →</text>`),
    cell(2, 0, `<circle cx="128" cy="128" r="98" fill="#ffffff" stroke="#d32f2f" stroke-width="22"/><text x="128" y="146" text-anchor="middle" font-family="${FONT_STACK}" font-weight="800" font-size="76" fill="#111111">40</text>`),
    cell(3, 0, `<circle cx="128" cy="128" r="98" fill="#1565c0" stroke="#d32f2f" stroke-width="22"/><line x1="58" y1="58" x2="198" y2="198" stroke="#d32f2f" stroke-width="20"/><line x1="198" y1="58" x2="58" y2="198" stroke="#d32f2f" stroke-width="20"/>`),

    // Row 1: Building/Unit plates & safety signs
    cell(0, 1, `<rect x="24" y="54" width="208" height="148" rx="8" fill="#1565c0" stroke="#ffffff" stroke-width="4"/><text x="128" y="114" text-anchor="middle" font-family="${FONT_STACK}" font-weight="800" font-size="40" fill="#ffffff">3 栋</text><text x="128" y="166" text-anchor="middle" font-family="${FONT_STACK}" font-weight="700" font-size="26" fill="#ffeb3b">2 单元</text>`),
    cell(1, 1, `<rect x="14" y="64" width="228" height="128" rx="6" fill="#0b6e4f" stroke="#ffffff" stroke-width="4"/><text x="128" y="118" text-anchor="middle" font-family="${FONT_STACK}" font-weight="800" font-size="34" fill="#ffffff">安全出口</text><text x="128" y="160" text-anchor="middle" font-family="${FONT_STACK}" font-weight="700" font-size="22" fill="#e0f2f1">EXIT →</text>`),
    cell(2, 1, `<rect x="34" y="24" width="188" height="208" rx="6" fill="#c62828" stroke="#ffffff" stroke-width="4"/><rect x="46" y="36" width="164" height="184" fill="none" stroke="#ffeb3b" stroke-width="2"/><text x="128" y="106" text-anchor="middle" font-family="${FONT_STACK}" font-weight="800" font-size="38" fill="#ffffff">消火栓</text><text x="128" y="164" text-anchor="middle" font-family="${FONT_STACK}" font-weight="700" font-size="26" fill="#ffeb3b">119</text>`),
    cell(3, 1, `<polygon points="128,28 228,214 28,214" fill="#fdd835" stroke="#111111" stroke-width="10"/><text x="128" y="176" text-anchor="middle" font-family="${FONT_STACK}" font-weight="800" font-size="88" fill="#111111">!</text>`),

    // Row 2: Parking & Traffic control
    cell(0, 2, `<rect x="28" y="28" width="200" height="200" rx="16" fill="#1565c0" stroke="#ffffff" stroke-width="6"/><text x="128" y="148" text-anchor="middle" font-family="${FONT_STACK}" font-weight="900" font-size="112" fill="#ffffff">P</text><text x="128" y="202" text-anchor="middle" font-family="${FONT_STACK}" font-weight="700" font-size="24" fill="#ffffff">地下车库</text>`),
    cell(1, 2, `<rect x="18" y="54" width="220" height="148" rx="6" fill="#ffffff" stroke="#1b5e20" stroke-width="6"/><text x="128" y="116" text-anchor="middle" font-family="${FONT_STACK}" font-weight="800" font-size="34" fill="#1b5e20">幸福小区</text><text x="128" y="162" text-anchor="middle" font-family="${FONT_STACK}" font-weight="700" font-size="22" fill="#37474f">外来车辆登记</text>`),
    cell(2, 2, `<rect x="18" y="54" width="220" height="148" rx="6" fill="#263238" stroke="#ffca28" stroke-width="4"/><text x="128" y="114" text-anchor="middle" font-family="${FONT_STACK}" font-weight="800" font-size="32" fill="#ffca28">施工重地</text><text x="128" y="160" text-anchor="middle" font-family="${FONT_STACK}" font-weight="700" font-size="24" fill="#ffffff">闲人免入</text>`),
    cell(3, 2, `<rect x="18" y="54" width="220" height="148" rx="6" fill="#1565c0" stroke="#ffffff" stroke-width="4"/><text x="128" y="112" text-anchor="middle" font-family="${FONT_STACK}" font-weight="800" font-size="30" fill="#ffffff">公交车站</text><text x="128" y="158" text-anchor="middle" font-family="${FONT_STACK}" font-weight="600" font-size="20" fill="#ffeb3b">1路 · 18路 · K3</text>`),

    // Row 3: Rural red-wall white slogans
    cell(0, 3, `<rect x="8" y="48" width="240" height="160" fill="#a82020"/><text x="128" y="114" text-anchor="middle" font-family="${FONT_STACK}" font-weight="800" font-size="28" fill="#f5f5f5">要想富 先修路</text><text x="128" y="160" text-anchor="middle" font-family="${FONT_STACK}" font-weight="700" font-size="24" fill="#ffebee">共建美丽乡村</text>`),
    cell(1, 3, `<rect x="8" y="48" width="240" height="160" fill="#a82020"/><text x="128" y="114" text-anchor="middle" font-family="${FONT_STACK}" font-weight="800" font-size="28" fill="#f5f5f5">严禁烟火</text><text x="128" y="160" text-anchor="middle" font-family="${FONT_STACK}" font-weight="700" font-size="24" fill="#ffebee">森林防火 人人有责</text>`),
    cell(2, 3, `<rect x="18" y="54" width="220" height="148" rx="6" fill="#00695c" stroke="#ffffff" stroke-width="4"/><text x="128" y="114" text-anchor="middle" font-family="${FONT_STACK}" font-weight="800" font-size="30" fill="#ffffff">垃圾分类</text><text x="128" y="160" text-anchor="middle" font-family="${FONT_STACK}" font-weight="600" font-size="22" fill="#e0f2f1">从我做起</text>`),
    cell(3, 3, `<rect x="18" y="54" width="220" height="148" rx="6" fill="#37474f" stroke="#cfd8dc" stroke-width="4"/><text x="128" y="114" text-anchor="middle" font-family="${FONT_STACK}" font-weight="800" font-size="28" fill="#ffca28">高压危险</text><text x="128" y="160" text-anchor="middle" font-family="${FONT_STACK}" font-weight="700" font-size="22" fill="#ffffff">切勿攀爬 10kV</text>`),
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#000000" fill-opacity="0"/>${parts.join('')}</svg>`;
}

function buildRoadMarkingsSvg(atlasDef) {
  const [w, h] = atlasDef.pcSize;
  const cw = w / 4;
  const ch = h / 4;
  const cell = (col, row, content) => `<g transform="translate(${col * cw},${row * ch})">${content}</g>`;

  const parts = [
    // Zebra crossing, double yellow line, white dashed, yellow no-park grid
    cell(0, 0, `<rect x="20" y="20" width="216" height="44" fill="#e8e8e4"/><rect x="20" y="106" width="216" height="44" fill="#e8e8e4"/><rect x="20" y="192" width="216" height="44" fill="#e8e8e4"/>`),
    cell(1, 0, `<rect x="108" y="0" width="12" height="256" fill="#f5b700"/><rect x="136" y="0" width="12" height="256" fill="#f5b700"/>`),
    cell(2, 0, `<rect x="118" y="16" width="20" height="96" fill="#eaeae6"/><rect x="118" y="144" width="20" height="96" fill="#eaeae6"/>`),
    cell(3, 0, `<rect x="16" y="16" width="224" height="224" fill="none" stroke="#f5b700" stroke-width="10"/><line x1="16" y1="16" x2="240" y2="240" stroke="#f5b700" stroke-width="8"/><line x1="240" y1="16" x2="16" y2="240" stroke="#f5b700" stroke-width="8"/>`),

    // Straight arrow, left arrow, straight+right arrow, stop line
    cell(0, 1, `<polygon points="128,24 180,104 146,104 146,232 110,232 110,104 76,104" fill="#eaeae6"/>`),
    cell(1, 1, `<path d="M148,232 L148,116 L98,116 L98,148 L36,94 L98,40 L98,74 L182,74 L182,232 Z" fill="#eaeae6"/>`),
    cell(2, 1, `<polygon points="104,24 146,88 118,88 118,232 90,232 90,88 62,88" fill="#eaeae6"/><path d="M118,126 L168,126 L168,100 L216,142 L168,184 L168,158 L118,158 Z" fill="#eaeae6"/>`),
    cell(3, 1, `<rect x="0" y="96" width="256" height="36" fill="#eaeae6"/><text x="128" y="196" text-anchor="middle" font-family="${FONT_STACK}" font-weight="800" font-size="44" fill="#eaeae6">停 STOP</text>`),

    // Parking bay, slow warning, round manhole, square manhole
    cell(0, 2, `<path d="M36,236 L36,24 L220,24 L220,236" fill="none" stroke="#eaeae6" stroke-width="12"/>`),
    cell(1, 2, `<polygon points="128,36 226,210 30,210" fill="none" stroke="#f5b700" stroke-width="14"/><text x="128" y="180" text-anchor="middle" font-family="${FONT_STACK}" font-weight="800" font-size="56" fill="#f5b700">慢</text>`),
    cell(2, 2, `<circle cx="128" cy="128" r="106" fill="#3a3d42" stroke="#22252a" stroke-width="8"/><circle cx="128" cy="128" r="88" fill="none" stroke="#53585f" stroke-width="4"/><circle cx="128" cy="128" r="64" fill="none" stroke="#53585f" stroke-width="4"/><text x="128" y="138" text-anchor="middle" font-family="${FONT_STACK}" font-weight="700" font-size="30" fill="#777c85">市政污水</text>`),
    cell(3, 2, `<rect x="22" y="22" width="212" height="212" rx="6" fill="#3b3e42" stroke="#202327" stroke-width="8"/><rect x="42" y="42" width="172" height="172" fill="none" stroke="#555a60" stroke-width="4"/><text x="128" y="138" text-anchor="middle" font-family="${FONT_STACK}" font-weight="700" font-size="30" fill="#787d85">电力检查井</text>`),

    // Speed bump, bus lane, non-motor bike icon, crosswalk warning diamonds
    cell(0, 3, `<rect x="12" y="88" width="46" height="80" fill="#f5b700"/><rect x="58" y="88" width="46" height="80" fill="#202224"/><rect x="104" y="88" width="46" height="80" fill="#f5b700"/><rect x="150" y="88" width="46" height="80" fill="#202224"/><rect x="196" y="88" width="48" height="80" fill="#f5b700"/>`),
    cell(1, 3, `<text x="128" y="108" text-anchor="middle" font-family="${FONT_STACK}" font-weight="800" font-size="48" fill="#f5b700">公交</text><text x="128" y="176" text-anchor="middle" font-family="${FONT_STACK}" font-weight="800" font-size="48" fill="#f5b700">专用</text>`),
    cell(2, 3, `<circle cx="72" cy="170" r="34" fill="none" stroke="#eaeae6" stroke-width="10"/><circle cx="184" cy="170" r="34" fill="none" stroke="#eaeae6" stroke-width="10"/><path d="M72,170 L118,108 L164,108 L184,170 M118,108 L104,76 L82,76" fill="none" stroke="#eaeae6" stroke-width="10"/>`),
    cell(3, 3, `<polygon points="128,28 196,128 128,228 60,128" fill="none" stroke="#eaeae6" stroke-width="14"/>`),
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#000000" fill-opacity="0"/>${parts.join('')}</svg>`;
}

function buildWeatheringVfxSvg(atlasDef) {
  const [w, h] = atlasDef.pcSize;
  const cw = w / 4;
  const ch = h / 4;
  const cell = (col, row, content) => `<g transform="translate(${col * cw},${row * ch})">${content}</g>`;

  const parts = [
    // Row 0: Water stain, peeling plaster, corridor flyers, oil slick
    cell(0, 0, `<ellipse cx="128" cy="196" rx="108" ry="42" fill="#2c3328" fill-opacity="0.65"/><path d="M64,180 Q90,90 105,175 Q140,60 155,178 Q182,110 198,185" fill="#252c22" fill-opacity="0.55"/>`),
    cell(1, 0, `<path d="M40,60 L196,48 L220,148 L156,216 L54,188 Z" fill="#5b5752" stroke="#d9d4cb" stroke-width="6"/><path d="M72,88 L176,78 L188,150 L98,176 Z" fill="#3f3b37"/>`),
    cell(2, 0, `<rect x="30" y="34" width="90" height="110" fill="#f5f1e6" stroke="#b0a99a" stroke-width="2" transform="rotate(-5 75 89)"/><text x="75" y="76" text-anchor="middle" font-family="${FONT_STACK}" font-weight="800" font-size="18" fill="#d32f2f">疏通开锁</text><text x="75" y="108" text-anchor="middle" font-family="${FONT_STACK}" font-weight="700" font-size="14" fill="#212121">138-XXXX</text><rect x="132" y="96" width="94" height="114" fill="#fff3cd" stroke="#c0b080" stroke-width="2" transform="rotate(6 179 153)"/><text x="179" y="142" text-anchor="middle" font-family="${FONT_STACK}" font-weight="800" font-size="18" fill="#1565c0">房屋出租</text><text x="179" y="172" text-anchor="middle" font-family="${FONT_STACK}" font-weight="700" font-size="14" fill="#333333">拎包入住</text>`),
    cell(3, 0, `<ellipse cx="128" cy="128" rx="92" ry="64" fill="#1b1c1f" fill-opacity="0.72"/><path d="M44,118 L112,126 L188,92 L222,108" fill="none" stroke="#111111" stroke-width="5"/>`),

    // Row 1: Bullet holes / scorch + crack stages
    cell(0, 1, `<circle cx="128" cy="128" r="56" fill="#181818" fill-opacity="0.7"/><circle cx="128" cy="128" r="18" fill="#0a0a0a"/><path d="M128,128 L72,82 M128,128 L184,90 M128,128 L172,186 M128,128 L86,178" stroke="#222222" stroke-width="4"/>`),
    cell(1, 1, `<path d="M128,24 L118,86 L142,138 L108,216 M118,86 L68,108 M142,138 L196,120" fill="none" stroke="#181818" stroke-width="7" stroke-linecap="round"/>`),
    cell(2, 1, `<path d="M128,16 L104,76 L146,128 L96,192 L134,242 M104,76 L46,56 M146,128 L212,110 M96,192 L40,210" fill="none" stroke="#141414" stroke-width="10" stroke-linecap="round"/>`),
    cell(3, 1, `<circle cx="128" cy="128" r="78" fill="#2e241b" fill-opacity="0.75"/><path d="M128,128 L34,42 M128,128 L224,52 M128,128 L216,214 M128,128 L42,208 M128,128 L128,18" stroke="#151210" stroke-width="8"/>`),

    // Row 2 & 3: Particle flipbook sprites (smoke/fire/sparks)
    cell(0, 2, `<radialGradient id="g1"><stop offset="0%" stop-color="#fff4b8"/><stop offset="55%" stop-color="#ff7a1a"/><stop offset="100%" stop-color="#ff3d00" stop-opacity="0"/></radialGradient><circle cx="128" cy="128" r="96" fill="url(#g1)"/>`),
    cell(1, 2, `<radialGradient id="g2"><stop offset="0%" stop-color="#d8dcd8" stop-opacity="0.85"/><stop offset="100%" stop-color="#8b9290" stop-opacity="0"/></radialGradient><circle cx="128" cy="128" r="96" fill="url(#g2)"/>`),
    cell(2, 2, `<radialGradient id="g3"><stop offset="0%" stop-color="#ffffff"/><stop offset="40%" stop-color="#ffd54f"/><stop offset="100%" stop-color="#ff8f00" stop-opacity="0"/></radialGradient><circle cx="128" cy="128" r="68" fill="url(#g3)"/>`),
    cell(3, 2, `<radialGradient id="g4"><stop offset="0%" stop-color="#90caf9" stop-opacity="0.9"/><stop offset="100%" stop-color="#1e88e5" stop-opacity="0"/></radialGradient><circle cx="128" cy="128" r="88" fill="url(#g4)"/>`),
    cell(0, 3, `<circle cx="128" cy="128" r="56" fill="#ffab40" fill-opacity="0.8"/>`),
    cell(1, 3, `<circle cx="128" cy="128" r="72" fill="#cfd8dc" fill-opacity="0.55"/>`),
    cell(2, 3, `<polygon points="128,28 148,108 228,128 148,148 128,228 108,148 28,128 108,108" fill="#ffe082"/>`),
    cell(3, 3, `<circle cx="128" cy="128" r="44" fill="#ff5252" fill-opacity="0.75"/>`),
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#000000" fill-opacity="0"/>${parts.join('')}</svg>`;
}

function buildBackdropWindowsSvg(atlasDef) {
  const [w, h] = atlasDef.pcSize;
  // Top half: Modern CBD glass tower grid; Bottom half: 90s residential block window grid
  const cols = 16;
  const rows = 16;
  const cw = w / cols;
  const ch = h / rows;

  const colorCells = [];
  const emCells = [];
  for (let r = 0; r < rows; r++) {
    const isOldtown = r >= rows / 2;
    for (let c = 0; c < cols; c++) {
      const hash = ((r * 73 + c * 139 + 17) % 100) / 100;
      const lit = hash > (isOldtown ? 0.62 : 0.48);
      const warm = hash > 0.78;
      const x = c * cw;
      const y = r * ch;
      const glassCol = isOldtown
        ? (lit ? '#5b5649' : '#22262b')
        : (lit ? '#3d586e' : '#1b2836');
      const frameCol = isOldtown ? '#959188' : '#2f3a44';
      colorCells.push(`<rect x="${x + 2}" y="${y + 3}" width="${cw - 4}" height="${ch - 6}" fill="${glassCol}" stroke="${frameCol}" stroke-width="2"/>`);
      if (lit) {
        const emCol = warm ? '#ffd180' : '#b3e5fc';
        const op = (0.45 + (hash % 0.45)).toFixed(2);
        emCells.push(`<rect x="${x + 4}" y="${y + 5}" width="${cw - 8}" height="${ch - 10}" fill="${emCol}" fill-opacity="${op}"/>`);
      }
    }
  }
  const colorSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#262c33"/>${colorCells.join('')}</svg>`;
  const emissiveSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#000000"/>${emCells.join('')}</svg>`;
  return { colorSvg, emissiveSvg };
}

async function generateRoadMarkingsNormalRm(colorPngBuf, width, height) {
  const { data } = await sharp(colorPngBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const nrm = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = data[i + 3];
      const isManhole = y >= height * 0.5 && y < height * 0.75 && x >= width * 0.5;
      nrm[i] = 128;
      nrm[i + 1] = 128;
      nrm[i + 2] = isManhole ? 140 : a > 32 ? 195 : 225;
      nrm[i + 3] = isManhole ? 210 : 0;
    }
  }
  return sharp(nrm, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
}

async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  await mkdir(OUT_DIR, { recursive: true });

  const table = { version: manifest.version, atlases: [] };

  for (const atlasDef of manifest.atlases) {
    const [w, h] = atlasDef.pcSize;
    const outFiles = {};

    if (atlasDef.id === 'cn_shop_signs') {
      const { colorSvg, emissiveSvg } = buildShopSignsSvg(atlasDef);
      await sharp(Buffer.from(colorSvg)).png({ compressionLevel: 9 }).toFile(path.join(OUT_DIR, 'cn_shop_signs_color.png'));
      await sharp(Buffer.from(emissiveSvg)).png({ compressionLevel: 9 }).toFile(path.join(OUT_DIR, 'cn_shop_signs_emissive.png'));
      outFiles.color = 'cn_shop_signs_color.png';
      outFiles.emissive = 'cn_shop_signs_emissive.png';
    } else if (atlasDef.id === 'cn_municipal_signs') {
      const svg = buildMunicipalSignsSvg(atlasDef);
      await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(path.join(OUT_DIR, 'cn_municipal_signs_color.png'));
      outFiles.color = 'cn_municipal_signs_color.png';
    } else if (atlasDef.id === 'cn_road_markings') {
      const svg = buildRoadMarkingsSvg(atlasDef);
      const colorBuf = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
      const nrmBuf = await generateRoadMarkingsNormalRm(colorBuf, w, h);
      await writeFile(path.join(OUT_DIR, 'cn_road_markings_color.png'), colorBuf);
      await writeFile(path.join(OUT_DIR, 'cn_road_markings_normal_rm.png'), nrmBuf);
      outFiles.color = 'cn_road_markings_color.png';
      outFiles.normal_rm = 'cn_road_markings_normal_rm.png';
    } else if (atlasDef.id === 'cn_weathering_vfx') {
      const svg = buildWeatheringVfxSvg(atlasDef);
      await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(path.join(OUT_DIR, 'cn_weathering_vfx_color.png'));
      outFiles.color = 'cn_weathering_vfx_color.png';
    } else if (atlasDef.id === 'cn_backdrop_windows') {
      const { colorSvg, emissiveSvg } = buildBackdropWindowsSvg(atlasDef);
      await sharp(Buffer.from(colorSvg)).png({ compressionLevel: 9 }).toFile(path.join(OUT_DIR, 'cn_backdrop_windows_color.png'));
      await sharp(Buffer.from(emissiveSvg)).png({ compressionLevel: 9 }).toFile(path.join(OUT_DIR, 'cn_backdrop_windows_emissive.png'));
      outFiles.color = 'cn_backdrop_windows_color.png';
      outFiles.emissive = 'cn_backdrop_windows_emissive.png';
    }

    table.atlases.push({
      id: atlasDef.id,
      pcSize: atlasDef.pcSize,
      mobileSize: atlasDef.mobileSize,
      cols: atlasDef.cols,
      rows: atlasDef.rows,
      files: outFiles,
    });
    console.log(`[decals:bake] Baked ${atlasDef.id} (${w}x${h}) -> ${Object.values(outFiles).join(', ')}`);
  }

  await writeFile(path.join(OUT_DIR, 'decals_table.json'), JSON.stringify(table, null, 2));
}

main().catch((err) => {
  console.error('[decals:bake] FAILED:', err);
  process.exit(1);
});
