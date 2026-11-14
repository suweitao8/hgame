/**
 * World-space projection for static Three.js/WebGL scenes.
 *
 * Inspired by the projection principle of Unreal WorldAlignedTexture, but this
 * is original JS/GLSL code; no Unreal material graph, shader or textures are
 * copied. All static meshes share world coordinates and material tile size.
 *
 * Projection:
 *   planar    1 filtered texture read (world XZ, for floor/ceiling)
 *   triplanar 3 reads weighted by world-space surface normal
 * Optional packed detail RGBA: R/G = signed height-gradient normals,
 * B = roughness multiplier, A = ambient occlusion. Both base color and
 * detail reuse exactly the same world UV/axis weights.
 * Both preserve MeshStandardMaterial PBR lights/shadows/tone mapping.
 *
 * For moving/skinned objects world-space patterns swim. Use only for static
 * scenery; a local/object-space variant is a separate future option.
 */
const PATTERNS = new Set(['stone', 'wood', 'concrete', 'soil', 'grass', 'plaster', 'metal', 'smooth']);
const PROJECTIONS = new Set(['planar', 'triplanar']);
const isColor = v => typeof v === 'string' && /^#[a-f0-9]{6}$/i.test(v);
const finiteRange = (v, name, min, max) => {
  if (!Number.isFinite(v) || v < min || v > max) {
    throw new RangeError(name + ' must be finite in [' + min + ', ' + max + ']');
  }
  return v;
};
const position3 = p => {
  if (!Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite)) {
    throw new TypeError('Expected world position [x,y,z]');
  }
  return [...p];
};
const optionsFor = input => {
  const options = input ?? {};
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('World material options must be an object');
  }
  const projection = options.projection ?? 'triplanar';
  const pattern = options.pattern ?? 'stone';
  const color = options.color ?? '#c3c7c8';
  if (!PROJECTIONS.has(projection)) throw new Error('Unsupported projection: ' + projection);
  if (!PATTERNS.has(pattern)) throw new Error('Unsupported procedural pattern: ' + pattern);
  if (!isColor(color)) throw new Error('World material color must be #RRGGBB');
  const offset = position3(options.offset ?? [0, 0, 0]);
  return {
    projection, pattern, color,
    tileSize: finiteRange(options.tileSize ?? 1, 'tileSize', 0.01, 10000),
    blendSharpness: finiteRange(options.blendSharpness ?? 6, 'blendSharpness', 0.1, 32),
    roughness: finiteRange(options.roughness ?? 0.83, 'roughness', 0, 1),
    metalness: finiteRange(options.metalness ?? 0, 'metalness', 0, 1),
    opacity: finiteRange(options.opacity ?? 1, 'opacity', 0, 1),
    transparent: options.transparent === true,
    offset,
    flatShading: options.flatShading === true,
    emissive: options.emissive ?? '#000000',
    emissiveIntensity: finiteRange(options.emissiveIntensity ?? 0,
      'emissiveIntensity', 0, 6),
    normalStrength: finiteRange(options.normalStrength ?? 0, 'normalStrength', 0, 1),
    roughnessVariation: finiteRange(options.roughnessVariation ?? 0, 'roughnessVariation', 0, 1),
    aoIntensity: finiteRange(options.aoIntensity ?? 0, 'aoIntensity', 0, 1),
    specularAA: options.specularAA === true,
    anisotropy: finiteRange(options.anisotropy ?? 4, 'anisotropy', 1, 16),
  };
};

/**
 * Adds screen-space normal-derivative roughness filtering to any PBR material
 * to suppress subpixel specular shimmering without disabling sharp highlights up close.
 */
