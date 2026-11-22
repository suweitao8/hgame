import * as THREE from 'three';
import {
  buildBeveledBoxRaw,
  buildBufferGeometryFromRaw,
  createWorldPbrMaterial,
  ensurePbrGeometryAttributes,
  loadHdriEnvironment,
  MaterialRegistry,
  PbrTextureArrayLoader,
} from './pbr-runtime.js';

export const REALISTIC_QUALITY_PRESETS = Object.freeze({
  ORIGINAL: {
    name: 'ORIGINAL',
    textureRes: 512,
    shadowMapSize: 2048,
    anisotropy: 8,
    pixelRatioCap: 2.0,
    fastShader: false,
    disableMicroDetail: false,
    disableShadows: false,
  },
  HIGH: {
    name: 'HIGH',
    textureRes: 512,
    shadowMapSize: 2048,
    anisotropy: 4,
    pixelRatioCap: 1.5,
    fastShader: false,
    disableMicroDetail: false,
    disableShadows: false,
  },
  LOW: {
    name: 'LOW',
    textureRes: 256,
    shadowMapSize: 1024,
    anisotropy: 1,
    pixelRatioCap: 1.25,
    fastShader: true,
    disableMicroDetail: false,
    disableShadows: false,
  },
  LOWEST: {
    name: 'LOWEST',
    textureRes: 256,
    shadowMapSize: 0,
    anisotropy: 1,
    pixelRatioCap: 1.0,
    fastShader: true,
    disableMicroDetail: true,
    disableShadows: true,
  },
});

export function getQualityPreset(name = 'HIGH') {
  return REALISTIC_QUALITY_PRESETS[name] || REALISTIC_QUALITY_PRESETS.HIGH;
}

export const CHINESE_LIGHTING_PRESETS = Object.freeze({
  cn_cbd_day: {
    id: 'cn_cbd_day',
    label: 'CBD 晴昼',
    hdri: '/assets/cn/materials/hdri/cn_day_clear.hdr',
    sunColor: 0xfff5e4,
    sunIntensity: 2.9,
    sunPos: [38, 52, 26],
    hemiSky: 0xdcecff,
    hemiGround: 0x3b4039,
    hemiIntensity: 0.72,
    fogColor: 0xcbd9e6,
    fogDensity: 0.0042,
    exposure: 1.05,
  },
  cn_old_town_dusk: {
    id: 'cn_old_town_dusk',
    label: '老城暮色',
    hdri: '/assets/cn/materials/hdri/cn_overcast_haze.hdr',
    sunColor: 0xffb36b,
    sunIntensity: 2.2,
    sunPos: [-42, 20, 28],
    hemiSky: 0x9aaec7,
    hemiGround: 0x2d241e,
    hemiIntensity: 0.58,
    fogColor: 0x9c8b7f,
    fogDensity: 0.0068,
    exposure: 1.0,
  },
  cn_horror_night: {
    id: 'cn_horror_night',
    label: '巷夜怪谈',
    hdri: '/assets/cn/materials/hdri/cn_night_city.hdr',
    sunColor: 0x7aa2d4,
    sunIntensity: 0.55,
    sunPos: [-24, 34, -22],
    hemiSky: 0x273549,
    hemiGround: 0x101417,
    hemiIntensity: 0.42,
    fogColor: 0x101720,
    fogDensity: 0.014,
    exposure: 1.12,
  },
  cn_rural_morning: {
    id: 'cn_rural_morning',
    label: '乡村晨雾',
    hdri: '/assets/cn/materials/hdri/cn_overcast_haze.hdr',
    sunColor: 0xffe8c2,
    sunIntensity: 2.35,
    sunPos: [30, 26, -32],
    hemiSky: 0xd8e5df,
    hemiGround: 0x3b4534,
    hemiIntensity: 0.78,
    fogColor: 0xcad6cf,
    fogDensity: 0.0085,
    exposure: 1.02,
  },
});

