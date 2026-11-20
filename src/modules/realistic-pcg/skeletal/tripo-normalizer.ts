import * as THREE from 'three';
import type { QualityTier } from '../core/quality-presets.js';

export interface TripoNormalizationConfig {
  albedoSaturation: number;
  albedoMinLuma: number;
  albedoMaxLuma: number;
  roughnessMin: number;
  roughnessMax: number;
  metalnessScale: number;
  normalScale: number;
  envMapIntensity: number;
  castShadow: boolean;
  receiveShadow: boolean;
}

export const DEFAULT_TRIPO_CONFIG: Readonly<TripoNormalizationConfig> = {
  albedoSaturation: 0.85,
  albedoMinLuma: 0.05,
  albedoMaxLuma: 0.82,
  roughnessMin: 0.42,
  roughnessMax: 0.95,
  metalnessScale: 0.85,
  normalScale: 1.15,
  envMapIntensity: 1.0,
  castShadow: true,
  receiveShadow: true,
};

export interface SkeletalAuditReport {
  triangles: number;
  boneCount: number;
  materialCount: number;
  maxTextureSize: number;
  warnings: string[];
  normalizedHeightMeters: number;
}

export interface TripoNormalizerHandle {
  applyToObject(
    root: THREE.Object3D,
    options?: { targetHeightMeters?: number; quality?: QualityTier }
  ): SkeletalAuditReport;
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  updateConfig(patch: Partial<TripoNormalizationConfig>): void;
  getConfig(): TripoNormalizationConfig;
}

