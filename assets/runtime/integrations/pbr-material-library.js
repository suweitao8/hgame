/**
 * Curated PBR material loader for caller-supplied local catalogs.
 *
 * Canonical input files:
 *   color = sRGB base color
 *   normal = OpenGL tangent-space XYZ (+Y)
 *   orm = linear RGB (R ambient occlusion, G roughness, B metallic)
 *
 * World-space planar/triplanar projection shares the same origin & tileSize
 * for all three textures. This code is independently authored and does not
 * include or copy Unreal shaders. Only use on static scenery: world-space
 * texture swimming is expected on animated characters/moving props.
 */
/** @typedef {import('./world-aligned-material.js').WorldTextureLike} PbrTextureLike */
/** @typedef {import('./world-aligned-material.js').WorldMaterialLike} PbrMaterialLike */
/** @typedef {import('./world-aligned-material.js').WorldProjection} PbrProjection */
/**
 * @typedef {object} PbrThree The subset of the THREE namespace used for world-aligned PBR materials.
 * @property {new (parameters?: object) => PbrMaterialLike} MeshStandardMaterial
 * @property {new (x?: number, y?: number, z?: number) => { x: number, y: number, z: number }} Vector3
 * @property {number} FrontSide
 */
/**
 * @typedef {object} PbrProjectionOptions
 * @property {PbrProjection} [projection='triplanar']
 * @property {number} [tileSize=1] World units per texture repeat, 0.01..1000.
 * @property {number} [blendSharpness=6] Triplanar blend exponent, 0.1..32.
 * @property {number} [aoIntensity=1] Ambient-occlusion strength, 0..1.
 * @property {number} [normalStrength=1] Normal-map strength, 0..2.
 */
/**
 * @typedef {PbrProjectionOptions & { color: PbrTextureLike, normal: PbrTextureLike, orm: PbrTextureLike }} WorldAlignedPbrOptions
 * color = sRGB base colour; normal = OpenGL tangent-space map; orm = linear (R AO, G roughness, B metallic).
 */
/**
 * @typedef {object} PbrCatalogEntry
 * @property {string} id Matches `[a-z][a-z0-9-]{0,100}`.
 * @property {string} color Relative `textures/<sha256>.png|webp` path.
 * @property {string} normal Relative texture path.
 * @property {string} orm Relative texture path.
 * @property {string} [name]
 * @property {string} [category]
 * @property {number} [tileSize] Default tile size in world units.
 * @property {PbrProjection} [projection]
 */
/**
 * @typedef {object} PbrCatalog
 * @property {1} version
 * @property {PbrCatalogEntry[]} materials At most 2000 entries.
 */
/**
 * @typedef {object} PbrLibraryThree THREE namespace for {@link loadCuratedPbrLibrary}; extends {@link PbrThree}.
 * @property {new () => { loadAsync(url: string): Promise<PbrTextureLike> }} TextureLoader
 * @property {new (parameters?: object) => PbrMaterialLike} MeshStandardMaterial
 * @property {new (x?: number, y?: number, z?: number) => { x: number, y: number, z: number }} Vector3
 * @property {number} FrontSide
 * @property {number} RepeatWrapping
 * @property {number} LinearFilter
 * @property {number} LinearMipmapLinearFilter
 * @property {string} SRGBColorSpace
 * @property {string} NoColorSpace
 */
/**
 * @typedef {object} PbrLibraryOptions
 * @property {PbrLibraryThree} THREE
 * @property {string} catalogUrl HTTP(S) URL of the catalog JSON (relative allowed).
 * @property {((url: string) => Promise<PbrCatalog>)|null} [fetchJson=null] Custom catalog fetcher; defaults to fetch().
 * @property {{ loadAsync(url: string): Promise<PbrTextureLike> }|null} [textureLoader=null] Defaults to `new THREE.TextureLoader()`.
 */