export function createAtmospherePipeline(renderer, scene, { quality = 'HIGH', initialPreset = 'cn_cbd_day', sceneHalfExtent = 42 } = {}) {
  const q = getQualityPreset(quality);
  const preset = CHINESE_LIGHTING_PRESETS[initialPreset] || CHINESE_LIGHTING_PRESETS.cn_cbd_day;

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = preset.exposure;
  renderer.shadowMap.enabled = !q.disableShadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const sunLight = new THREE.DirectionalLight(preset.sunColor, preset.sunIntensity);
  sunLight.position.set(...preset.sunPos);
  sunLight.castShadow = !q.disableShadows;
  if (q.shadowMapSize > 0) {
    sunLight.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
  }
  sunLight.shadow.camera.left = -sceneHalfExtent;
  sunLight.shadow.camera.right = sceneHalfExtent;
  sunLight.shadow.camera.top = sceneHalfExtent;
  sunLight.shadow.camera.bottom = -sceneHalfExtent;
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 160;
  sunLight.shadow.bias = -0.0005;
  scene.add(sunLight);

  const hemiLight = new THREE.HemisphereLight(preset.hemiSky, preset.hemiGround, preset.hemiIntensity);
  scene.add(hemiLight);

  const fog = new THREE.FogExp2(preset.fogColor, preset.fogDensity);
  scene.fog = fog;
  scene.background = new THREE.Color(preset.fogColor);

  let currentPreset = preset;

  return {
    sunLight,
    hemiLight,
    getPreset() {
      return currentPreset;
    },
    setPreset(name) {
      const next = CHINESE_LIGHTING_PRESETS[name] || CHINESE_LIGHTING_PRESETS.cn_cbd_day;
      currentPreset = next;
      sunLight.color.setHex(next.sunColor);
      sunLight.intensity = next.sunIntensity;
      sunLight.position.set(...next.sunPos);
      hemiLight.color.setHex(next.hemiSky);
      hemiLight.groundColor.setHex(next.hemiGround);
      hemiLight.intensity = next.hemiIntensity;
      fog.color.setHex(next.fogColor);
      fog.density = next.fogDensity;
      scene.background = new THREE.Color(next.fogColor);
      renderer.toneMappingExposure = next.exposure;
      return next;
    },
    dispose() {
      scene.remove(sunLight, hemiLight);
      scene.fog = null;
    },
  };
}

export class BucketedInstancedLodPool {
  #groups = [];
  #lastCamPos = new THREE.Vector3(1e9, 1e9, 1e9);
  #lastCamDir = new THREE.Vector3(0, 0, -1);
  #frustum = new THREE.Frustum();
  #projScreen = new THREE.Matrix4();
  #tmpSphere = new THREE.Sphere();
  #tmpDir = new THREE.Vector3();

  constructor({ hysteresis = 1.12, moveTriggerMeters = 0.5, rotTriggerDeg = 3.0 } = {}) {
    this.hysteresis = hysteresis;
    this.moveTriggerMeters = moveTriggerMeters;
    this.rotTriggerDeg = rotTriggerDeg;
  }

  /**
   * Register an asset with embedded LOD geometries [geo0, geo1, geo2] and instance transforms.
   * Each bucket[0..2] shares one InstancedMesh draw call across all instances at that LOD.
   */
  addLodGroup(scene, {
    id = 'prop',
    geometries = [],
    material,
    transforms = [],
    boundingSphereRadius = 1.5,
    thresholds = [0.18, 0.06],
    cullRatio = 0.005,
  } = {}) {
    if (!transforms.length || !geometries.length) return null;
    const maxCount = transforms.length;
    const buckets = [0, 1, 2].map((lvl) => {
      const geo = geometries[lvl];
      if (!geo) return null;
      const im = new THREE.InstancedMesh(geo, material, maxCount);
      im.name = `${id}:lod${lvl}`;
      im.count = 0;
      im.castShadow = lvl < 2;
      im.receiveShadow = true;
      im.frustumCulled = false;
      scene.add(im);
      return im;
    });

    const m4 = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scl = new THREE.Vector3(1, 1, 1);

    const instances = transforms.map((t) => {
      pos.set(...(t.pos || [0, 0, 0]));
      euler.set(...(t.rot || [0, 0, 0]));
      quat.setFromEuler(euler);
      scl.set(...(t.scale || [1, 1, 1]));
      m4.compose(pos, quat, scl);
      return {
        matrix: m4.clone(),
        center: pos.clone().add(new THREE.Vector3(0, (t.centerY ?? boundingSphereRadius * 0.5), 0)),
        radius: boundingSphereRadius * Math.max(scl.x, scl.y, scl.z),
        lod: 0,
      };
    });

    const entry = { id, buckets, instances, thresholds, cullRatio };
    this.#groups.push(entry);
    return entry;
  }

