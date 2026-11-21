import { createSeededRng } from '../sim/rng.js';

/**
 * Build a GPU-instanced foliage / grass field with deterministic seeded placement,
 * real-time GPU vertex wind sway, character trampling bend (`setTrampler`), and smooth
 * screen-space 4x4 Bayer distance dither fade in a single `THREE.InstancedMesh` draw call.
 *
 * @param {any} THREE Three.js namespace or compatible mock.
 * @param {object} [options]
 * @param {any} [options.geometry] Custom blade geometry; defaults to an upright tapered quad.
 * @param {number} [options.count=400] Instance count.
 * @param {number} [options.areaSize=24] Square placement extent centered at origin.
 * @param {number} [options.minScale=0.7]
 * @param {number} [options.maxScale=1.35]
 * @param {number} [options.windAmp=0.16]
 * @param {number} [options.windFreq=2.4]
 * @param {number} [options.fadeNear=18] Distance where Bayer fade begins.
 * @param {number} [options.fadeFar=36] Distance where blades completely fade out.
 * @param {number} [options.trampleRadius=1.4] Radius around trampler bending blades away.
 * @param {number} [options.colorBase=0x166534]
 * @param {number} [options.colorTip=0x4ade80]
 * @param {number} [options.seed=1337]
 */
export function createInstancedFoliage3D(THREE, {
  geometry = null,
  count = 400,
  areaSize = 24,
  minScale = 0.7,
  maxScale = 1.35,
  windAmp = 0.16,
  windFreq = 2.4,
  fadeNear = 18,
  fadeFar = 36,
  trampleRadius = 1.4,
  colorBase = 0x166534,
  colorTip = 0x4ade80,
  seed = 1337,
} = {}) {
  if (!THREE?.InstancedMesh || !THREE?.MeshStandardMaterial || !THREE?.Matrix4) {
    throw new TypeError('createInstancedFoliage3D requires THREE.InstancedMesh, MeshStandardMaterial, and Matrix4');
  }

  const instanceCount = Math.max(1, Math.floor(count) || 400);
  const ownsGeo = !geometry;
  let geo = geometry;
  if (!geo) {
    geo = new THREE.PlaneGeometry(0.18, 0.85, 1, 3);
    geo.translate?.(0, 0.425, 0);
  }

  const mat = new THREE.MeshStandardMaterial({
    color: colorTip,
    roughness: 0.75,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });

  const uniforms = {
    uFoliageTime: { value: 0 },
    uWindAmp: { value: Number.isFinite(windAmp) ? windAmp : 0.16 },
    uWindFreq: { value: Number.isFinite(windFreq) ? windFreq : 2.4 },
    uTramplePos: { value: new THREE.Vector3(0, -1000, 0) },
    uTrampleRadius: { value: Math.max(0.1, Number(trampleRadius) || 1.4) },
    uFadeNear: { value: Math.max(1, Number(fadeNear) || 18) },
    uFadeFar: { value: Math.max((Number(fadeNear) || 18) + 1, Number(fadeFar) || 36) },
  };

  mat.customProgramCacheKey = () => 'hgame-foliage3d-v1';
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = [
      'uniform float uFoliageTime;',
      'uniform float uWindAmp;',
      'uniform float uWindFreq;',
      'uniform vec3 uTramplePos;',
      'uniform float uTrampleRadius;',
      'varying float vFoliageViewDist;',
    ].join('\n') + '\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      [
        '#include <begin_vertex>',
        '{',
        '  vec4 _fwOrigin = vec4(0.0, 0.0, 0.0, 1.0);',
        '  #ifdef USE_INSTANCING',
        '    _fwOrigin = instanceMatrix * _fwOrigin;',
        '  #endif',
        '  _fwOrigin = modelMatrix * _fwOrigin;',
        '  float _hW = clamp(transformed.y / 0.85, 0.0, 1.0);',
        '  float _phase = uFoliageTime * uWindFreq + _fwOrigin.x * 0.65 + _fwOrigin.z * 0.55;',
        '  float _sway = (sin(_phase) + 0.4 * sin(_phase * 2.1 + 1.1)) * uWindAmp * _hW * _hW;',
        '  transformed.x += _sway;',
        '  transformed.z += _sway * 0.35;',
        '  vec2 _tDelta = _fwOrigin.xz - uTramplePos.xz;',
        '  float _tDist = length(_tDelta);',
        '  if (_tDist < uTrampleRadius && uTramplePos.y > -500.0) {',
        '    float _bend = (1.0 - _tDist / max(0.001, uTrampleRadius)) * _hW;',
        '    vec2 _tDir = _tDist > 0.001 ? _tDelta / _tDist : vec2(1.0, 0.0);',
        '    transformed.x += _tDir.x * _bend * 0.55;',
        '    transformed.z += _tDir.y * _bend * 0.55;',
        '    transformed.y *= max(0.25, 1.0 - _bend * 0.65);',
        '  }',
        '}',
      ].join('\n'),
    ).replace(
      '#include <project_vertex>',
      '#include <project_vertex>\nvFoliageViewDist = -mvPosition.z;',
    );

    shader.fragmentShader = [
      'uniform float uFadeNear;',
      'uniform float uFadeFar;',
      'varying float vFoliageViewDist;',
    ].join('\n') + '\n' + shader.fragmentShader.replace(
      '#include <alphatest_fragment>',
      [
        '#include <alphatest_fragment>',
        '{',
        '  float _fAlpha = 1.0 - clamp((vFoliageViewDist - uFadeNear) / max(0.01, uFadeFar - uFadeNear), 0.0, 1.0);',
        '  if (_fAlpha < 0.999) {',
        '    int _bx = int(mod(gl_FragCoord.x, 4.0));',
        '    int _by = int(mod(gl_FragCoord.y, 4.0));',
        '    float _bayer = (float((_bx * 5 + _by * 3) % 16) + 0.5) / 16.0;',
        '    if (_fAlpha <= _bayer) discard;',
        '  }',
        '}',
      ].join('\n'),
    );
  };

  const mesh = new THREE.InstancedMesh(geo, mat, instanceCount);
  mesh.name = 'hgame_instanced_foliage';
  mesh.castShadow = false;
  mesh.receiveShadow = true;

  const rng = createSeededRng(seed);
  const half = Math.max(0.5, Number(areaSize) || 24) * 0.5;
  const dummyMat = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = THREE.Quaternion ? new THREE.Quaternion() : null;
  const euler = THREE.Euler ? new THREE.Euler() : null;
  const scale = new THREE.Vector3();
  const cBase = THREE.Color ? new THREE.Color(colorBase) : null;
  const cTip = THREE.Color ? new THREE.Color(colorTip) : null;
  const instColor = THREE.Color ? new THREE.Color() : null;

  for (let i = 0; i < instanceCount; i++) {
    const px = (rng.next() * 2 - 1) * half;
    const pz = (rng.next() * 2 - 1) * half;
    const s = minScale + (maxScale - minScale) * rng.next();
    const yaw = rng.next() * Math.PI * 2;
    pos.set(px, 0, pz);
    scale.set(s, s * (0.85 + rng.next() * 0.4), s);
    if (quat && euler && typeof dummyMat.compose === 'function') {
      euler.set(0, yaw, 0);
      quat.setFromEuler(euler);
      dummyMat.compose(pos, quat, scale);
    } else {
      dummyMat.makeTranslation(px, 0, pz);
    }
    mesh.setMatrixAt(i, dummyMat);
    if (instColor && cBase && cTip && typeof mesh.setColorAt === 'function') {
      instColor.copy(cBase).lerp(cTip, 0.35 + rng.next() * 0.65);
      mesh.setColorAt(i, instColor);
    }
  }
  if (mesh.instanceMatrix) mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  function setTrampler(x, y = 0, z = 0) {
    uniforms.uTramplePos.value.set(Number(x) || 0, Number(y) || 0, Number(z) || 0);
  }

  function setWind(amp, freq) {
    if (Number.isFinite(amp)) uniforms.uWindAmp.value = amp;
    if (Number.isFinite(freq)) uniforms.uWindFreq.value = freq;
  }

  function update(dt = 0, tramplerPos = null) {
    const stepDt = Math.max(0, Number(dt) || 0);
    uniforms.uFoliageTime.value += stepDt;
    if (tramplerPos) {
      const tx = Array.isArray(tramplerPos) ? tramplerPos[0] : tramplerPos.x;
      const ty = Array.isArray(tramplerPos) ? tramplerPos[1] : tramplerPos.y;
      const tz = Array.isArray(tramplerPos) ? tramplerPos[2] : tramplerPos.z;
      setTrampler(tx, ty ?? 0, tz);
    }
  }

  function dispose() {
    mesh.dispose?.();
    mat.dispose?.();
    if (ownsGeo) geo.dispose?.();
  }

  return Object.freeze({
    mesh,
    material: mat,
    uniforms,
    count: instanceCount,
    update,
    setTrampler,
    setWind,
    dispose,
  });
}
