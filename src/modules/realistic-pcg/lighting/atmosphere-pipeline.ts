import * as THREE from 'three';
import { getQualityPreset, type QualityTier } from '../core/quality-presets.js';
import { createProceduralIBL, type LightingPresetName, type ProceduralIBLHandle } from './procedural-ibl.js';

export interface AtmospherePipelineHandle {
  sunLight: THREE.DirectionalLight;
  hemiLight: THREE.HemisphereLight;
  ibl: ProceduralIBLHandle;
  setPreset(name: LightingPresetName): void;
  setQuality(tier: QualityTier): void;
  update(timeSec: number, cameraPos?: THREE.Vector3): void;
  dispose(): void;
}

export function createAtmospherePipeline(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  options: {
    initialPreset?: LightingPresetName;
    quality?: QualityTier;
    sceneHalfExtent?: number;
  } = {}
): AtmospherePipelineHandle {
  let qualityTier: QualityTier = options.quality ?? 'HIGH';
  const extent = options.sceneHalfExtent ?? 22;

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const ibl = createProceduralIBL(options.initialPreset ?? 'OVERCAST_WET');
  scene.add(ibl.skyMesh);

  const sunLight = new THREE.DirectionalLight('#ffffff', 2.0);
  sunLight.castShadow = true;
  sunLight.shadow.bias = -0.0004;
  sunLight.shadow.normalBias = 0.025;
  sunLight.shadow.camera.left = -extent;
  sunLight.shadow.camera.right = extent;
  sunLight.shadow.camera.top = extent;
  sunLight.shadow.camera.bottom = -extent;
  sunLight.shadow.camera.near = 1.0;
  sunLight.shadow.camera.far = 90.0;
  sunLight.shadow.camera.updateProjectionMatrix();
  scene.add(sunLight);
  scene.add(sunLight.target);

  const hemiLight = new THREE.HemisphereLight('#8d99a6', '#222624', 0.65);
  scene.add(hemiLight);

  function applyShadowMapResolution(tier: QualityTier): void {
    const preset = getQualityPreset(tier);
    sunLight.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
    if (sunLight.shadow.map) {
      sunLight.shadow.map.dispose();
      sunLight.shadow.map = null;
    }
  }

  function applyPreset(name: LightingPresetName): void {
    ibl.setPreset(name, renderer, scene);
    const p = ibl.getPreset();
    const dir = new THREE.Vector3(p.sunDirection[0], p.sunDirection[1], p.sunDirection[2]).normalize();
    sunLight.position.copy(dir.multiplyScalar(36));
    sunLight.target.position.set(0, 0, 0);
    sunLight.color.set(p.sunColor);
    sunLight.intensity = p.sunIntensity;

    hemiLight.color.set(p.horizonColor);
    hemiLight.groundColor.set(p.groundColor);
    hemiLight.intensity = p.hemiIntensity;

    scene.fog = new THREE.FogExp2(p.fogColor, p.fogDensity);
    renderer.toneMappingExposure = p.exposure;
  }

  applyShadowMapResolution(qualityTier);
  applyPreset(options.initialPreset ?? 'OVERCAST_WET');

  return {
    sunLight,
    hemiLight,
    ibl,
    setPreset: applyPreset,
    setQuality(tier: QualityTier): void {
      if (tier === qualityTier) return;
      qualityTier = tier;
      applyShadowMapResolution(tier);
    },
    update(timeSec: number, cameraPos?: THREE.Vector3): void {
      ibl.update(timeSec, cameraPos);
    },
    dispose(): void {
      scene.remove(ibl.skyMesh);
      scene.remove(sunLight);
      scene.remove(sunLight.target);
      scene.remove(hemiLight);
      if (sunLight.shadow.map) {
        sunLight.shadow.map.dispose();
        sunLight.shadow.map = null;
      }
      scene.environment = null;
      scene.fog = null;
      ibl.dispose();
    },
  };
}
