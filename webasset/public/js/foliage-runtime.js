import * as THREE from 'three';

function createSlotQuadGeometry(slotMeta) {
  const meshType = slotMeta.mesh || 'cross_quad';
  const [u0, v0, uw, vh] = slotMeta.uvRect || [0, 0, 0.25, 0.25];
  const h = slotMeta.heightScale ?? 0.75;
  const w = 0.88;

  const positions = [];
  const normals = [];
  const uvs = [];
  const anchors = []; // 1 at top (sways), 0 at base (rooted)
  const indices = [];

  const pushPlane = (cx, cz, width, height, yawRad, tiltTopZ = 0, flippedAnchor = false) => {
    const hw = width * 0.5;
    const ca = Math.cos(yawRad), sa = Math.sin(yawRad);
    const localPts = [
      [-hw, 0, 0],
      [hw, 0, 0],
      [hw, height, tiltTopZ],
      [-hw, height, tiltTopZ],
    ];
    const quadUvs = [
      [u0, v0],
      [u0 + uw, v0],
      [u0 + uw, v0 + vh],
      [u0, v0 + vh],
    ];
    const base = positions.length / 3;
    for (let i = 0; i < 4; i++) {
      const lx = localPts[i][0], ly = localPts[i][1], lz = localPts[i][2];
      const wx = cx + lx * ca - lz * sa;
      const wz = cz + lx * sa + lz * ca;
      positions.push(wx, ly, wz);
      normals.push(-sa * 0.25, 0.94, ca * 0.25);
      uvs.push(quadUvs[i][0], quadUvs[i][1]);
      const isTop = i >= 2;
      anchors.push(flippedAnchor ? (isTop ? 0 : 1) : (isTop ? 1 : 0));
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  if (meshType === 'star_quad') {
    for (let k = 0; k < 3; k++) pushPlane(0, 0, w, h, (k * Math.PI) / 3);
  } else if (meshType === 'fern_quad') {
    for (let k = 0; k < 4; k++) pushPlane(0, 0, w * 0.9, h, (k * Math.PI) / 2, 0.24);
  } else if (meshType === 'hash_quad') {
    const off = 0.24;
    pushPlane(0, -off, w, h, 0);
    pushPlane(0, off, w, h, 0);
    pushPlane(-off, 0, w, h, Math.PI * 0.5);
    pushPlane(off, 0, w, h, Math.PI * 0.5);
  } else if (meshType === 'wall_quad') {
    pushPlane(0, 0, w, h, 0, 0, slotMeta.anchor === 'top');
  } else {
    pushPlane(0, 0, w, h, Math.PI * 0.25);
    pushPlane(0, 0, w, h, -Math.PI * 0.25);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('aFoliageSway', new THREE.Float32BufferAttribute(anchors, 1));
  geo.setIndex(indices);
  return geo;
}

export class FoliageSystem {
  #group = new THREE.Group();
  #materials = [];
  #geometries = [];
  #timeUniform = { value: 0 };
  #atlasTex = null;
  #table = null;

  constructor(options = {}) {
    this.tableUrl = options.tableUrl || '/assets/pbr/foliage/foliage_table.json';
    this.lightingRig = options.lightingRig || null;
    this.#group.name = 'FoliageSystemGroup';
  }

  async load() {
    if (this.#table) return this.#table;
    const table = await fetch(this.tableUrl).then(r => {
      if (!r.ok) throw new Error(`Foliage table HTTP ${r.status}`);
      return r.json();
    });
    const imgUrl = table.atlasUrl || '/assets/pbr/foliage/foliage_albedo.webp';
    const blob = await fetch(imgUrl).then(r => {
      if (!r.ok) throw new Error(`Foliage atlas HTTP ${r.status}`);
      return r.blob();
    });
    const bmp = await createImageBitmap(blob);
    const tex = new THREE.Texture(bmp);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    this.#atlasTex = tex;
    this.#table = table;
    return table;
  }

  createMaterial() {
    if (!this.#atlasTex) throw new Error('FoliageSystem must be loaded before creating material');
    const mat = new THREE.MeshStandardMaterial({
      map: this.#atlasTex,
      roughness: 0.78,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    const timeUniform = this.#timeUniform;
    const lightingRig = this.lightingRig;

    mat.customProgramCacheKey = () => 'hgame-foliage-v2';
    mat.onBeforeCompile = shader => {
      shader.uniforms.uTime = timeUniform;
      if (lightingRig) {
        shader.uniforms.uTorchCount = lightingRig.torchCountUniform;
        shader.uniforms.uTorchPosRadius = { value: lightingRig.torchPosRadius };
        shader.uniforms.uTorchColor = { value: lightingRig.torchColor };
      }

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute float aFoliageSway;
uniform float uTime;
varying vec3 vFolWorldPos;
varying vec2 vFolUv;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
vec4 folWp0 = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  folWp0 = instanceMatrix * folWp0;
#endif
folWp0 = modelMatrix * folWp0;
float swayWave = sin(uTime * 1.85 + folWp0.x * 0.72 + folWp0.z * 0.53);
float swaySide = cos(uTime * 1.42 + folWp0.z * 0.65);
transformed.x += swayWave * 0.065 * aFoliageSway;
transformed.z += swaySide * 0.045 * aFoliageSway;`,
        )
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
vec4 folWp = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  folWp = instanceMatrix * folWp;
#endif
folWp = modelMatrix * folWp;
vFolWorldPos = folWp.xyz;
vFolUv = uv;`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vFolWorldPos;
varying vec2 vFolUv;
${lightingRig ? `uniform int uTorchCount;\nuniform vec4 uTorchPosRadius[8];\nuniform vec4 uTorchColor[8];` : ''}`,
        )
        .replace(
          '#include <map_fragment>',
          `vec4 sampledDiffuseColor = texture2D(map, vFolUv);
vec2 folTexDx = dFdx(vFolUv * 1024.0);
vec2 folTexDy = dFdy(vFolUv * 1024.0);
float folMip = max(0.0, 0.5 * log2(max(dot(folTexDx, folTexDx), dot(folTexDy, folTexDy)) + 1e-6));
float folAlpha = sampledDiffuseColor.a * (1.0 + folMip * 0.28);
if (folAlpha < 0.5) discard;
diffuseColor *= vec4(sampledDiffuseColor.rgb, 1.0);`,
        )
        .replace(
          '#include <normal_fragment_begin>',
          `#include <normal_fragment_begin>
normal = normalize(mix((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz, normal, 0.4));`,
        );

      if (lightingRig) {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <aomap_fragment>',
          `#include <aomap_fragment>
for (int tlIdx = 0; tlIdx < 8; tlIdx++) {
  if (tlIdx >= uTorchCount) break;
  vec4 tp = uTorchPosRadius[tlIdx];
  vec4 tc = uTorchColor[tlIdx];
  vec3 toLight = tp.xyz - vFolWorldPos;
  float d = length(toLight);
  if (d < tp.w) {
    float att = pow(clamp(1.0 - d / tp.w, 0.0, 1.0), 2.0);
    reflectedLight.directDiffuse += diffuseColor.rgb * tc.rgb * (tc.a * att * 0.65 / 3.14159);
  }
}`,
        );
      }
    };
    this.#materials.push(mat);
    return mat;
  }

  buildGroupFromPlacements(placements = []) {
    this.clearMeshes();
    if (!this.#table) throw new Error('FoliageSystem not loaded');
    const bySlot = new Map(this.#table.slots.map(s => [s.slot, s]));
    const grouped = new Map();
    for (const p of placements) {
      if (!bySlot.has(p.slot)) continue;
      if (!grouped.has(p.slot)) grouped.set(p.slot, []);
      grouped.get(p.slot).push(p);
    }

    const mat = this.createMaterial();
    const dummy = new THREE.Object3D();
    for (const [slotName, list] of grouped.entries()) {
      const slotMeta = bySlot.get(slotName);
      const geo = createSlotQuadGeometry(slotMeta);
      this.#geometries.push(geo);
      const inst = new THREE.InstancedMesh(geo, mat, list.length);
      inst.name = `foliage:${slotName}`;
      inst.castShadow = false;
      inst.receiveShadow = true;
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        dummy.position.set(it.pos[0], it.pos[1], it.pos[2]);
        dummy.rotation.set(0, it.rotY ?? (i * 1.13), 0);
        const s = it.scale ?? 1.0;
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      }
      inst.instanceMatrix.needsUpdate = true;
      this.#group.add(inst);
    }
    return this.#group;
  }

  update(elapsedSec) {
    this.#timeUniform.value = elapsedSec;
  }

  getGroup() {
    return this.#group;
  }

  getTable() {
    return this.#table;
  }

  clearMeshes() {
    while (this.#group.children.length) {
      this.#group.remove(this.#group.children[0]);
    }
    for (const g of this.#geometries) g.dispose();
    this.#geometries = [];
    for (const m of this.#materials) m.dispose();
    this.#materials = [];
  }

  dispose() {
    this.clearMeshes();
    if (this.#atlasTex) {
      this.#atlasTex.dispose();
      this.#atlasTex = null;
    }
  }
}
