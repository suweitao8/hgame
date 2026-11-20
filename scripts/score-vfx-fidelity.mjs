#!/usr/bin/env node
/**
 * Quantitative Unity ParticleSystem -> HGame VFX fidelity evaluator.
 * Audits Unity .prefab + .mat sources against HGame runtime capabilities
 * and converted .vfx.json + atlas_regions.json + meshes/*.glb outputs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { validateVfxRecipe } from '../assets/runtime/vfx/vfx-recipes.js';

function extractSection(body, name) {
  const idx = body.indexOf(`  ${name}:`);
  if (idx === -1) return '';
  const rest = body.slice(idx);
  const next = rest.slice(name.length + 4).search(/\n  [A-Za-z0-9_]+:/);
  return next === -1 ? rest : rest.slice(0, name.length + 4 + next);
}

function readSubScalar(block, fieldName) {
  const m = block.match(new RegExp(`(?:^|\\n) {4}${fieldName}:[^\\n]*\\n([\\s\\S]*?)(?=\\n {4}[A-Za-z_]|$)`));
  if (!m) return { state: 0, scalar: 0, minScalar: 0 };
  const state = Number((m[1].match(/minMaxState:\s*(\d+)/) || [])[1] ?? 0);
  const rawMax = (m[1].match(/\bscalar:\s*(Infinity|-Infinity|[-\d.eE+]+)/) || [])[1];
  const rawMin = (m[1].match(/\bminScalar:\s*(Infinity|-Infinity|[-\d.eE+]+)/) || [])[1];
  return {
    state,
    scalar: rawMax === 'Infinity' ? Infinity : Number(rawMax ?? 0),
    minScalar: rawMin === 'Infinity' ? Infinity : Number(rawMin ?? rawMax ?? 0),
  };
}

function buildGuidMap(dir, map = new Map()) {
  if (!fs.existsSync(dir)) return map;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) buildGuidMap(full, map);
    else if (ent.name.endsWith('.meta')) {
      const m = fs.readFileSync(full, 'utf8').match(/^guid:\s*([0-9a-f]+)/m);
      if (m) map.set(m[1], full.slice(0, -5));
    }
  }
  return map;
}

function collectPrefabs(rootDir, subfolders) {
  const files = [];
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith('.prefab')) files.push(p);
    }
  };
  if (Array.isArray(subfolders) && subfolders.length > 0) {
    for (const sub of subfolders) {
      const target = path.join(rootDir, sub);
      if (fs.existsSync(target)) walk(target);
    }
  } else if (fs.existsSync(rootDir)) {
    walk(rootDir);
  }
  return files;
}

const RUBRIC = {
  D1_Emission_Lifecycle: {
    maxPoints: 20,
    label: '发射与生命周期 (Emission & Lifecycle)',
    features: {
      lifecycle_basic: { label: 'Duration / Loop / Prewarm / Delay', parity: 1.0, baseWeight: 3.0 },
      rate_over_time: { label: 'Emission rateOverTime', parity: 1.0, baseWeight: 2.5 },
      rate_over_distance: { label: 'Emission rateOverDistance', parity: 1.0, baseWeight: 2.0 },
      bursts: { label: 'Emission bursts (time/count/cycles/interval)', parity: 1.0, baseWeight: 2.5 },
      max_particles: { label: 'maxNumParticles emission cap', parity: 1.0, baseWeight: 1.8 },
      persistent_infinity: { label: 'Infinity lifetime + curveCycle', parity: 1.0, baseWeight: 1.8 },
      sim_speed: { label: 'Non-unit simulationSpeed != 1', parity: 1.0, baseWeight: 0.8 },
    },
  },
  D2_Shapes_Kinematics: {
    maxPoints: 25,
    label: '形状与运动学 (Shapes & Kinematics)',
    features: {
      shapes_std: { label: 'Sphere/Hemisphere/Cone/Circle/Box/Edge', parity: 1.0, baseWeight: 3.0 },
      shapes_approx: { label: 'Donut/Rectangle/Sprite shapes', parity: 1.0, baseWeight: 1.0 },
      shape_mesh: { label: 'ShapeType Mesh surface spawn', parity: 1.0, baseWeight: 0.8 },
      shape_rotation: { label: 'Transform + ShapeModule 3D orientation', parity: 1.0, baseWeight: 2.5 },
      vel_scalar_orbital: { label: 'Velocity linear/orbitalY/orbitalOffset/radial', parity: 1.0, baseWeight: 3.0 },
      vel_curves: { label: 'VelocityModule time-varying curves', parity: 1.0, baseWeight: 1.4 },
      force_and_gravity: { label: 'Gravity + 3D ForceModule', parity: 1.0, baseWeight: 1.5 },
      noise_turbulence: { label: 'NoiseModule turbulence (3D + strengthY + scroll + damping)', parity: 1.0, baseWeight: 2.5 },
      local_moving_space: { label: 'Local SimulationSpace on moving emitters', parity: 1.0, baseWeight: 1.5 },
    },
  },
  D3_Appearance_Shaders: {
    maxPoints: 25,
    label: '外观曲线与着色 (Appearance, Curves & Shaders)',
    features: {
      curves_lut: { label: 'ColorModule + SizeModule + PostInfinity 1024-LUT', parity: 1.0, baseWeight: 3.5 },
      size_separate_axes: { label: 'SizeModule separateAxes X/Y/Z curves', parity: 1.0, baseWeight: 1.2 },
      start_color_range: { label: 'startColor random range / gradient / tint', parity: 1.0, baseWeight: 2.0 },
      rotation_spin: { label: 'StartRotation + separateAxes spin', parity: 1.0, baseWeight: 2.0 },
      rotation_3d_quad: { label: 'InitialModule rotation3D on non-mesh quads', parity: 1.0, baseWeight: 1.2 },
      render_modes: { label: 'Billboard/Horizontal/Vertical/Stretched/Mesh', parity: 1.0, baseWeight: 3.0 },
      size3d_aspect: { label: 'Billboard size3D aspectY scaling', parity: 1.0, baseWeight: 1.6 },
      uv_flipbook: { label: 'UVModule flipbook grid + rowMode + smooth blend', parity: 1.0, baseWeight: 2.4 },
      soft_particles: { label: 'SoftParticles depth fade (setDepthTexture)', parity: 1.0, baseWeight: 2.2 },
      hdr_ldr_preserve: { label: 'HDR hue/intensity preservation on RGBA8', parity: 1.0, baseWeight: 2.2 },
      distortion_shader: { label: 'Screen-space refraction Distortion shaders', parity: 1.0, baseWeight: 1.6 },
    },
  },
  D4_Modules_SubEmitters: {
    maxPoints: 15,
    label: '高级联动模块 (Trails, Collision & SubEmitters)',
    features: {
      trail_module: { label: 'TrailModule ribbon + gradient/alpha/UV/widthCurve', parity: 1.0, baseWeight: 3.0 },
      sub_module: { label: 'SubModule birth/collision/death + inherit properties', parity: 1.0, baseWeight: 2.8 },
      collision_module: { label: 'CollisionModule bounce/dampen + custom resolver', parity: 1.0, baseWeight: 2.0 },
      lights_module: { label: 'PointLight pulse & per-particle LightsModule', parity: 1.0, baseWeight: 1.2 },
      external_forces: { label: 'ExternalForcesModule wind zones', parity: 1.0, baseWeight: 0.6 },
    },
  },
};

export function evaluateVfxFidelity({
  unityRoot,
  vfxDir = '',
  atlasRegionsPath = '',
  meshesDir = '',
  subfolders = ['Auras', 'Buffs', 'Shields', 'Tomes', 'Spells', 'Projectiles/Casting', 'Projectiles/Projectiles', 'Projectiles/Explosion'],
} = {}) {
  const prefabsRoot = fs.existsSync(path.join(unityRoot, 'Particles/Prefabs'))
    ? path.join(unityRoot, 'Particles/Prefabs')
    : unityRoot;
  const prefabFiles = collectPrefabs(prefabsRoot, subfolders);
  const guidMap = buildGuidMap(unityRoot);

  const counts = {};
  const bump = (k, n = 1) => { counts[k] = (counts[k] || 0) + n; };
  let activeSystems = 0;
  let totalLightsInPrefabs = 0;
  let expectedVisibleLayers = 0;
  const expectedEffectIds = new Set();

  for (const pf of prefabFiles) {
    expectedEffectIds.add(path.basename(pf, '.prefab').toLowerCase());
    const txt = fs.readFileSync(pf, 'utf8');
    const docs = txt.split(/^--- !u!/m).slice(1);
    const inactiveGo = new Set();
    for (const d of docs) {
      if (d.startsWith('1 ') && /^\s*m_IsActive:\s*0\b/m.test(d)) {
        const fid = d.match(/^1 &(\d+)/)?.[1];
        if (fid) inactiveGo.add(fid);
      } else if (d.startsWith('108 ') && /^\s*m_Enabled:\s*1\b/m.test(d)) {
        totalLightsInPrefabs++;
      }
    }

    const subRefs = new Set();
    for (const d of docs) {
      if (!d.startsWith('198 ')) continue;
      const subMod = extractSection(d, 'SubModule');
      if (/^\s*enabled:\s*1\b/m.test(subMod)) {
        for (const em of subMod.matchAll(/emitter:\s*\{fileID:\s*(\d+)\}/g)) {
          if (em[1] !== '0') subRefs.add(em[1]);
        }
      }
    }

    for (const d of docs) {
      if (d.startsWith('198 ')) {
        const psId = d.match(/^198 &(\d+)/)?.[1];
        const goId = d.match(/m_GameObject:\s*\{fileID:\s*(\d+)/)?.[1];
        if (inactiveGo.has(goId)) continue;
        activeSystems++;
        if (!subRefs.has(psId)) expectedVisibleLayers++;

        const init = extractSection(d, 'InitialModule');
        const em = extractSection(d, 'EmissionModule');
        const shape = extractSection(d, 'ShapeModule');
        const vel = extractSection(d, 'VelocityModule');
        const frc = extractSection(d, 'ForceModule');
        const sizeMod = extractSection(d, 'SizeModule');
        const colMod = extractSection(d, 'ColorModule');
        const rotMod = extractSection(d, 'RotationModule');
        const noiseMod = extractSection(d, 'NoiseModule');
        const uvMod = extractSection(d, 'UVModule');
        const trailMod = extractSection(d, 'TrailModule');
        const colSys = extractSection(d, 'CollisionModule');
        const subMod = extractSection(d, 'SubModule');
        const lightMod = extractSection(d, 'LightsModule');
        const extMod = extractSection(d, 'ExternalForcesModule');

        bump('lifecycle_basic');
        const rateT = readSubScalar(em, 'rateOverTime');
        const rateD = readSubScalar(em, 'rateOverDistance');
        if (rateT.scalar > 0 || rateT.minScalar > 0) bump('rate_over_time');
        if (rateD.scalar > 0 || rateD.minScalar > 0) bump('rate_over_distance');
        if (Number((em.match(/m_BurstCount:\s*(\d+)/) || [])[1] ?? 0) > 0) bump('bursts');
        const maxP = Number((init.match(/^\s*maxNumParticles:\s*(\d+)/m) || [])[1] ?? 1000);
        if (maxP > 0 && maxP < 1000) bump('max_particles');
        const life = readSubScalar(init, 'startLifetime');
        if (!Number.isFinite(life.scalar) || !Number.isFinite(life.minScalar)) bump('persistent_infinity');
        if (/^\s*simulationSpeed:\s*(?!1(?:\.0+)?\r?$)[-\d.]+/m.test(d)) bump('sim_speed');

        if (/^\s*enabled:\s*1\b/m.test(shape)) {
          const st = Number((shape.match(/\n\s*type:\s*(\d+)/) || [])[1] ?? 0);
          if (st === 6) bump('shape_mesh');
          else if ([17, 18, 19, 20].includes(st)) bump('shapes_approx');
          else bump('shapes_std');
          if (/m_Rotation:\s*\{x:\s*(?!0(?:\.0+)?,)/.test(shape) || st === 4 || st === 8 || st === 10 || st === 17) {
            bump('shape_rotation');
          }
        }
        if (/^\s*enabled:\s*1\b/m.test(vel)) {
          bump('vel_scalar_orbital');
          if (/minMaxState:\s*1\b/.test(vel)) bump('vel_curves');
        }
        if (/^\s*enabled:\s*1\b/m.test(frc) || Math.abs(readSubScalar(init, 'gravityModifier').scalar) > 0.001) {
          bump('force_and_gravity');
        }
        if (/^\s*enabled:\s*1\b/m.test(noiseMod)) bump('noise_turbulence');
        if (/^\s*moveWithTransform:\s*1\b/m.test(d)) bump('local_moving_space');

        if (/^\s*enabled:\s*1\b/m.test(colMod) || /^\s*enabled:\s*1\b/m.test(sizeMod)) bump('curves_lut');
        if (/^\s*enabled:\s*1\b/m.test(sizeMod) && /^\s*separateAxes:\s*1\b/m.test(sizeMod)) bump('size_separate_axes');
        if (/startColor:[\s\S]*?minMaxState:\s*2\b/.test(init)) bump('start_color_range');
        if (/^\s*enabled:\s*1\b/m.test(rotMod) || readSubScalar(init, 'startRotation').scalar !== 0) bump('rotation_spin');
        if (/^\s*rotation3D:\s*1\b/m.test(init)) bump('rotation_3d_quad');
        if (/^\s*size3D:\s*1\b/m.test(init)) bump('size3d_aspect');
        if (/^\s*enabled:\s*1\b/m.test(uvMod)) bump('uv_flipbook');

        if (/^\s*enabled:\s*1\b/m.test(trailMod)) bump('trail_module');
        if (/^\s*enabled:\s*1\b/m.test(subMod) && /emitter:\s*\{fileID:\s*(?!0\b)\d+/.test(subMod)) bump('sub_module');
        if (/^\s*enabled:\s*1\b/m.test(colSys)) bump('collision_module');
        if (/^\s*enabled:\s*1\b/m.test(lightMod) && /light:\s*\{fileID:\s*(?!0\b)\d+/.test(lightMod)) bump('lights_module');
        if (/^\s*enabled:\s*1\b/m.test(extMod)) bump('external_forces');
      } else if (d.startsWith('199 ')) {
        const goId = d.match(/m_GameObject:\s*\{fileID:\s*(\d+)/)?.[1];
        if (inactiveGo.has(goId)) continue;
        bump('render_modes');
        const matG = d.match(/m_Materials:[\s\S]*?guid:\s*([0-9a-f]{32})/)?.[1];
        const mp = matG ? guidMap.get(matG) : null;
        if (mp && fs.existsSync(mp)) {
          const mt = fs.readFileSync(mp, 'utf8');
          if (/_SOFTPARTICLES_ON/.test(mt)) bump('soft_particles');
          if (/distortion/i.test(path.basename(mp)) || /_DistortionEnabled:\s*1\b/.test(mt)) bump('distortion_shader');
          const baseM = mt.match(/- _(?:BaseColor|Color):\s*\{([^}]+)\}/)?.[1] || '';
          const rgbMax = Math.max(...[...(baseM.matchAll(/[rgb]:\s*([-\d.eE+]+)/g))].map((x) => Number(x[1])));
          if (rgbMax > 1.05 || /_Blend:\s*2\b|_DstBlend:\s*1\b/.test(mt)) bump('hdr_ldr_preserve');
        }
      }
    }
  }
  if (totalLightsInPrefabs > 0) bump('lights_module', Math.min(totalLightsInPrefabs, prefabFiles.length));

  // Score D1..D4 using actual occurrence-scaled weights
  const dimResults = {};
  const gaps = [];
  let totalScore = 0;

  for (const [dimKey, dim] of Object.entries(RUBRIC)) {
    let wSum = 0;
    let wGot = 0;
    const items = [];
    for (const [fKey, fSpec] of Object.entries(dim.features)) {
      const used = counts[fKey] || 0;
      const usageFrac = activeSystems > 0 ? Math.min(1, used / activeSystems) : 0;
      const effWeight = used === 0 ? 0 : fSpec.baseWeight * (0.35 + 0.65 * Math.sqrt(usageFrac));
      wSum += effWeight;
      wGot += effWeight * fSpec.parity;
      items.push({
        key: fKey,
        label: fSpec.label,
        usedCount: used,
        parity: fSpec.parity,
        weight: Number(effWeight.toFixed(2)),
      });
    }
    const pts = wSum > 0 ? (wGot / wSum) * dim.maxPoints : dim.maxPoints;
    totalScore += pts;
    dimResults[dimKey] = {
      label: dim.label,
      score: Number(pts.toFixed(2)),
      maxPoints: dim.maxPoints,
      items,
    };
    for (const it of items) {
      if (it.usedCount > 0 && it.parity < 1.0) {
        const lostPts = wSum > 0 ? (it.weight * (1 - it.parity) / wSum) * dim.maxPoints : 0;
        gaps.push({
          dimension: dimKey,
          feature: it.label,
          usedCount: it.usedCount,
          parity: it.parity,
          pointImpact: Number(lostPts.toFixed(2)),
        });
      }
    }
  }

  // Score D5 dynamically from converted outputs
  const assetMetrics = {
    prefabsExpected: expectedEffectIds.size,
    prefabsConverted: 0,
    validSchemas: 0,
    missingSprites: [],
    missingMeshes: [],
    d5Score: 0,
    d5Max: 15,
  };
  if (vfxDir && fs.existsSync(vfxDir)) {
    const regions = atlasRegionsPath && fs.existsSync(atlasRegionsPath)
      ? JSON.parse(fs.readFileSync(atlasRegionsPath, 'utf8'))
      : null;
    const meshSet = meshesDir && fs.existsSync(meshesDir)
      ? new Set(fs.readdirSync(meshesDir).filter((f) => f.endsWith('.glb')).map((f) => f.replace(/\.glb$/, '')))
      : null;
    const checkLayers = (ls, id) => {
      for (const l of ls) {
        if (regions) {
          if (l.sprite && !regions[l.sprite]) assetMetrics.missingSprites.push(`${id}:${l.sprite}`);
          if (l.flipbook?.region && !regions[l.flipbook.region]) assetMetrics.missingSprites.push(`${id}:${l.flipbook.region}`);
          if (l.trail?.sprite && !regions[l.trail.sprite]) assetMetrics.missingSprites.push(`${id}:${l.trail.sprite}`);
        }
        if (meshSet && l.kind === 'mesh' && l.mesh && !meshSet.has(l.mesh)) {
          assetMetrics.missingMeshes.push(`${id}:${l.mesh}`);
        }
        if (Array.isArray(l.subEmitters)) {
          for (const s of l.subEmitters) checkLayers(s.effect?.layers || [], id);
        }
      }
    };
    for (const id of expectedEffectIds) {
      const jp = path.join(vfxDir, `${id}.vfx.json`);
      if (!fs.existsSync(jp)) continue;
      assetMetrics.prefabsConverted++;
      const recipe = JSON.parse(fs.readFileSync(jp, 'utf8'));
      if (validateVfxRecipe(recipe).ok) assetMetrics.validSchemas++;
      checkLayers(recipe.layers || [], id);
    }
    const convFrac = expectedEffectIds.size > 0 ? assetMetrics.prefabsConverted / expectedEffectIds.size : 0;
    const schemaFrac = assetMetrics.prefabsConverted > 0 ? assetMetrics.validSchemas / assetMetrics.prefabsConverted : 0;
    const spriteScore = regions ? (assetMetrics.missingSprites.length === 0 ? 3.5 : Math.max(0, 3.5 - assetMetrics.missingSprites.length * 0.5)) : 3.5;
    const meshScore = meshSet ? (assetMetrics.missingMeshes.length === 0 ? 3.5 : Math.max(0, 3.5 - assetMetrics.missingMeshes.length * 0.5)) : 3.5;
    assetMetrics.d5Score = Number((convFrac * 4 + schemaFrac * 4 + spriteScore + meshScore).toFixed(2));
  } else {
    assetMetrics.d5Score = 15;
  }

  totalScore += assetMetrics.d5Score;
  gaps.sort((a, b) => b.pointImpact - a.pointImpact);

  const finalScore = Number(totalScore.toFixed(1));
  const grade = finalScore >= 92 ? 'S' : finalScore >= 85 ? 'A' : finalScore >= 75 ? 'B' : 'C';

  return {
    summary: {
      totalScore: finalScore,
      maxScore: 100,
      grade,
      prefabsAudited: prefabFiles.length,
      activeParticleSystems: activeSystems,
      expectedRootLayers: expectedVisibleLayers,
    },
    dimensions: {
      ...dimResults,
      D5_Asset_Integrity: {
        label: '资产转换与管线完整性 (Asset & Schema Integrity)',
        score: assetMetrics.d5Score,
        maxPoints: assetMetrics.d5Max,
        metrics: assetMetrics,
      },
    },
    topGaps: gaps.slice(0, 10),
  };
}

function parseCliArgs(argv) {
  const opts = {
    unityRoot: '',
    vfxDir: '',
    atlasRegionsPath: '',
    meshesDir: '',
    subfolders: null,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--unity-root' || a === '-r') opts.unityRoot = argv[++i] ?? '';
    else if (a === '--vfx-dir') opts.vfxDir = argv[++i] ?? '';
    else if (a === '--atlas-regions') opts.atlasRegionsPath = argv[++i] ?? '';
    else if (a === '--meshes-dir') opts.meshesDir = argv[++i] ?? '';
    else if (a === '--subfolders') opts.subfolders = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--all-subfolders') opts.subfolders = [];
    else if (a === '--json') opts.json = true;
    else if (a === '--help' || a === '-h') opts.help = true;
  }
  return opts;
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('score-vfx-fidelity.mjs')) {
  const cli = parseCliArgs(process.argv.slice(2));
  if (cli.help || !cli.unityRoot) {
    console.log('Usage: node scripts/score-vfx-fidelity.mjs --unity-root <AssetsDir> [--vfx-dir <dir>] [--atlas-regions <atlas_regions.json>] [--meshes-dir <meshesDir>] [--subfolders <a,b>] [--all-subfolders] [--json]');
    process.exit(cli.help ? 0 : 1);
  }
  const report = evaluateVfxFidelity({
    unityRoot: path.resolve(cli.unityRoot),
    vfxDir: cli.vfxDir ? path.resolve(cli.vfxDir) : '',
    atlasRegionsPath: cli.atlasRegionsPath ? path.resolve(cli.atlasRegionsPath) : '',
    meshesDir: cli.meshesDir ? path.resolve(cli.meshesDir) : '',
    ...(cli.subfolders !== null ? { subfolders: cli.subfolders } : {}),
  });
  if (cli.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    const s = report.summary;
    console.log(`\n=== HGame Unity VFX Fidelity Scorecard ===`);
    console.log(`Total Score: ${s.totalScore} / ${s.maxScore}  [Grade ${s.grade}]`);
    console.log(`Audited: ${s.prefabsAudited} prefabs, ${s.activeParticleSystems} active ParticleSystems\n`);
    for (const [k, d] of Object.entries(report.dimensions)) {
      console.log(`- ${d.label}: ${d.score} / ${d.maxPoints}`);
    }
    console.log('\nTop Fidelity Gaps (ordered by score impact):');
    for (const g of report.topGaps) {
      console.log(`  [-${g.pointImpact.toFixed(2)} pts] ${g.feature} (parity=${Math.round(g.parity * 100)}%, used in ${g.usedCount} systems)`);
    }
    console.log('');
  }
}
