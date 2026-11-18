// Clean-room pixel-perfect & grid-memory Fog of War simulation kernel.
// Supports 2D (XY) and 3D (XZ) planes, analytical corner-ray LOS occlusion,
// vision cones, exploration memory/regrow, hider tracking, and zero-GC updates.

export const FOG_FADE_TYPE = Object.freeze({
  LINEAR: 'linear',
  SMOOTH: 'smooth',
  SMOOTHER: 'smoother',
  SMOOTHSTEP: 'smoothstep',
  EXPONENTIAL: 'exponential',
});

export const FOG_QUALITY = Object.freeze({
  LOW: 48,
  MEDIUM: 96,
  HIGH: 180,
  ULTRA: 360,
});

const DEG_TO_RAD = Math.PI / 180;
const TWO_PI = Math.PI * 2;

function clamp01(v) {
  return v <= 0 ? 0 : v >= 1 ? 1 : v;
}

function wrapAngle(rad) {
  let a = rad;
  while (a > Math.PI) a -= TWO_PI;
  while (a < -Math.PI) a += TWO_PI;
  return a;
}

function applyFadeCurve(t, fadeType, fadePower) {
  const u = clamp01(t);
  switch (fadeType) {
    case FOG_FADE_TYPE.LINEAR:
      return u;
    case FOG_FADE_TYPE.SMOOTH:
      return Math.sin(u * Math.PI * 0.5);
    case FOG_FADE_TYPE.SMOOTHER:
      return 0.5 - Math.cos(u * Math.PI) * 0.5;
    case FOG_FADE_TYPE.EXPONENTIAL:
      return u ** Math.max(0.05, fadePower);
    case FOG_FADE_TYPE.SMOOTHSTEP:
    default:
      return u * u * (3 - 2 * u);
  }
}

function normalizeObstacle(raw, fallbackId) {
  const id = raw.id ?? fallbackId;
  if (raw.radius !== undefined && raw.radius > 0) {
    const x = raw.x ?? 0;
    const y = raw.y ?? raw.z ?? 0;
    const r = raw.radius;
    return {
      id,
      kind: 'circle',
      x,
      y,
      radius: r,
      minX: x - r,
      minY: y - r,
      maxX: x + r,
      maxY: y + r,
      segments: null,
      verticesX: null,
      verticesY: null,
    };
  }

  if (Array.isArray(raw.points) && raw.points.length >= 2) {
    const pts = raw.points;
    const vx = new Float32Array(pts.length);
    const vy = new Float32Array(pts.length);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const px = pts[i].x ?? pts[i][0] ?? 0;
      const py = pts[i].y ?? pts[i].z ?? pts[i][1] ?? 0;
      vx[i] = px;
      vy[i] = py;
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }
    const closed = raw.closed !== false && pts.length >= 3;
    const segCount = closed ? pts.length : pts.length - 1;
    const segments = new Float32Array(segCount * 4);
    for (let i = 0; i < segCount; i++) {
      const j = (i + 1) % pts.length;
      segments[i * 4] = vx[i];
      segments[i * 4 + 1] = vy[i];
      segments[i * 4 + 2] = vx[j];
      segments[i * 4 + 3] = vy[j];
    }
    return {
      id,
      kind: 'polygon',
      minX,
      minY,
      maxX,
      maxY,
      segments,
      segmentCount: segCount,
      verticesX: vx,
      verticesY: vy,
      vertexCount: pts.length,
    };
  }

  // Box obstacle: either { minX, minY, maxX, maxY } or { x, y, width, height, rotation }
  let cx;
  let cy;
  let hw;
  let hh;
  if (raw.minX !== undefined && raw.maxX !== undefined) {
    cx = (raw.minX + raw.maxX) * 0.5;
    cy = ((raw.minY ?? raw.minZ ?? 0) + (raw.maxY ?? raw.maxZ ?? 0)) * 0.5;
    hw = Math.max(0.001, (raw.maxX - raw.minX) * 0.5);
    hh = Math.max(0.001, ((raw.maxY ?? raw.maxZ ?? 0) - (raw.minY ?? raw.minZ ?? 0)) * 0.5);
  } else {
    cx = raw.x ?? 0;
    cy = raw.y ?? raw.z ?? 0;
    hw = Math.max(0.001, (raw.width ?? 1) * 0.5);
    hh = Math.max(0.001, (raw.height ?? raw.depth ?? 1) * 0.5);
  }
  const rot = raw.rotation ?? raw.yaw ?? 0;
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);
  const lx = [-hw, hw, hw, -hw];
  const ly = [-hh, -hh, hh, hh];
  const vx = new Float32Array(4);
  const vy = new Float32Array(4);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < 4; i++) {
    const px = cx + lx[i] * cosR - ly[i] * sinR;
    const py = cy + lx[i] * sinR + ly[i] * cosR;
    vx[i] = px;
    vy[i] = py;
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }
  const segments = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    segments[i * 4] = vx[i];
    segments[i * 4 + 1] = vy[i];
    segments[i * 4 + 2] = vx[j];
    segments[i * 4 + 3] = vy[j];
  }
  return {
    id,
    kind: 'polygon',
    minX,
    minY,
    maxX,
    maxY,
    segments,
    segmentCount: 4,
    verticesX: vx,
    verticesY: vy,
    vertexCount: 4,
  };
}

