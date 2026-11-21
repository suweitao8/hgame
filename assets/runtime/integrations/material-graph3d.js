/**
 * Composable declarative 3D PBR material system with shared constant uniform blocks,
 * deterministic shader program cache keys (avoiding ad-hoc onBeforeCompile collisions),
 * and modular surface features (Fresnel rim glow, procedural Dissolve, Triplanar UV scale,
 * and Geometric Specular AA). Zero direct 'three' imports.
 */

/**
 * Shared shader uniform block reused across multiple materials so time, wind, or
 * global atmospheric uniforms update once without per-material traversal.
 */
export function createSharedMaterialBlock3D(initialUniforms = {}) {
  const uniforms = Object.create(null);
  let version = 1;

  for (const [k, v] of Object.entries(initialUniforms)) {
    uniforms[k] = { value: v };
  }

  function set(name, value) {
    if (name in uniforms) {
      if (uniforms[name].value !== value) {
        uniforms[name].value = value;
        version++;
      }
    } else {
      uniforms[name] = { value };
      version++;
    }
  }

  function get(name) {
    return uniforms[name]?.value;
  }

  return {
    get version() { return version; },
    get uniforms() { return uniforms; },
    set,
    get,
  };
}

/**
 * Build a declarative PBR material combining standard/physical base properties
 * with deterministic shader modules (`fresnel`, `dissolve`, `triplanar`, `specularAA`, `windSway`)
 * and optional `sharedBlock` uniforms.
 *
 * @param {object} THREE Three.js namespace or compatible mock.
 * @param {object} [options]
 */