/**
 * @typedef {object} PbrLibraryListItem
 * @property {string} id
 * @property {string|undefined} name
 * @property {string|undefined} category
 * @property {number|undefined} tileSize
 */
/**
 * @typedef {object} PbrLibraryStats
 * @property {number} materials Cached material variants.
 * @property {number} textures Cached textures.
 * @property {number} entries Catalog entries.
 */
/**
 * @typedef {object} PbrLibrary
 * @property {() => PbrLibraryListItem[]} list
 * @property {(id: string, options?: PbrProjectionOptions) => Promise<PbrMaterialLike>} get Cached per (id, options).
 * @property {() => Promise<void>} dispose
 * @property {PbrLibraryStats} stats (getter)
 */

const MATERIAL_ID = /^[a-z][a-z0-9-]{0,100}$/;
const IMAGE_PATH = /^textures[/][a-f0-9]{64}[.](?:png|webp)$/;
const PROJECTIONS = new Set(['planar', 'triplanar']);

function config(params) {
  const projection = params.projection ?? 'triplanar';
  const tileSize = params.tileSize ?? 1;
  const blendSharpness = params.blendSharpness ?? 6;
  const aoIntensity = params.aoIntensity ?? 1;
  const normalStrength = params.normalStrength ?? 1;
  if (!PROJECTIONS.has(projection)) throw new Error('Unsupported projection');
  for (const [name, n, min, max] of [
    ['tileSize', tileSize, 0.01, 1000],
    ['blendSharpness', blendSharpness, 0.1, 32],
    ['aoIntensity', aoIntensity, 0, 1],
    ['normalStrength', normalStrength, 0, 2],
  ]) if (!Number.isFinite(n) || n < min || n > max) {
    throw new RangeError('Invalid PBR parameter ' + name);
  }
  return { projection, tileSize, blendSharpness, aoIntensity, normalStrength };
}

/**
 * @param {PbrThree} THREE
 * @param {WorldAlignedPbrOptions} options
 * @returns {PbrMaterialLike}
 */