/**
 * Extracts merged horizontal box obstacles from a `TileMap` (or any grid with `width/height/tileSize` and `getTile(x, y)`).
 * @param {object} tileMap
 * @param {(tile: any, gx: number, gy: number) => boolean} [isOpaque]
 * @returns {Array<{ minX: number, minY: number, maxX: number, maxY: number }>}
 */
export function extractTileMapObstacles(tileMap, isOpaque = (tile) => Boolean(tile && (tile.solid || tile.opaque || tile > 0))) {
  if (!tileMap || !tileMap.width || !tileMap.height) return [];
  const w = tileMap.width | 0;
  const h = tileMap.height | 0;
  const ts = tileMap.tileSize ?? 1;
  const ox = tileMap.originX ?? 0;
  const oy = tileMap.originY ?? 0;
  const visited = new Uint8Array(w * h);
  const out = [];

  const solidAt = (gx, gy) => {
    const tile = typeof tileMap.getTile === 'function'
      ? tileMap.getTile(gx, gy)
      : tileMap.data?.[gy * w + gx];
    return isOpaque(tile, gx, gy);
  };

  for (let gy = 0; gy < h; gy++) {
    for (let gx = 0; gx < w; gx++) {
      const idx = gy * w + gx;
      if (visited[idx] || !solidAt(gx, gy)) continue;

      let runW = 1;
      while (gx + runW < w && !visited[gy * w + gx + runW] && solidAt(gx + runW, gy)) {
        runW++;
      }

      let runH = 1;
      while (gy + runH < h) {
        let fullRow = true;
        for (let k = 0; k < runW; k++) {
          const cIdx = (gy + runH) * w + gx + k;
          if (visited[cIdx] || !solidAt(gx + k, gy + runH)) {
            fullRow = false;
            break;
          }
        }
        if (!fullRow) break;
        runH++;
      }

      for (let dy = 0; dy < runH; dy++) {
        for (let dx = 0; dx < runW; dx++) {
          visited[(gy + dy) * w + gx + dx] = 1;
        }
      }

      out.push({
        minX: ox + gx * ts,
        minY: oy + gy * ts,
        maxX: ox + (gx + runW) * ts,
        maxY: oy + (gy + runH) * ts,
      });
    }
  }
  return out;
}

/**
 * Creates a deterministic, zero-GC Fog of War world supporting analytical line-of-sight
 * polygons, vision cones, obstacle corner occlusion, persistent exploration memory/regrow,
 * hider tracking, and minimap RGBA export.
 */
