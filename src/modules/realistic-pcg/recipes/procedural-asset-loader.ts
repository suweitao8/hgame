import type * as THREE from 'three';
import { getQualityPreset, type QualityTier, type RealisticQualityPreset } from '../core/quality-presets.js';
import type { ParamMap } from '../core/safe-expr.js';
import { extractBoundsBox, extractTriMesh } from '../geometry/collider-exporter.js';
import { bakeMaterialArrayAsync, type TextureArraySet } from '../materials/texture-array-baker.js';
import { evaluateMeshRecipe } from './mesh-recipe-eval.js';
import type {
  AABB,
  MaterialRecipe,
  MeshRecipe,
  ProceduralManifest,
  TriMeshData,
} from './schema-types.js';

export interface InstantiateMeshOptions {
  params?: ParamMap;
  materialOverrides?: Record<string, string>;
}

export interface InstantiatedMeshAsset {
  geometry: THREE.BufferGeometry;
  colliders: AABB[] | TriMeshData;
  cacheKey: string;
  triangleCount: number;
}

export interface ProceduralAssetLoaderOptions {
  quality?: QualityTier;
  renderer?: THREE.WebGLRenderer | null;
  fetchJson?: (url: string) => Promise<unknown>;
}

function stableStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify((obj as Record<string, unknown>)[k])).join(',') + '}';
}

function resolveRelativeUrl(baseUrl: string, relPath: string): string {
  const idx = baseUrl.lastIndexOf('/');
  const dir = idx >= 0 ? baseUrl.slice(0, idx + 1) : '';
  return dir + relPath;
}

export class ProceduralAssetLoader {
  private preset: RealisticQualityPreset;
  private renderer: THREE.WebGLRenderer | null;
  private fetchJson: (url: string) => Promise<unknown>;
  private materialRecipes = new Map<string, MaterialRecipe>();
  private meshRecipes = new Map<string, MeshRecipe>();
  private meshCache = new Map<string, InstantiatedMeshAsset>();
  private textureArray: TextureArraySet | null = null;

