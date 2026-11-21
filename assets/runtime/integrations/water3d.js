/**
 * Lightweight realistic 3D water & glass material presets (zero direct 'three' imports).
 * - Water: dual-layer counter-scrolling tangent normal map + Schlick Fresnel reflection/opacity.
 * - Glass: low-roughness translucent dielectric preset with disabled depthWrite.
 */

const WATER_FRAG_PARS = [
  'uniform float uWaterTime;',
  'uniform sampler2D uWaterNormalMap;',
  'uniform float uHasWaterNormal;',
  'uniform vec2 uWaterScrollA;',
  'uniform vec2 uWaterScrollB;',
  'uniform float uWaterNormalScale;',
  'uniform float uWaterNormalStrength;',
  'uniform vec3 uWaterShallowColor;',
  'uniform vec3 uWaterDeepColor;',
  'uniform float uWaterFresnelPower;',
  'uniform float uWaterBaseAlpha;',
  'varying vec2 vWaterUv;',
  'varying vec3 vWaterWorldPos;',
].join('\n');

/**
 * Creates a lightweight realistic water MeshStandardMaterial with dual scrolling normals
 * and Schlick Fresnel edge reflectivity.
 * @param {any} THREE Three.js namespace or compatible mock.
 * @param {Record<string, any>} [options]
 */
export function createRealisticWater3D(THREE, {
  normalMap = null,
  shallowColor = 0x2b6e78,
  deepColor = 0x0f2b36,
  roughness = 0.08,
  metalness = 0.12,
  normalScale = 0.18,
  normalStrength = 0.75,
  scrollA = [0.035, 0.022],
  scrollB = [-0.028, 0.031],
  fresnelPower = 5.0,
  baseAlpha = 0.68,
  side,
  sharedBlock = null,
} = {}) {
  if (!THREE?.MeshStandardMaterial) {
    throw new TypeError('createRealisticWater3D requires THREE.MeshStandardMaterial');
  }

  const mat = new THREE.MeshStandardMaterial({
    color: shallowColor,
    roughness,
    metalness,
    transparent: true,
    opacity: baseAlpha,
    depthWrite: false,
    ...(side !== undefined ? { side } : {}),
  });
  mat.defines = { ...(mat.defines || {}), USE_UV: '' };
  mat.customProgramCacheKey = () => 'hgame-water3d-v1';

  const shallowCol = THREE.Color ? new THREE.Color(shallowColor) : { r: 0.17, g: 0.43, b: 0.47 };
  const deepCol = THREE.Color ? new THREE.Color(deepColor) : { r: 0.06, g: 0.17, b: 0.21 };
  const uniforms = {
    uWaterTime: sharedBlock?.uniforms?.uTime ?? { value: 0 },
    uWaterNormalMap: { value: normalMap },
    uHasWaterNormal: { value: normalMap ? 1.0 : 0.0 },
    uWaterScrollA: { value: THREE.Vector2 ? new THREE.Vector2(scrollA[0] ?? 0.035, scrollA[1] ?? 0.022) : { x: scrollA[0] ?? 0.035, y: scrollA[1] ?? 0.022 } },
    uWaterScrollB: { value: THREE.Vector2 ? new THREE.Vector2(scrollB[0] ?? -0.028, scrollB[1] ?? 0.031) : { x: scrollB[0] ?? -0.028, y: scrollB[1] ?? 0.031 } },
    uWaterNormalScale: { value: Math.max(0.005, Number(normalScale) || 0.18) },
    uWaterNormalStrength: { value: Math.max(0, Number(normalStrength) ?? 0.75) },
    uWaterShallowColor: { value: shallowCol },
    uWaterDeepColor: { value: deepCol },
    uWaterFresnelPower: { value: Math.max(1.0, Number(fresnelPower) || 5.0) },
    uWaterBaseAlpha: { value: Math.max(0.05, Math.min(1.0, Number(baseAlpha) ?? 0.68)) },
  };

  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    if (shader.vertexShader.includes('#include <project_vertex>')) {
      shader.vertexShader = 'varying vec2 vWaterUv;\nvarying vec3 vWaterWorldPos;\n' +
        shader.vertexShader.replace(
          '#include <project_vertex>',
          [
            '#include <project_vertex>',
            '#ifdef USE_UV\n  vWaterUv = uv;\n#else\n  vWaterUv = vec2(0.0);\n#endif',
            'vWaterWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
          ].join('\n'),
        );
    }

    if (shader.fragmentShader.includes('#include <normal_fragment_maps>')) {
      shader.fragmentShader = WATER_FRAG_PARS + '\n' + shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        [
          '#include <normal_fragment_maps>',
          '{',
          '  vec2 _wBaseUv = vWaterWorldPos.xz * uWaterNormalScale;',
          '  vec3 _wN = vec3(0.0, 0.0, 1.0);',
          '  if (uHasWaterNormal > 0.5) {',
          '    vec2 _nA = texture2D(uWaterNormalMap, _wBaseUv + uWaterScrollA * uWaterTime).rg * 2.0 - 1.0;',
          '    vec2 _nB = texture2D(uWaterNormalMap, _wBaseUv * 1.37 + uWaterScrollB * uWaterTime).rg * 2.0 - 1.0;',
          '    vec2 _nMix = (_nA + _nB) * 0.5 * uWaterNormalStrength;',
          '    float _nZ = sqrt(max(0.0, 1.0 - dot(_nMix, _nMix)));',
          '    _wN = normalize(vec3(_nMix.x, _nZ, _nMix.y));',
          '    vec3 _wViewN = normalize(mat3(viewMatrix) * _wN);',
          '    normal = normalize(mix(normal, _wViewN, clamp(uWaterNormalStrength, 0.0, 1.0)));',
          '  } else {',
          '    float _rA = sin(_wBaseUv.x * 9.0 + uWaterTime * 1.9) * cos(_wBaseUv.y * 8.0 - uWaterTime * 1.5);',
          '    float _rB = cos(_wBaseUv.x * 13.0 - uWaterTime * 2.3) * sin(_wBaseUv.y * 11.0 + uWaterTime * 1.7);',
          '    vec3 _wRip = normalize(vec3((_rA + _rB) * 0.06 * uWaterNormalStrength, 1.0, (_rA - _rB) * 0.06 * uWaterNormalStrength));',
          '    normal = normalize(mix(normal, normalize(mat3(viewMatrix) * _wRip), 0.75));',
          '  }',
          '  float _ndotv = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);',
          '  float _fresnel = 0.02 + 0.98 * pow(1.0 - _ndotv, uWaterFresnelPower);',
          '  diffuseColor.rgb = mix(uWaterShallowColor, uWaterDeepColor, _fresnel * 0.75);',
          '  diffuseColor.a = clamp(mix(uWaterBaseAlpha, 0.96, _fresnel), 0.05, 0.98);',
          '}',
        ].join('\n'),
      );
    }
  };

  mat.userData.hgameUniforms = uniforms;
  mat.userData.hgameWater = {
    uniforms,
    update(dt = 0) {
      if (!sharedBlock?.uniforms?.uTime) {
        uniforms.uWaterTime.value += Math.max(0, Number(dt) || 0);
      }
      return uniforms.uWaterTime.value;
    },
    setTime(t = 0) {
      uniforms.uWaterTime.value = Number.isFinite(t) ? t : 0;
      return uniforms.uWaterTime.value;
    },
  };
  mat.needsUpdate = true;
  return mat;
}