export function createFogOfWarWorld({
  plane = 'xy',
  bounds = { minX: -480, minY: -270, maxX: 480, maxY: 270 },
  resolutionX = 128,
  resolutionY = 128,
  fadeType = FOG_FADE_TYPE.SMOOTHSTEP,
  fadePower = 1.5,
  blendMode = 'max',
  useMemory = true,
  exploredAlpha = 0.35,
  useRegrow = false,
  regrowSpeed = 0.08,
  regrowFloor = 0.25,
  fadeInSpeed = 8.0,
  fadeOutSpeed = 4.0,
  initialExploration = 0,
  blurPasses = 1,
  worldBoundsSoften = 0,
  sightExtra = 0.02,
  edgeSoften = 0.15,
  hidersUseGrid = false,
  maxRaysPerRevealer = 768,
  maxRevealersPerFrame = 0,
} = {}) {
  const isXZ = plane === 'xz';
  const bMinX = bounds.minX ?? -50;
  const bMinY = bounds.minY ?? bounds.minZ ?? -50;
  const bMaxX = bounds.maxX ?? 50;
  const bMaxY = bounds.maxY ?? bounds.maxZ ?? 50;
  const bWidth = Math.max(0.001, bMaxX - bMinX);
  const bHeight = Math.max(0.001, bMaxY - bMinY);

  const resX = Math.max(8, Math.min(1024, resolutionX | 0));
  const resY = Math.max(8, Math.min(1024, resolutionY | 0));
  const cellCount = resX * resY;

  const liveVisibility = new Float32Array(cellCount);
  const exploredMemory = new Float32Array(cellCount);
  const displayVisibility = new Float32Array(cellCount);
  const blurScratch = new Float32Array(cellCount);

  if (initialExploration > 0) {
    const initV = clamp01(initialExploration);
    exploredMemory.fill(initV);
    displayVisibility.fill(initV * exploredAlpha);
  }

  let nextRevealerId = 1;
  let nextHiderId = 1;
  let nextObstacleId = 1;
  let obstaclesVersion = 1;
  let timeSliceCursor = 0;

  const obstacles = [];
  const nearbyObstacles = [];
  const revealers = [];
  const revealerById = new Map();
  const hiders = [];
  const hiderById = new Map();

  const rayCap = Math.max(32, maxRaysPerRevealer | 0);
  const scratchAngles = new Float32Array(rayCap);
  const scratchRayIdx = new Int32Array(rayCap);

  function addObstacle(raw) {
    const obs = normalizeObstacle(raw, nextObstacleId++);
    obstacles.push(obs);
    obstaclesVersion++;
    return obs.id;
  }

  function removeObstacle(id) {
    const idx = obstacles.findIndex((o) => o.id === id);
    if (idx < 0) return false;
    obstacles[idx] = obstacles[obstacles.length - 1];
    obstacles.pop();
    obstaclesVersion++;
    return true;
  }

  function setObstacles(list) {
    obstacles.length = 0;
    if (Array.isArray(list)) {
      for (let i = 0; i < list.length; i++) {
        obstacles.push(normalizeObstacle(list[i], nextObstacleId++));
      }
    }
    obstaclesVersion++;
  }

  function setObstaclesFromTileMap(tileMap, isOpaque) {
    setObstacles(extractTileMapObstacles(tileMap, isOpaque));
  }

  function castSingleRay(ox, oy, dx, dy, maxDist, countNearby) {
    let bestT = maxDist;
    let didHit = false;

    for (let i = 0; i < countNearby; i++) {
      const obs = nearbyObstacles[i];
      if (obs.kind === 'circle') {
        const fx = ox - obs.x;
        const fy = oy - obs.y;
        const b = 2 * (fx * dx + fy * dy);
        const c = fx * fx + fy * fy - obs.radius * obs.radius;
        if (c <= 0) continue;
        const disc = b * b - 4 * c;
        if (disc < 0) continue;
        const t = (-b - Math.sqrt(disc)) * 0.5;
        if (t >= 0 && t < bestT) {
          bestT = t;
          didHit = true;
        }
      } else {
        const segs = obs.segments;
        const sc = obs.segmentCount;
        for (let s = 0; s < sc; s++) {
          const s4 = s * 4;
          const ax = segs[s4];
          const ay = segs[s4 + 1];
          const bx = segs[s4 + 2];
          const by = segs[s4 + 3];
          const sx = bx - ax;
          const sy = by - ay;
          const denom = dx * sy - dy * sx;
          if (Math.abs(denom) <= 1e-8) continue;
          const qpx = ax - ox;
          const qpy = ay - oy;
          const t = (qpx * sy - qpy * sx) / denom;
          if (t < 0 || t >= bestT) continue;
          const u = (qpx * dy - qpy * dx) / denom;
          if (u >= -1e-4 && u <= 1.0001) {
            bestT = t;
            didHit = true;
          }
        }
      }
    }

    return { dist: bestT, hit: didHit };
  }

  function computeRevealerSegments(rev) {
    const totalR = rev.viewRadius + rev.softenDistance;
    if (!rev.useOcclusion || totalR <= 0) {
      rev.segmentCount = 0;
      rev.dirty = false;
      rev.lastObstaclesVersion = obstaclesVersion;
      return;
    }

    const ox = rev.x;
    const oy = rev.y;
    const minX = ox - totalR;
    const minY = oy - totalR;
    const maxX = ox + totalR;
    const maxY = oy + totalR;

    nearbyObstacles.length = 0;
    for (let i = 0; i < obstacles.length; i++) {
      const obs = obstacles[i];
      if (obs.maxX < minX || obs.minX > maxX || obs.maxY < minY || obs.minY > maxY) continue;
      nearbyObstacles.push(obs);
    }

    if (nearbyObstacles.length === 0) {
      rev.segmentCount = 0;
      rev.dirty = false;
      rev.lastObstaclesVersion = obstaclesVersion;
      return;
    }

    const fullCircle = rev.viewAngleDeg >= 359.5;
    const halfAngle = fullCircle ? Math.PI : Math.max(0.005, rev.viewAngleDeg * 0.5 * DEG_TO_RAD);
    const baseRays = Math.max(12, Math.min(rayCap - 16, rev.rayCount | 0));
    let nRays = 0;

    // Base uniform fan across [-halfAngle, +halfAngle]
    const span = halfAngle * 2;
    const step = fullCircle ? span / baseRays : span / Math.max(1, baseRays - 1);
    for (let i = 0; i < baseRays && nRays < rayCap; i++) {
      scratchAngles[nRays++] = -halfAngle + i * step;
    }

    // Analytical corner/tangent angle injection for crisp silhouettes
    const rPadSq = (totalR + 0.25) * (totalR + 0.25);
    const eps = 0.0005;
    for (let i = 0; i < nearbyObstacles.length && nRays + 4 < rayCap; i++) {
      const obs = nearbyObstacles[i];
      if (obs.kind === 'circle') {
        const dx = obs.x - ox;
        const dy = obs.y - oy;
        const dSq = dx * dx + dy * dy;
        const d = Math.sqrt(dSq);
        if (d > obs.radius + 1e-4 && d <= totalR + obs.radius) {
          const cRel = wrapAngle(Math.atan2(dy, dx) - rev.yaw);
          const tanDelta = Math.asin(Math.min(0.999, obs.radius / d));
          const candidates = [
            wrapAngle(cRel - tanDelta - eps),
            wrapAngle(cRel - tanDelta),
            wrapAngle(cRel + tanDelta),
            wrapAngle(cRel + tanDelta + eps),
          ];
          for (let k = 0; k < 4 && nRays < rayCap; k++) {
            const a = candidates[k];
            if (fullCircle || Math.abs(a) <= halfAngle) {
              scratchAngles[nRays++] = a;
            }
          }
        }
      } else {
        const vc = obs.vertexCount;
        for (let v = 0; v < vc && nRays + 3 < rayCap; v++) {
          const dx = obs.verticesX[v] - ox;
          const dy = obs.verticesY[v] - oy;
          if (dx * dx + dy * dy > rPadSq) continue;
          const rel = wrapAngle(Math.atan2(dy, dx) - rev.yaw);
          if (fullCircle || Math.abs(rel) <= halfAngle + eps) {
            scratchAngles[nRays++] = Math.max(-halfAngle, Math.min(halfAngle, rel - eps));
            scratchAngles[nRays++] = Math.max(-halfAngle, Math.min(halfAngle, rel));
            scratchAngles[nRays++] = Math.max(-halfAngle, Math.min(halfAngle, rel + eps));
          }
        }
      }
    }

    // Sort angles in place (small index array sort avoids allocating objects)
    for (let i = 0; i < nRays; i++) scratchRayIdx[i] = i;
    const sub = scratchAngles.subarray(0, nRays);
    sub.sort();

    // Deduplicate nearly identical angles & cast rays
    let outCount = 0;
    let prevAng = -999;
    const maxSegs = rev.segAngle.length;
    for (let i = 0; i < nRays && outCount < maxSegs; i++) {
      const angRel = sub[i];
      if (outCount > 0 && Math.abs(angRel - prevAng) < 1e-5) continue;
      prevAng = angRel;

      const worldAng = rev.yaw + angRel;
      const dx = Math.cos(worldAng);
      const dy = Math.sin(worldAng);
      const hitRes = castSingleRay(ox, oy, dx, dy, totalR, nearbyObstacles.length);
      rev.segAngle[outCount] = angRel;
      rev.segDirX[outCount] = dx;
      rev.segDirY[outCount] = dy;
      rev.segDist[outCount] = hitRes.dist;
      rev.segHit[outCount] = hitRes.hit ? 1 : 0;
      outCount++;
    }

    // For full 360 circle, wrap closing segment back to first angle + 2PI for seamless sector interpolation
    if (fullCircle && outCount > 1 && outCount < maxSegs) {
      rev.segAngle[outCount] = rev.segAngle[0] + TWO_PI;
      rev.segDirX[outCount] = rev.segDirX[0];
      rev.segDirY[outCount] = rev.segDirY[0];
      rev.segDist[outCount] = rev.segDist[0];
      rev.segHit[outCount] = rev.segHit[0];
      outCount++;
    }

    rev.segmentCount = outCount;
    rev.dirty = false;
    rev.lastObstaclesVersion = obstaclesVersion;
  }

  function addRevealer(opts = {}) {
    const id = opts.id ?? nextRevealerId++;
    if (revealerById.has(id)) {
      updateRevealer(id, opts);
      return id;
    }
    const segCap = rayCap + 4;
    const rev = {
      id,
      active: opts.active !== false,
      isStatic: Boolean(opts.static),
      x: opts.x ?? 0,
      y: isXZ ? (opts.z ?? opts.y ?? 0) : (opts.y ?? 0),
      z: isXZ ? (opts.y ?? 0) : (opts.z ?? 0),
      yaw: opts.yaw ?? opts.angleRad ?? 0,
      viewRadius: Math.max(0, opts.viewRadius ?? 120),
      softenDistance: Math.max(0, opts.softenDistance ?? 28),
      viewAngleDeg: Math.max(1, Math.min(360, opts.viewAngleDeg ?? 360)),
      innerSoftenAngleDeg: Math.max(0, Math.min(60, opts.innerSoftenAngleDeg ?? 5)),
      unobscuredRadius: opts.unobscuredRadius ?? 0,
      unobscuredSoften: Math.max(0, opts.unobscuredSoften ?? 0),
      visionHeight: opts.visionHeight ?? 0,
      visionHeightSoften: Math.max(0, opts.visionHeightSoften ?? 0),
      opacity: clamp01(opts.opacity ?? 1),
      useOcclusion: opts.useOcclusion !== false,
      rayCount: opts.rayCount ?? (typeof opts.quality === 'number' ? opts.quality : FOG_QUALITY[String(opts.quality || 'HIGH').toUpperCase()] ?? FOG_QUALITY.HIGH),
      dirty: true,
      lastObstaclesVersion: -1,
      segmentCount: 0,
      segAngle: new Float32Array(segCap),
      segDirX: new Float32Array(segCap),
      segDirY: new Float32Array(segCap),
      segDist: new Float32Array(segCap),
      segHit: new Uint8Array(segCap),
    };
    revealers.push(rev);
    revealerById.set(id, rev);
    computeRevealerSegments(rev);
    return id;
  }

  function updateRevealer(id, patch = {}) {
    const rev = revealerById.get(id);
    if (!rev) return false;
    let changed = false;

    const nx = patch.x !== undefined ? patch.x : rev.x;
    const ny = isXZ
      ? (patch.z !== undefined ? patch.z : (patch.y !== undefined ? patch.y : rev.y))
      : (patch.y !== undefined ? patch.y : rev.y);
    const nz = isXZ
      ? (patch.y !== undefined ? patch.y : rev.z)
      : (patch.z !== undefined ? patch.z : rev.z);

    if (nx !== rev.x || ny !== rev.y || nz !== rev.z) {
      rev.x = nx;
      rev.y = ny;
      rev.z = nz;
      changed = true;
    }
    const nyaw = patch.yaw ?? patch.angleRad;
    if (nyaw !== undefined && nyaw !== rev.yaw) {
      rev.yaw = nyaw;
      changed = true;
    }
    if (patch.viewRadius !== undefined && patch.viewRadius !== rev.viewRadius) {
      rev.viewRadius = Math.max(0, patch.viewRadius);
      changed = true;
    }
    if (patch.softenDistance !== undefined && patch.softenDistance !== rev.softenDistance) {
      rev.softenDistance = Math.max(0, patch.softenDistance);
      changed = true;
    }
    if (patch.viewAngleDeg !== undefined && patch.viewAngleDeg !== rev.viewAngleDeg) {
      rev.viewAngleDeg = Math.max(1, Math.min(360, patch.viewAngleDeg));
      changed = true;
    }
    if (patch.innerSoftenAngleDeg !== undefined) {
      rev.innerSoftenAngleDeg = Math.max(0, Math.min(60, patch.innerSoftenAngleDeg));
    }
    if (patch.unobscuredRadius !== undefined) rev.unobscuredRadius = patch.unobscuredRadius;
    if (patch.unobscuredSoften !== undefined) rev.unobscuredSoften = Math.max(0, patch.unobscuredSoften);
    if (patch.visionHeight !== undefined) rev.visionHeight = patch.visionHeight;
    if (patch.visionHeightSoften !== undefined) rev.visionHeightSoften = Math.max(0, patch.visionHeightSoften);
    if (patch.opacity !== undefined) rev.opacity = clamp01(patch.opacity);
    if (patch.active !== undefined) rev.active = Boolean(patch.active);
    if (patch.static !== undefined) rev.isStatic = Boolean(patch.static);
    if (patch.useOcclusion !== undefined && patch.useOcclusion !== rev.useOcclusion) {
      rev.useOcclusion = Boolean(patch.useOcclusion);
      changed = true;
    }
    if (changed) rev.dirty = true;
    return true;
  }

  function removeRevealer(id) {
    const rev = revealerById.get(id);
    if (!rev) return false;
    revealerById.delete(id);
    const idx = revealers.indexOf(rev);
    if (idx >= 0) {
      revealers[idx] = revealers[revealers.length - 1];
      revealers.pop();
    }
    return true;
  }

  function sampleSegmentFanDist(rev, relX, relY, dist, angRel) {
    const n = rev.segmentCount;
    if (n < 2) return rev.viewRadius + rev.softenDistance;

    let targetAng = angRel;
    if (rev.viewAngleDeg >= 359.5 && targetAng < rev.segAngle[0]) {
      targetAng += TWO_PI;
    }

    let lo = 0;
    let hi = n - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (rev.segAngle[mid] <= targetAng) lo = mid;
      else hi = mid - 1;
    }
    const i0 = lo;
    const i1 = i0 + 1;

    const d0 = rev.segDist[i0];
    const d1 = rev.segDist[i1];
    const h0 = rev.segHit[i0];
    const h1 = rev.segHit[i1];

    if (h0 && h1) {
      const ax = rev.segDirX[i0] * d0;
      const ay = rev.segDirY[i0] * d0;
      const bx = rev.segDirX[i1] * d1;
      const by = rev.segDirY[i1] * d1;
      const sx = bx - ax;
      const sy = by - ay;
      if (sx * sx + sy * sy > 0.0025) {
        // Cramer's rule intersection along ray (relX, relY)
        const a1 = by - ay;
        const b1 = ax - bx;
        const c1 = a1 * ax + b1 * ay;
        const a2 = relY;
        const b2 = -relX;
        const det = a1 * b2 - a2 * b1;
        if (Math.abs(det) > 1e-6) {
          const ix = (b2 * c1) / det;
          const iy = -(a2 * c1) / det;
          return Math.hypot(ix, iy) + sightExtra;
        }
      }
      return Math.min(d0, d1) + sightExtra;
    }

    const span = rev.segAngle[i1] - rev.segAngle[i0];
    const t = span > 1e-5 ? clamp01((targetAng - rev.segAngle[i0]) / span) : 0;
    return d0 + (d1 - d0) * t + sightExtra;
  }

  function sampleRevealerVisibility(rev, wx, wy, wz = 0, ignoreHeight = false) {
    if (!rev.active || rev.opacity <= 0) return 0;
    const rx = wx - rev.x;
    const ry = wy - rev.y;
    const totalR = rev.viewRadius + rev.softenDistance;
    const distSq = rx * rx + ry * ry;
    if (distSq > totalR * totalR) return 0;

    let heightFactor = 1;
    if (!ignoreHeight && rev.visionHeight > 0) {
      const hDist = Math.abs(wz - rev.z);
      if (hDist > rev.visionHeight + rev.visionHeightSoften) return 0;
      if (hDist > rev.visionHeight && rev.visionHeightSoften > 1e-4) {
        heightFactor = 1 - (hDist - rev.visionHeight) / rev.visionHeightSoften;
      }
    }

    const dist = Math.sqrt(distSq);
    if (rev.unobscuredRadius < 0 && dist < -rev.unobscuredRadius) return 0;

    let unobscuredVis = 0;
    if (rev.unobscuredRadius > 0 && dist <= rev.unobscuredRadius + rev.unobscuredSoften) {
      if (dist <= rev.unobscuredRadius || rev.unobscuredSoften <= 1e-4) {
        unobscuredVis = 1;
      } else {
        unobscuredVis = applyFadeCurve(1 - (dist - rev.unobscuredRadius) / rev.unobscuredSoften, fadeType, fadePower);
      }
    }

    const fullCircle = rev.viewAngleDeg >= 359.5;
    let angFactor = 1;
    let angRel = 0;
    if (dist > 1e-5) {
      angRel = wrapAngle(Math.atan2(ry, rx) - rev.yaw);
      if (!fullCircle) {
        const halfCone = rev.viewAngleDeg * 0.5 * DEG_TO_RAD;
        const absA = Math.abs(angRel);
        if (absA > halfCone) return unobscuredVis * rev.opacity * heightFactor;
        const softAngle = rev.innerSoftenAngleDeg * DEG_TO_RAD;
        if (softAngle > 1e-4 && absA > halfCone - softAngle) {
          angFactor = clamp01((halfCone - absA) / softAngle);
        }
      }
    }

    let losVis = 0;
    if (rev.useOcclusion && rev.segmentCount >= 2) {
      const maxSegDist = sampleSegmentFanDist(rev, rx, ry, dist, angRel);
      const blocked = maxSegDist < rev.viewRadius + rev.softenDistance - 0.01;
      if (blocked) {
        const edgeDist = maxSegDist;
        if (dist <= edgeDist) {
          losVis = 1;
        } else if (edgeSoften > 1e-4 && dist < edgeDist + edgeSoften) {
          losVis = clamp01(1 - (dist - edgeDist) / edgeSoften);
        }
        // Apply radial outer falloff within softenDistance even on unblocked sub-span
        if (losVis > 0 && dist > rev.viewRadius && rev.softenDistance > 1e-4) {
          const radFade = applyFadeCurve(1 - (dist - rev.viewRadius) / rev.softenDistance, fadeType, fadePower);
          losVis = Math.min(losVis, radFade);
        }
      } else {
        if (dist <= rev.viewRadius || rev.softenDistance <= 1e-4) {
          losVis = 1;
        } else {
          losVis = applyFadeCurve(1 - (dist - rev.viewRadius) / rev.softenDistance, fadeType, fadePower);
        }
      }
    } else {
      if (dist <= rev.viewRadius || rev.softenDistance <= 1e-4) {
        losVis = 1;
      } else {
        losVis = applyFadeCurve(1 - (dist - rev.viewRadius) / rev.softenDistance, fadeType, fadePower);
      }
    }

    const combined = Math.max(unobscuredVis, losVis * angFactor);
    return clamp01(combined * rev.opacity * heightFactor);
  }

  /**
   * Samples exact analytical line-of-sight visibility `[0..1]` at a world coordinate.
   * @param {number} x
   * @param {number} yOrZ
   * @param {number} [zOrHeight=0]
   * @returns {number}
   */
  function sampleVisibility(x, yOrZ, zOrHeight = 0) {
    const px = x;
    const py = yOrZ;
    const pz = zOrHeight;
    let vis = 0;
    for (let i = 0; i < revealers.length; i++) {
      const v = sampleRevealerVisibility(revealers[i], px, py, pz, false);
      vis = blendMode === 'additive' ? clamp01(vis + v) : Math.max(vis, v);
      if (vis >= 0.999) return 1;
    }
    return vis;
  }

  function sampleGridArray(arr, wx, wy) {
    const fx = ((wx - bMinX) / bWidth) * resX - 0.5;
    const fy = ((wy - bMinY) / bHeight) * resY - 0.5;
    const x0 = Math.max(0, Math.min(resX - 1, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(resY - 1, Math.floor(fy)));
    const x1 = Math.min(resX - 1, x0 + 1);
    const y1 = Math.min(resY - 1, y0 + 1);
    const tx = clamp01(fx - x0);
    const ty = clamp01(fy - y0);
    const v00 = arr[y0 * resX + x0];
    const v10 = arr[y0 * resX + x1];
    const v01 = arr[y1 * resX + x0];
    const v11 = arr[y1 * resX + x1];
    const top = v00 + (v10 - v00) * tx;
    const bot = v01 + (v11 - v01) * tx;
    return top + (bot - top) * ty;
  }

  function sampleExploration(x, yOrZ) {
    return sampleGridArray(exploredMemory, x, yOrZ);
  }

  function sampleDisplay(x, yOrZ) {
    return sampleGridArray(displayVisibility, x, yOrZ);
  }

  function addHider(opts = {}) {
    const id = opts.id ?? nextHiderId++;
    const hider = {
      id,
      x: opts.x ?? 0,
      y: isXZ ? (opts.z ?? opts.y ?? 0) : (opts.y ?? 0),
      z: isXZ ? (opts.y ?? 0) : (opts.z ?? 0),
      samplePoints: Array.isArray(opts.samplePoints) ? opts.samplePoints : null,
      threshold: opts.threshold ?? 0.35,
      permanentlyReveal: Boolean(opts.permanentlyReveal),
      revealedOnce: false,
      visible: false,
      visibility: 0,
      onVisibilityChanged: typeof opts.onVisibilityChanged === 'function' ? opts.onVisibilityChanged : null,
    };
    hiders.push(hider);
    hiderById.set(id, hider);
    return id;
  }

  function updateHider(id, patch = {}) {
    const h = hiderById.get(id);
    if (!h) return false;
    if (patch.x !== undefined) h.x = patch.x;
    if (isXZ) {
      if (patch.z !== undefined) h.y = patch.z;
      if (patch.y !== undefined) h.z = patch.y;
    } else {
      if (patch.y !== undefined) h.y = patch.y;
      if (patch.z !== undefined) h.z = patch.z;
    }
    if (patch.threshold !== undefined) h.threshold = patch.threshold;
    if (patch.permanentlyReveal !== undefined) h.permanentlyReveal = Boolean(patch.permanentlyReveal);
    return true;
  }

  function removeHider(id) {
    const h = hiderById.get(id);
    if (!h) return false;
    hiderById.delete(id);
    const idx = hiders.indexOf(h);
    if (idx >= 0) {
      hiders[idx] = hiders[hiders.length - 1];
      hiders.pop();
    }
    return true;
  }

  function isHiderVisible(id) {
    return Boolean(hiderById.get(id)?.visible);
  }

  function getHiderState(id) {
    const h = hiderById.get(id);
    if (!h) return null;
    return { id: h.id, visible: h.visible, visibility: h.visibility, revealedOnce: h.revealedOnce };
  }

  function applySeparableBlur(buf) {
    for (let y = 0; y < resY; y++) {
      const rowOff = y * resX;
      for (let x = 0; x < resX; x++) {
        const xl = x > 0 ? x - 1 : x;
        const xr = x + 1 < resX ? x + 1 : x;
        blurScratch[rowOff + x] = (buf[rowOff + xl] + buf[rowOff + x] * 2 + buf[rowOff + xr]) * 0.25;
      }
    }
    for (let y = 0; y < resY; y++) {
      const yt = y > 0 ? y - 1 : y;
      const yb = y + 1 < resY ? y + 1 : y;
      const rowOff = y * resX;
      const topOff = yt * resX;
      const botOff = yb * resX;
      for (let x = 0; x < resX; x++) {
        buf[rowOff + x] = (blurScratch[topOff + x] + blurScratch[rowOff + x] * 2 + blurScratch[botOff + x]) * 0.25;
      }
    }
  }

  function update(dt = 0.016) {
    const stepDt = Math.max(0, Math.min(0.25, dt));

    // 1. Update revealer sight polygons (with optional time-slicing for non-dirty/dynamic)
    const revCount = revealers.length;
    if (maxRevealersPerFrame > 0 && revCount > maxRevealersPerFrame) {
      let processed = 0;
      for (let k = 0; k < revCount && processed < maxRevealersPerFrame; k++) {
        const idx = (timeSliceCursor + k) % revCount;
        const rev = revealers[idx];
        if (!rev.active) continue;
        if (rev.dirty || (!rev.isStatic && rev.lastObstaclesVersion !== obstaclesVersion)) {
          computeRevealerSegments(rev);
          processed++;
        }
      }
      timeSliceCursor = (timeSliceCursor + maxRevealersPerFrame) % Math.max(1, revCount);
    } else {
      for (let i = 0; i < revCount; i++) {
        const rev = revealers[i];
        if (!rev.active) continue;
        if (rev.dirty || rev.lastObstaclesVersion !== obstaclesVersion) {
          computeRevealerSegments(rev);
        }
      }
    }

    // 2. Rasterize live visibility per-revealer AABB into grid
    liveVisibility.fill(0);
    const cellW = bWidth / resX;
    const cellH = bHeight / resY;
    for (let r = 0; r < revCount; r++) {
      const rev = revealers[r];
      if (!rev.active || rev.opacity <= 0) continue;
      const totalR = rev.viewRadius + rev.softenDistance;
      const gx0 = Math.max(0, Math.floor((rev.x - totalR - bMinX) / cellW));
      const gy0 = Math.max(0, Math.floor((rev.y - totalR - bMinY) / cellH));
      const gx1 = Math.min(resX - 1, Math.ceil((rev.x + totalR - bMinX) / cellW));
      const gy1 = Math.min(resY - 1, Math.ceil((rev.y + totalR - bMinY) / cellH));

      for (let gy = gy0; gy <= gy1; gy++) {
        const wy = bMinY + (gy + 0.5) * cellH;
        const rowOff = gy * resX;
        for (let gx = gx0; gx <= gx1; gx++) {
          const wx = bMinX + (gx + 0.5) * cellW;
          const v = sampleRevealerVisibility(rev, wx, wy, rev.z, true);
          if (v > 0) {
            const idx = rowOff + gx;
            liveVisibility[idx] = blendMode === 'additive'
              ? clamp01(liveVisibility[idx] + v)
              : Math.max(liveVisibility[idx], v);
          }
        }
      }
    }

    // 3. Optional grid blur
    for (let p = 0; p < blurPasses; p++) {
      applySeparableBlur(liveVisibility);
    }

    // 4. Update memory, regrow, world-bounds fade, and display smoothing
    const hasBoundsSoften = worldBoundsSoften > 1e-4;
    for (let gy = 0; gy < resY; gy++) {
      const wy = bMinY + (gy + 0.5) * cellH;
      const rowOff = gy * resX;
      for (let gx = 0; gx < resX; gx++) {
        const idx = rowOff + gx;
        let live = liveVisibility[idx];

        if (hasBoundsSoften) {
          const wx = bMinX + (gx + 0.5) * cellW;
          const edgeDist = Math.min(wx - bMinX, bMaxX - wx, wy - bMinY, bMaxY - wy);
          if (edgeDist < worldBoundsSoften) {
            live *= clamp01(edgeDist / worldBoundsSoften);
            liveVisibility[idx] = live;
          }
        }

        if (useMemory) {
          if (live > exploredMemory[idx]) {
            exploredMemory[idx] = live;
          } else if (useRegrow && exploredMemory[idx] > regrowFloor) {
            exploredMemory[idx] = Math.max(regrowFloor, exploredMemory[idx] - regrowSpeed * stepDt);
          }
        }

        const target = useMemory ? Math.max(live, exploredMemory[idx] * exploredAlpha) : live;
        const cur = displayVisibility[idx];
        const speed = target >= cur ? fadeInSpeed : fadeOutSpeed;
        if (speed <= 0 || stepDt <= 0) {
          displayVisibility[idx] = target;
        } else {
          displayVisibility[idx] = cur + (target - cur) * Math.min(1, speed * stepDt);
        }
      }
    }

    // 5. Evaluate hiders
    for (let i = 0; i < hiders.length; i++) {
      const h = hiders[i];
      if (h.permanentlyReveal && h.revealedOnce) {
        h.visibility = 1;
        h.visible = true;
        continue;
      }

      let maxVis = 0;
      if (h.samplePoints && h.samplePoints.length > 0) {
        for (let p = 0; p < h.samplePoints.length; p++) {
          const sp = h.samplePoints[p];
          const sx = h.x + (sp.dx ?? sp.x ?? 0);
          const sy = h.y + (isXZ ? (sp.dz ?? sp.dy ?? sp.z ?? sp.y ?? 0) : (sp.dy ?? sp.y ?? 0));
          const sz = h.z + (isXZ ? (sp.dy ?? sp.y ?? 0) : (sp.dz ?? sp.z ?? 0));
          const v = hidersUseGrid ? sampleGridArray(liveVisibility, sx, sy) : sampleVisibility(sx, sy, sz);
          if (v > maxVis) maxVis = v;
        }
      } else {
        maxVis = hidersUseGrid ? sampleGridArray(liveVisibility, h.x, h.y) : sampleVisibility(h.x, h.y, h.z);
      }

      h.visibility = maxVis;
      const nowVisible = maxVis >= h.threshold;
      if (nowVisible) h.revealedOnce = true;
      if (nowVisible !== h.visible) {
        h.visible = nowVisible;
        h.onVisibilityChanged?.(h, nowVisible, maxVis);
      }
    }
  }

  /**
   * Writes RGBA minimap pixels (`outRgba.length >= resX * resY * 4`) representing unexplored,
   * explored-shroud, and live-visible cells without allocating.
   */
  function writeMinimapRgba(outRgba, {
    unexploredRgba = [10, 14, 24, 240],
    exploredRgba = [24, 34, 54, 160],
    visibleRgba = [74, 222, 128, 35],
  } = {}) {
    for (let i = 0; i < cellCount; i++) {
      const live = liveVisibility[i];
      const exp = exploredMemory[i];
      const o4 = i * 4;
      if (live > 0.05) {
        const t = live;
        outRgba[o4] = (exploredRgba[0] + (visibleRgba[0] - exploredRgba[0]) * t) | 0;
        outRgba[o4 + 1] = (exploredRgba[1] + (visibleRgba[1] - exploredRgba[1]) * t) | 0;
        outRgba[o4 + 2] = (exploredRgba[2] + (visibleRgba[2] - exploredRgba[2]) * t) | 0;
        outRgba[o4 + 3] = (exploredRgba[3] + (visibleRgba[3] - exploredRgba[3]) * t) | 0;
      } else if (exp > 0.05) {
        const t = exp;
        outRgba[o4] = (unexploredRgba[0] + (exploredRgba[0] - unexploredRgba[0]) * t) | 0;
        outRgba[o4 + 1] = (unexploredRgba[1] + (exploredRgba[1] - unexploredRgba[1]) * t) | 0;
        outRgba[o4 + 2] = (unexploredRgba[2] + (exploredRgba[2] - unexploredRgba[2]) * t) | 0;
        outRgba[o4 + 3] = (unexploredRgba[3] + (exploredRgba[3] - unexploredRgba[3]) * t) | 0;
      } else {
        outRgba[o4] = unexploredRgba[0];
        outRgba[o4 + 1] = unexploredRgba[1];
        outRgba[o4 + 2] = unexploredRgba[2];
        outRgba[o4 + 3] = unexploredRgba[3];
      }
    }
    return outRgba;
  }

  function exportExploration() {
    return {
      resX,
      resY,
      data: Array.from(exploredMemory, (v) => Math.round(v * 255)),
    };
  }

  function importExploration(snapshot) {
    if (!snapshot || snapshot.resX !== resX || snapshot.resY !== resY || !Array.isArray(snapshot.data)) {
      return false;
    }
    const len = Math.min(cellCount, snapshot.data.length);
    for (let i = 0; i < len; i++) {
      const v = clamp01((snapshot.data[i] || 0) / 255);
      exploredMemory[i] = v;
      displayVisibility[i] = Math.max(displayVisibility[i], v * exploredAlpha);
    }
    return true;
  }

  function clearExploration(value = 0) {
    const v = clamp01(value);
    exploredMemory.fill(v);
    displayVisibility.fill(v * exploredAlpha);
  }

  return {
    plane,
    bounds: Object.freeze({ minX: bMinX, minY: bMinY, maxX: bMaxX, maxY: bMaxY, width: bWidth, height: bHeight }),
    resX,
    resY,
    liveVisibility,
    exploredMemory,
    displayVisibility,
    addObstacle,
    removeObstacle,
    setObstacles,
    setObstaclesFromTileMap,
    addRevealer,
    updateRevealer,
    removeRevealer,
    addHider,
    updateHider,
    removeHider,
    isHiderVisible,
    getHiderState,
    sampleVisibility,
    sampleExploration,
    sampleDisplay,
    update,
    writeMinimapRgba,
    exportExploration,
    importExploration,
    clearExploration,
    getRevealers() {
      return revealers;
    },
    getObstacles() {
      return obstacles;
    },
    getHiders() {
      return hiders;
    },
    getStats() {
      let visibleHiders = 0;
      for (let i = 0; i < hiders.length; i++) if (hiders[i].visible) visibleHiders++;
      return {
        plane,
        resX,
        resY,
        revealerCount: revealers.length,
        obstacleCount: obstacles.length,
        hiderCount: hiders.length,
        visibleHiders,
      };
    },
  };
}
