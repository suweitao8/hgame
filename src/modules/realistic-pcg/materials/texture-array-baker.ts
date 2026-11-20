import * as THREE from 'three';
import type { RealisticQualityPreset } from '../core/quality-presets.js';
import type { ParamMap } from '../core/safe-expr.js';
import {
  createMaterialBakeJob,
  type BakedMaterialBuffers,
  type MaterialBakeJob,
} from '../recipes/material-graph-eval.js';
import type { MaterialRecipe } from '../recipes/schema-types.js';
import { createGpuMaterialBaker, type GpuBakerContext } from './gpu-material-baker.js';

export type BakeMode = 'auto' | 'gpu' | 'cpu';

export interface MaterialLayerInfo {
  id: string;
  materialId: number;
  tileMeters: number;
  recipe: MaterialRecipe;
  stats: BakedMaterialBuffers['stats'];
}

export interface TextureArraySet {
  albedoArray: THREE.DataArrayTexture;
  normalArray: THREE.DataArrayTexture;
  ormArray: THREE.DataArrayTexture;
  size: number;
  depth: number;
  bakeBackend: 'gpu' | 'cpu';
  layers: Map<string, MaterialLayerInfo>;
  tileMetersById: Float32Array;
  estimatedMemoryMB: number;
  bakeTimeMs: number;
  maxSliceMs: number;
  updateLayer(
    recipe: MaterialRecipe,
    renderer?: THREE.WebGLRenderer | null,
    paramOverrides?: ParamMap
  ): Promise<number>;
  dispose(): void;
}

