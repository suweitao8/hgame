#!/usr/bin/env node
/**
 * Clean-room Unity ParticleSystem YAML (.prefab + .mat + .meta) -> HGame .vfx.json converter.
 * Outputs normalized declarative .vfx.json recipes and an asset dependency manifest
 * without bundling or committing any third-party assets.
 */
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const opts = {
    unityRoot: '',
    prefab: '',
    out: '',
    manifestOut: '',
    id: '',
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--unity-root' || a === '-r') opts.unityRoot = argv[++i] ?? '';
    else if (a === '--prefab' || a === '-p') opts.prefab = argv[++i] ?? '';
    else if (a === '--out' || a === '-o') opts.out = argv[++i] ?? '';
    else if (a === '--manifest' || a === '-m') opts.manifestOut = argv[++i] ?? '';
    else if (a === '--id') opts.id = argv[++i] ?? '';
    else if (a === '--help' || a === '-h') opts.help = true;
  }
  return opts;
}

function buildGuidIndex(dir, rootDir, map = new Map()) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) buildGuidIndex(full, rootDir, map);
    else if (entry.name.endsWith('.meta')) {
      const txt = fs.readFileSync(full, 'utf8');
      const g = txt.match(/^guid:\s*([0-9a-f]+)/m);
      if (g) {
        const assetPath = full.slice(0, -5);
        const alphaUsage = Number((txt.match(/^\s*alphaUsage:\s*(\d+)/m) || [])[1] ?? 1);
        const alphaIsTransparency = /alphaIsTransparency:\s*1/.test(txt);
        map.set(g[1], {
          relPath: path.relative(rootDir, assetPath).replace(/\\/g, '/'),
          fullPath: assetPath,
          fromGrayScale: alphaUsage === 2,
          alphaIsTransparency,
        });
      }
    }
  }
  return map;
}

function extractSection(body, name) {
  const idx = body.indexOf(`  ${name}:`);
  if (idx === -1) return '';
  const rest = body.slice(idx);
  const next = rest.slice(name.length + 4).search(/\n  [A-Za-z0-9_]+:/);
  return next === -1 ? rest : rest.slice(0, name.length + 4 + next);
}

function readMinMaxScalar(block, fieldName, fallback = 0) {
  const sub = block.match(new RegExp(`(?:^|\\n) {4}${fieldName}:[^\\n]*\\n([\\s\\S]*?)(?=\\n {4}[A-Za-z_]|$)`));
  if (!sub) return fallback;
  const mode = Number((sub[1].match(/minMaxState:\s*(\d+)/) || [])[1] ?? 0);
  const maxVal = Number((sub[1].match(/\bscalar:\s*([-\d.eE+]+)/) || [])[1] ?? fallback);
  const minVal = Number((sub[1].match(/\bminScalar:\s*([-\d.eE+]+)/) || [])[1] ?? maxVal);
  if (mode === 3 && minVal !== maxVal) {
    return [Number(Math.min(minVal, maxVal).toFixed(4)), Number(Math.max(minVal, maxVal).toFixed(4))];
  }
  return Number(maxVal.toFixed(4));
}

function parseColorObject(str) {
  const r = Number((str.match(/r:\s*([-\d.eE+]+)/) || [])[1] ?? 1);
  const g = Number((str.match(/g:\s*([-\d.eE+]+)/) || [])[1] ?? 1);
  const b = Number((str.match(/b:\s*([-\d.eE+]+)/) || [])[1] ?? 1);
  const a = Number((str.match(/a:\s*([-\d.eE+]+)/) || [])[1] ?? 1);
  return [r, g, b, a];
}

function normalizeHdrColor(rgba) {
  const maxRgb = Math.max(rgba[0], rgba[1], rgba[2], 1);
  return {
    hdr: Number(maxRgb.toFixed(3)),
    rgb: [
      Number((rgba[0] / maxRgb).toFixed(4)),
      Number((rgba[1] / maxRgb).toFixed(4)),
      Number((rgba[2] / maxRgb).toFixed(4)),
    ],
    a: Number(rgba[3].toFixed(4)),
  };
}

