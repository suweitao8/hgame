export type QualityTier = 'HIGH' | 'LOW';

export interface RealisticQualityPreset {
  tier: QualityTier;
  textureSize: number;
  shadowMapSize: number;
  anisotropy: number;
  pixelRatioCap: number;
  frameBudgetMs: number;
  enableTriplanar: boolean;
  enableMicroDetail: boolean;
  maxMaterials: number;
  maxTextureMemoryMB: number;
  skeletalMaxTriangles: number;
  skeletalMaxTextureSize: number;
}

export const REALISTIC_QUALITY_PRESETS: Readonly<Record<QualityTier, RealisticQualityPreset>> = {
  HIGH: {
    tier: 'HIGH',
    textureSize: 512,
    shadowMapSize: 2048,
    anisotropy: 8,
    pixelRatioCap: 2,
    frameBudgetMs: 8,
    enableTriplanar: true,
    enableMicroDetail: true,
    maxMaterials: 16,
    maxTextureMemoryMB: 96,
    skeletalMaxTriangles: 30000,
    skeletalMaxTextureSize: 1024,
  },
  LOW: {
    tier: 'LOW',
    textureSize: 256,
    shadowMapSize: 1024,
    anisotropy: 2,
    pixelRatioCap: 1.5,
    frameBudgetMs: 8,
    enableTriplanar: false,
    enableMicroDetail: true,
    maxMaterials: 16,
    maxTextureMemoryMB: 24,
    skeletalMaxTriangles: 12000,
    skeletalMaxTextureSize: 1024,
  },
};

export function getQualityPreset(tier: QualityTier): RealisticQualityPreset {
  return REALISTIC_QUALITY_PRESETS[tier];
}