export function createWorldAlignedPbrMaterial(THREE, { color, normal, orm, ...options } = {}) {
  if (!THREE?.MeshStandardMaterial || !THREE?.Vector3 ||
      !color?.isTexture || !normal?.isTexture || !orm?.isTexture) {
    throw new TypeError('World PBR material requires Three.js and Color/Normal/ORM textures');
  }
  const c = config(options);
  const uniform = {
    uPbrColor: { value: color },
    uPbrNormal: { value: normal },
    uPbrORM: { value: orm },
    uPbrTile: { value: c.tileSize },
    uPbrBlendSharpness: { value: c.blendSharpness },
    uPbrAO: { value: c.aoIntensity },
    uPbrNormalStrength: { value: c.normalStrength },
  };
  const mat = new THREE.MeshStandardMaterial({
    color: '#ffffff', roughness: 1, metalness: 1,
    side: THREE.FrontSide,
  });
  mat.userData.pbr = Object.freeze({ ...c, maps: { color, normal, orm }, uniforms: uniform });
  mat.customProgramCacheKey = () => 'world-triplanar-pbr-v1:' + c.projection;
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniform);
    const vs = '#include <project_vertex>';
    if (!shader.vertexShader.includes(vs)) throw new Error('Three vertex shader chunk changed');
    shader.vertexShader = `
      varying vec3 vPbrWorldPosition;
      varying vec3 vPbrWorldNormal;
    ` + shader.vertexShader.replace(vs, vs + `
      vec4 pbrPosition = vec4(transformed, 1.0);
      vec3 pbrNormal = normal;
      #ifdef USE_INSTANCING
        pbrPosition = instanceMatrix * pbrPosition;
        pbrNormal = mat3(instanceMatrix) * pbrNormal;
      #endif
      #ifdef USE_BATCHING
        pbrPosition = batchingMatrix * pbrPosition;
      #endif
      vPbrWorldPosition = (modelMatrix * pbrPosition).xyz;
      vPbrWorldNormal = normalize(mat3(modelMatrix) * pbrNormal);
    `);
    const marker = '#include <map_fragment>';
    if (!shader.fragmentShader.includes(marker)) throw new Error('Three map shader chunk changed');
    const samples = c.projection === 'planar' ? `
      vec3 pbrColor = texture2D(uPbrColor, pbrUV.xz).rgb;
      vec3 pbrN = texture2D(uPbrNormal, pbrUV.xz).rgb * 2.0 - 1.0;
      vec3 pbrNormalWorld = normalize(vec3(pbrN.x, pbrN.z, pbrN.y));
      vec3 pbrORM = texture2D(uPbrORM, pbrUV.xz).rgb;
    ` : `
      vec3 pbrWeights = pow(max(abs(normalize(vPbrWorldNormal)), vec3(0.00001)),
                            vec3(uPbrBlendSharpness));
      pbrWeights /= max(dot(pbrWeights, vec3(1.0)), 0.00001);
      vec3 pbrColor =
          texture2D(uPbrColor, pbrUV.zy).rgb * pbrWeights.x +
          texture2D(uPbrColor, pbrUV.xz).rgb * pbrWeights.y +
          texture2D(uPbrColor, pbrUV.xy).rgb * pbrWeights.z;
      vec3 pbrORM =
          texture2D(uPbrORM, pbrUV.zy).rgb * pbrWeights.x +
          texture2D(uPbrORM, pbrUV.xz).rgb * pbrWeights.y +
          texture2D(uPbrORM, pbrUV.xy).rgb * pbrWeights.z;
      vec3 pbrNx = texture2D(uPbrNormal, pbrUV.zy).rgb * 2.0 - 1.0;
      vec3 pbrNy = texture2D(uPbrNormal, pbrUV.xz).rgb * 2.0 - 1.0;
      vec3 pbrNz = texture2D(uPbrNormal, pbrUV.xy).rgb * 2.0 - 1.0;
      vec3 pbrNormalWorld = normalize(
          vec3(sign(vPbrWorldNormal.x) * pbrNx.z, pbrNx.y, pbrNx.x) * pbrWeights.x +
          vec3(pbrNy.x, sign(vPbrWorldNormal.y) * pbrNy.z, pbrNy.y) * pbrWeights.y +
          vec3(pbrNz.x, pbrNz.y, sign(vPbrWorldNormal.z) * pbrNz.z) * pbrWeights.z);
    `;
    shader.fragmentShader = `
      uniform sampler2D uPbrColor;
      uniform sampler2D uPbrNormal;
      uniform sampler2D uPbrORM;
      uniform float uPbrTile;
      uniform float uPbrBlendSharpness;
      uniform float uPbrAO;
      uniform float uPbrNormalStrength;
      varying vec3 vPbrWorldPosition;
      varying vec3 vPbrWorldNormal;
    ` + shader.fragmentShader.replace(marker, marker + `
      vec3 pbrUV = vPbrWorldPosition / uPbrTile;
      ${samples}
      diffuseColor.rgb *= pbrColor;
    `);
    const replacements = [
      ['#include <roughnessmap_fragment>',
        'roughnessFactor *= clamp(pbrORM.g, 0.025, 1.0);'],
      ['#include <metalnessmap_fragment>',
        'metalnessFactor *= clamp(pbrORM.b, 0.0, 1.0);'],
      ['#include <normal_fragment_maps>',
        `vec3 pbrFinalNormal = normalize(mix(normalize(vPbrWorldNormal),
           pbrNormalWorld, uPbrNormalStrength));
         normal = normalize(mat3(viewMatrix) * pbrFinalNormal);
         #ifdef DOUBLE_SIDED
           normal *= faceDirection;
         #endif`],
      ['#include <aomap_fragment>',
        `float pbrAmbientOcclusion = mix(1.0, pbrORM.r, uPbrAO);
         reflectedLight.indirectDiffuse *= pbrAmbientOcclusion;
         #if defined(USE_ENVMAP) && defined(STANDARD)
           float pbrDotNV = saturate(dot(geometryNormal, geometryViewDir));
           reflectedLight.indirectSpecular *=
             computeSpecularOcclusion(pbrDotNV, pbrAmbientOcclusion, material.roughness);
         #endif`],
    ];
    for (const [chunk, insertion] of replacements) {
      if (!shader.fragmentShader.includes(chunk)) throw new Error('Missing Three chunk ' + chunk);
      shader.fragmentShader = shader.fragmentShader.replace(chunk, chunk + '\n' + insertion);
    }
  };
  return mat;
}