export function createTripoMaterialNormalizer(
  initialConfig: Partial<TripoNormalizationConfig> = {}
): TripoNormalizerHandle {
  const config: TripoNormalizationConfig = { ...DEFAULT_TRIPO_CONFIG, ...initialConfig };
  let enabled = true;

  const sharedUniforms = {
    uTripoNormEnabled: { value: 1.0 },
    uTripoAlbedoSat: { value: config.albedoSaturation },
    uTripoAlbedoMinLuma: { value: config.albedoMinLuma },
    uTripoAlbedoMaxLuma: { value: config.albedoMaxLuma },
    uTripoRoughMin: { value: config.roughnessMin },
    uTripoRoughMax: { value: config.roughnessMax },
    uTripoMetalScale: { value: config.metalnessScale },
  };

  function patchMaterial(mat: THREE.Material): void {
    const std = mat as THREE.MeshStandardMaterial;
    if (!('roughness' in std) || std.userData.__tripoNormalized) return;
    std.userData.__tripoNormalized = true;

    std.envMapIntensity = config.envMapIntensity;
    if (std.normalScale && typeof std.normalScale.set === 'function') {
      std.normalScale.set(config.normalScale, config.normalScale);
    }

    const prevKey = typeof std.customProgramCacheKey === 'function' ? std.customProgramCacheKey() : '';
    std.customProgramCacheKey = () => `${prevKey}|tripo-norm-v1`;

    const prevOnBeforeCompile = std.onBeforeCompile;
    std.onBeforeCompile = (shader, renderer) => {
      if (typeof prevOnBeforeCompile === 'function') {
        prevOnBeforeCompile.call(std, shader, renderer);
      }
      Object.assign(shader.uniforms, sharedUniforms);

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uTripoNormEnabled;
uniform float uTripoAlbedoSat;
uniform float uTripoAlbedoMinLuma;
uniform float uTripoAlbedoMaxLuma;
uniform float uTripoRoughMin;
uniform float uTripoRoughMax;
uniform float uTripoMetalScale;`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
if ( uTripoNormEnabled > 0.5 ) {
  // Mild delighting & saturation alignment for Tripo3D baked albedo
  float tLuma = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  vec3 tDesat = mix( vec3( tLuma ), diffuseColor.rgb, uTripoAlbedoSat );
  float tTargetLuma = clamp( mix( tLuma, 0.28, 0.14 ), uTripoAlbedoMinLuma, uTripoAlbedoMaxLuma );
  float tScale = tLuma > 1e-4 ? ( tTargetLuma / tLuma ) : 1.0;
  diffuseColor.rgb = clamp( tDesat * tScale, 0.01, 0.95 );
}`
        )
        .replace(
          '#include <metalnessmap_fragment>',
          `#include <metalnessmap_fragment>
if ( uTripoNormEnabled > 0.5 ) {
  metalnessFactor = clamp( metalnessFactor * uTripoMetalScale, 0.0, 1.0 );
  float tMinR = metalnessFactor > 0.5 ? 0.20 : uTripoRoughMin;
  roughnessFactor = mix( tMinR, uTripoRoughMax, clamp( roughnessFactor, 0.0, 1.0 ) );
}`
        );
    };
    std.needsUpdate = true;
  }

  function syncUniforms(): void {
    sharedUniforms.uTripoNormEnabled.value = enabled ? 1.0 : 0.0;
    sharedUniforms.uTripoAlbedoSat.value = config.albedoSaturation;
    sharedUniforms.uTripoAlbedoMinLuma.value = config.albedoMinLuma;
    sharedUniforms.uTripoAlbedoMaxLuma.value = config.albedoMaxLuma;
    sharedUniforms.uTripoRoughMin.value = config.roughnessMin;
    sharedUniforms.uTripoRoughMax.value = config.roughnessMax;
    sharedUniforms.uTripoMetalScale.value = config.metalnessScale;
  }

  return {
    applyToObject(
      root: THREE.Object3D,
      options: { targetHeightMeters?: number; quality?: QualityTier } = {}
    ): SkeletalAuditReport {
      const targetHeight = options.targetHeightMeters ?? 1.75;
      const quality = options.quality ?? 'HIGH';

      // Reset transform before measuring raw bounds
      root.position.set(0, 0, 0);
      root.scale.set(1, 1, 1);
      root.updateMatrixWorld(true);

      const box = new THREE.Box3().setFromObject(root);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);

      const rawHeight = size.y > 0.01 ? size.y : targetHeight;
      const scaleFactor = targetHeight / rawHeight;
      root.scale.set(scaleFactor, scaleFactor, scaleFactor);
      root.updateMatrixWorld(true);

      // Ground feet strictly at local y = 0 and center X/Z
      const scaledBox = new THREE.Box3().setFromObject(root);
      const scaledCenter = new THREE.Vector3();
      scaledBox.getCenter(scaledCenter);
      root.position.set(-scaledCenter.x, -scaledBox.min.y, -scaledCenter.z);
      root.updateMatrixWorld(true);

      let triangles = 0;
      let boneCount = 0;
      const materials = new Set<THREE.Material>();
      let maxTextureSize = 0;

      root.traverse((obj) => {
        if ((obj as { isBone?: boolean }).isBone || obj.constructor?.name === 'Bone') {
          boneCount++;
        }
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry) {
          mesh.castShadow = config.castShadow;
          mesh.receiveShadow = config.receiveShadow;
          const index = mesh.geometry.getIndex();
          const pos = mesh.geometry.getAttribute('position');
          if (index) triangles += Math.floor(index.count / 3);
          else if (pos) triangles += Math.floor(pos.count / 3);

          const matList = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of matList) {
            if (!m) continue;
            materials.add(m);
            patchMaterial(m);
            const std = m as THREE.MeshStandardMaterial;
            for (const tex of [std.map, std.normalMap, std.roughnessMap, std.metalnessMap, std.aoMap]) {
              const img = tex?.image as { width?: number; height?: number } | undefined;
              if (img?.width && img?.height) {
                maxTextureSize = Math.max(maxTextureSize, img.width, img.height);
              }
            }
          }
        }
      });

      const warnings: string[] = [];
      const triLimit = quality === 'LOW' ? 12000 : 30000;
      if (triangles > triLimit) {
        warnings.push(`Skeletal triangle count (${triangles}) exceeds ${quality} budget (${triLimit})`);
      }
      if (maxTextureSize > 1024) {
        warnings.push(`Skeletal texture size (${maxTextureSize}px) exceeds recommended 1024px cap`);
      }

      return {
        triangles,
        boneCount,
        materialCount: materials.size,
        maxTextureSize,
        warnings,
        normalizedHeightMeters: targetHeight,
      };
    },

    setEnabled(val: boolean): void {
      enabled = Boolean(val);
      syncUniforms();
    },

    isEnabled(): boolean {
      return enabled;
    },

    updateConfig(patch: Partial<TripoNormalizationConfig>): void {
      Object.assign(config, patch);
      syncUniforms();
    },

    getConfig(): TripoNormalizationConfig {
      return { ...config };
    },
  };
}