/**
 * Creates a lightweight architectural glass material (no depthWrite, low roughness, Fresnel edge reflection).
 * @param {any} THREE
 * @param {Record<string, any>} [options]
 */
export function createRealisticGlassMaterial3D(THREE, {
  color = 0xdbeafe,
  opacity = 0.24,
  roughness = 0.06,
  metalness = 0.08,
  clearcoat = 1.0,
  clearcoatRoughness = 0.04,
  side,
} = {}) {
  if (!THREE?.MeshStandardMaterial) {
    throw new TypeError('createRealisticGlassMaterial3D requires THREE.MeshStandardMaterial');
  }
  const usePhysical = typeof THREE.MeshPhysicalMaterial === 'function';
  const opts = {
    color,
    roughness,
    metalness,
    transparent: true,
    opacity: Math.max(0.02, Math.min(0.95, Number(opacity) || 0.24)),
    depthWrite: false,
    ...(side !== undefined ? { side } : {}),
  };
  if (usePhysical) {
    opts.clearcoat = clearcoat;
    opts.clearcoatRoughness = clearcoatRoughness;
    opts.ior = 1.5;
  }
  const mat = usePhysical ? new THREE.MeshPhysicalMaterial(opts) : new THREE.MeshStandardMaterial(opts);
  mat.userData.surfaceType = 'glass';
  return mat;
}