/**
 * Content-addressed catalogs can share a texture pool across material entries.
 * @param {PbrLibraryOptions} options
 * @returns {Promise<PbrLibrary>}
 */
export async function loadCuratedPbrLibrary({
  THREE, catalogUrl, fetchJson = null, textureLoader = null,
} = {}) {
  if (!THREE?.TextureLoader || !THREE?.MeshStandardMaterial || !catalogUrl) {
    throw new TypeError('Provide THREE and local PBR catalogUrl');
  }
  const base = new URL(catalogUrl, typeof location === 'undefined' ? 'http://localhost/' : location.href);
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Expected HTTP(S) material catalog');
  const source = fetchJson ?? (async url => {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Material catalog HTTP ' + response.status);
    return response.json();
  });
  const catalog = await source(base.href);
  if (catalog.version !== 1 || !Array.isArray(catalog.materials) || catalog.materials.length > 2000) {
    throw new Error('Invalid material catalog v1');
  }
  const entries = new Map();
  for (const entry of catalog.materials) {
    if (!MATERIAL_ID.test(entry.id) || entries.has(entry.id) ||
        !['color', 'normal', 'orm'].every(key => IMAGE_PATH.test(entry[key]))) {
      throw new Error('Invalid or duplicate Color/Normal/ORM material: ' + entry.id);
    }
    entries.set(entry.id, entry);
  }
  const loader = textureLoader ?? new THREE.TextureLoader();
  const textures = new Map();
  const materials = new Map();
  let disposed = false;
  function texture(rel, kind) {
    if (!textures.has(rel)) {
      const url = new URL(rel, base).href;
      const pending = Promise.resolve(loader.loadAsync(url)).then(t => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.magFilter = THREE.LinearFilter;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.generateMipmaps = true;
        t.anisotropy = 4;
        t.colorSpace = kind === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.needsUpdate = true;
        return t;
      });
      textures.set(rel, pending);
      pending.catch(() => textures.delete(rel));
    }
    return textures.get(rel);
  }
  async function get(id, options = {}) {
    if (disposed) throw new Error('Material library disposed');
    const entry = entries.get(id);
    if (!entry) throw new Error('Unknown curated material ' + id);
    const params = config({ tileSize: entry.tileSize ?? 1, projection: entry.projection ?? 'triplanar',
      ...options });
    const key = JSON.stringify([id, params]);
    if (!materials.has(key)) {
      const task = Promise.all([
        texture(entry.color, 'color'), texture(entry.normal, 'normal'), texture(entry.orm, 'orm'),
      ]).then(([color, normal, orm]) =>
        createWorldAlignedPbrMaterial(THREE, { color, normal, orm, ...params }));
      materials.set(key, task);
      task.catch(() => materials.delete(key));
    }
    return materials.get(key);
  }
  async function dispose() {
    if (disposed) return;
    disposed = true;
    for (const result of await Promise.allSettled(materials.values())) {
      if (result.status === 'fulfilled') result.value.dispose();
    }
    for (const result of await Promise.allSettled(textures.values())) {
      if (result.status === 'fulfilled') result.value.dispose();
    }
    materials.clear();
    textures.clear();
  }
  return {
    list: () => [...entries.values()].map(e => ({
      id: e.id, name: e.name, category: e.category, tileSize: e.tileSize,
    })),
    get, dispose,
    get stats() { return { materials: materials.size, textures: textures.size, entries: entries.size }; },
  };
}