export function createComposableMaterial3D(THREE, {
  color = 0xffffff,
  roughness = 0.65,
  metalness = 0.05,
  clearcoat = 0,
  clearcoatRoughness = 0.15,
  emissive = 0x000000,
  emissiveIntensity = 1,
  transparent = false,
  opacity = 1,
  side,
  fresnel = null,
  dissolve = null,
  triplanar = null,
  specularAA = false,
  windSway = null,
  sharedBlock = null,
  vertexChunks = [],
  fragmentChunks = [],
} = {}) {
  if (!THREE?.MeshStandardMaterial) {
    throw new TypeError('createComposableMaterial3D requires THREE.MeshStandardMaterial');
  }

  const usePhysical = clearcoat > 0 && typeof THREE.MeshPhysicalMaterial === 'function';
  const matOpts = {
    color,
    roughness,
    metalness,
    emissive,
    emissiveIntensity,
    transparent,
    opacity,
  };
  if (side !== undefined) matOpts.side = side;
  if (usePhysical) {
    matOpts.clearcoat = clearcoat;
    matOpts.clearcoatRoughness = clearcoatRoughness;
  }

  const material = usePhysical
    ? new THREE.MeshPhysicalMaterial(matOpts)
    : new THREE.MeshStandardMaterial(matOpts);

  const hasFresnel = Boolean(fresnel);
  const hasDissolve = Boolean(dissolve);
  const hasTriplanar = Boolean(triplanar);
  const hasSpecularAA = Boolean(specularAA);
  const hasWindSway = Boolean(windSway);
  const windWeightMode = windSway?.weightMode === 'vertexColor' ? 'vertexColor' : 'height';

  const features = [];
  if (hasFresnel) features.push('fresnel');
  if (hasDissolve) features.push('dissolve');
  if (hasTriplanar) features.push('triplanar');
  if (hasSpecularAA) features.push('specularAA');
  if (hasWindSway) features.push(`wind:${windWeightMode}`);
  if (sharedBlock) features.push('sharedBlock');

  const cacheKey = `hgame-matgraph-v1:${usePhysical ? 'phys' : 'std'}:${features.join('+') || 'base'}:${vertexChunks.length}:${fragmentChunks.length}`;
  material.customProgramCacheKey = () => cacheKey;

  const windDirRaw = Array.isArray(windSway?.direction) ? windSway.direction : [1, 0, 0.35];
  const windDirLen = Math.hypot(windDirRaw[0] ?? 1, windDirRaw[1] ?? 0, windDirRaw[2] ?? 0.35) || 1;
  const featureUniforms = {
    uFresnelColor: { value: THREE.Color ? new THREE.Color(fresnel?.color ?? 0x66e0ff) : { r: 0.4, g: 0.88, b: 1 } },
    uFresnelPower: { value: Number.isFinite(fresnel?.power) ? fresnel.power : 3.0 },
    uFresnelStrength: { value: Number.isFinite(fresnel?.strength) ? fresnel.strength : 0.8 },
    uDissolveThreshold: { value: Number.isFinite(dissolve?.threshold) ? dissolve.threshold : 0.0 },
    uDissolveEdgeWidth: { value: Number.isFinite(dissolve?.edgeWidth) ? dissolve.edgeWidth : 0.08 },
    uDissolveEdgeColor: { value: THREE.Color ? new THREE.Color(dissolve?.edgeColor ?? 0xff6b2b) : { r: 1, g: 0.42, b: 0.17 } },
    uTriplanarScale: { value: Number.isFinite(triplanar?.scale) ? triplanar.scale : 0.25 },
    uWindTime: { value: Number.isFinite(windSway?.time) ? windSway.time : 0.0 },
    uWindAmp: { value: Number.isFinite(windSway?.amplitude) ? windSway.amplitude : 0.12 },
    uWindFreq: { value: Number.isFinite(windSway?.frequency) ? windSway.frequency : 2.2 },
    uWindDir: {
      value: THREE.Vector3
        ? new THREE.Vector3(
            (windDirRaw[0] ?? 1) / windDirLen,
            (windDirRaw[1] ?? 0) / windDirLen,
            (windDirRaw[2] ?? 0.35) / windDirLen,
          )
        : {
            x: (windDirRaw[0] ?? 1) / windDirLen,
            y: (windDirRaw[1] ?? 0) / windDirLen,
            z: (windDirRaw[2] ?? 0.35) / windDirLen,
          },
    },
    uWindRange: {
      value: THREE.Vector2
        ? new THREE.Vector2(Number.isFinite(windSway?.minY) ? windSway.minY : 0, Number.isFinite(windSway?.maxY) ? windSway.maxY : 1.5)
        : { x: Number.isFinite(windSway?.minY) ? windSway.minY : 0, y: Number.isFinite(windSway?.maxY) ? windSway.maxY : 1.5 },
    },
  };

  if (features.length > 0 || vertexChunks.length > 0 || fragmentChunks.length > 0) {
    material.onBeforeCompile = shader => {
      if (sharedBlock?.uniforms) {
        for (const [k, u] of Object.entries(sharedBlock.uniforms)) {
          shader.uniforms[k] = u;
        }
      }
      if (hasFresnel) {
        shader.uniforms.uFresnelColor = featureUniforms.uFresnelColor;
        shader.uniforms.uFresnelPower = featureUniforms.uFresnelPower;
        shader.uniforms.uFresnelStrength = featureUniforms.uFresnelStrength;
      }
      if (hasDissolve) {
        shader.uniforms.uDissolveThreshold = featureUniforms.uDissolveThreshold;
        shader.uniforms.uDissolveEdgeWidth = featureUniforms.uDissolveEdgeWidth;
        shader.uniforms.uDissolveEdgeColor = featureUniforms.uDissolveEdgeColor;
      }
      if (hasTriplanar) {
        shader.uniforms.uTriplanarScale = featureUniforms.uTriplanarScale;
      }
      if (hasWindSway) {
        shader.uniforms.uWindTime = sharedBlock?.uniforms?.uTime ?? featureUniforms.uWindTime;
        shader.uniforms.uWindAmp = featureUniforms.uWindAmp;
        shader.uniforms.uWindFreq = featureUniforms.uWindFreq;
        shader.uniforms.uWindDir = featureUniforms.uWindDir;
        shader.uniforms.uWindRange = featureUniforms.uWindRange;
      }

      const vertDecls = [];
      const beginInjections = [];
      if (hasDissolve || hasTriplanar) {
        vertDecls.push('varying vec3 vHgameLocalPos;', 'varying vec3 vHgameWorldPos;');
      }
      if (hasWindSway) {
        vertDecls.push(
          'uniform float uWindTime;',
          'uniform float uWindAmp;',
          'uniform float uWindFreq;',
          'uniform vec3 uWindDir;',
          'uniform vec2 uWindRange;',
        );
        const weightExpr = windWeightMode === 'vertexColor'
          ? '#ifdef USE_COLOR\n  float _wWeight = clamp(color.r, 0.0, 1.0);\n#else\n  float _wWeight = clamp((transformed.y - uWindRange.x) / max(0.001, uWindRange.y - uWindRange.x), 0.0, 1.0);\n#endif'
          : 'float _wWeight = clamp((transformed.y - uWindRange.x) / max(0.001, uWindRange.y - uWindRange.x), 0.0, 1.0);';
        beginInjections.push(
          '{',
          weightExpr,
          '  float _wPhase = uWindTime * uWindFreq + dot(modelMatrix[3].xyz, vec3(1.7, 0.5, 2.3)) + transformed.x * 1.5 + transformed.z * 1.2;',
          '  float _wSway = sin(_wPhase) + 0.35 * sin(_wPhase * 2.13 + 0.9);',
          '  transformed += uWindDir * (_wSway * uWindAmp * _wWeight * _wWeight);',
          '}',
        );
      }
      if (hasDissolve || hasTriplanar) {
        beginInjections.push(
          'vHgameLocalPos = position;',
          'vHgameWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        );
      }
      if (vertDecls.length > 0 && shader.vertexShader.includes('#include <begin_vertex>')) {
        shader.vertexShader = vertDecls.join('\n') + '\n' + shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\n' + beginInjections.join('\n'),
        );
      }

      for (const chunk of vertexChunks) {
        if (chunk?.marker && chunk?.code && shader.vertexShader.includes(chunk.marker)) {
          shader.vertexShader = shader.vertexShader.replace(chunk.marker, chunk.code);
        }
      }

      const fragDecls = [];
      if (hasDissolve || hasTriplanar) fragDecls.push('varying vec3 vHgameLocalPos;\nvarying vec3 vHgameWorldPos;');
      if (hasFresnel) fragDecls.push('uniform vec3 uFresnelColor;\nuniform float uFresnelPower;\nuniform float uFresnelStrength;');
      if (hasDissolve) fragDecls.push('uniform float uDissolveThreshold;\nuniform float uDissolveEdgeWidth;\nuniform vec3 uDissolveEdgeColor;');
      if (hasTriplanar) fragDecls.push('uniform float uTriplanarScale;');

      if (fragDecls.length > 0) {
        shader.fragmentShader = fragDecls.join('\n') + '\n' + shader.fragmentShader;
      }

      if (hasDissolve && shader.fragmentShader.includes('#include <color_fragment>')) {
        const dissolveBody = [
          '#include <color_fragment>',
          '{',
          '  float _dNoise = fract(sin(dot(floor(vHgameLocalPos * 12.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);',
          '  if (_dNoise < uDissolveThreshold) discard;',
          '  float _dEdge = 1.0 - smoothstep(0.0, max(0.001, uDissolveEdgeWidth), _dNoise - uDissolveThreshold);',
          '  diffuseColor.rgb = mix(diffuseColor.rgb, uDissolveEdgeColor * 2.0, _dEdge * step(0.001, uDissolveThreshold));',
          '}',
        ].join('\n');
        shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', dissolveBody);
      }

      if (hasSpecularAA && shader.fragmentShader.includes('#include <normal_fragment_maps>')) {
        const specAaBody = [
          '#include <normal_fragment_maps>',
          '{',
          '  vec3 _dNdx = dFdx(normal);',
          '  vec3 _dNdy = dFdy(normal);',
          '  float _varN = max(dot(_dNdx, _dNdx), dot(_dNdy, _dNdy));',
          '  roughnessFactor = clamp(sqrt(roughnessFactor * roughnessFactor + min(0.25, _varN * 0.5)), 0.04, 1.0);',
          '}',
        ].join('\n');
        shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', specAaBody);
      }

      if (hasFresnel && shader.fragmentShader.includes('#include <emissivemap_fragment>')) {
        const fresnelBody = [
          '#include <emissivemap_fragment>',
          '{',
          '  vec3 _viewDir = normalize(vViewPosition);',
          '  float _fresnel = pow(clamp(1.0 - abs(dot(normalize(normal), _viewDir)), 0.0, 1.0), max(0.25, uFresnelPower));',
          '  totalEmissiveRadiance += uFresnelColor * (_fresnel * uFresnelStrength);',
          '}',
        ].join('\n');
        shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', fresnelBody);
      }

      for (const chunk of fragmentChunks) {
        if (chunk?.marker && chunk?.code && shader.fragmentShader.includes(chunk.marker)) {
          shader.fragmentShader = shader.fragmentShader.replace(chunk.marker, chunk.code);
        }
      }
    };
  }

  material.userData.hgameUniforms = featureUniforms;
  material.userData.hgameMaterialGraph = {
    features,
    cacheKey,
    uniforms: featureUniforms,
    setWindTime(timeSeconds) {
      const t = Number.isFinite(timeSeconds) ? timeSeconds : 0;
      if (sharedBlock?.set && sharedBlock.uniforms?.uTime) {
        sharedBlock.set('uTime', t);
      } else {
        featureUniforms.uWindTime.value = t;
      }
      return t;
    },
    setFeatureParam(name, value) {
      const u = featureUniforms[name];
      if (!u) return false;
      if (u.value?.set && (typeof value === 'number' || typeof value === 'string')) {
        u.value.set(value);
      } else {
        u.value = value;
      }
      return true;
    },
  };
  material.needsUpdate = true;
  return material;
}