  constructor(options: ProceduralAssetLoaderOptions = {}) {
    this.preset = getQualityPreset(options.quality ?? 'HIGH');
    this.renderer = options.renderer ?? null;
    this.fetchJson =
      options.fetchJson ??
      (async (url: string) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
        return res.json();
      });
  }

  getQualityPreset(): RealisticQualityPreset {
    return this.preset;
  }

  getTextureArray(): TextureArraySet | null {
    return this.textureArray;
  }

  getMaterialId(id: string): number {
    const info = this.textureArray?.layers.get(id);
    if (!info) {
      throw new Error(`Material "${id}" is not registered in TextureArray`);
    }
    return info.materialId;
  }

  getMaterialRecipe(id: string): MaterialRecipe | undefined {
    return this.materialRecipes.get(id);
  }

  getMeshRecipe(id: string): MeshRecipe | undefined {
    return this.meshRecipes.get(id);
  }

  listMaterialIds(): string[] {
    return [...this.materialRecipes.keys()];
  }

  listMeshIds(): string[] {
    return [...this.meshRecipes.keys()];
  }

  getCachedMeshCount(): number {
    return this.meshCache.size;
  }

  async loadManifest(
    manifestUrl: string,
    onProgress?: (ratio: number) => void
  ): Promise<void> {
    const manifest = (await this.fetchJson(manifestUrl)) as ProceduralManifest;
    if (manifest.format !== 'hgame.manifest' || manifest.version !== 1) {
      throw new Error(`Invalid manifest at ${manifestUrl}`);
    }

    const [mats, meshes] = await Promise.all([
      Promise.all(
        manifest.materials.map((m) =>
          this.fetchJson(resolveRelativeUrl(manifestUrl, m.path)) as Promise<MaterialRecipe>
        )
      ),
      Promise.all(
        manifest.meshes.map((m) =>
          this.fetchJson(resolveRelativeUrl(manifestUrl, m.path)) as Promise<MeshRecipe>
        )
      ),
    ]);

    this.materialRecipes.clear();
    this.meshRecipes.clear();
    this.clearMeshCache();
    if (this.textureArray) {
      this.textureArray.dispose();
      this.textureArray = null;
    }

    for (const mat of mats) this.materialRecipes.set(mat.id, mat);
    for (const mesh of meshes) this.meshRecipes.set(mesh.id, mesh);

    this.textureArray = await bakeMaterialArrayAsync(mats, this.preset, {
      onProgress,
      renderer: this.renderer,
    });
  }

  async setQuality(tier: QualityTier, onProgress?: (ratio: number) => void): Promise<TextureArraySet> {
    this.preset = getQualityPreset(tier);
    if (this.textureArray) {
      this.textureArray.dispose();
      this.textureArray = null;
    }
    const mats = [...this.materialRecipes.values()];
    this.textureArray = await bakeMaterialArrayAsync(mats, this.preset, {
      onProgress,
      renderer: this.renderer,
    });
    return this.textureArray;
  }

  async registerMaterialRecipe(recipe: MaterialRecipe): Promise<number> {
    this.materialRecipes.set(recipe.id, recipe);
    if (!this.textureArray) {
      this.textureArray = await bakeMaterialArrayAsync([recipe], this.preset, {
        renderer: this.renderer,
      });
      return this.getMaterialId(recipe.id);
    }
    return this.textureArray.updateLayer(recipe, this.renderer);
  }

  registerMeshRecipe(recipe: MeshRecipe): void {
    this.meshRecipes.set(recipe.id, recipe);
    // Invalidate cached geometries that match this mesh or reference it via ref
    for (const [key, entry] of this.meshCache.entries()) {
      if (key.startsWith(`${recipe.id}|`) || this.meshUsesRef(key.split('|')[0]!, recipe.id)) {
        entry.geometry.dispose();
        this.meshCache.delete(key);
      }
    }
  }

  private meshUsesRef(rootId: string, targetId: string, seen = new Set<string>()): boolean {
    if (seen.has(rootId)) return false;
    seen.add(rootId);
    const r = this.meshRecipes.get(rootId);
    if (!r) return false;
    for (const p of r.parts) {
      if (p.op === 'ref' && p.ref) {
        if (p.ref === targetId) return true;
        if (this.meshUsesRef(p.ref, targetId, seen)) return true;
      }
    }
    return false;
  }

  instantiateMesh(meshId: string, options: InstantiateMeshOptions = {}): InstantiatedMeshAsset {
    const recipe = this.meshRecipes.get(meshId);
    if (!recipe) {
      throw new Error(`Unknown mesh recipe "${meshId}"`);
    }
    const cacheKey = `${meshId}|${stableStringify(options.params ?? {})}|${stableStringify(
      options.materialOverrides ?? {}
    )}`;
    const cached = this.meshCache.get(cacheKey);
    if (cached) return cached;

    const evaluated = evaluateMeshRecipe(
      recipe,
      {
        recipes: this.meshRecipes,
        resolveMaterialId: (matName) => this.getMaterialId(matName),
      },
      options
    );

    const colliderMode = recipe.meta.collider ?? 'auto_boxes';
    const colliders: AABB[] | TriMeshData =
      colliderMode === 'trimesh'
        ? extractTriMesh(evaluated.geometry)
        : colliderMode === 'none'
        ? []
        : extractBoundsBox(evaluated.geometry);

    const asset: InstantiatedMeshAsset = {
      geometry: evaluated.geometry,
      colliders,
      cacheKey,
      triangleCount: evaluated.triangleCount,
    };
    this.meshCache.set(cacheKey, asset);
    return asset;
  }

  clearMeshCache(): void {
    for (const entry of this.meshCache.values()) {
      entry.geometry.dispose();
    }
    this.meshCache.clear();
  }

  dispose(): void {
    this.clearMeshCache();
    if (this.textureArray) {
      this.textureArray.dispose();
      this.textureArray = null;
    }
    this.materialRecipes.clear();
    this.meshRecipes.clear();
  }
}
