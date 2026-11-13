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

/** Content-addressed catalogs can share a texture pool across material entries. */
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