function parseCurveKeys(curveBlock) {
  const keys = [...curveBlock.matchAll(/time:\s*([-\d.eE+]+)\s*\n\s*value:\s*([-\d.eE+]+)/g)];
  if (keys.length === 0) return null;
  const out = [];
  for (const k of keys) {
    const t = Math.max(0, Math.min(1, Number(k[1])));
    const v = Math.max(0, Number(k[2]));
    if (out.length === 0 || t >= out[out.length - 1][0]) {
      out.push([Number(t.toFixed(3)), Number(v.toFixed(3))]);
    } else {
      break; // ignore Unity minCurve duplicate following maxCurve
    }
  }
  return out.length >= 2 ? out : null;
}

function parseGradientStops(colorMod) {
  const numC = Math.min(8, Number((colorMod.match(/m_NumColorKeys:\s*(\d+)/) || [])[1] ?? 2));
  const numA = Math.min(8, Number((colorMod.match(/m_NumAlphaKeys:\s*(\d+)/) || [])[1] ?? 2));
  const cols = [];
  for (let i = 0; i < numC; i++) {
    const km = colorMod.match(new RegExp(`key${i}:\\s*\\{([^}]+)\\}`));
    const tm = colorMod.match(new RegExp(`ctime${i}:\\s*(\\d+)`));
    if (km) {
      const c = parseColorObject(km[1]);
      const t = tm ? Number(tm[1]) / 65535 : i / Math.max(1, numC - 1);
      cols.push({ t, r: c[0], g: c[1], b: c[2] });
    }
  }
  const alphas = [];
  for (let i = 0; i < numA; i++) {
    const km = colorMod.match(new RegExp(`key${i}:\\s*\\{([^}]+)\\}`));
    const tm = colorMod.match(new RegExp(`atime${i}:\\s*(\\d+)`));
    if (km) {
      const c = parseColorObject(km[1]);
      const t = tm ? Number(tm[1]) / 65535 : i / Math.max(1, numA - 1);
      alphas.push({ t, a: c[3] });
    }
  }
  const times = [...new Set([...cols.map((c) => Number(c.t.toFixed(3))), ...alphas.map((a) => Number(a.t.toFixed(3)))])].sort((a, b) => a - b);
  const sampleAt = (arr, t, keys) => {
    if (arr.length === 0) return keys.map(() => 1);
    if (t <= arr[0].t) return keys.map((k) => arr[0][k]);
    if (t >= arr[arr.length - 1].t) return keys.map((k) => arr[arr.length - 1][k]);
    for (let i = 0; i < arr.length - 1; i++) {
      if (t <= arr[i + 1].t) {
        const f = (t - arr[i].t) / Math.max(1e-6, arr[i + 1].t - arr[i].t);
        return keys.map((k) => arr[i][k] + (arr[i + 1][k] - arr[i][k]) * f);
      }
    }
    return keys.map((k) => arr[arr.length - 1][k]);
  };
  const stops = times.slice(0, 8).map((t) => {
    const [r, g, b] = sampleAt(cols, t, ['r', 'g', 'b']);
    const [a] = sampleAt(alphas, t, ['a']);
    return [t, [Number(r.toFixed(3)), Number(g.toFixed(3)), Number(b.toFixed(3)), Number(a.toFixed(3))]];
  });
  return stops.length > 0 ? stops : null;
}