function createArrayTex(
  data: Uint8Array,
  size: number,
  depth: number,
  colorSpace: string,
  anisotropy: number
): THREE.DataArrayTexture {
  const tex = new THREE.DataArrayTexture(data, size, size, depth);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = colorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = anisotropy;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

function nextFrameYield(): Promise<void> {
  if (typeof MessageChannel === 'function') {
    return new Promise((resolve) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => {
        ch.port1.close();
        ch.port2.close();
        resolve();
      };
      ch.port2.postMessage(null);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function copyLayerToArray(
  dst: Uint8Array,
  src: Uint8Array,
  layerIdx: number,
  layerByteLength: number
): void {
  dst.set(src, layerIdx * layerByteLength);
}

function uploadLayerSubImage3D(
  renderer: THREE.WebGLRenderer,
  tex: THREE.DataArrayTexture,
  layerIdx: number,
  size: number,
  data: Uint8Array
): boolean {
  try {
    const props = renderer.properties?.get(tex) as { __webglTexture?: WebGLTexture } | undefined;
    const gl = renderer.getContext?.();
    if (!props?.__webglTexture || !gl || typeof gl.texSubImage3D !== 'function') {
      return false;
    }
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, props.__webglTexture);
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      0,
      0,
      layerIdx,
      size,
      size,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      data
    );
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    return true;
  } catch {
    return false;
  }
}

function canUseGpuBake(renderer: THREE.WebGLRenderer | null | undefined, mode: BakeMode): boolean {
  if (mode === 'cpu') return false;
  return Boolean(
    renderer &&
      typeof renderer.setRenderTarget === 'function' &&
      typeof renderer.readRenderTargetPixels === 'function'
  );
}

export async function bakeMaterialArrayAsync(
  recipes: MaterialRecipe[],
  preset: RealisticQualityPreset,
  options: {
    onProgress?: (ratio: number) => void;
    renderer?: THREE.WebGLRenderer | null;
    bakeMode?: BakeMode;
  } = {}
): Promise<TextureArraySet> {
  const startTime = performance.now();
  const size = preset.textureSize;
  const maxLayers = Math.max(preset.maxMaterials, recipes.length);
  const layerBytes = size * size * 4;
  const totalBytes = layerBytes * maxLayers;

  const albedoAll = new Uint8Array(totalBytes);
  const normalAll = new Uint8Array(totalBytes);
  const ormAll = new Uint8Array(totalBytes);

  if (recipes.length === 0) {
    for (let p = 0; p < layerBytes; p += 4) {
      albedoAll[p] = 128; albedoAll[p + 1] = 128; albedoAll[p + 2] = 128; albedoAll[p + 3] = 128;
      normalAll[p] = 128; normalAll[p + 1] = 128; normalAll[p + 2] = 255; normalAll[p + 3] = 255;
      ormAll[p] = 255; ormAll[p + 1] = 204; ormAll[p + 2] = 0; ormAll[p + 3] = 128;
    }
  }

  const bakeMode = options.bakeMode ?? 'auto';
  const useGpu = canUseGpuBake(options.renderer, bakeMode);
  let gpuBaker: GpuBakerContext | null = null;
  let actualBackend: 'gpu' | 'cpu' = 'cpu';

  if (useGpu && options.renderer) {
    try {
      gpuBaker = createGpuMaterialBaker(options.renderer);
      actualBackend = 'gpu';
    } catch {
      gpuBaker = null;
      actualBackend = 'cpu';
    }
  }

  const layers = new Map<string, MaterialLayerInfo>();
  const tileMetersById = new Float32Array(maxLayers);
  tileMetersById.fill(1.0);

  let maxSliceMs = 0;
  let gpuSliceAccumMs = 0;
  const totalJobs = Math.max(1, recipes.length);

  for (let i = 0; i < recipes.length; i++) {
    const recipe = recipes[i]!;
    let baked: BakedMaterialBuffers | null = null;

    if (gpuBaker) {
      try {
        const t0 = performance.now();
        baked = gpuBaker.bakeMaterial(recipe, size);
        const dt = performance.now() - t0;
        if (dt > maxSliceMs) maxSliceMs = dt;
        gpuSliceAccumMs += dt;
        if (gpuSliceAccumMs >= preset.frameBudgetMs && i + 1 < recipes.length) {
          gpuSliceAccumMs = 0;
          await nextFrameYield();
        }
      } catch {
        baked = null;
        actualBackend = 'cpu';
      }
    }

    if (!baked) {
      const job: MaterialBakeJob = createMaterialBakeJob(recipe, size);
      while (true) {
        const t0 = performance.now();
        const done = job.step(preset.frameBudgetMs);
        const dt = performance.now() - t0;
        if (dt > maxSliceMs) maxSliceMs = dt;
        if (done) break;
        options.onProgress?.((i + 0.5) / totalJobs);
        await nextFrameYield();
      }
      baked = job.getResult();
    }

    copyLayerToArray(albedoAll, baked.albedoData, i, layerBytes);
    copyLayerToArray(normalAll, baked.normalData, i, layerBytes);
    copyLayerToArray(ormAll, baked.ormData, i, layerBytes);

    tileMetersById[i] = recipe.meta.tileMeters;
    layers.set(recipe.id, {
      id: recipe.id,
      materialId: i,
      tileMeters: recipe.meta.tileMeters,
      recipe,
      stats: baked.stats,
    });
    options.onProgress?.((i + 1) / totalJobs);
  }

  if (gpuBaker) {
    gpuBaker.dispose();
    gpuBaker = null;
  }

  const maxAniso = options.renderer?.capabilities?.getMaxAnisotropy?.() ?? preset.anisotropy;
  const aniso = Math.min(preset.anisotropy, maxAniso);
  const albedoArray = createArrayTex(albedoAll, size, maxLayers, THREE.SRGBColorSpace, aniso);
  const normalArray = createArrayTex(normalAll, size, maxLayers, THREE.NoColorSpace, 1);
  const ormArray = createArrayTex(ormAll, size, maxLayers, THREE.NoColorSpace, 1);

  const bakeTimeMs = performance.now() - startTime;
  const estimatedMemoryMB = (totalBytes * 3 * (4 / 3)) / (1024 * 1024);
  let nextSlot = recipes.length;

  return {
    albedoArray,
    normalArray,
    ormArray,
    size,
    depth: maxLayers,
    bakeBackend: actualBackend,
    layers,
    tileMetersById,
    estimatedMemoryMB,
    bakeTimeMs,
    maxSliceMs,

    async updateLayer(
      recipe: MaterialRecipe,
      renderer?: THREE.WebGLRenderer | null,
      paramOverrides?: ParamMap
    ): Promise<number> {
      const existing = layers.get(recipe.id);
      let slot: number;
      if (existing) {
        slot = existing.materialId;
      } else {
        if (nextSlot >= maxLayers) {
          throw new Error(`Material array capacity (${maxLayers}) exceeded when registering "${recipe.id}"`);
        }
        slot = nextSlot++;
      }

      const activeRenderer = renderer ?? options.renderer ?? null;
      let baked: BakedMaterialBuffers | null = null;
      if (canUseGpuBake(activeRenderer, bakeMode) && activeRenderer) {
        const tempBaker = createGpuMaterialBaker(activeRenderer);
        try {
          baked = tempBaker.bakeMaterial(recipe, size, paramOverrides);
        } catch {
          baked = null;
        } finally {
          tempBaker.dispose();
        }
      }

      if (!baked) {
        const job = createMaterialBakeJob(recipe, size, paramOverrides);
        while (!job.step(preset.frameBudgetMs)) {
          await nextFrameYield();
        }
        baked = job.getResult();
      }

      copyLayerToArray(albedoAll, baked.albedoData, slot, layerBytes);
      copyLayerToArray(normalAll, baked.normalData, slot, layerBytes);
      copyLayerToArray(ormAll, baked.ormData, slot, layerBytes);
      tileMetersById[slot] = recipe.meta.tileMeters;

      layers.set(recipe.id, {
        id: recipe.id,
        materialId: slot,
        tileMeters: recipe.meta.tileMeters,
        recipe,
        stats: baked.stats,
      });

      const subOk =
        activeRenderer !== null &&
        uploadLayerSubImage3D(activeRenderer, albedoArray, slot, size, baked.albedoData) &&
        uploadLayerSubImage3D(activeRenderer, normalArray, slot, size, baked.normalData) &&
        uploadLayerSubImage3D(activeRenderer, ormArray, slot, size, baked.ormData);

      if (!subOk) {
        albedoArray.needsUpdate = true;
        normalArray.needsUpdate = true;
        ormArray.needsUpdate = true;
      }
      return slot;
    },

    dispose(): void {
      albedoArray.dispose();
      normalArray.dispose();
      ormArray.dispose();
      layers.clear();
    },
  };
}