/**
 * Creates a 2-texture world-aligned PBR material (`color` + `normalRm`), optionally
 * sampling a `TEXTURE_2D_ARRAY` (`DataArrayTexture`) with 4-layer splatmap blending
 * and shared global `wetness`.
 *
 * `normalRm` packs OpenGL +Y tangent normal XY into `RG`, roughness into `B`, metallic into `A`.
 *
 * @param {PbrThree} THREE
 * @param {Record<string, any>} [options]
 * @returns {PbrMaterialLike}
 */
export function createTwoMapWorldPbrMaterial(THREE, {
  color,
  normalRm,
  splatMap = null,
  layerIndices = [0, 1, 2, 3],
  projection = 'triplanar',
  tileSize = 1,
  blendSharpness = 6,
  normalStrength = 1,
  wetness = 0,
  sharedBlock = null,
} = {}) {
  if (!THREE?.MeshStandardMaterial || !THREE?.Vector3 || !color?.isTexture || !normalRm?.isTexture) {
    throw new TypeError('createTwoMapWorldPbrMaterial requires THREE, color texture, and normalRm texture');
  }
  const c = config({ projection, tileSize, blendSharpness, aoIntensity: 1, normalStrength });
  const isArray = Boolean(color.isDataArrayTexture || color.isCompressedArrayTexture || (Array.isArray(color.image?.data) === false && Number(color.image?.depth) > 1));
  const useSplat = Boolean(isArray && splatMap?.isTexture);
  const idxArr = Array.isArray(layerIndices) ? layerIndices : [0, 1, 2, 3];

  const uniforms = {
    uTwoColor: { value: color },
    uTwoNormalRm: { value: normalRm },
    uTwoSplatMap: { value: splatMap },
    uTwoTile: { value: c.tileSize },
    uTwoBlendSharpness: { value: c.blendSharpness },
    uTwoNormalStrength: { value: c.normalStrength },
    uTwoWetness: sharedBlock?.uniforms?.uWetness ?? { value: Math.max(0, Math.min(1, Number(wetness) || 0)) },
    uTwoLayerIds: { value: { x: idxArr[0] ?? 0, y: idxArr[1] ?? 1, z: idxArr[2] ?? 2, w: idxArr[3] ?? 3 } },
  };
  if (THREE.Vector4) {
    uniforms.uTwoLayerIds.value = new THREE.Vector4(idxArr[0] ?? 0, idxArr[1] ?? 1, idxArr[2] ?? 2, idxArr[3] ?? 3);
  }

  const mat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 1,
    metalness: 1,
    side: THREE.FrontSide,
  });
  mat.customProgramCacheKey = () => `two-map-world-pbr-v1:${c.projection}:${isArray ? 'arr' : '2d'}:${useSplat ? 'splat' : 'single'}`;
  mat.userData.twoMapPbr = Object.freeze({ ...c, isArray, useSplat, uniforms });

  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    const vsMarker = '#include <project_vertex>';
    if (shader.vertexShader.includes(vsMarker)) {
      shader.vertexShader = [
        'varying vec3 vTwoWorldPos;',
        'varying vec3 vTwoWorldNormal;',
        'varying vec2 vTwoBaseUv;',
      ].join('\n') + '\n' + shader.vertexShader.replace(
        vsMarker,
        vsMarker + '\n' + [
          'vec4 _twoWp = vec4(transformed, 1.0);',
          'vec3 _twoWn = normal;',
          '#ifdef USE_INSTANCING',
          '  _twoWp = instanceMatrix * _twoWp;',
          '  _twoWn = mat3(instanceMatrix) * _twoWn;',
          '#endif',
          'vTwoWorldPos = (modelMatrix * _twoWp).xyz;',
          'vTwoWorldNormal = normalize(mat3(modelMatrix) * _twoWn);',
          '#ifdef USE_UV\n  vTwoBaseUv = uv;\n#else\n  vTwoBaseUv = vec2(0.0);\n#endif',
        ].join('\n'),
      );
    }

    const samplerDecl = isArray
      ? 'uniform sampler2DArray uTwoColor;\nuniform sampler2DArray uTwoNormalRm;'
      : 'uniform sampler2D uTwoColor;\nuniform sampler2D uTwoNormalRm;';

    const sampleLayerFn = isArray
      ? `
        vec4 sampleTwoCol(vec2 uvCoord, float layerId) { return texture(uTwoColor, vec3(uvCoord, layerId)); }
        vec4 sampleTwoNrm(vec2 uvCoord, float layerId) { return texture(uTwoNormalRm, vec3(uvCoord, layerId)); }
      `
      : `
        vec4 sampleTwoCol(vec2 uvCoord, float layerId) { return texture2D(uTwoColor, uvCoord); }
        vec4 sampleTwoNrm(vec2 uvCoord, float layerId) { return texture2D(uTwoNormalRm, uvCoord); }
      `;

    const projEval = c.projection === 'planar'
      ? `
        vec4 _tCol = sampleTwoCol(_twoUv.xz, _layerId);
        vec4 _tNrm = sampleTwoNrm(_twoUv.xz, _layerId);
        vec2 _nXY = _tNrm.rg * 2.0 - 1.0;
        float _nZ = sqrt(max(0.0, 1.0 - dot(_nXY, _nXY)));
        vec3 _tWorldN = normalize(vec3(_nXY.x, _nZ, _nXY.y));
      `
      : `
        vec3 _tW = pow(max(abs(normalize(vTwoWorldNormal)), vec3(0.00001)), vec3(uTwoBlendSharpness));
        _tW /= max(dot(_tW, vec3(1.0)), 0.00001);
        vec4 _tCol = sampleTwoCol(_twoUv.zy, _layerId) * _tW.x
                   + sampleTwoCol(_twoUv.xz, _layerId) * _tW.y
                   + sampleTwoCol(_twoUv.xy, _layerId) * _tW.z;
        vec4 _nX = sampleTwoNrm(_twoUv.zy, _layerId);
        vec4 _nY = sampleTwoNrm(_twoUv.xz, _layerId);
        vec4 _nZ = sampleTwoNrm(_twoUv.xy, _layerId);
        vec4 _tNrm = _nX * _tW.x + _nY * _tW.y + _nZ * _tW.z;
        vec2 _xyX = _nX.rg * 2.0 - 1.0;
        vec2 _xyY = _nY.rg * 2.0 - 1.0;
        vec2 _xyZ = _nZ.rg * 2.0 - 1.0;
        vec3 _pX = vec3(_xyX, sqrt(max(0.0, 1.0 - dot(_xyX, _xyX))));
        vec3 _pY = vec3(_xyY, sqrt(max(0.0, 1.0 - dot(_xyY, _xyY))));
        vec3 _pZ = vec3(_xyZ, sqrt(max(0.0, 1.0 - dot(_xyZ, _xyZ))));
        vec3 _tWorldN = normalize(
          vec3(sign(vTwoWorldNormal.x) * _pX.z, _pX.y, _pX.x) * _tW.x +
          vec3(_pY.x, sign(vTwoWorldNormal.y) * _pY.z, _pY.y) * _tW.y +
          vec3(_pZ.x, _pZ.y, sign(vTwoWorldNormal.z) * _pZ.z) * _tW.z
        );
      `;

    const evalBlock = useSplat
      ? `
        vec4 _splat = texture2D(uTwoSplatMap, vTwoBaseUv);
        float _swSum = max(0.0001, _splat.r + _splat.g + _splat.b + _splat.a);
        _splat /= _swSum;
        vec4 _twoCol = vec4(0.0);
        vec4 _twoNrmPack = vec4(0.0);
        vec3 _twoNormalWorld = vec3(0.0);
        float _lIds[4];
        _lIds[0] = uTwoLayerIds.x; _lIds[1] = uTwoLayerIds.y; _lIds[2] = uTwoLayerIds.z; _lIds[3] = uTwoLayerIds.w;
        float _lWs[4];
        _lWs[0] = _splat.r; _lWs[1] = _splat.g; _lWs[2] = _splat.b; _lWs[3] = _splat.a;
        for (int _li = 0; _li < 4; _li++) {
          if (_lWs[_li] > 0.001) {
            float _layerId = _lIds[_li];
            ${projEval}
            _twoCol += _tCol * _lWs[_li];
            _twoNrmPack += _tNrm * _lWs[_li];
            _twoNormalWorld += _tWorldN * _lWs[_li];
          }
        }
        _twoNormalWorld = normalize(_twoNormalWorld);
      `
      : `
        float _layerId = uTwoLayerIds.x;
        ${projEval}
        vec4 _twoCol = _tCol;
        vec4 _twoNrmPack = _tNrm;
        vec3 _twoNormalWorld = _tWorldN;
      `;

    if (shader.fragmentShader.includes('#include <map_fragment>')) {
      shader.fragmentShader = [
        samplerDecl,
        'uniform sampler2D uTwoSplatMap;',
        'uniform float uTwoTile;',
        'uniform float uTwoBlendSharpness;',
        'uniform float uTwoNormalStrength;',
        'uniform float uTwoWetness;',
        'uniform vec4 uTwoLayerIds;',
        'varying vec3 vTwoWorldPos;',
        'varying vec3 vTwoWorldNormal;',
        'varying vec2 vTwoBaseUv;',
        sampleLayerFn,
      ].join('\n') + '\n' + shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        vec3 _twoUv = vTwoWorldPos / uTwoTile;
        ${evalBlock}
        diffuseColor.rgb *= _twoCol.rgb;`,
      );
    }

    const replacements = [
      ['#include <roughnessmap_fragment>', 'roughnessFactor = clamp(_twoNrmPack.b, 0.025, 1.0);'],
      ['#include <metalnessmap_fragment>', 'metalnessFactor = clamp(_twoNrmPack.a, 0.0, 1.0);'],
      [
        '#include <normal_fragment_maps>',
        `vec3 _twoFinalN = normalize(mix(normalize(vTwoWorldNormal), _twoNormalWorld, uTwoNormalStrength));
         normal = normalize(mat3(viewMatrix) * _twoFinalN);
         #ifdef DOUBLE_SIDED
           normal *= faceDirection;
         #endif
         if (uTwoWetness > 0.01) {
           float _upM = smoothstep(0.55, 0.92, normalize(vTwoWorldNormal).y);
           float _wetV = clamp(uTwoWetness, 0.0, 1.0) * mix(0.45, 1.0, _upM);
           diffuseColor.rgb *= mix(1.0, 0.72, _wetV * (1.0 - metalnessFactor));
           roughnessFactor = mix(roughnessFactor, 0.10, _wetV * _upM);
           normal = normalize(mix(normal, nonPerturbedNormal, _wetV * _upM * 0.65));
         }`,
      ],
      [
        '#include <aomap_fragment>',
        `float _twoMicroAO = mix(1.0, 0.88, roughnessFactor * roughnessFactor);
         reflectedLight.indirectDiffuse *= _twoMicroAO;`,
      ],
    ];
    for (const [chunk, insertion] of replacements) {
      if (shader.fragmentShader.includes(chunk)) {
        shader.fragmentShader = shader.fragmentShader.replace(chunk, chunk + '\n' + insertion);
      }
    }
  };

  return mat;
}