function inspectMaterial(matInfo, guidMap, deps) {
  if (!matInfo || !fs.existsSync(matInfo.fullPath)) return null;
  const txt = fs.readFileSync(matInfo.fullPath, 'utf8');
  const mainTexGuid = (txt.match(/- _(?:MainTex|BaseMap):[\s\S]*?guid:\s*([0-9a-f]{32})/) || [])[1];
  const colorMatch = txt.match(/- _(?:Color|BaseColor):\s*\{([^}]+)\}/);
  const color = colorMatch ? normalizeHdrColor(parseColorObject(colorMatch[1])) : { hdr: 1, rgb: [1, 1, 1], a: 1 };
  const isAdditive = /_Blend:\s*2\b/.test(txt) || /_DstBlend:\s*1\b/.test(txt) || /_ADDITIVE/i.test(txt);
  const isLit = /_NORMALMAP|_METALLIC|_SPECGLOSSMAP|Standard Surface/i.test(txt) || /guid:\s*0406db5a14f94604a8c57ccfbc9f3b46/.test(txt);
  const isOpaque = /_Mode:\s*0\b/.test(txt) || /_Surface:\s*0\b/.test(txt);
  const flipbookMode = Number((txt.match(/- _FlipbookMode:\s*([\d.]+)/) || [])[1] ?? 0);

  let spriteKey = null;
  if (mainTexGuid && guidMap.has(mainTexGuid)) {
    const tex = guidMap.get(mainTexGuid);
    deps.textures.set(tex.relPath, tex);
    spriteKey = path.basename(tex.relPath, path.extname(tex.relPath)).toLowerCase().replace(/[^a-z0-9]+/g, '_');
  }

  return {
    spriteKey,
    hdr: color.hdr,
    tintRgb: color.rgb,
    blend: isAdditive ? 'additive' : 'alpha',
    lit: isLit,
    opaque: isOpaque,
    flipbookBlend: flipbookMode >= 1,
  };
}

function mapShapeType(unityType) {
  switch (Number(unityType)) {
    case 0:
    case 1: return 'sphere';
    case 2:
    case 3: return 'hemisphere';
    case 4: return 'cone';
    case 5:
    case 6:
    case 15:
    case 16: return 'box';
    case 10:
    case 11: return 'circle';
    case 12: return 'edge';
    default: return 'sphere';
  }
}

