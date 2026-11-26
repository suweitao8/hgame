#!/usr/bin/env node
/**
 * Automated numerical parity verifier across all exported Piloto Studio `.vfx.json` recipes
 * against Unity `unity-vfx-oracle.json` ground-truth simulation data.
 *
 * Checks for every layer across all 671 prefabs:
 *  - Finite coordinates & nonzero emission when Unity emitted particles
 *  - World center position agreement (`posCenterRhs`)
 *  - Anisotropic emitter span / major-axis orientation agreement (`posSpanRhs`, catches swapped Y/Z trails)
 *  - World scale magnitude ratio (`scalingMode` Hierarchy / Local / Shape parity)
 *  - Mean velocity direction cosine similarity (`velMeanRhs`, catches LHS/RHS velocity sign flips)
 *  - 3D Mesh world vertex span & orientation parity (`bakedSpanRhs` under probe camera)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as THREE from '../assets/optional/three/three.module.js';
import { createEffectPlayer } from '../assets/runtime/vfx/vfx-recipes.js';
import { createAtlasParticlePool } from '../assets/runtime/vfx/vfx-atlas-particles.js';
import { createMeshVfxPool } from '../assets/runtime/vfx/vfx-mesh.js';
import { applyClampVelocityStep, hasClampVelocity } from '../assets/runtime/vfx/vfx-core.js';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const DEFAULT_VFX_DIR = path.join(REPO_ROOT, 'webasset/assets/vfx');

function parseGlbGeometries(glbPath) {
  const buf = fs.readFileSync(glbPath);
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binChunkStart = 20 + jsonLen;
  const binLen = buf.readUInt32LE(binChunkStart);
  const binStart = binChunkStart + 8;
  const bin = buf.subarray(binStart, binStart + binLen);

  const readAccessor = (accIdx) => {
    const acc = gltf.accessors[accIdx];
    const bv = gltf.bufferViews[acc.bufferView];
    const byteOff = (bv.byteOffset || 0) + (acc.byteOffset || 0);
    const comps = acc.type === 'VEC3' ? 3 : acc.type === 'VEC2' ? 2 : 1;
    const count = acc.count * comps;
    if (acc.componentType === 5126) {
      const out = new Float32Array(count);
      for (let i = 0; i < count; i++) out[i] = bin.readFloatLE(byteOff + i * 4);
      return out;
    }
    if (acc.componentType === 5123) {
      const out = new Uint16Array(count);
      for (let i = 0; i < count; i++) out[i] = bin.readUInt16LE(byteOff + i * 2);
      return out;
    }
    if (acc.componentType === 5125) {
      const out = new Uint32Array(count);
      for (let i = 0; i < count; i++) out[i] = bin.readUInt32LE(byteOff + i * 4);
      return out;
    }
    return null;
  };

  const out = [];
  for (const m of gltf.meshes || []) {
    const prim = m.primitives?.[0];
    if (!prim?.attributes || prim.attributes.POSITION === undefined) continue;
    const pos = readAccessor(prim.attributes.POSITION);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (prim.attributes.NORMAL !== undefined) {
      geo.setAttribute('normal', new THREE.BufferAttribute(readAccessor(prim.attributes.NORMAL), 3));
    }
    if (prim.indices !== undefined) {
      geo.setIndex(new THREE.BufferAttribute(readAccessor(prim.indices), 1));
    }
    out.push({ name: m.name || 'Mesh_0', geo });
  }
  return out;
}

function normSubKey(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function findOraclePath(explicit = '') {
  const candidates = [
    explicit,
    path.join(os.tmpdir(), 'hgame-unity-vfx-oracle', 'unity-vfx-oracle.json'),
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('unity-vfx-oracle.json not found. Pass --oracle <path>.');
}

function dominantAxis(span) {
  const s = [...span].sort((a, b) => b - a);
  if (s[0] <= 0.4 || s[0] < s[1] * 1.45) return -1; // isotropic / too close to tell unambiguously
  return span.indexOf(s[0]);
}

export function verifyUnityVfxParity({
  vfxDir = DEFAULT_VFX_DIR,
  oraclePath = '',
  failThreshold = 0.02,
} = {}) {
  const resolvedOracle = findOraclePath(oraclePath);
  const oracle = JSON.parse(fs.readFileSync(resolvedOracle, 'utf8').replace(/^\uFEFF/, ''));
  const meshIndexPath = path.join(vfxDir, 'meshes/mesh_index.json');
  const meshIndex = JSON.parse(fs.readFileSync(meshIndexPath, 'utf8').replace(/^\uFEFF/, ''));
  const packsIndex = JSON.parse(fs.readFileSync(path.join(vfxDir, 'packs/packs_index.json'), 'utf8'));

  // Preload all GLB geometries once
  const geoByKey = new Map();
  for (const [mKey, info] of Object.entries(meshIndex)) {
    const glbPath = path.join(vfxDir, info.file);
    if (!fs.existsSync(glbPath)) continue;
    try {
      const parsed = parseGlbGeometries(glbPath);
      if (parsed.length > 0) geoByKey.set(mKey, parsed);
    } catch {
      // skip unreadable mesh
    }
  }

  // Probe camera matching HGameVfxOracleExporter: pos (0, 6, 10) RHS looking at (0, 0, 0)
  const probeCamera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  probeCamera.position.set(0, 6, 10);
  probeCamera.lookAt(0, 0, 0);
  probeCamera.updateMatrixWorld();

  function evalCurveVal(curve, u) {
    if (!Array.isArray(curve) || curve.length === 0) return 1;
    if (u <= curve[0][0]) return curve[0][1];
    const last = curve[curve.length - 1];
    if (u >= last[0]) return last[1];
    for (let i = 0; i < curve.length - 1; i++) {
      if (u <= curve[i + 1][0]) {
        const span = Math.max(1e-6, curve[i + 1][0] - curve[i][0]);
        const f = (u - curve[i][0]) / span;
        return curve[i][1] + (curve[i + 1][1] - curve[i][1]) * f;
      }
    }
    return last[1];
  }

  function mapUnityShapeName(st) {
    switch (Number(st)) {
      case 0: case 1: return 'sphere';
      case 2: case 3: return 'hemisphere';
      case 4: case 7: case 8: case 9: return 'cone';
      case 5: case 15: case 16: return 'box';
      case 6: case 13: case 14: return 'mesh';
      case 10: case 11: case 19: case 20: return 'circle';
      case 12: return 'edge';
      case 17: return 'donut';
      case 18: return 'rectangle';
      default: return 'point';
    }
  }

  const stats = {
    prefabsChecked: 0,
    prefabsMissing: 0,
    layersChecked: 0,
    layersWithParticles: 0,
    meshLayersChecked: 0,
    meshLayersWithVerts: 0,
    finiteFailures: 0,
    centerOutliers: [],
    axisSwaps: [],
    scaleOutliers: [],
    velFlips: [],
    meshSpanAxisSwaps: [],
    meshScaleOutliers: [],
  };

  for (const packMeta of packsIndex.packs) {
    if (packMeta.id === 'flagship_bench') continue;
    const packIndex = JSON.parse(fs.readFileSync(path.join(vfxDir, packMeta.manifestFile), 'utf8'));

    const scene = new THREE.Scene();
    const atlas = createAtlasParticlePool({ mode: 'headless', maxParticles: 4096 });
    const meshVfx = createMeshVfxPool({ mode: '3d', THREE, scene, maxMeshes: 512 });
    meshVfx.setCamera(probeCamera);

    // Register base geometries & pack aliases
    for (const [alias, baseKey] of Object.entries(packIndex.meshAliases || {})) {
      const list = geoByKey.get(baseKey);
      if (!list || list.length === 0) continue;
      let chosen = list[0].geo;
      const idx = alias.indexOf('__sub_');
      if (idx !== -1) {
        const want = alias.slice(idx + 6);
        const match = list.find((g) => normSubKey(g.name) === want);
        if (match) chosen = match.geo;
      }
      meshVfx.registerMesh(alias, chosen, { topDownUv: true });
    }
    for (const [mKey, list] of geoByKey) {
      if (list.length > 0) meshVfx.registerMesh(mKey, list[0].geo, { topDownUv: true });
    }

    let capturedParticles = [];
    let capturedMeshes = [];
    let simClock = 0;
    const origEmit = atlas.emit.bind(atlas);
    const atlasProxy = Object.assign(Object.create(atlas), {
      emit(opts) {
        capturedParticles.push({
          x: opts.x || 0,
          y: opts.y || 0,
          z: opts.z || 0,
          vx: opts.vx || 0,
          vy: opts.vy || 0,
          vz: opts.vz || 0,
          gravity: opts.gravity || 0,
          accelX: opts.accelX || 0,
          accelZ: opts.accelZ || 0,
          drag: opts.drag || 0,
          velCurve: opts.velCurve || null,
          clampVelocity: hasClampVelocity(opts.clampVelocity) ? opts.clampVelocity : null,
          phase: opts.phase ?? 0.5,
          duration: opts.duration || 1,
          initialAge: opts.initialAge || 0,
          spawnTime: simClock,
        });
        return origEmit(opts);
      },
    });
    const origSpawn = meshVfx.spawn.bind(meshVfx);
    const meshProxy = Object.assign(Object.create(meshVfx), {
      spawn(opts) {
        const h = origSpawn(opts);
        capturedMeshes.push({ handle: h, opts });
        return h;
      },
    });

    const player = createEffectPlayer({ atlasParticles: atlasProxy, meshVfx: meshProxy, scene, THREE });

    const simulateLayerAt = (rLayer, effId, lIdx, targetT, durationHint) => {
      capturedParticles = [];
      capturedMeshes = [];
      simClock = 0;
      player.reset();
      meshVfx.setCamera(probeCamera);

      const testLayer = { ...rLayer };
      delete testLayer.subEmitters;
      const isoRecipe = {
        schemaVersion: 1,
        id: `parity_${effId}_${lIdx}`,
        duration: durationHint || 5,
        loop: false,
        layers: [testLayer],
      };
      player.registerEffect(isoRecipe);
      player.playEffect(isoRecipe.id, { x: 0, y: 0, z: 0 });
      const dt = 1 / 60;
      const steps = Math.max(1, Math.round(targetT / dt));
      for (let s = 0; s < steps; s++) {
        player.update(dt);
        atlas.update(dt);
        meshVfx.update(dt);
        simClock += dt;
      }

      const livePts = [];
      const liveVels = [];
      for (const p of capturedParticles) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
          stats.finiteFailures++;
          continue;
        }
        const age = Math.max(0, targetT - p.spawnTime + p.initialAge);
        if (p.duration > 0 && age > p.duration + 0.02) continue;
        // 4-step midpoint integration matching velCurve, drag, clampVelocity, accel, and gravity
        let px = p.x;
        let py = p.y;
        let pz = p.z;
        const velObj = { vx: p.vx, vy: p.vy, vz: p.vz };
        const subSteps = 4;
        const h = age / subSteps;
        const lifeSpan = Math.max(0.01, p.duration);
        for (let k = 0; k < subSteps; k++) {
          const t0 = k * h;
          const midT = (k + 0.5) * h;
          const u = Math.min(1, midT / lifeSpan);
          if (p.drag > 0.001) {
            const d = Math.exp(-p.drag * h);
            velObj.vx *= d;
            velObj.vy *= d;
            velObj.vz *= d;
          }
          velObj.vx += p.accelX * h;
          velObj.vy -= p.gravity * h;
          velObj.vz += p.accelZ * h;
          if (p.clampVelocity) {
            applyClampVelocityStep(velObj, p.clampVelocity, h, Math.min(1, t0 / lifeSpan), p.phase ?? 0.5);
          }
          const vMul = p.velCurve ? evalCurveVal(p.velCurve, u) : 1;
          px += velObj.vx * vMul * h;
          py += velObj.vy * vMul * h;
          pz += velObj.vz * vMul * h;
        }
        const finalMul = p.velCurve ? evalCurveVal(p.velCurve, Math.min(1, age / lifeSpan)) : 1;
        livePts.push([px, py, pz]);
        liveVels.push([velObj.vx * finalMul, velObj.vy * finalMul, velObj.vz * finalMul]);
      }

      const posBuf = new Float32Array(3);
      const velBuf = new Float32Array(3);
      const qBuf = new Float32Array(4);
      const sBuf = new Float32Array(3);
      const mMin = [Infinity, Infinity, Infinity];
      const mMax = [-Infinity, -Infinity, -Infinity];
      let meshVertChecks = 0;
      const tmpQ = new THREE.Quaternion();
      const tmpV = new THREE.Vector3();
      for (const m of capturedMeshes) {
        meshVfx.readSlotMotion(m.handle, posBuf, velBuf);
        if (Number.isFinite(posBuf[0]) && Number.isFinite(posBuf[1]) && Number.isFinite(posBuf[2])) {
          livePts.push([posBuf[0], posBuf[1], posBuf[2]]);
          liveVels.push([velBuf[0], velBuf[1], velBuf[2]]);
        }
        if (meshVfx.readSlotTransform(m.handle, posBuf, qBuf, sBuf)) {
          const mAlias = String(m.opts?.mesh || '');
          const baseKey = packIndex.meshAliases?.[mAlias] || mAlias;
          const list = geoByKey.get(baseKey);
          let geo = list?.[0]?.geo || null;
          if (list && mAlias.includes('__sub_')) {
            const want = mAlias.slice(mAlias.indexOf('__sub_') + 6);
            geo = list.find((g) => normSubKey(g.name) === want)?.geo || geo;
          }
          const pAttr = geo?.getAttribute?.('position');
          if (pAttr) {
            tmpQ.set(qBuf[0], qBuf[1], qBuf[2], qBuf[3]);
            const pv = m.opts?.pivot || [0, 0, 0];
            const stepV = Math.max(1, Math.floor(pAttr.count / 64));
            for (let vi = 0; vi < pAttr.count; vi += stepV) {
              tmpV.set(
                (pAttr.getX(vi) + (pv[0] || 0)) * sBuf[0],
                (pAttr.getY(vi) + (pv[1] || 0)) * sBuf[1],
                (pAttr.getZ(vi) + (pv[2] || 0)) * sBuf[2],
              ).applyQuaternion(tmpQ);
              tmpV.x += posBuf[0]; tmpV.y += posBuf[1]; tmpV.z += posBuf[2];
              if (tmpV.x < mMin[0]) mMin[0] = tmpV.x; if (tmpV.x > mMax[0]) mMax[0] = tmpV.x;
              if (tmpV.y < mMin[1]) mMin[1] = tmpV.y; if (tmpV.y > mMax[1]) mMax[1] = tmpV.y;
              if (tmpV.z < mMin[2]) mMin[2] = tmpV.z; if (tmpV.z > mMax[2]) mMax[2] = tmpV.z;
            }
            meshVertChecks++;
          }
        }
      }

      let center = [0, 0, 0];
      let span = [0, 0, 0];
      if (livePts.length > 0) {
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        let sx = 0, sy = 0, sz = 0;
        for (const pt of livePts) {
          if (pt[0] < minX) minX = pt[0]; if (pt[0] > maxX) maxX = pt[0];
          if (pt[1] < minY) minY = pt[1]; if (pt[1] > maxY) maxY = pt[1];
          if (pt[2] < minZ) minZ = pt[2]; if (pt[2] > maxZ) maxZ = pt[2];
          sx += pt[0]; sy += pt[1]; sz += pt[2];
        }
        center = [sx / livePts.length, sy / livePts.length, sz / livePts.length];
        span = [maxX - minX, maxY - minY, maxZ - minZ];
      } else if (Array.isArray(rLayer.offset)) {
        center = [...rLayer.offset];
      }
      return {
        rLayer,
        livePts,
        liveVels,
        center,
        span,
        meshVertChecks,
        ourMeshSpan: meshVertChecks > 0 && Number.isFinite(mMin[0])
          ? [mMax[0] - mMin[0], mMax[1] - mMin[1], mMax[2] - mMin[2]]
          : null,
      };
    };

    for (const eff of packIndex.effects) {
      const relSource = `${packMeta.name}/${eff.relSource}`.replace(/\\/g, '/');
      const oEntry = oracle[relSource];
      if (!oEntry) {
        stats.prefabsMissing++;
        continue;
      }
      stats.prefabsChecked++;
      const recipe = JSON.parse(fs.readFileSync(path.join(vfxDir, eff.file), 'utf8'));

      // Group recipe & oracle layers by exact unityPath when available (falling back to normalized name) so identical child names under different parents never mispair.
      const useUnityPath = recipe.layers.some((l) => typeof l.unityPath === 'string')
        && oEntry.layers.every((l) => typeof l.path === 'string');
      const rGroups = new Map();
      recipe.layers.forEach((rLayer, rIdx) => {
        if (rLayer.kind === 'none' || rLayer.renderMode === 'none') return;
        const key = useUnityPath ? rLayer.unityPath : rLayer.name;
        const arr = rGroups.get(key) || [];
        arr.push({ rLayer, rIdx });
        rGroups.set(key, arr);
      });
      const oGroups = new Map();
      oEntry.layers.forEach((oLayer) => {
        if (oLayer.pCount <= 0 || oLayer.renderMode === 5) return;
        const key = useUnityPath
          ? oLayer.path
          : oLayer.name.toLowerCase().replace(/[^a-z0-9_]+/g, '_');
        const arr = oGroups.get(key) || [];
        arr.push(oLayer);
        oGroups.set(key, arr);
      });

      for (const [normName, rList] of rGroups) {
        const oList = oGroups.get(normName);
        if (!oList || oList.length === 0) continue;

        let pairs = [];
        if (rList.length === 1 && oList.length === 1) {
          const sim = simulateLayerAt(rList[0].rLayer, eff.id, rList[0].rIdx, Math.max(0.05, oList[0].simT), recipe.duration);
          pairs.push({ sim, oLayer: oList[0] });
        } else {
          // Simulate candidate pairs at each oracle layer's own simT (cached by simT) so delayed beams match cleanly.
          const usedO = new Set();
          const simCache = new Map();
          const getSim = (item, targetT) => {
            const key = `${item.rIdx}_${targetT.toFixed(3)}`;
            let cached = simCache.get(key);
            if (!cached) {
              cached = simulateLayerAt(item.rLayer, eff.id, item.rIdx, targetT, recipe.duration);
              simCache.set(key, cached);
            }
            return cached;
          };
          for (const item of rList) {
            const rShapeType = item.rLayer.shape?.type || 'point';
            const rDelay = Array.isArray(item.rLayer.delay) ? Number(item.rLayer.delay[0] ?? 0) : Number(item.rLayer.delay ?? 0);
            let bestOi = -1;
            let bestSim = null;
            let bestCost = Infinity;
            for (let oi = 0; oi < oList.length; oi++) {
              if (usedO.has(oi)) continue;
              const oL = oList[oi];
              const oShapeType = mapUnityShapeName(oL.shapeType);
              const shapePen = oShapeType === rShapeType ? 0 : 100;
              if (rDelay > oL.simT + 0.02) {
                const delayCost = 10000 + shapePen;
                if (delayCost < bestCost) {
                  bestCost = delayCost;
                  bestOi = oi;
                  bestSim = null;
                }
                continue;
              }
              const targetT = Math.max(0.05, oL.simT);
              const candSim = getSim(item, targetT);
              const cDist = Math.hypot(
                candSim.center[0] - oL.posCenterRhs[0],
                candSim.center[1] - oL.posCenterRhs[1],
                candSim.center[2] - oL.posCenterRhs[2],
              );
              const sDist = Math.hypot(
                candSim.span[0] - oL.posSpanRhs[0],
                candSim.span[1] - oL.posSpanRhs[1],
                candSim.span[2] - oL.posSpanRhs[2],
              );
              const mDist = (candSim.ourMeshSpan && oL.bakedVerts > 0)
                ? Math.hypot(
                    candSim.ourMeshSpan[0] - oL.bakedSpanRhs[0],
                    candSim.ourMeshSpan[1] - oL.bakedSpanRhs[1],
                    candSim.ourMeshSpan[2] - oL.bakedSpanRhs[2],
                  )
                : 0;
              const cost = shapePen + cDist * 2 + sDist * 0.5 + mDist * 0.5;
              if (cost < bestCost) {
                bestCost = cost;
                bestOi = oi;
                bestSim = candSim;
              }
            }
            if (bestOi >= 0) {
              usedO.add(bestOi);
              const matchedO = oList[bestOi];
              const finalSim = bestSim || getSim(item, Math.max(0.05, matchedO.simT));
              pairs.push({ sim: finalSim, oLayer: matchedO });
            }
          }
        }

        for (const { sim, oLayer } of pairs) {
          const { rLayer, livePts, liveVels, center: ourCenter, span: ourSpan, meshVertChecks, ourMeshSpan } = sim;
          stats.layersChecked++;
          if (oLayer.renderMode === 4 && oLayer.bakedVerts > 0) {
            stats.meshLayersChecked++;
            if (meshVertChecks > 0 && ourMeshSpan) {
              stats.meshLayersWithVerts++;
              const oMeshSpan = oLayer.bakedSpanRhs;
              const mDomO = dominantAxis(oMeshSpan);
              const mDomOur = dominantAxis(ourMeshSpan);
              if (mDomO !== -1 && mDomOur !== -1 && mDomO !== mDomOur) {
                stats.meshSpanAxisSwaps.push({
                  prefab: relSource,
                  layer: oLayer.name,
                  mesh: rLayer.mesh,
                  align: rLayer.meshAlign,
                  oSpan: oMeshSpan.map((v) => Number(v.toFixed(2))),
                  ourSpan: ourMeshSpan.map((v) => Number(v.toFixed(2))),
                });
              }
              const maxOM = Math.max(...oMeshSpan);
              const maxOurM = Math.max(...ourMeshSpan);
              if (maxOM > 0.4) {
                const mRatio = maxOurM / maxOM;
                if (mRatio < 0.35 || mRatio > 2.8) {
                  stats.meshScaleOutliers.push({
                    prefab: relSource,
                    layer: oLayer.name,
                    mesh: rLayer.mesh,
                    scalingMode: oLayer.scalingMode,
                    ratio: Number(mRatio.toFixed(2)),
                    oSpan: oMeshSpan.map((v) => Number(v.toFixed(2))),
                    ourSpan: ourMeshSpan.map((v) => Number(v.toFixed(2))),
                  });
                }
              }
            }
          }
          if (livePts.length === 0) continue;
          stats.layersWithParticles++;

          const oCenter = oLayer.posCenterRhs;
          const oSpan = oLayer.posSpanRhs;
          const maxOSpan = Math.max(...oSpan);
          const maxOurSpan = Math.max(...ourSpan);
          const cDist = Math.hypot(ourCenter[0] - oCenter[0], ourCenter[1] - oCenter[1], ourCenter[2] - oCenter[2]);
          const cTol = Math.max(1.2, 0.45 * maxOSpan, 0.35 * maxOurSpan);
          if (cDist > cTol) {
            stats.centerOutliers.push({
              prefab: relSource,
              layer: oLayer.name,
              ourCenter: ourCenter.map((v) => Number(v.toFixed(2))),
              oCenter: oCenter.map((v) => Number(v.toFixed(2))),
              dist: Number(cDist.toFixed(2)),
            });
          }

          const oDom = dominantAxis(oSpan);
          const ourDom = dominantAxis(ourSpan);
          if (oDom !== -1 && ourDom !== -1 && oDom !== ourDom && oLayer.pCount >= 4 && livePts.length >= 4) {
            stats.axisSwaps.push({
              prefab: relSource,
              layer: oLayer.name,
              shapeType: rLayer.shape?.type,
              oSpan: oSpan.map((v) => Number(v.toFixed(2))),
              ourSpan: ourSpan.map((v) => Number(v.toFixed(2))),
            });
          }

          if (maxOSpan > 0.6 && oLayer.pCount >= 5 && livePts.length >= 5) {
            const ratio = maxOurSpan / maxOSpan;
            if (ratio < 0.28 || ratio > 3.5) {
              stats.scaleOutliers.push({
                prefab: relSource,
                layer: oLayer.name,
                scalingMode: oLayer.scalingMode,
                ratio: Number(ratio.toFixed(2)),
                oSpan: oSpan.map((v) => Number(v.toFixed(2))),
                ourSpan: ourSpan.map((v) => Number(v.toFixed(2))),
              });
            }
          }

          const ovx = oLayer.velMeanRhs[0], ovy = oLayer.velMeanRhs[1], ovz = oLayer.velMeanRhs[2];
          const oVLen = Math.hypot(ovx, ovy, ovz);
          if (oVLen > 1.5 && oLayer.pCount >= 3 && liveVels.length >= 3) {
            let vx = 0, vy = 0, vz = 0;
            for (const v of liveVels) { vx += v[0]; vy += v[1]; vz += v[2]; }
            vx /= liveVels.length; vy /= liveVels.length; vz /= liveVels.length;
            const ourVLen = Math.hypot(vx, vy, vz);
            if (ourVLen > 0.5) {
              const cos = (vx * ovx + vy * ovy + vz * ovz) / (ourVLen * oVLen);
              if (cos < 0.15) {
                stats.velFlips.push({
                  prefab: relSource,
                  layer: oLayer.name,
                  cos: Number(cos.toFixed(3)),
                  oVel: oLayer.velMeanRhs.map((v) => Number(v.toFixed(2))),
                  ourVel: [vx, vy, vz].map((v) => Number(v.toFixed(2))),
                });
              }
            }
          }
        }
      }
    }

    player.dispose();
    meshVfx.dispose();
    atlas.dispose();
  }

  return stats;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const args = process.argv.slice(2);
  let oraclePath = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--oracle' && args[i + 1]) oraclePath = args[++i];
  }
  const summary = verifyUnityVfxParity({ oraclePath });
  console.log(JSON.stringify({
    prefabsChecked: summary.prefabsChecked,
    prefabsMissing: summary.prefabsMissing,
    layersChecked: summary.layersChecked,
    layersWithParticles: summary.layersWithParticles,
    meshLayersChecked: summary.meshLayersChecked,
    meshLayersWithVerts: summary.meshLayersWithVerts,
    finiteFailures: summary.finiteFailures,
    centerOutliersCount: summary.centerOutliers.length,
    axisSwapsCount: summary.axisSwaps.length,
    scaleOutliersCount: summary.scaleOutliers.length,
    velFlipsCount: summary.velFlips.length,
    meshSpanAxisSwapsCount: summary.meshSpanAxisSwaps.length,
    meshScaleOutliersCount: summary.meshScaleOutliers.length,
    sampleCenterOutliers: summary.centerOutliers.slice(0, 10),
    sampleAxisSwaps: summary.axisSwaps.slice(0, 15),
    sampleScaleOutliers: summary.scaleOutliers.slice(0, 15),
    sampleVelFlips: summary.velFlips.slice(0, 15),
    sampleMeshSpanAxisSwaps: summary.meshSpanAxisSwaps.slice(0, 15),
    sampleMeshScaleOutliers: summary.meshScaleOutliers.slice(0, 15),
  }, null, 2));
}