export function applyGeometricSpecularAA(material, { strength = 1.0, maxRoughnessBoost = 0.35 } = {}) {
  if (!material || typeof material !== 'object') {
    throw new TypeError('applyGeometricSpecularAA requires a Three.js material');
  }
  const aaStrength = finiteRange(strength, 'strength', 0, 4);
  const maxBoost = finiteRange(maxRoughnessBoost, 'maxRoughnessBoost', 0, 1);
  if (material.userData?.specularAA) return material;

  const prevCompile = material.onBeforeCompile;
  const prevCacheKey = typeof material.customProgramCacheKey === 'function'
    ? material.customProgramCacheKey.bind(material)
    : () => '';

  material.customProgramCacheKey = () => {
    const base = prevCacheKey();
    return base ? base + ':specaa' : 'specaa';
  };
  material.onBeforeCompile = (shader, renderer) => {
    if (typeof prevCompile === 'function') prevCompile.call(material, shader, renderer);
    shader.uniforms.uSpecAAStrength = { value: aaStrength };
    shader.uniforms.uSpecAAMaxBoost = { value: maxBoost };

    const snippet = `
      vec3 specDndu = dFdx(normal);
      vec3 specDndv = dFdy(normal);
      float specVar = uSpecAAStrength * (dot(specDndu, specDndu) + dot(specDndv, specDndv));
      float specKernel = min(2.0 * specVar, uSpecAAMaxBoost * uSpecAAMaxBoost);
    `;
    if (shader.fragmentShader.includes('#include <lights_physical_fragment>')) {
      shader.fragmentShader = `
        uniform float uSpecAAStrength;
        uniform float uSpecAAMaxBoost;
      ` + shader.fragmentShader.replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>' + snippet + `
        material.roughness = clamp(sqrt(material.roughness * material.roughness + specKernel), 0.04, 1.0);
      `);
    } else if (shader.fragmentShader.includes('#include <normal_fragment_maps>')) {
      shader.fragmentShader = `
        uniform float uSpecAAStrength;
        uniform float uSpecAAMaxBoost;
      ` + shader.fragmentShader.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>' + snippet + `
        roughnessFactor = clamp(sqrt(roughnessFactor * roughnessFactor + specKernel), 0.04, 1.0);
      `);
    }
  };
  material.userData ??= {};
  material.userData.specularAA = Object.freeze({ strength: aaStrength, maxRoughnessBoost: maxBoost });
  material.needsUpdate = true;
  return material;
}

/** Y-up; exact same world coordinates on adjacent meshes produce same UV. */
export function worldProjectUV(position, axis, options = {}) {
  const p = position3(position);
  if (!['x', 'y', 'z'].includes(axis)) throw new Error('Unknown projection axis');
  const tileSize = finiteRange(options.tileSize ?? 1, 'tileSize', 0.01, 10000);
  const offset = position3(options.offset ?? [0, 0, 0]);
  const q = p.map((v, i) => (v + offset[i]) / tileSize);
  return axis === 'x' ? [q[2], q[1]] :
    axis === 'y' ? [q[0], q[2]] : [q[0], q[1]];
}

export function triplanarWeights(normal, sharpness = 6) {
  const n = position3(normal);
  finiteRange(sharpness, 'sharpness', 0.1, 32);
  const len = Math.hypot(...n);
  if (len < 1e-12) throw new Error('Zero normal is not a valid triplanar axis');
  const weights = n.map(x => Math.pow(Math.abs(x / len), sharpness));
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map(x => x / total);
}

function hashGrid(x, y, seed) {
  let v = Math.imul(x + 137, 374761393) ^
    Math.imul(y + 733, 668265263) ^ Math.imul(seed + 59, 2246822519);
  v = Math.imul(v ^ (v >>> 13), 1274126177);
  return ((v ^ (v >>> 16)) >>> 0) / 4294967295;
}
function tileNoise(u, v, count, seed) {
  const xx = u * count, yy = v * count;
  const ax = Math.floor(xx), ay = Math.floor(yy);
  const tx = xx - ax, ty = yy - ay;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const wrap = i => (i % count + count) % count;
  const a = hashGrid(wrap(ax), wrap(ay), seed);
  const b = hashGrid(wrap(ax + 1), wrap(ay), seed);
  const c = hashGrid(wrap(ax), wrap(ay + 1), seed);
  const d = hashGrid(wrap(ax + 1), wrap(ay + 1), seed);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}
function texturePixel(pattern, u, v) {
  const seed = { stone: 7, wood: 19, concrete: 31, soil: 47, grass: 61,
    plaster: 83, metal: 97, smooth: 113 }[pattern];
  const low = tileNoise(u, v, 4, seed);
  const mid = tileNoise(u, v, 16, seed + 10);
  const fine = tileNoise(u, v, 64, seed + 22);
  let grain = (low - 0.5) * 0.28 + (mid - 0.5) * 0.15 + (fine - 0.5) * 0.055;
  if (pattern === 'wood') {
    // Broad stylized planks, not Minecraft-pixel noise.
    grain += Math.sin((v * 9 + 0.065 * mid) * Math.PI * 2) * 0.075;
  } else if (pattern === 'stone') {
    grain += (mid > 0.62 ? -0.045 : 0);
  } else if (pattern === 'metal') {
    grain = (low - 0.5) * 0.08 + (fine - 0.5) * 0.065;
  } else if (pattern === 'smooth') {
    grain *= 0.10;
  } else if (pattern === 'plaster') {
    grain *= 0.38;
  }
  return Math.max(0.32, Math.min(1, 0.84 + grain));
}

/** In-memory high-res repeatable maps; linear/mipmap filtering (not MC pixels). */
export function createSmoothProceduralTexture(THREE, pattern = 'stone', resolution = 256) {
  if (!THREE?.DataTexture || !PATTERNS.has(pattern) ||
      !Number.isInteger(resolution) || resolution < 128 || resolution > 1024) {
    throw new TypeError('High resolution Three.js texture and supported pattern required');
  }
  const pixels = new Uint8Array(resolution * resolution * 4);
  for (let y = 0; y < resolution; y++) {
    for (let x = 0; x < resolution; x++) {
      const brightness = Math.round(texturePixel(pattern, x / resolution, y / resolution) * 255);
      const i = (y * resolution + x) * 4;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = brightness;
      pixels[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(pixels, resolution, resolution, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  texture.name = 'procedural-world-' + pattern;
  return texture;
}

/**
 * Reuse the exact same periodic material noise used by albedo to build
 * non-color data: world-space perturbation slopes, roughness, and AO.
 * Channel packing avoids separate GPU texture requests for each PBR detail.
 * This is lightweight authored procedural relief, not copied UE textures.
 */
export function createSmoothProceduralDetailTexture(THREE, pattern = 'stone', resolution = 256) {
  if (!THREE?.DataTexture || !PATTERNS.has(pattern) ||
      !Number.isInteger(resolution) || resolution < 128 || resolution > 1024) {
    throw new TypeError('High resolution Three.js detail texture and supported pattern required');
  }
  const pixels = new Uint8Array(resolution * resolution * 4);
  const clamp01 = value => Math.max(0, Math.min(1, value));
  for (let y = 0; y < resolution; y++) {
    for (let x = 0; x < resolution; x++) {
      const u = x / resolution, v = y / resolution;
      const center = texturePixel(pattern, u, v);
      const slopeX = texturePixel(pattern, (x + 1) / resolution, v) -
        texturePixel(pattern, (x - 1) / resolution, v);
      const slopeY = texturePixel(pattern, u, (y + 1) / resolution) -
        texturePixel(pattern, u, (y - 1) / resolution);
      const i = (y * resolution + x) * 4;
      pixels[i] = Math.round(clamp01(0.5 - slopeX * 2.4) * 255);
      pixels[i + 1] = Math.round(clamp01(0.5 - slopeY * 2.4) * 255);
      pixels[i + 2] = Math.round(clamp01(0.54 + center * 0.44) * 255);
      pixels[i + 3] = Math.round(clamp01(0.52 + center * 0.46) * 255);
    }
  }
  const texture = new THREE.DataTexture(pixels, resolution, resolution, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  // Normals, roughness, and AO are linear signals, never sRGB colors.
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  texture.name = 'procedural-world-detail-' + pattern;
  return texture;
}

function makeMaterial(THREE, input, sharedTexture, sharedDetailTexture) {
  if (!THREE?.MeshStandardMaterial || !THREE?.Vector3) {
    throw new TypeError('A complete Three.js namespace is required');
  }
  const o = optionsFor(input);
  const tex = sharedTexture ?? createSmoothProceduralTexture(THREE, o.pattern);
  const needsDetail = o.normalStrength > 0 || o.roughnessVariation > 0 || o.aoIntensity > 0;
  const detail = needsDetail ?
    (sharedDetailTexture ?? createSmoothProceduralDetailTexture(THREE, o.pattern)) : null;
  const mat = new THREE.MeshStandardMaterial({
    color: o.color, roughness: o.roughness, metalness: o.metalness,
    transparent: o.transparent, opacity: o.opacity, flatShading: o.flatShading,
    emissive: o.emissive, emissiveIntensity: o.emissiveIntensity,
  });
  mat.userData.worldAligned = Object.freeze({
    projection: o.projection, pattern: o.pattern, tileSize: o.tileSize,
    blendSharpness: o.blendSharpness, texture: tex, detailTexture: detail,
    normalStrength: o.normalStrength, roughnessVariation: o.roughnessVariation,
    aoIntensity: o.aoIntensity, offset: [...o.offset],
  });
  const uniform = {
    uWorldAlignedTexture: { value: tex },
    uWorldAlignedTile: { value: o.tileSize },
    uWorldAlignedOffset: { value: new THREE.Vector3(...o.offset) },
    uWorldAlignedSharpness: { value: o.blendSharpness },
  };
  if (detail) {
    uniform.uWorldAlignedDetailTexture = { value: detail };
    uniform.uWorldAlignedNormalStrength = { value: o.normalStrength };
    uniform.uWorldAlignedRoughnessVariation = { value: o.roughnessVariation };
    uniform.uWorldAlignedAOIntensity = { value: o.aoIntensity };
  }
  const detailFlags = [
    o.normalStrength > 0 ? 'N' : '',
    o.roughnessVariation > 0 ? 'R' : '',
    o.aoIntensity > 0 ? 'A' : '',
  ].join('');
  mat.customProgramCacheKey = () => 'world-aligned-v2:' + o.projection +
    (detail ? ':detail:' + detailFlags : '');
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniform);
    const vMarker = '#include <project_vertex>';
    if (!shader.vertexShader.includes(vMarker)) throw new Error('Three.js vertex shader chunk changed');
    shader.vertexShader = `
      varying vec3 vWorldAlignedPos;
      varying vec3 vWorldAlignedNormal;
    ` + shader.vertexShader.replace(vMarker, vMarker + `
      vec4 waWorld = vec4(transformed, 1.0);
      vec3 waNormal = normal;
      #ifdef USE_INSTANCING
        waWorld = instanceMatrix * waWorld;
        waNormal = mat3(instanceMatrix) * waNormal;
      #endif
      #ifdef USE_BATCHING
        waWorld = batchingMatrix * waWorld;
      #endif
      vWorldAlignedPos = (modelMatrix * waWorld).xyz;
      vWorldAlignedNormal = normalize(mat3(modelMatrix) * waNormal);
    `);
    const fragMarker = '#include <map_fragment>';
    if (!shader.fragmentShader.includes(fragMarker)) throw new Error('Three.js fragment shader chunk changed');
    const sample = o.projection === 'planar'
      ? `vec3 waColor = texture2D(uWorldAlignedTexture, waP.xz).rgb;`
      : `
        vec3 triWeights = pow(max(abs(normalize(vWorldAlignedNormal)), vec3(0.000001)),
          vec3(uWorldAlignedSharpness));
        triWeights /= max(dot(triWeights, vec3(1.0)), 0.000001);
        vec3 waColor =
          texture2D(uWorldAlignedTexture, waP.zy).rgb * triWeights.x +
          texture2D(uWorldAlignedTexture, waP.xz).rgb * triWeights.y +
          texture2D(uWorldAlignedTexture, waP.xy).rgb * triWeights.z;
      `;
    const detailSample = !detail ? '' :
      o.projection === 'planar' ? `
        vec4 waDetail = texture2D(uWorldAlignedDetailTexture, waP.xz);
        ${o.normalStrength > 0 ? `
          vec2 waSlope = waDetail.rg * 2.0 - 1.0;
          vec3 waNormalDelta = vec3(waSlope.x, 0.0, waSlope.y);
        ` : ''}
      ` : `
        vec4 waDetailX = texture2D(uWorldAlignedDetailTexture, waP.zy);
        vec4 waDetailY = texture2D(uWorldAlignedDetailTexture, waP.xz);
        vec4 waDetailZ = texture2D(uWorldAlignedDetailTexture, waP.xy);
        vec4 waDetail = waDetailX * triWeights.x +
          waDetailY * triWeights.y + waDetailZ * triWeights.z;
        ${o.normalStrength > 0 ? `
          vec2 waSlopeX = waDetailX.rg * 2.0 - 1.0;
          vec2 waSlopeY = waDetailY.rg * 2.0 - 1.0;
          vec2 waSlopeZ = waDetailZ.rg * 2.0 - 1.0;
          vec3 waNormalDelta =
            vec3(0.0, waSlopeX.y, waSlopeX.x) * triWeights.x +
            vec3(waSlopeY.x, 0.0, waSlopeY.y) * triWeights.y +
            vec3(waSlopeZ.x, waSlopeZ.y, 0.0) * triWeights.z;
        ` : ''}
      `;
    shader.fragmentShader = `
      uniform sampler2D uWorldAlignedTexture;
      uniform float uWorldAlignedTile;
      uniform float uWorldAlignedSharpness;
      uniform vec3 uWorldAlignedOffset;
      ${detail ? `
        uniform sampler2D uWorldAlignedDetailTexture;
        uniform float uWorldAlignedNormalStrength;
        uniform float uWorldAlignedRoughnessVariation;
        uniform float uWorldAlignedAOIntensity;
      ` : ''}
      varying vec3 vWorldAlignedPos;
      varying vec3 vWorldAlignedNormal;
    ` + shader.fragmentShader.replace(fragMarker, fragMarker + `
      vec3 waP = (vWorldAlignedPos + uWorldAlignedOffset) / uWorldAlignedTile;
      ${sample}
      diffuseColor.rgb *= waColor;
      ${detailSample}
    `);
    if (o.roughnessVariation > 0) {
      const marker = '#include <roughnessmap_fragment>';
      if (!shader.fragmentShader.includes(marker)) {
        throw new Error('Three.js roughness shader chunk changed');
      }
      shader.fragmentShader = shader.fragmentShader.replace(marker, marker + `
        roughnessFactor *= mix(1.0, waDetail.b, uWorldAlignedRoughnessVariation);
      `);
    }
    if (o.normalStrength > 0) {
      const marker = '#include <normal_fragment_maps>';
      if (!shader.fragmentShader.includes(marker)) throw new Error('Three.js normal shader chunk changed');
      shader.fragmentShader = shader.fragmentShader.replace(marker, marker + `
        // World-aligned detail perturbs the world normal before light evaluation.
        // Flat detail (waNormalDelta=0) retains the original geometry normal.
        vec3 waWorldNormal = normalize(vWorldAlignedNormal +
          waNormalDelta * uWorldAlignedNormalStrength);
        #ifdef DOUBLE_SIDED
          waWorldNormal *= faceDirection;
        #endif
        normal = normalize(mat3(viewMatrix) * waWorldNormal);
      `);
    }
    if (o.aoIntensity > 0) {
      const marker = '#include <aomap_fragment>';
      if (!shader.fragmentShader.includes(marker)) throw new Error('Three.js AO shader chunk changed');
      shader.fragmentShader = shader.fragmentShader.replace(marker, marker + `
        // AO affects indirect lighting only; avoid dimming direct sun/lamps.
        float waAO = mix(1.0, waDetail.a, uWorldAlignedAOIntensity);
        reflectedLight.indirectDiffuse *= waAO;
        #if defined( USE_ENVMAP ) && defined( STANDARD )
          float waDotNV = saturate(dot(geometryNormal, geometryViewDir));
          reflectedLight.indirectSpecular *=
            computeSpecularOcclusion(waDotNV, waAO, material.roughness);
        #endif
      `);
    }
  };
  if (!sharedTexture) tex.anisotropy = o.anisotropy;
  if (detail && !sharedDetailTexture) detail.anisotropy = o.anisotropy;
  if (o.specularAA) applyGeometricSpecularAA(mat, input?.specularAAOptions);
  // Palette-owned textures must be disposed by palette.dispose(), not by a
  // single shared material. Standalone callers own the generated textures.
  mat.userData.ownsTexture = !sharedTexture;
  mat.userData.ownsDetailTexture = Boolean(detail && !sharedDetailTexture);
  mat.userData.worldAlignedOffsetUniform = uniform.uWorldAlignedOffset;
  return mat;
}

export function createWorldAlignedMaterial(THREE, options = {}) {
  return makeMaterial(THREE, options);
}

export function createWorldMaterialPalette(THREE, definitions, paletteOptions = {}) {
  if (!definitions || typeof definitions !== 'object' || Array.isArray(definitions)) {
    throw new TypeError('Material palette needs a dictionary');
  }
  const defaultAnisotropy = finiteRange(paletteOptions?.anisotropy ?? 4, 'anisotropy', 1, 16);
  const defaultSpecularAA = paletteOptions?.specularAA === true;
  const textures = new Map();
  const detailTextures = new Map();
  const materials = new Map();
  for (const [name, config] of Object.entries(definitions)) {
    if (!/^[a-z][a-z0-9-]{0,47}$/.test(name)) throw new Error('Invalid material name');
    const mergedConfig = {
      anisotropy: defaultAnisotropy,
      specularAA: defaultSpecularAA,
      ...(config && typeof config === 'object' ? config : {}),
    };
    const o = optionsFor(mergedConfig);
    if (!textures.has(o.pattern)) {
      const tex = createSmoothProceduralTexture(THREE, o.pattern);
      tex.anisotropy = o.anisotropy;
      textures.set(o.pattern, tex);
    }
    const needsDetail = o.normalStrength > 0 || o.roughnessVariation > 0 || o.aoIntensity > 0;
    if (needsDetail && !detailTextures.has(o.pattern)) {
      const detail = createSmoothProceduralDetailTexture(THREE, o.pattern);
      detail.anisotropy = o.anisotropy;
      detailTextures.set(o.pattern, detail);
    }
    materials.set(name, makeMaterial(THREE, o, textures.get(o.pattern),
      detailTextures.get(o.pattern)));
  }
  let disposed = false;
  return {
    get(name) {
      if (disposed) throw new Error('World material palette disposed');
      if (!materials.has(name)) throw new Error('Unknown world material: ' + name);
      return materials.get(name);
    },
    setAnisotropy(value) {
      if (disposed) return;
      const next = finiteRange(value, 'anisotropy', 1, 16);
      for (const tex of textures.values()) {
        tex.anisotropy = next;
        tex.needsUpdate = true;
      }
      for (const tex of detailTextures.values()) {
        tex.anisotropy = next;
        tex.needsUpdate = true;
      }
    },
    shiftOffset(dx = 0, dy = 0, dz = 0) {
      if (disposed) return;
      for (const mat of materials.values()) {
        const u = mat.userData?.worldAlignedOffsetUniform?.value;
        if (u) {
          u.x += dx;
          u.y += dy;
          u.z += dz;
        }
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const mat of materials.values()) mat.dispose();
      for (const tex of textures.values()) tex.dispose();
      for (const tex of detailTextures.values()) tex.dispose();
      materials.clear();
      textures.clear();
      detailTextures.clear();
    },
    get stats() {
      return {
        materials: materials.size,
        uniqueTextures: textures.size,
        uniqueDetailTextures: detailTextures.size,
      };
    },
  };
}