export function convertUnityPrefab({ unityRoot, prefabPath, id }) {
  const guidMap = buildGuidIndex(unityRoot, unityRoot);
  const raw = fs.readFileSync(prefabPath, 'utf8');
  const docs = raw.split(/^--- !u!/m).slice(1);
  const goNames = new Map();
  const transforms = [];
  const psByGo = new Map();
  const psrByGo = new Map();
  const lightByGo = new Map();

  for (const d of docs) {
    const firstNl = d.indexOf('\n');
    const [cls, fidPart] = d.slice(0, firstNl).trim().split(/\s+/);
    const fid = fidPart.replace('&', '');
    const body = d.slice(firstNl + 1);
    if (cls === '1') {
      const nm = (body.match(/^\s*m_Name:\s*(.+)$/m) || [])[1]?.trim() || 'layer';
      const act = !/^\s*m_IsActive:\s*0\b/m.test(body);
      goNames.set(fid, { name: nm, active: act });
    } else if (cls === '4') {
      transforms.push(body);
    } else if (cls === '198') {
      const goId = (body.match(/m_GameObject:\s*\{fileID:\s*(\d+)\}/) || [])[1];
      if (goId) psByGo.set(goId, body);
    } else if (cls === '199') {
      const goId = (body.match(/m_GameObject:\s*\{fileID:\s*(\d+)\}/) || [])[1];
      if (goId) psrByGo.set(goId, body);
    } else if (cls === '108') {
      const goId = (body.match(/m_GameObject:\s*\{fileID:\s*(\d+)\}/) || [])[1];
      if (goId) lightByGo.set(goId, body);
    }
  }

  const deps = { textures: new Map(), meshes: new Map() };
  const layers = [];
  let recipeLoop = false;
  let maxDuration = 0.5;
  let lightPulse = null;

  for (const tr of transforms) {
    const goId = (tr.match(/m_GameObject:\s*\{fileID:\s*(\d+)\}/) || [])[1];
    const go = goNames.get(goId) || { name: 'layer', active: true };
    if (!go.active) continue;

    const fatherId = (tr.match(/m_Father:\s*\{fileID:\s*(\d+)\}/) || [])[1] ?? '0';
    const posM = tr.match(/m_LocalPosition:\s*\{x:\s*([-\d.eE+]+),\s*y:\s*([-\d.eE+]+),\s*z:\s*([-\d.eE+]+)\}/);
    const offset = (fatherId !== '0' && posM) ? [Number(posM[1]), Number(posM[2]), Number(posM[3])] : [0, 0, 0];

    const lt = lightByGo.get(goId);
    if (lt && !lightPulse) {
      const cM = lt.match(/m_Color:\s*\{([^}]+)\}/);
      const col = cM ? parseColorObject(cM[1]) : [1, 1, 1, 1];
      const intensity = Number((lt.match(/^\s*m_Intensity:\s*([-\d.eE+]+)/m) || [])[1] ?? 2);
      const range = Number((lt.match(/^\s*m_Range:\s*([-\d.eE+]+)/m) || [])[1] ?? 8);
      const hex = '#' + [col[0], col[1], col[2]].map((v) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0')).join('');
      lightPulse = { color: hex, intensity, range, duration: 0.45, offset };
    }

    const ps = psByGo.get(goId);
    const psr = psrByGo.get(goId);
    if (!ps || !psr) continue;

    const isLoop = /^\s*looping:\s*1\b/m.test(ps);
    if (isLoop) recipeLoop = true;
    const dur = Number((ps.match(/^\s*lengthInSec:\s*([-\d.eE+]+)/m) || [])[1] ?? 2);
    const delay = readMinMaxScalar(ps, 'startDelay', 0);

    const initMod = extractSection(ps, 'InitialModule');
    const maxParticles = Number((initMod.match(/^\s*maxNumParticles:\s*(\d+)/m) || [])[1] ?? 1000);
    const life = readMinMaxScalar(initMod, 'startLifetime', 1);
    const speed = readMinMaxScalar(initMod, 'startSpeed', 0);
    const size = readMinMaxScalar(initMod, 'startSize', 1);
    const rot = readMinMaxScalar(initMod, 'startRotation', 0);
    const gravScalar = readMinMaxScalar(initMod, 'gravityModifier', 0);

    const maxLife = Array.isArray(life) ? life[1] : life;
    maxDuration = Math.max(maxDuration, isLoop ? dur : (Number(delay) + maxLife));

    const scBlock = initMod.match(/(?:^|\n) {4}startColor:[^\n]*\n[\s\S]*?(?=\n {4}[a-zA-Z]|$)/)?.[0] || '';
    const scMode = Number((scBlock.match(/minMaxState:\s*(\d+)/) || [])[1] ?? 0);
    const maxColM = scBlock.match(/maxColor:\s*\{([^}]+)\}/);
    const minColM = scBlock.match(/minColor:\s*\{([^}]+)\}/);
    const maxCol = maxColM ? parseColorObject(maxColM[1]) : [1, 1, 1, 1];
    const minCol = minColM ? parseColorObject(minColM[1]) : maxCol;

    const emMod = extractSection(ps, 'EmissionModule');
    const rateRaw = readMinMaxScalar(emMod, 'rateOverTime', 0);
    const rate = Array.isArray(rateRaw) ? Number(((rateRaw[0] + rateRaw[1]) * 0.5).toFixed(2)) : rateRaw;
    const bursts = [];
    const burstCount = Number((emMod.match(/m_BurstCount:\s*(\d+)/) || [])[1] ?? 0);
    const burstsPart = emMod.split('m_Bursts:')[1] || '';
    if (burstCount > 0 && burstsPart) {
      const burstMatches = [...burstsPart.matchAll(/-\s*serializedVersion:\s*\d+\s*\n\s*time:\s*([-\d.eE+]+)[\s\S]*?\bscalar:\s*([-\d.eE+]+)[\s\S]*?cycleCount:\s*(\d+)[\s\S]*?repeatInterval:\s*([-\d.eE+]+)/g)];
      for (let bi = 0; bi < Math.min(burstCount, burstMatches.length); bi++) {
        const bm = burstMatches[bi];
        bursts.push({
          time: Number(bm[1]),
          count: Math.max(1, Math.round(Number(bm[2]))),
          cycles: Math.max(1, Number(bm[3])),
          interval: Number(bm[4]),
        });
      }
    }
    const singleLoopMode = maxParticles === 1 && bursts.length === 0;
    const effectiveBursts = singleLoopMode ? [{ time: 0, count: 1 }] : bursts;
    const effectiveRate = singleLoopMode ? 0 : rate;

    const matsBlock = (psr.match(/m_Materials:\s*\n([\s\S]*?)\n  m_/) || ['', ''])[1];
    const matGuids = [...matsBlock.matchAll(/guid:\s*([0-9a-f]{32})/g)].map((m) => m[1]);
    const mainMat = inspectMaterial(guidMap.get(matGuids[0]), guidMap, deps);
    const trailMat = matGuids[1] ? inspectMaterial(guidMap.get(matGuids[1]), guidMap, deps) : null;

    const rmNum = Number((psr.match(/^\s*m_RenderMode:\s*(\d+)/m) || [])[1] ?? 0);
    const renderMode = rmNum === 4 ? 'mesh' : rmNum === 3 ? 'vertical' : rmNum === 2 ? 'horizontal' : rmNum === 1 ? 'stretched' : 'billboard';

    const meshGuid = (psr.match(/m_Mesh:[\s\S]*?guid:\s*([0-9a-f]{32})/) || [])[1];
    let meshKey = 'crystal';
    if (meshGuid && guidMap.has(meshGuid)) {
      const mInfo = guidMap.get(meshGuid);
      deps.meshes.set(mInfo.relPath, mInfo);
      meshKey = path.basename(mInfo.relPath, path.extname(mInfo.relPath))
        .replace(/\([^)]*\)/g, '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    }

    const layer = {
      name: go.name.toLowerCase().replace(/[^a-z0-9_]+/g, '_'),
      kind: renderMode === 'mesh' ? 'mesh' : 'particle',
      renderMode,
      blend: mainMat?.blend || 'alpha',
      hdr: mainMat?.hdr ?? 1.0,
      ...(typeof delay === 'number' && delay > 0 ? { delay } : {}),
      ...(effectiveBursts.length > 0 ? { bursts: effectiveBursts } : {}),
      ...(typeof effectiveRate === 'number' && effectiveRate > 0 ? { rate: effectiveRate } : {}),
      life,
      speed,
      size,
      rotation: rot,
      ...(gravScalar !== 0 ? { gravity: Number((gravScalar * 9.81).toFixed(3)) } : {}),
    };

    if (offset[0] !== 0 || offset[1] !== 0 || offset[2] !== 0) {
      layer.offset = offset;
    }

    if (renderMode === 'mesh') {
      layer.mesh = meshKey;
      if (mainMat?.lit) layer.lit = true;
      if (mainMat?.opaque) layer.opaque = true;
      if (Array.isArray(speed) ? speed[1] > 0.1 : speed > 0.1) layer.alignToVelocity = true;
    } else if (mainMat?.spriteKey) {
      layer.sprite = mainMat.spriteKey;
    }

    if (scMode === 2) {
      layer.startColor = [minCol.slice(0, 3), maxCol.slice(0, 3)];
    }

    const shapeMod = extractSection(ps, 'ShapeModule');
    if (/enabled:\s*1/.test(shapeMod)) {
      const st = (shapeMod.match(/type:\s*(\d+)/) || [])[1] ?? 0;
      const rad = Number((shapeMod.match(/radius:[\s\S]*?value:\s*([-\d.eE+]+)/) || [])[1] ?? 0);
      const ang = Number((shapeMod.match(/\bangle:\s*([-\d.eE+]+)/) || [])[1] ?? 25);
      layer.shape = { type: mapShapeType(st), radius: Number(rad.toFixed(3)), angle: Number(ang.toFixed(1)) };
    }

    const sizeMod = extractSection(ps, 'SizeModule');
    if (/enabled:\s*1/.test(sizeMod)) {
      const curveBlock = sizeMod.split('x:')[1]?.split('y:')[0] || sizeMod;
      const sc = parseCurveKeys(curveBlock);
      if (sc) layer.sizeCurve = sc;
    }

    const startMul = scMode === 2 ? [1, 1, 1, maxCol[3]] : maxCol;
    const colorMod = extractSection(ps, 'ColorModule');
    const colCurve = /enabled:\s*1/.test(colorMod) ? parseGradientStops(colorMod) : null;
    if (colCurve) {
      // When startColor is random range (scMode === 2), per-particle tint applies startColor; otherwise bake maxCol here.
      layer.colorCurve = colCurve.map(([t, rgba]) => [
        t,
        [
          Number((rgba[0] * startMul[0] * (mainMat?.tintRgb?.[0] ?? 1)).toFixed(3)),
          Number((rgba[1] * startMul[1] * (mainMat?.tintRgb?.[1] ?? 1)).toFixed(3)),
          Number((rgba[2] * startMul[2] * (mainMat?.tintRgb?.[2] ?? 1)).toFixed(3)),
          Number((rgba[3] * startMul[3]).toFixed(3)),
        ],
      ]);
    } else {
      layer.colorCurve = [
        [0, [
          Number((startMul[0] * (mainMat?.tintRgb?.[0] ?? 1)).toFixed(3)),
          Number((startMul[1] * (mainMat?.tintRgb?.[1] ?? 1)).toFixed(3)),
          Number((startMul[2] * (mainMat?.tintRgb?.[2] ?? 1)).toFixed(3)),
          Number(startMul[3].toFixed(3)),
        ]],
        [1, [
          Number((startMul[0] * (mainMat?.tintRgb?.[0] ?? 1)).toFixed(3)),
          Number((startMul[1] * (mainMat?.tintRgb?.[1] ?? 1)).toFixed(3)),
          Number((startMul[2] * (mainMat?.tintRgb?.[2] ?? 1)).toFixed(3)),
          0,
        ]],
      ];
    }

    const velMod = extractSection(ps, 'VelocityModule');
    if (/enabled:\s*1/.test(velMod)) {
      const vx = readMinMaxScalar(velMod, 'x', 0);
      const vy = readMinMaxScalar(velMod, 'y', 0);
      const vz = readMinMaxScalar(velMod, 'z', 0);
      const orbY = readMinMaxScalar(velMod, 'orbitalY', 0);
      const radV = readMinMaxScalar(velMod, 'radial', 0);
      const velObj = {};
      if ((Array.isArray(vx) || vx !== 0) || (Array.isArray(vy) || vy !== 0) || (Array.isArray(vz) || vz !== 0)) {
        velObj.linear = [Array.isArray(vx) ? vx[0] : vx, Array.isArray(vy) ? vy[0] : vy, Array.isArray(vz) ? vz[0] : vz];
      }
      if (typeof orbY === 'number' && orbY !== 0) velObj.orbitalY = orbY;
      if (typeof radV === 'number' && radV !== 0) velObj.radial = radV;
      if (Object.keys(velObj).length > 0) layer.velocity = velObj;
    }

    const rotMod = extractSection(ps, 'RotationModule');
    if (/enabled:\s*1/.test(rotMod)) {
      const av = readMinMaxScalar(rotMod, 'curve', 0);
      if (av !== 0) layer.angularVel = av;
    }

    const noiseMod = extractSection(ps, 'NoiseModule');
    if (/enabled:\s*1/.test(noiseMod)) {
      const str = readMinMaxScalar(noiseMod, 'strength', 0.5);
      const freq = Number((noiseMod.match(/\bfrequency:\s*([-\d.eE+]+)/) || [])[1] ?? 0.5);
      layer.noise = { strength: typeof str === 'number' ? str : str[1], frequency: freq };
    }

    const uvMod = extractSection(ps, 'UVModule');
    if (/enabled:\s*1/.test(uvMod)) {
      const cols = Number((uvMod.match(/tilesX:\s*(\d+)/) || [])[1] ?? 1);
      const rows = Number((uvMod.match(/tilesY:\s*(\d+)/) || [])[1] ?? 1);
      const cycles = Number((uvMod.match(/cycles:\s*([-\d.eE+]+)/) || [])[1] ?? 1);
      if (cols > 1 || rows > 1) {
        layer.flipbook = {
          region: mainMat?.spriteKey || 'flipbook',
          cols,
          rows,
          cycles,
          blend: mainMat?.flipbookBlend ?? true,
        };
        delete layer.sprite;
      }
    }

    const trailMod = extractSection(ps, 'TrailModule');
    if (/enabled:\s*1/.test(trailMod)) {
      const tLife = readMinMaxScalar(trailMod, 'lifetime', 0.2);
      const wScalar = readMinMaxScalar(trailMod, 'widthOverTrail', 1);
      const inheritColor = /inheritParticleColor:\s*1/.test(trailMod);
      const cotBlock = trailMod.match(/colorOverTrail:[\s\S]*?(?=widthOverTrail:|$)/)?.[0] || '';
      const cotStops = parseGradientStops(cotBlock);
      const startRgb = cotStops?.[0]?.[1] || maxCol;
      const endRgb = cotStops?.[cotStops.length - 1]?.[1] || startRgb;
      const toHex = (c) => '#' + [c[0], c[1], c[2]].map((v) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0')).join('');
      layer.trail = {
        lifetime: typeof tLife === 'number' ? tLife : tLife[1],
        width: Number(((typeof size === 'number' ? size : size[1]) * (typeof wScalar === 'number' ? wScalar : wScalar[1])).toFixed(3)),
        endWidth: 0,
        inheritColor,
        color: toHex(startRgb),
        endColor: toHex(endRgb),
        hdr: trailMat?.hdr ?? 2.0,
      };
    }

    const colMod = extractSection(ps, 'CollisionModule');
    if (/enabled:\s*1/.test(colMod)) {
      const bounce = readMinMaxScalar(colMod, 'm_Bounce', 0.5);
      const dampen = readMinMaxScalar(colMod, 'm_Dampen', 0.2);
      layer.collision = {
        groundY: 0,
        bounce: typeof bounce === 'number' ? bounce : bounce[1],
        dampen: typeof dampen === 'number' ? dampen : dampen[1],
        maxBounces: 3,
      };
    }

    layers.push(layer);
  }

  const recipeId = id || path.basename(prefabPath, '.prefab').toLowerCase().replace(/[^a-z0-9_]+/g, '_');
  const recipe = {
    schemaVersion: 1,
    id: recipeId,
    loop: recipeLoop,
    duration: Number(maxDuration.toFixed(2)),
    space: 'local',
    ...(lightPulse ? { juice: { lightPulse } } : {}),
    layers,
  };

  return {
    recipe,
    dependencies: {
      textures: [...deps.textures.values()],
      meshes: [...deps.meshes.values()],
    },
  };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('import-unity-vfx.mjs')) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.unityRoot || !opts.prefab) {
    console.log('Usage: node scripts/import-unity-vfx.mjs --unity-root <AssetsDir> --prefab <Effect.prefab> [--out <out.vfx.json>] [--manifest <manifest.json>] [--id <id>]');
    process.exit(opts.help ? 0 : 1);
  }
  const result = convertUnityPrefab({
    unityRoot: path.resolve(opts.unityRoot),
    prefabPath: path.resolve(opts.prefab),
    id: opts.id,
  });
  const jsonText = JSON.stringify(result.recipe, null, 2) + '\n';
  if (opts.out) {
    fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
    fs.writeFileSync(path.resolve(opts.out), jsonText, 'utf8');
  } else {
    process.stdout.write(jsonText);
  }
  if (opts.manifestOut) {
    fs.mkdirSync(path.dirname(path.resolve(opts.manifestOut)), { recursive: true });
    fs.writeFileSync(path.resolve(opts.manifestOut), JSON.stringify(result.dependencies, null, 2) + '\n', 'utf8');
  }
}