/**
 * Shared O(1) Material Batch Registry synchronizing global uniforms (`uTime`, `uWindDir`,
 * `uFogDensity`) across registered Three.js materials without per-material scene traversal.
 * @param {Record<string, any>} [initialSharedUniforms]
 */
export function createMaterialBatchRegistry3D(initialSharedUniforms = { uTime: 0, uFogDensity: 0 }) {
  const sharedBlock = createSharedMaterialBlock3D(initialSharedUniforms);
  const materials = new Set();

  function register(material) {
    if (!material || typeof material !== 'object') return false;
    materials.add(material);
    if (material.userData?.hgameUniforms) {
      for (const [k, u] of Object.entries(sharedBlock.uniforms)) {
        if (k in material.userData.hgameUniforms) {
          material.userData.hgameUniforms[k] = u;
        }
      }
    }
    return true;
  }

  function unregister(material) {
    return materials.delete(material);
  }

  function setGlobal(name, value) {
    sharedBlock.set(name, value);
    return value;
  }

  function updateFrame(dt = 0, overrides = null) {
    const curTime = Number(sharedBlock.get('uTime')) || 0;
    sharedBlock.set('uTime', curTime + Math.max(0, Number(dt) || 0));
    if (overrides && typeof overrides === 'object') {
      for (const [k, v] of Object.entries(overrides)) {
        sharedBlock.set(k, v);
      }
    }
    return sharedBlock.version;
  }

  function getStats() {
    return Object.freeze({
      registeredCount: materials.size,
      version: sharedBlock.version,
      uniformKeys: Object.keys(sharedBlock.uniforms),
    });
  }

  return Object.freeze({
    sharedBlock,
    register,
    unregister,
    setGlobal,
    updateFrame,
    getStats,
  });
}