  // Backward-compatible single-LOD helper
  addBatch(scene, geometry, material, transforms = []) {
    return this.addLodGroup(scene, {
      geometries: [geometry],
      material,
      transforms,
      thresholds: [],
      cullRatio: 0,
    });
  }

  update(camera, { lodBias = 1.0, forcedLod = 'auto', force = false } = {}) {
    if (!camera || !this.#groups.length) return { lodCounts: [0, 0, 0], culled: 0 };

    camera.getWorldDirection(this.#tmpDir);
    const moved = camera.position.distanceTo(this.#lastCamPos);
    const cosAng = Math.max(-1, Math.min(1, this.#tmpDir.dot(this.#lastCamDir)));
    const rotDeg = THREE.MathUtils.radToDeg(Math.acos(cosAng));
    if (!force && moved < this.moveTriggerMeters && rotDeg < this.rotTriggerDeg) {
      return null;
    }
    this.#lastCamPos.copy(camera.position);
    this.#lastCamDir.copy(this.#tmpDir);

    camera.updateMatrixWorld();
    this.#projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.#frustum.setFromProjectionMatrix(this.#projScreen);

    const tanHalfFov = Math.tan(THREE.MathUtils.degToRad((camera.fov || 48) * 0.5));
    const lodCounts = [0, 0, 0];
    let culled = 0;

    for (const grp of this.#groups) {
      const counts = [0, 0, 0];
      const hasL1 = Boolean(grp.buckets[1]);
      const hasL2 = Boolean(grp.buckets[2]);
      const t01 = grp.thresholds[0] ?? 0.16;
      const t12 = grp.thresholds[1] ?? 0.055;

      for (const inst of grp.instances) {
        this.#tmpSphere.set(inst.center, inst.radius);
        if (!this.#frustum.intersectsSphere(this.#tmpSphere)) {
          culled++;
          continue;
        }

        let targetLod = 0;
        if (forcedLod === '0' || forcedLod === '1' || forcedLod === '2' || forcedLod === '3') {
          targetLod = Math.min(2, Number(forcedLod));
        } else {
          const dist = Math.max(0.5, camera.position.distanceTo(inst.center));
          const ratio = (inst.radius / (dist * tanHalfFov)) / Math.max(0.25, lodBias);
          if (ratio < grp.cullRatio && grp.cullRatio > 0) {
            culled++;
            continue;
          }
          const prev = inst.lod;
          if (hasL2 && (prev === 2 ? ratio < t12 * this.hysteresis : ratio < t12)) {
            targetLod = 2;
          } else if (hasL1 && (prev >= 1 ? ratio < t01 * this.hysteresis : ratio < t01)) {
            targetLod = 1;
          } else {
            targetLod = 0;
          }
        }

        while (targetLod > 0 && !grp.buckets[targetLod]) targetLod--;
        inst.lod = targetLod;
        const im = grp.buckets[targetLod];
        if (im) {
          im.setMatrixAt(counts[targetLod]++, inst.matrix);
        }
      }

      for (let lvl = 0; lvl < 3; lvl++) {
        const im = grp.buckets[lvl];
        if (!im) continue;
        im.count = counts[lvl];
        im.visible = counts[lvl] > 0;
        im.instanceMatrix.needsUpdate = true;
        lodCounts[lvl] += counts[lvl];
      }
    }
    return { lodCounts, culled };
  }

  dispose() {
    for (const grp of this.#groups) {
      for (const im of grp.buckets) {
        if (!im) continue;
        im.parent?.remove(im);
        im.dispose();
      }
    }
    this.#groups = [];
  }
}

export const InstancedPropPool = BucketedInstancedLodPool;

export {
  buildBeveledBoxRaw,
  buildBufferGeometryFromRaw,
  createWorldPbrMaterial,
  ensurePbrGeometryAttributes,
  loadHdriEnvironment,
  MaterialRegistry,
  PbrTextureArrayLoader,
};
