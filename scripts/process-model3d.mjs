#!/usr/bin/env node
/**
 * Local 3D AI modeling & Blender pose-normalization CLI for HGame 1.0.0.
 *
 * Integrates:
 * - Local ComfyUI + Trellis2-GGUF (image -> 3D GLB)
 * - Local ComfyUI + UltraTex LowVRAM GGUF (mesh + reference -> PBR textures + GLB)
 * - Headless Blender (inspect, pose/origin/scale/face-budget normalize, multi-view QA render)
 */

import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decodePng, encodePng, splitRgbaGrid } from './process-assets.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const blenderHelperPath = path.join(scriptDir, 'blender-model3d.py');

export const DEFAULT_TRELLIS2_WORKFLOW_REL = 'user/default/workflows/PixelArtistry/MeshWithTexturing_Pixal3D_GGUF.json';
export const DEFAULT_TRELLIS2_HQ_WORKFLOW_REL = 'user/default/workflows/Trellis2GGUF/High_Quality_GGUF.json';
export const DEFAULT_ULTRATEX_WORKFLOW_REL = 'user/default/workflows/PixelArtistry/PixelArtistry_UltraTex_03_LowVRAM_GGUF.json';

/**
 * T5 Skeletal Character Poly & LOD Budgets (per HGame 3D Model & LOD Spec):
 * - low / npc:  LOD0 <= 6,000 tris / <= 7,500 GPU vertices (via targetQuads = 2800), LOD1 ~2,200 tris
 * - hero:       LOD0 <= 9,000 tris / <= 11,000 GPU vertices (via targetQuads = 4200), LOD1 ~2,200 tris
 * - high:       High-poly bake master (16k quads, <= 65,535 16-bit index hard cap)
 */
export const GLOBAL_MAX_GPU_VERTICES = 65535;
export const T5_LOD1_TARGET_TRIS = 2200;

export const CHARACTER_POLY_PRESETS = Object.freeze({
  low: Object.freeze({ targetQuads: 2800, maxTris: 6000, maxVertices: 7500, lod1TargetTris: 2200, textureSize: 1024, normalStrength: 0.25 }),
  hero: Object.freeze({ targetQuads: 4200, maxTris: 9000, maxVertices: 11000, lod1TargetTris: 2200, textureSize: 1024, normalStrength: 0.25 }),
  high: Object.freeze({ targetQuads: 16000, maxTris: 36000, maxVertices: 65535, lod1TargetTris: 0, textureSize: 2048, normalStrength: 0.28 }),
});

export function resolveLowPolyPreset(name = 'low') {
  const key = String(name || 'low').trim().toLowerCase();
  if (key === 'high' || key === 'hq') {
    return { name: 'high', ...CHARACTER_POLY_PRESETS.high };
  }
  if (['hero', 'player', 'protagonist', 'boss'].includes(key)) {
    return { name: 'hero', ...CHARACTER_POLY_PRESETS.hero };
  }
  if (['low', 'npc', 'character', 'general', 'mob', 'standard'].includes(key)) {
    return { name: 'low', ...CHARACTER_POLY_PRESETS.low };
  }
  throw new RangeError(`Unknown character poly preset "${name}"; expected low|npc|hero|high`);
}

export const SKIP_UI_NODE_TYPES = new Set([
  'Reroute',
  'Note',
  'MarkdownNote',
  'Preview3D',
  'Preview3DAdvanced',
]);

export const TRELLIS2_WIDGET_ORDER = {
  Trellis2ExportMesh: ['filename_prefix', 'file_format'],
  Trellis2PreProcessImage: ['padding', 'remove_background', 'max_size'],
  Trellis2ImageCondGenerator: ['max_views'],
  PrimitiveInt: ['value', 'value:__control__'],
  PrimitiveString: ['value'],
  Trellis2DecodeLatents: ['resolution', 'use_tiled_decoder'],
  Trellis2ShapeGenerator: [
    'resolution', 'shape_steps', 'shape_guidance_strength',
    'shape_guidance_rescale', 'shape_rescale_t', 'shape_sampler',
    'shape_guidance_interval_start', 'shape_guidance_interval_end', 'verbose',
    'dino_lock', 'dino_substeps', 'dino_foundation_cap',
  ],
  Trellis2TexSlatGenerator: [
    'resolution', 'texture_steps', 'texture_guidance_strength',
    'texture_guidance_rescale', 'texture_rescale_t', 'texture_sampler',
    'texture_guidance_interval_start', 'texture_guidance_interval_end', 'verbose',
    'dino_lock', 'dino_substeps', 'dino_foundation_cap', 'from_resolution',
  ],
  Trellis2SparseGenerator: [
    'seed', 'seed:__control__', 'sparse_structure_steps',
    'sparse_structure_guidance_strength', 'sparse_structure_guidance_rescale',
    'sparse_structure_rescale_t', 'sparse_structure_sampler', 'sparse_structure_resolution',
    'sparse_structure_guidance_interval_start', 'sparse_structure_guidance_interval_end',
    'fill_holes', 'hole_iterations', 'verbose', 'dino_lock', 'dino_substeps',
    'hole_fill_algorithm', 'dino_foundation_cap', 'keep_only_shell',
  ],
  Trellis2ShapeCascadeGenerator: [
    'seed', 'from_resolution',
    'sparse_structure_resolution', 'max_num_tokens', 'shape_steps',
    'shape_guidance_strength', 'shape_guidance_rescale', 'shape_rescale_t',
    'shape_sampler', 'shape_guidance_interval_start', 'shape_guidance_interval_end',
    'verbose', 'dino_lock', 'dino_substeps', 'dino_foundation_cap',
  ],
  Trellis2SimplifyMesh: ['target_face_num', 'method'],
  Trellis2RemeshWithQuad: [
    'remesh_band', 'remesh_project', 'dual_contouring_resolution',
    'remove_floaters', 'remove_inner_faces',
  ],
  Trellis2ReconstructMeshWithQuad: [
    'remesh_band', 'resolution', 'remove_floaters', 'remove_inner_faces',
  ],
  Trellis2MeshWithVoxelToTrimesh: ['reorient_vertices'],
  Trellis2MeshWithVoxelAdvancedGenerator: [
    'seed', 'seed:__control__', 'pipeline_type',
    'sparse_structure_steps', 'sparse_structure_guidance_strength',
    'sparse_structure_guidance_rescale', 'sparse_structure_rescale_t',
    'shape_steps', 'shape_guidance_strength', 'shape_guidance_rescale', 'shape_rescale_t',
    'texture_steps', 'texture_guidance_strength', 'texture_guidance_rescale', 'texture_rescale_t',
    'max_num_tokens', 'max_views', 'sparse_structure_resolution', 'generate_texture_slat',
    'sparse_structure_guidance_interval_start', 'sparse_structure_guidance_interval_end',
    'shape_guidance_interval_start', 'shape_guidance_interval_end',
    'texture_guidance_interval_start', 'texture_guidance_interval_end',
    'use_tiled_decoder', 'sampler',
    'fill_holes', 'hole_iterations', 'verbose', 'dino_lock', 'dino_substeps',
    'hole_fill_algorithm', 'dino_foundation_cap', 'keep_only_shell',
  ],
  Trellis2MeshRefiner: [
    'seed', 'seed:__control__', 'resolution',
    'shape_steps', 'shape_guidance_strength', 'shape_guidance_rescale', 'shape_rescale_t',
    'texture_steps', 'texture_guidance_strength', 'texture_guidance_rescale', 'texture_rescale_t',
    'max_num_tokens', 'generate_texture_slat', 'downsampling',
    'shape_guidance_interval_start', 'shape_guidance_interval_end',
    'texture_guidance_interval_start', 'texture_guidance_interval_end',
    'use_tiled_decoder', 'max_views', 'sampler',
    'verbose', 'dino_lock', 'dino_substeps', 'dino_foundation_cap',
  ],
  Trellis2MeshTexturing: [
    'seed', 'seed:__control__', 'texture_steps', 'texture_guidance_strength',
    'texture_guidance_rescale', 'texture_rescale_t', 'resolution', 'texture_size',
    'texture_alpha_mode', 'double_side_material',
    'texture_guidance_interval_start', 'texture_guidance_interval_end',
    'max_views', 'bake_on_vertices', 'use_custom_normals',
    'mesh_cluster_threshold_cone_half_angle_rad', 'sampler', 'inpainting',
    'verbose', 'dino_lock', 'dino_substeps', 'dino_foundation_cap',
  ],
  Trellis2SmoothNormals: [],
  Trellis2Continue: [],
  StringConcatenate: ['string_a', 'string_b', 'delimiter'],
  Trellis2FillHolesWithMeshlib: [],
  Trellis2UnWrapAndRasterizer: [
    'mesh_cluster_threshold_cone_half_angle_rad',
    'mesh_cluster_refine_iterations', 'mesh_cluster_global_iterations',
    'mesh_cluster_smooth_strength', 'texture_size', 'texture_alpha_mode',
    'double_side_material', 'bake_on_vertices', 'use_custom_normals', 'inpainting',
    'reorient_vertices',
  ],
  Trellis2LoadImageWithTransparency: ['image', 'image:__upload__'],
  Trellis2LoadModel_GGUF: [
    'modelname', 'model_format', 'backend', 'device',
    'low_vram', 'keep_models_loaded',
  ],
};

export const ULTRATEX_WIDGET_ORDER = {
  Load3DAdvanced: ['model_file', 'viewport_state', 'width', 'height'],
  LoadImage: ['image', 'image:__upload__'],
  UnetLoaderGGUF: ['unet_name'],
  VAELoader: ['vae_name'],
  CLIPLoaderGGUF: ['clip_name', 'type'],
  CLIPLoader: ['clip_name', 'type', 'device'],
  UTXTextEncode: ['text'],
  UTXGenerateTextureViewsV23: [
    'lora_name', 'lora_strength', 'decoder_name', 'task',
    'view_resolution', 'view_count', 'seed', 'seed:__control__', 'steps', 'guidance',
    'denoise', 'sparse_retention', 'extra_angle_mode', 'extra_denoise', 'extra_steps',
    'tiled_decode',
  ],
  UTXSaveViews: ['prefix'],
  SaveGLB: ['filename_prefix', 'preview:__control__'],
  SaveImage: ['filename_prefix'],
  LoadBackgroundRemovalModel: ['bg_removal_name'],
  RemoveBackground: [],
  MaskToImage: [],
  PreviewImage: [],
  UTXFileToMesh: [],
  UTXUnwrapMeshUVV25: ['atlas_size', 'uv_mode', 'padding'],
  UTXPrepareTextureV25: [
    'alignment', 'mask_polarity', 'normal_mode',
    'normal_view_resolution', 'camera_fit', 'image_margin_percent',
    'image_padding_pixels', 'reference_zoom',
  ],
  UTXFastSurfaceTextureBaker: ['texture_size', 'completion', 'upscale_mode', 'device'],
  UTXConfigureRuntime: [
    'spill_directory', 'ram_cache_mb', 'disk_budget_gb', 'system_headroom_mb',
    'gpu_headroom_mb', 'token_chunk', 'activation_factor', 'atlas_tile', 'decode_tile',
    'performance_mode', 'max_vram_mb', 'adaptive_diagnostics',
  ],
  InvertMask: [],
  JoinImageWithAlpha: [],
};

function findLocalConfigFile(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, '.hgame.local.json');
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const repoCandidate = path.join(repoRoot, '.hgame.local.json');
  if (existsSync(repoCandidate)) return repoCandidate;
  return null;
}

function cleanStr(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function resolveMaybeRelative(baseDir, rawPath) {
  const s = cleanStr(rawPath);
  if (!s) return null;
  if (path.isAbsolute(s)) return path.resolve(s);
  return baseDir ? path.resolve(baseDir, s) : path.resolve(s);
}

/**
 * Resolves local 3D modeling toolchain config from `.hgame.local.json` and env vars.
 * Never embeds machine-specific paths in tracked source files.
 */
export function resolveModel3dConfig(startDir = process.cwd(), overrides = {}) {
  let fileConfig = {};
  const configPath = findLocalConfigFile(startDir);
  if (configPath) {
    try {
      fileConfig = JSON.parse(readFileSync(configPath, 'utf8')) || {};
    } catch {
      fileConfig = {};
    }
  }

  const section = (fileConfig && typeof fileConfig.model3d === 'object' && fileConfig.model3d) || {};
  const rawRoot = cleanStr(overrides.rootDir)
    || cleanStr(process.env.HGAME_MODEL3D_DIR)
    || cleanStr(section.rootDir);
  const rootDir = rawRoot ? path.resolve(rawRoot) : null;

  const comfyUiUrl = (
    cleanStr(overrides.comfyUiUrl)
    || cleanStr(process.env.HGAME_MODEL3D_COMFY_URL)
    || cleanStr(section.comfyUiUrl)
    || 'http://127.0.0.1:8188'
  ).replace(/\/+$/, '');

  const rawComfyDir = cleanStr(overrides.comfyUiDir)
    || cleanStr(process.env.HGAME_MODEL3D_COMFY_DIR)
    || cleanStr(section.comfyUiDir)
    || (rootDir ? path.join(rootDir, 'ComfyUI-Easy-Install', 'ComfyUI') : '');
  const comfyUiDir = rawComfyDir ? path.resolve(rawComfyDir) : null;

  const blenderPath = cleanStr(overrides.blenderPath)
    || cleanStr(process.env.HGAME_MODEL3D_BLENDER)
    || cleanStr(section.blenderPath)
    || 'blender';

  const trellis2Workflow = resolveMaybeRelative(
    comfyUiDir,
    cleanStr(overrides.trellis2Workflow) || cleanStr(section.trellis2Workflow) || DEFAULT_TRELLIS2_WORKFLOW_REL
  );
  const ultratexWorkflow = resolveMaybeRelative(
    comfyUiDir,
    cleanStr(overrides.ultratexWorkflow) || cleanStr(section.ultratexWorkflow) || DEFAULT_ULTRATEX_WORKFLOW_REL
  );

  const startBatPath = resolveMaybeRelative(
    rootDir,
    cleanStr(section.startBatPath) || (rootDir ? path.join(rootDir, 'ComfyUI-Easy-Install', 'Start ComfyUI FlashAttention.bat') : '')
  );

  const runAnimGlb = resolveMaybeRelative(
    rootDir,
    cleanStr(overrides.runAnimGlb) || cleanStr(process.env.HGAME_MODEL3D_RUN_ANIM_GLB) || cleanStr(section.runAnimGlb)
  );

  return {
    configPath,
    rootDir,
    comfyUiUrl,
    comfyUiDir,
    blenderPath,
    trellis2Workflow,
    ultratexWorkflow,
    startBatPath,
    runAnimGlb,
  };
}

/** Ensures paths passed to ComfyUI / QuadRemesher / Blender stay strictly ASCII. */
export function assertAsciiPath(value, label = 'Path') {
  const s = String(value ?? '');
  if (!s) throw new Error(`${label} must not be empty`);
  if (/[^\x00-\x7F]/.test(s)) {
    throw new Error(`${label} contains non-ASCII characters (unsupported by QuadRemesher/3D tools): ${s}`);
  }
  return s;
}

/**
 * Converts a ComfyUI UI workflow JSON into a ComfyUI `/prompt` API graph
 * using a calibrated per-node `widgetOrderMap`.
 */
export function convertComfyUiWorkflowToApi(workflowJson, widgetOrderMap, { skipTypes = SKIP_UI_NODE_TYPES } = {}) {
  if (!workflowJson || !Array.isArray(workflowJson.nodes) || !Array.isArray(workflowJson.links)) {
    throw new TypeError('Invalid ComfyUI workflow JSON: expected nodes[] and links[]');
  }
  const links = new Map();
  for (const link of workflowJson.links) {
    if (Array.isArray(link) && link.length >= 3) {
      links.set(link[0], link);
    }
  }

  const prompt = {};
  const warnings = [];

  for (const node of workflowJson.nodes) {
    const classType = node?.type;
    if (!classType || skipTypes.has(classType)) continue;

    const order = widgetOrderMap[classType];
    if (!order) {
      throw new Error(`Missing WIDGET_ORDER mapping for ComfyUI node type: ${classType}`);
    }

    const widgets = Array.isArray(node.widgets_values) ? node.widgets_values : [];
    const uiInputs = Array.isArray(node.inputs) ? node.inputs : [];
    const uiByName = new Map(uiInputs.map((i) => [i.name, i]));
    const linked = new Map();
    for (const inp of uiInputs) {
      if (inp.link !== null && inp.link !== undefined) {
        linked.set(inp.name, inp.link);
      }
    }

    const values = {};
    let wi = 0;
    for (const slot of order) {
      if (slot.endsWith(':__control__') || slot.endsWith(':__upload__')) {
        if (wi < widgets.length) wi++;
        continue;
      }
      const entry = uiByName.get(slot);
      if (linked.has(slot)) {
        if (entry && entry.widget !== undefined && entry.widget !== null && wi < widgets.length) {
          wi++; // linked widgets still occupy a slot in widgets_values
        }
        const lk = links.get(linked.get(slot));
        if (!lk) throw new Error(`Missing link ${linked.get(slot)} on node ${node.id} (${classType}.${slot})`);
        values[slot] = [String(lk[1]), lk[2]];
      } else {
        if (wi < widgets.length) {
          values[slot] = widgets[wi];
        }
        wi++;
      }
    }

    if (wi < widgets.length) {
      warnings.push(`Node ${node.id} (${classType}) left unconsumed widgets: ${JSON.stringify(widgets.slice(wi))}`);
    }

    for (const [name, linkId] of linked.entries()) {
      if (!(name in values)) {
        const lk = links.get(linkId);
        if (!lk) throw new Error(`Missing link ${linkId} on node ${node.id} (${classType}.${name})`);
        values[name] = [String(lk[1]), lk[2]];
      }
    }

    prompt[String(node.id)] = {
      class_type: classType,
      inputs: values,
    };
  }

  return { prompt, warnings };
}

function findNodesByClass(prompt, classType) {
  return Object.entries(prompt)
    .filter(([, node]) => node.class_type === classType)
    .map(([id, node]) => ({ id, node }));
}

function setLinkedOrDirectInput(prompt, node, inputName, value) {
  const cur = node.inputs[inputName];
  if (Array.isArray(cur) && cur.length >= 2) {
    const srcNode = prompt[String(cur[0])];
    if (srcNode && (srcNode.class_type === 'PrimitiveInt' || srcNode.class_type === 'PrimitiveString' || srcNode.class_type === 'PrimitiveFloat')) {
      srcNode.inputs.value = value;
      return;
    }
  }
  node.inputs[inputName] = value;
}

function applyMissingDefaults(inputs, defaults) {
  for (const [k, v] of Object.entries(defaults)) {
    if (inputs[k] === undefined) inputs[k] = v;
  }
}

/** Builds a calibrated Trellis2-GGUF `/prompt` payload for image-to-3D GLB generation. */
export function buildBiRefNetCutoutPrompt(imagesMap, opts = {}) {
  const bgModel = opts.bgModel || 'birefnet.safetensors';
  const prompt = {
    '1': {
      class_type: 'LoadBackgroundRemovalModel',
      inputs: { bg_removal_name: bgModel },
    },
  };
  const saveNodes = {};
  let nextId = 2;
  for (const [viewKey, info] of Object.entries(imagesMap)) {
    if (!info || !info.filename) continue;
    const loadId = String(nextId++);
    const rmId = String(nextId++);
    const invId = String(nextId++);
    const joinId = String(nextId++);
    const saveId = String(nextId++);
    prompt[loadId] = { class_type: 'LoadImage', inputs: { image: info.filename } };
    prompt[rmId] = { class_type: 'RemoveBackground', inputs: { bg_removal_model: ['1', 0], image: [loadId, 0] } };
    prompt[invId] = { class_type: 'InvertMask', inputs: { mask: [rmId, 0] } };
    prompt[joinId] = { class_type: 'JoinImageWithAlpha', inputs: { image: [loadId, 0], alpha: [invId, 0] } };
    prompt[saveId] = {
      class_type: 'SaveImage',
      inputs: { images: [joinId, 0], filename_prefix: info.savePrefix || `${opts.prefix || 'hgame_cutout'}_${viewKey}` },
    };
    saveNodes[viewKey] = saveId;
  }
  return { prompt, saveNodes };
}

export function buildTrellis2MultiviewPrompt(opts = {}) {
  const views = opts.views || {};
  if (!views.front) {
    throw new Error('buildTrellis2MultiviewPrompt requires views.front');
  }
  const steps = opts.steps !== undefined ? Number(opts.steps) : 14;
  const sampler = opts.sampler || 'heun';
  const seed = opts.seed !== undefined ? Number(opts.seed) : 12345;
  const targetFaces = opts.faces !== undefined ? Number(opts.faces) : 400000;
  const textureSize = opts.textureSize !== undefined ? Number(opts.textureSize) : 4096;
  const maxNumTokens = opts.maxNumTokens !== undefined ? Number(opts.maxNumTokens) : 32768;
  const prefix = opts.prefix ? assertAsciiPath(opts.prefix, 'Output prefix').replace(/^\/+|\/+$/g, '') : 'hgame_t2_mv';

  const prompt = {
    '1': {
      class_type: 'Trellis2LoadModel_GGUF',
      inputs: {
        modelname: 'TRELLIS.2-4B',
        model_format: opts.modelFormat || 'GGUF Q4_K_M',
        backend: opts.backend || 'flash_attn',
        device: 'cuda',
        low_vram: true,
        keep_models_loaded: false,
      },
    },
  };

  let nextId = 2;
  const preIds = {};
  for (const viewKey of ['front', 'back', 'left', 'right']) {
    if (!views[viewKey]) continue;
    const loadId = String(nextId++);
    const preId = String(nextId++);
    prompt[loadId] = {
      class_type: 'Trellis2LoadImageWithTransparency_GGUF',
      inputs: { image: views[viewKey] },
    };
    prompt[preId] = {
      class_type: 'Trellis2PreProcessImage_GGUF',
      inputs: {
        image: [loadId, 2],
        padding: 0,
        remove_background: Boolean(opts.useRembgFallback),
      },
    };
    preIds[viewKey] = preId;
  }

  const mvInputs = {
    pipeline: ['1', 0],
    front_image: [preIds.front, 0],
    seed,
    pipeline_type: opts.pipelineType || '1024_cascade',
    sparse_structure_steps: steps,
    sparse_structure_guidance_strength: 6.5,
    sparse_structure_guidance_rescale: 0.05,
    sparse_structure_rescale_t: 4.0,
    shape_steps: steps,
    shape_guidance_strength: 6.5,
    shape_guidance_rescale: 0.05,
    shape_rescale_t: 4.0,
    texture_steps: steps,
    texture_guidance_strength: 3.5,
    texture_guidance_rescale: 0.15,
    texture_rescale_t: 3.0,
    max_num_tokens: maxNumTokens,
    sparse_structure_resolution: 32,
    generate_texture_slat: true,
    sparse_structure_guidance_interval_start: 0.1,
    sparse_structure_guidance_interval_end: 1.0,
    shape_guidance_interval_start: 0.1,
    shape_guidance_interval_end: 1.0,
    texture_guidance_interval_start: 0.0,
    texture_guidance_interval_end: 0.9,
    use_tiled_decoder: true,
    front_axis: 'z',
    blend_temperature: opts.blendTemperature !== undefined ? Number(opts.blendTemperature) : 2.0,
    sparse_structure_sampler: sampler,
    shape_sampler: sampler,
    texture_sampler: sampler,
  };
  if (preIds.back) mvInputs.back_image = [preIds.back, 0];
  if (preIds.left) mvInputs.left_image = [preIds.left, 0];
  if (preIds.right) mvInputs.right_image = [preIds.right, 0];

  prompt['21'] = {
    class_type: 'Trellis2MeshWithVoxelMultiViewGenerator_GGUF',
    inputs: mvInputs,
  };
  prompt['22'] = {
    class_type: 'Trellis2PostProcessAndUnWrapAndRasterizer_GGUF',
    inputs: {
      mesh: ['21', 0],
      bvh: ['21', 1],
      mesh_cluster_threshold_cone_half_angle_rad: 75.0,
      mesh_cluster_refine_iterations: 2,
      mesh_cluster_global_iterations: 1,
      mesh_cluster_smooth_strength: 1,
      texture_size: textureSize,
      remesh: true,
      remesh_band: 1.0,
      remesh_project: 0.0,
      target_face_num: targetFaces,
      simplify_method: 'Cumesh',
      fill_holes: true,
      texture_alpha_mode: 'OPAQUE',
      dual_contouring_resolution: '1024',
      double_side_material: false,
      remove_floaters: true,
      bake_on_vertices: false,
      use_custom_normals: false,
      uv_unwrap_method: 'Xatlas',
      remove_inner_faces: true,
    },
  };
  prompt['23'] = {
    class_type: 'Trellis2ExportMesh_GGUF',
    inputs: {
      trimesh: ['22', 0],
      filename_prefix: prefix,
      file_format: 'glb',
    },
  };
  return { prompt, warnings: [], exportNodeId: '23', prefix };
}

/**
 * Fast 12GB LowVRAM single-view GGUF workflow graph.
 * Uses TRELLIS.2-4B GGUF Q4_K_M with `euler` (1 NFE/step) and bounded `max_num_tokens` (20480)
 * on `1024_cascade` so sampling fits in ~7GB free VRAM without WDDM paging stalls.
 * Note: the `512` texture DiT GGUF corrupts colors into rainbow patches, so we always keep `1024_cascade`.
 */
export function buildTrellis2FastSinglePrompt(opts = {}) {
  const imageName = opts.inputImageName || 'input.png';
  const prefix = opts.prefix || 'hgame_t2_fast';
  const seed = Number.isFinite(Number(opts.seed)) ? Number(opts.seed) : 42;
  const steps = Number.isFinite(Number(opts.steps)) ? Number(opts.steps) : 12;
  const sampler = typeof opts.sampler === 'string' && opts.sampler ? opts.sampler : 'euler';
  const pipelineType = typeof opts.pipelineType === 'string' && opts.pipelineType ? opts.pipelineType : '1024_cascade';
  const maxNumTokens = Number.isFinite(Number(opts.maxNumTokens)) ? Number(opts.maxNumTokens) : 20480;
  const textureSize = Number.isFinite(Number(opts.textureSize)) ? Number(opts.textureSize) : 2048;
  const faces = Number.isFinite(Number(opts.faces)) ? Number(opts.faces) : 180000;
  const usePreCutout = Boolean(opts.usePreCutout);

  const prompt = {
    '1': {
      class_type: 'Trellis2LoadModel_GGUF',
      inputs: {
        modelname: 'TRELLIS.2-4B',
        model_format: 'GGUF Q4_K_M',
        backend: 'flash_attn',
        device: 'cuda',
        low_vram: true,
        keep_models_loaded: false,
      },
    },
    '2': {
      class_type: usePreCutout ? 'Trellis2LoadImageWithTransparency_GGUF' : 'LoadImage',
      inputs: { image: imageName },
    },
    '3': {
      class_type: 'Trellis2PreProcessImage_GGUF',
      inputs: {
        image: ['2', 0],
        padding: usePreCutout ? 0 : 10,
        remove_background: !usePreCutout,
      },
    },
    '4': {
      class_type: 'Trellis2MeshWithVoxelAdvancedGenerator_GGUF',
      inputs: {
        pipeline: ['1', 0],
        image: ['3', 0],
        seed,
        pipeline_type: pipelineType,
        sparse_structure_steps: steps,
        sparse_structure_guidance_strength: 6.5,
        sparse_structure_guidance_rescale: 0.05,
        sparse_structure_rescale_t: 4.0,
        sparse_structure_sampler: sampler,
        shape_steps: steps,
        shape_guidance_strength: 6.5,
        shape_guidance_rescale: 0.05,
        shape_rescale_t: 4.0,
        shape_sampler: sampler,
        texture_steps: steps,
        texture_guidance_strength: 3.0,
        texture_guidance_rescale: 0.2,
        texture_rescale_t: 3.0,
        texture_sampler: sampler,
        max_num_tokens: maxNumTokens,
        max_views: 4,
        sparse_structure_resolution: 32,
        generate_texture_slat: true,
        sparse_structure_guidance_interval_start: 0.1,
        sparse_structure_guidance_interval_end: 1.0,
        shape_guidance_interval_start: 0.1,
        shape_guidance_interval_end: 1.0,
        texture_guidance_interval_start: 0.0,
        texture_guidance_interval_end: 0.9,
        use_tiled_decoder: true,
      },
    },
    '5': {
      class_type: 'Trellis2PostProcessAndUnWrapAndRasterizer_GGUF',
      inputs: {
        mesh: ['4', 0],
        bvh: ['4', 1],
        mesh_cluster_threshold_cone_half_angle_rad: 75.0,
        mesh_cluster_refine_iterations: 0,
        mesh_cluster_global_iterations: 1,
        mesh_cluster_smooth_strength: 1,
        texture_size: textureSize,
        remesh: true,
        remesh_band: 1.0,
        remesh_project: 0.0,
        target_face_num: faces,
        simplify_method: 'Cumesh',
        fill_holes: true,
        texture_alpha_mode: 'OPAQUE',
        dual_contouring_resolution: '1024',
        double_side_material: false,
        remove_floaters: true,
        bake_on_vertices: false,
        use_custom_normals: false,
        uv_unwrap_method: 'Xatlas',
        remove_inner_faces: true,
        inpainting: true,
      },
    },
    '6': {
      class_type: 'Trellis2ExportMesh_GGUF',
      inputs: {
        trimesh: ['5', 0],
        filename_prefix: prefix,
        file_format: 'glb',
      },
    },
  };

  return { prompt, warnings: [], exportNodeId: '6' };
}

export function buildTrellis2Prompt(workflowJson, opts = {}) {
  const { prompt, warnings } = convertComfyUiWorkflowToApi(workflowJson, TRELLIS2_WIDGET_ORDER);

  const loadImgs = findNodesByClass(prompt, 'Trellis2LoadImageWithTransparency');
  if (loadImgs.length === 0) throw new Error('Trellis2 workflow missing Trellis2LoadImageWithTransparency');
  if (opts.inputImageName) {
    loadImgs[0].node.inputs.image = assertAsciiPath(opts.inputImageName, 'Input image name');
  }

  const exporters = findNodesByClass(prompt, 'Trellis2ExportMesh');
  if (exporters.length === 0) throw new Error('Trellis2 workflow missing Trellis2ExportMesh');
  // In multi-stage workflows (e.g. High_Quality_GGUF), pick the final textured exporter.
  const finalExporter = exporters.find(({ node }) => {
    const src = Array.isArray(node.inputs.trimesh) ? prompt[String(node.inputs.trimesh[0])] : null;
    return src && /Texturing|Rasterizer/i.test(src.class_type);
  }) || exporters[exporters.length - 1];

  if (opts.prefix) {
    for (const { node } of exporters) {
      const basePrefix = assertAsciiPath(opts.prefix, 'Output prefix');
      if (node === finalExporter.node) {
        setLinkedOrDirectInput(prompt, node, 'filename_prefix', basePrefix);
      } else {
        const curName = typeof node.inputs.filename_prefix === 'string' ? node.inputs.filename_prefix : 'stage';
        setLinkedOrDirectInput(prompt, node, 'filename_prefix', `${basePrefix}_${sanitizeSlug(curName)}`);
      }
    }
  }

  const simplifiers = findNodesByClass(prompt, 'Trellis2SimplifyMesh');
  if (simplifiers.length > 0 && opts.faces !== undefined && opts.faces !== null) {
    const faces = Number(opts.faces);
    if (!Number.isInteger(faces) || faces < 100) {
      throw new RangeError('--faces must be an integer >= 100');
    }
    const targetSimplifier = simplifiers[simplifiers.length - 1];
    setLinkedOrDirectInput(prompt, targetSimplifier.node, 'target_face_num', faces);
  }

  for (const { node } of findNodesByClass(prompt, 'Trellis2LoadModel_GGUF')) {
    if (!node.inputs.modelname || node.inputs.modelname === 'Pixal3D-GGUF') {
      node.inputs.modelname = opts.modelName || 'TRELLIS.2-4B';
    }
  }

  for (const { node } of findNodesByClass(prompt, 'Trellis2MeshWithVoxelAdvancedGenerator')) {
    applyMissingDefaults(node.inputs, {
      fill_holes: true,
      hole_iterations: 1,
      verbose: false,
      dino_lock: 0,
      dino_substeps: 4,
      hole_fill_algorithm: 'flood_fill',
      dino_foundation_cap: 1,
      keep_only_shell: true,
    });
    if (opts.seed !== undefined && opts.seed !== null) node.inputs.seed = Number(opts.seed);
  }

  for (const { node } of findNodesByClass(prompt, 'Trellis2MeshRefiner')) {
    applyMissingDefaults(node.inputs, {
      verbose: false,
      dino_lock: 0,
      dino_substeps: 4,
      dino_foundation_cap: 1,
    });
    if (opts.seed !== undefined && opts.seed !== null) node.inputs.seed = Number(opts.seed);
  }

  for (const { node } of findNodesByClass(prompt, 'Trellis2MeshTexturing')) {
    applyMissingDefaults(node.inputs, {
      verbose: false,
      dino_lock: 0,
      dino_substeps: 4,
      dino_foundation_cap: 1,
    });
    if (opts.seed !== undefined && opts.seed !== null) node.inputs.seed = Number(opts.seed);
    if (opts.textureSize) node.inputs.texture_size = Number(opts.textureSize);
  }

  for (const { node } of findNodesByClass(prompt, 'Trellis2ShapeCascadeGenerator')) {
    if (node.inputs.to_resolution === undefined) {
      node.inputs.to_resolution = Number(opts.toResolution ?? 1024);
    }
    if (opts.seed !== undefined && opts.seed !== null) {
      node.inputs.seed = Number(opts.seed);
    }
  }

  if (opts.seed !== undefined && opts.seed !== null) {
    for (const { node } of findNodesByClass(prompt, 'Trellis2SparseGenerator')) {
      node.inputs.seed = Number(opts.seed);
    }
  }

  for (const { node } of findNodesByClass(prompt, 'Trellis2UnWrapAndRasterizer')) {
    if (opts.textureSize) node.inputs.texture_size = Number(opts.textureSize);
    if (opts.reorient) node.inputs.reorient_vertices = opts.reorient;
  }

  return {
    prompt,
    warnings,
    exportNodeId: finalExporter.id,
  };
}

/** Builds a calibrated UltraTex LowVRAM GGUF `/prompt` payload for GLB re-texturing. */
export function buildUltratexPrompt(workflowJson, opts = {}) {
  const { prompt, warnings } = convertComfyUiWorkflowToApi(workflowJson, ULTRATEX_WIDGET_ORDER);
  const hq = String(opts.quality || 'standard').toLowerCase() === 'high';

  const load3ds = findNodesByClass(prompt, 'Load3DAdvanced');
  if (load3ds.length === 0) throw new Error('UltraTex workflow missing Load3DAdvanced');
  if (opts.meshFile) {
    load3ds[0].node.inputs.model_file = assertAsciiPath(opts.meshFile, 'Input 3D mesh file');
  }

  const loadImgs = findNodesByClass(prompt, 'LoadImage');
  if (loadImgs.length === 0) throw new Error('UltraTex workflow missing LoadImage');
  if (opts.refImageName) {
    loadImgs[0].node.inputs.image = assertAsciiPath(opts.refImageName, 'Reference image name');
  }

  // Keep 1024 view/normal res in 12GB LowVRAM preset so Flux2 avoids PCIe RAM paging; override with --normal-view-res / --view-res.
  const normalViewRes = opts.normalViewRes ?? (hq ? 2048 : undefined);
  const prepNodes = findNodesByClass(prompt, 'UTXPrepareTextureV25');
  for (const { node } of prepNodes) {
    if (opts.alignment) node.inputs.alignment = opts.alignment;
    if (normalViewRes) node.inputs.normal_view_resolution = Number(normalViewRes);
    if (opts.cameraFit) node.inputs.camera_fit = opts.cameraFit;
  }

  // GPU unwrap stays fast on 300k+ face meshes where CPU xatlas stalls; pass --uv-mode to override.
  const uvMode = opts.uvMode ?? (hq ? 'keep_existing' : undefined);
  const uvPadding = opts.padding ?? (hq ? 4 : undefined);
  const unwrapNodes = findNodesByClass(prompt, 'UTXUnwrapMeshUVV25');
  for (const { node } of unwrapNodes) {
    if (uvMode) node.inputs.uv_mode = uvMode;
    if (opts.atlasSize) node.inputs.atlas_size = Number(opts.atlasSize);
    if (uvPadding !== undefined && uvPadding !== null) node.inputs.padding = Number(uvPadding);
  }

  const viewRes = opts.viewRes ?? (hq ? 768 : undefined);
  const steps = opts.steps ?? (hq ? 20 : undefined);
  const extraSteps = opts.extraSteps ?? (hq ? 12 : undefined);
  const genNodes = findNodesByClass(prompt, 'UTXGenerateTextureViewsV23');
  for (const { node } of genNodes) {
    if (viewRes) node.inputs.view_resolution = Number(viewRes);
    if (steps !== undefined && steps !== null) node.inputs.steps = Number(steps);
    if (extraSteps !== undefined && extraSteps !== null) node.inputs.extra_steps = Number(extraSteps);
    if (opts.seed !== undefined && opts.seed !== null) node.inputs.seed = Number(opts.seed);
  }

  const textureSize = opts.textureSize ?? (hq ? 2048 : undefined);
  const bakers = findNodesByClass(prompt, 'UTXFastSurfaceTextureBaker');
  const bakerIds = new Set(bakers.map((b) => b.id));
  for (const { node } of bakers) {
    if (textureSize) node.inputs.texture_size = Number(textureSize);
  }

  for (const { node } of findNodesByClass(prompt, 'UTXConfigureRuntime')) {
    if (opts.maxVramMb !== undefined) node.inputs.max_vram_mb = Number(opts.maxVramMb);
    if (opts.tokenChunk !== undefined) node.inputs.token_chunk = Number(opts.tokenChunk);
    if (opts.performanceMode) node.inputs.performance_mode = String(opts.performanceMode);
  }

  if (opts.guidance !== undefined) {
    for (const { node } of genNodes) {
      node.inputs.guidance = Number(opts.guidance);
    }
  }

  if (opts.prompt !== undefined || opts.negativePrompt !== undefined) {
    // Identify positive vs negative text encoders from the albedo generator's links.
    const albedoGen = genNodes.find((g) => g.node.inputs.task === 'albedo') || genNodes[0];
    if (albedoGen) {
      const posLink = albedoGen.node.inputs.positive;
      const negLink = albedoGen.node.inputs.negative;
      if (opts.prompt !== undefined && Array.isArray(posLink) && prompt[String(posLink[0])]) {
        prompt[String(posLink[0])].inputs.text = String(opts.prompt);
      }
      if (opts.negativePrompt !== undefined) {
        if (Array.isArray(negLink) && prompt[String(negLink[0])]) {
          prompt[String(negLink[0])].inputs.text = String(opts.negativePrompt);
        } else if (Array.isArray(posLink) && prompt[String(posLink[0])]?.inputs?.clip) {
          const negId = '9901';
          prompt[negId] = {
            class_type: 'UTXTextEncode',
            inputs: { clip: prompt[String(posLink[0])].inputs.clip, text: String(opts.negativePrompt) },
          };
          for (const { node } of genNodes) {
            node.inputs.negative = [negId, 0];
          }
        }
      }
    }
  }

  const prefix = opts.prefix ? assertAsciiPath(opts.prefix, 'Output prefix').replace(/^\/+|\/+$/g, '') : '';
  const saveGlbs = findNodesByClass(prompt, 'SaveGLB');
  if (prefix) {
    for (const { node } of saveGlbs) {
      node.inputs.filename_prefix = `${prefix}/textured`;
    }
    for (const { node } of findNodesByClass(prompt, 'UTXSaveViews')) {
      node.inputs.prefix = `${prefix.replace(/\//g, '_')}_views`;
    }
  }

  const pbrNodeIds = { baseColor: null, roughness: null, metallic: null };
  for (const { id, node } of findNodesByClass(prompt, 'SaveImage')) {
    const imgLink = node.inputs.images;
    if (Array.isArray(imgLink) && bakerIds.has(String(imgLink[0]))) {
      const slot = Number(imgLink[1]);
      if (slot === 2) {
        pbrNodeIds.baseColor = id;
        if (prefix) node.inputs.filename_prefix = `${prefix}/base_color`;
      } else if (slot === 3) {
        pbrNodeIds.roughness = id;
        if (prefix) node.inputs.filename_prefix = `${prefix}/roughness`;
      } else if (slot === 4) {
        pbrNodeIds.metallic = id;
        if (prefix) node.inputs.filename_prefix = `${prefix}/metallic`;
      }
    }
  }

  return {
    prompt,
    warnings,
    saveGlbNodeId: saveGlbs[0]?.id ?? null,
    pbrNodeIds,
  };
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}: ${text.slice(0, 1500)}`);
  }
  return JSON.parse(text);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function submitAndWaitComfyPrompt(comfyUiUrl, prompt, { clientId = 'hgame-model3d', pollMs = 3000, timeoutMs = 1800000 } = {}) {
  const submitted = await fetchJson(`${comfyUiUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, client_id: clientId }),
  });
  const promptId = submitted.prompt_id;
  if (!promptId) {
    throw new Error(`ComfyUI /prompt did not return prompt_id: ${JSON.stringify(submitted)}`);
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const history = await fetchJson(`${comfyUiUrl}/history/${encodeURIComponent(promptId)}`);
    const entry = history?.[promptId];
    if (entry) {
      const statusStr = entry.status?.status_str;
      if (statusStr === 'error') {
        throw new Error(`ComfyUI prompt ${promptId} failed: ${JSON.stringify(entry.status?.messages || entry.status)}`);
      }
      if (entry.status?.completed || statusStr === 'success') {
        return { promptId, entry };
      }
    }
    await sleep(pollMs);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ComfyUI prompt ${promptId}`);
}

function resolveComfyOutputFile(comfyUiDir, item) {
  if (!item || !item.filename) return null;
  const sub = item.subfolder ? item.subfolder : '';
  return path.join(comfyUiDir, 'output', sub, item.filename);
}

async function copyComfyOutputFile(config, item, destPath) {
  if (!item || !item.filename) return null;
  await mkdir(path.dirname(destPath), { recursive: true });
  if (config.comfyUiDir) {
    const localSrc = resolveComfyOutputFile(config.comfyUiDir, item);
    if (localSrc && existsSync(localSrc)) {
      await copyFile(localSrc, destPath);
      return destPath;
    }
  }
  const q = new URLSearchParams({
    filename: item.filename,
    subfolder: item.subfolder || '',
    type: item.type || 'output',
  });
  const res = await fetch(`${config.comfyUiUrl}/view?${q.toString()}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch ComfyUI output ${item.filename}: HTTP ${res.status}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  await writeFile(destPath, buf);
  return destPath;
}

function runBlenderHelper(config, args) {
  assertAsciiPath(blenderHelperPath, 'Blender helper script');
  const fullArgs = ['--background', '--factory-startup', '-P', blenderHelperPath, '--', ...args];
  const env = config.runAnimGlb && !process.env.HGAME_MODEL3D_RUN_ANIM_GLB
    ? { ...process.env, HGAME_MODEL3D_RUN_ANIM_GLB: config.runAnimGlb }
    : process.env;
  const res = spawnSync(config.blenderPath, fullArgs, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, env });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`Blender exited with code ${res.status}:\n${res.stderr || res.stdout}`);
  }
  const marker = 'HGAME_MODEL3D_JSON:';
  const lines = (res.stdout || '').split(/\r?\n/);
  const jsonLine = [...lines].reverse().find((l) => l.startsWith(marker));
  if (!jsonLine) {
    throw new Error(`Blender helper did not emit ${marker} summary.\n${res.stdout}`);
  }
  return JSON.parse(jsonLine.slice(marker.length));
}

function sanitizeSlug(name) {
  const cleaned = String(name || 'asset').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'asset';
}

/** Extracts front (left) or side (right) panel from a 2:1 horizontal turnaround PNG when requested or auto-detected. */
export function extractSheetPanelPng(pngBuffer, panelMode = 'auto') {
  const mode = String(panelMode || 'auto').toLowerCase();
  if (!['auto', 'left', 'front', 'right', 'side', 'full', 'none'].includes(mode)) {
    throw new RangeError(`Invalid panel mode "${panelMode}"; expected auto|left|front|right|side|full`);
  }
  const decoded = decodePng(pngBuffer);
  const { width, height } = decoded;
  if (mode === 'full' || mode === 'none') {
    return { buffer: pngBuffer, extracted: false, mode, sourceSize: [width, height], outputSize: [width, height] };
  }
  const isTwoPanelSheet = width >= height * 1.75;
  if (mode === 'auto' && !isTwoPanelSheet) {
    return { buffer: pngBuffer, extracted: false, mode, sourceSize: [width, height], outputSize: [width, height] };
  }
  const cells = splitRgbaGrid(decoded, { columns: 2, rows: 1 });
  const pickIndex = (mode === 'right' || mode === 'side') ? 1 : 0;
  const cell = cells[pickIndex];
  const outBuf = encodePng({ width: cell.width, height: cell.height, data: cell.data });
  return {
    buffer: outBuf,
    extracted: true,
    mode,
    selectedPanel: pickIndex === 0 ? 'left' : 'right',
    sourceSize: [width, height],
    outputSize: [cell.width, cell.height],
  };
}

async function stageInputFile(srcPath, destDir, prefixSlug, { panelMode = null } = {}) {
  const absSrc = path.resolve(srcPath);
  const st = await stat(absSrc);
  if (!st.isFile()) throw new Error(`Input file not found: ${absSrc}`);
  const ext = path.extname(absSrc).toLowerCase() || '';
  const safeBase = `${sanitizeSlug(prefixSlug)}${ext}`;
  const destPath = path.join(destDir, safeBase);
  assertAsciiPath(destPath, 'Staged ComfyUI input path');
  await mkdir(destDir, { recursive: true });
  let panelInfo = null;
  if (panelMode && ext === '.png') {
    const rawBuf = await readFile(absSrc);
    const res = extractSheetPanelPng(rawBuf, panelMode);
    panelInfo = {
      extracted: res.extracted,
      mode: res.mode,
      selectedPanel: res.selectedPanel ?? null,
      sourceSize: res.sourceSize,
      outputSize: res.outputSize,
    };
    if (res.extracted) {
      await writeFile(destPath, res.buffer);
      return { absSrc, destPath, filename: safeBase, panelInfo };
    }
  }
  await copyFile(absSrc, destPath);
  return { absSrc, destPath, filename: safeBase, panelInfo };
}

export function parseProcessModel3dArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--help' || token === '-h') {
      flags.help = true;
    } else if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      if (eq !== -1) {
        flags[token.slice(2, eq)] = token.slice(eq + 1);
      } else {
        const key = token.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) {
          flags[key] = true;
        } else {
          flags[key] = next;
          i++;
        }
      }
    } else {
      positional.push(token);
    }
  }
  const command = positional[0] || (flags.help ? 'help' : '');
  const rest = positional.slice(1);
  return { command, positional: rest, flags };
}

function printUsage() {
  console.log([
    'Usage: node scripts/process-model3d.mjs <command> [options]',
    '',
    'Commands:',
    '  doctor                                         Check ComfyUI, Blender, and local workflow files',
    '  inspect <mesh.glb> [--out-dir <dir>]           Inspect bounds/UVs/tris and optionally render 4/6 views',
    '  normalize <mesh.glb> --out <out.glb> [opts]    Rotate (--rx/--ry/--rz), apply transforms, ground/scale/decimate',
    '  remesh-bake --input <glb> --out <glb> [opts]   QuadRemesher + AutoUnwrap + Cycles PBR (--preset low|high, --rig-run)',
    '  character-pack --input <glb>|--from-webasset    Standardize raw AI character -> clean High + rigged Low (+ --upload WebAsset)',
    '  rig-run --input <glb> --out <out.glb> [opts]   Auto-rig humanoid character + embed looping Run animation QA',
    '  assemble-pbr --mesh <glb> --base-color <png> --roughness <png> [--normal <png>] --out <glb>',
    '  qa <mesh.glb> --out-dir <dir>                  Render multi-view QA images and print mesh/texture diagnostics',
    '  generate --input <img.png> --out <out.glb>     12GB LowVRAM single-view GGUF (--remesh, --low-out, --preset low, --no-rig)',
    '  texture --mesh <glb> --ref <png> --out <glb>   Run UltraTex LowVRAM GGUF PBR texturing (--quality standard|high, --uv-mode)',
  ].join('\n'));
}

async function cmdDoctor(config) {
  const report = {
    configPath: config.configPath,
    rootDir: config.rootDir,
    comfyUiUrl: config.comfyUiUrl,
    comfyUiDir: config.comfyUiDir,
    blenderPath: config.blenderPath,
    workflows: {
      trellis2: { path: config.trellis2Workflow, exists: Boolean(config.trellis2Workflow && existsSync(config.trellis2Workflow)) },
      ultratex: { path: config.ultratexWorkflow, exists: Boolean(config.ultratexWorkflow && existsSync(config.ultratexWorkflow)) },
    },
    blender: { ok: false, version: null, error: null },
    comfyUi: { ok: false, queue: null, trellis2Node: false, ultratexNode: false, error: null },
  };

  const bRes = spawnSync(config.blenderPath, ['--version'], { encoding: 'utf8' });
  if (bRes.error) {
    report.blender.error = bRes.error.message;
  } else if (bRes.status !== 0) {
    report.blender.error = bRes.stderr || `exit ${bRes.status}`;
  } else {
    report.blender.ok = true;
    report.blender.version = (bRes.stdout || '').split(/\r?\n/)[0]?.trim() || 'unknown';
  }

  try {
    const queue = await fetchJson(`${config.comfyUiUrl}/queue`);
    const t2 = await fetchJson(`${config.comfyUiUrl}/object_info/Trellis2LoadModel_GGUF`);
    const utx = await fetchJson(`${config.comfyUiUrl}/object_info/UTXFastSurfaceTextureBaker`);
    report.comfyUi.ok = Boolean(t2?.Trellis2LoadModel_GGUF && utx?.UTXFastSurfaceTextureBaker);
    report.comfyUi.queue = {
      running: Array.isArray(queue.queue_running) ? queue.queue_running.length : 0,
      pending: Array.isArray(queue.queue_pending) ? queue.queue_pending.length : 0,
    };
    report.comfyUi.trellis2Node = Boolean(t2?.Trellis2LoadModel_GGUF);
    report.comfyUi.ultratexNode = Boolean(utx?.UTXFastSurfaceTextureBaker);
  } catch (err) {
    report.comfyUi.error = err.message;
  }

  console.log(JSON.stringify(report, null, 2));
  if (!report.blender.ok || !report.comfyUi.ok || !report.workflows.trellis2.exists || !report.workflows.ultratex.exists) {
    process.exitCode = 1;
  }
}

function buildBlenderInspectArgs(inputPath, flags, defaultViews = '6', defaultElev = '0') {
  const args = ['inspect', '--input', assertAsciiPath(path.resolve(inputPath), 'Input model')];
  const outDir = flags['out-dir'] || flags.outDir;
  if (outDir) args.push('--out-dir', assertAsciiPath(path.resolve(outDir), 'Render output dir'));
  if (flags.views || defaultViews) args.push('--views', String(flags.views || defaultViews));
  if (flags.size) args.push('--size', String(flags.size));
  args.push('--elev', String(flags.elev ?? defaultElev));
  if (flags.engine) args.push('--engine', String(flags.engine));
  return args;
}

export function buildBlenderNormalizeArgs(inputPath, outPath, flags) {
  const args = [
    'normalize',
    '--input', assertAsciiPath(path.resolve(inputPath), 'Input model'),
    '--out', assertAsciiPath(path.resolve(outPath), 'Output model'),
    '--rx', String(flags.rx ?? 0),
    '--ry', String(flags.ry ?? 0),
    '--rz', String(flags.rz ?? 0),
    '--origin', String(flags.origin ?? 'ground'),
  ];
  if (flags['target-height'] || flags.targetHeight) {
    args.push('--target-height', String(flags['target-height'] || flags.targetHeight));
  }
  if (flags['target-faces'] || flags.targetFaces) {
    args.push('--target-faces', String(flags['target-faces'] || flags.targetFaces));
  }
  if (flags['no-repair'] || flags.repair === false) args.push('--no-repair');
  if (flags['prune-whiskers'] || flags.pruneWhiskers) args.push('--prune-whiskers');
  if (flags['keep-largest-island'] || flags.keepLargestIsland) args.push('--keep-largest-island');
  if (flags['qa-dir'] || flags.qaDir) {
    args.push('--qa-dir', assertAsciiPath(path.resolve(flags['qa-dir'] || flags.qaDir), 'QA render dir'));
  }
  if (flags.views) args.push('--views', String(flags.views));
  if (flags.size) args.push('--size', String(flags.size));
  if (flags.elev !== undefined) args.push('--elev', String(flags.elev));
  if (flags.engine) args.push('--engine', String(flags.engine));
  return args;
}

export function buildBlenderRemeshBakeArgs(inputPath, outPath, flags = {}) {
  const preset = (flags.preset || flags.role) ? resolveLowPolyPreset(flags.preset || flags.role) : null;
  const args = [
    'remesh-bake',
    '--input', assertAsciiPath(path.resolve(inputPath), 'Input model'),
    '--out', assertAsciiPath(path.resolve(outPath), 'Output model'),
    '--target-quads', String(flags['target-quads'] ?? flags.targetQuads ?? preset?.targetQuads ?? 16000),
    '--uv-solver', String(flags['uv-solver'] ?? flags.uvSolver ?? 'organic'),
    '--texture-size', String(flags['texture-size'] ?? flags.textureSize ?? preset?.textureSize ?? 2048),
    '--normal-strength', String(flags['normal-strength'] ?? flags.normalStrength ?? preset?.normalStrength ?? 0.28),
    '--cage-extrusion', String(flags['cage-extrusion'] ?? 0.022),
    '--max-ray-distance', String(flags['max-ray-distance'] ?? 0.08),
    '--voxel-div', String(flags['voxel-div'] ?? 260),
    '--samples', String(flags.samples ?? 16),
  ];
  if (flags['work-dir'] || flags.workDir) {
    args.push('--work-dir', assertAsciiPath(path.resolve(flags['work-dir'] || flags.workDir), 'Work dir'));
  }
  if (flags['clean-uv-out'] || flags.cleanUvOut) {
    args.push('--clean-uv-out', assertAsciiPath(path.resolve(flags['clean-uv-out'] || flags.cleanUvOut), 'Clean UV GLB'));
  }
  if (flags['smooth-head-z'] !== undefined) {
    args.push('--smooth-head-z', String(flags['smooth-head-z']));
  }
  if (flags['no-weld-high']) args.push('--no-weld-high');
  if (flags['rig-run'] || flags.rigRun) args.push('--rig-run');
  const lod1Tris = flags['no-lod1'] ? 0 : (flags['lod1-tris'] ?? flags.lod1Tris ?? preset?.lod1TargetTris ?? 0);
  if (Number(lod1Tris) > 0) args.push('--lod1-tris', String(lod1Tris));
  if (flags['anim-glb'] || flags.animGlb) args.push('--anim-glb', String(flags['anim-glb'] || flags.animGlb));
  if (flags['qa-dir'] || flags.qaDir) {
    args.push('--qa-dir', assertAsciiPath(path.resolve(flags['qa-dir'] || flags.qaDir), 'QA render dir'));
  }
  if (flags.views) args.push('--views', String(flags.views));
  if (flags.size) args.push('--size', String(flags.size));
  if (flags.elev !== undefined) args.push('--elev', String(flags.elev));
  if (flags.engine) args.push('--engine', String(flags.engine));
  return args;
}

export function buildBlenderRigRunArgs(inputPath, outPath, flags = {}) {
  const args = [
    'rig-run',
    '--input', assertAsciiPath(path.resolve(inputPath), 'Input model'),
    '--out', assertAsciiPath(path.resolve(outPath), 'Output model'),
    '--action-name', String(flags['action-name'] ?? flags.actionName ?? 'Run'),
  ];
  if (flags['anim-glb'] || flags.animGlb) args.push('--anim-glb', String(flags['anim-glb'] || flags.animGlb));
  if (flags['qa-dir'] || flags.qaDir) {
    args.push('--qa-dir', assertAsciiPath(path.resolve(flags['qa-dir'] || flags.qaDir), 'QA render dir'));
  }
  if (flags.size) args.push('--size', String(flags.size));
  if (flags.engine) args.push('--engine', String(flags.engine));
  return args;
}

export function buildBlenderAssemblePbrArgs(meshPath, outPath, flags = {}) {
  const bc = flags['base-color'] || flags.baseColor;
  const rg = flags.roughness;
  if (!bc || !rg) {
    throw new Error('assemble-pbr requires --base-color and --roughness');
  }
  const args = [
    'assemble-pbr',
    '--mesh', assertAsciiPath(path.resolve(meshPath), 'Mesh GLB'),
    '--base-color', assertAsciiPath(path.resolve(bc), 'BaseColor texture'),
    '--roughness', assertAsciiPath(path.resolve(rg), 'Roughness texture'),
    '--out', assertAsciiPath(path.resolve(outPath), 'Output GLB'),
  ];
  if (flags.metallic) args.push('--metallic', assertAsciiPath(path.resolve(flags.metallic), 'Metallic texture'));
  if (flags.normal) args.push('--normal', assertAsciiPath(path.resolve(flags.normal), 'Normal texture'));
  if (flags['flip-v'] || flags.flipV) args.push('--flip-v');
  if (flags['qa-dir'] || flags.qaDir) {
    args.push('--qa-dir', assertAsciiPath(path.resolve(flags['qa-dir'] || flags.qaDir), 'QA render dir'));
  }
  if (flags.views) args.push('--views', String(flags.views));
  if (flags.size) args.push('--size', String(flags.size));
  if (flags.elev !== undefined) args.push('--elev', String(flags.elev));
  if (flags.engine) args.push('--engine', String(flags.engine));
  return args;
}

async function freeComfyMemory(comfyUiUrl) {
  await fetch(`${comfyUiUrl.replace(/\/+$/, '')}/free`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unload_models: true, free_memory: true }),
  }).catch(() => {});
}

async function findLatestComfyOutputByPrefix(outputDir, prefix, ext = '.glb') {
  const { readdir, stat } = await import('node:fs/promises');
  const baseName = path.basename(prefix);
  const subDir = path.dirname(prefix);
  const searchDir = subDir && subDir !== '.' ? path.join(outputDir, subDir) : outputDir;
  if (!existsSync(searchDir)) return null;
  const entries = await readdir(searchDir);
  const matches = entries.filter((f) => f.startsWith(`${baseName}_`) && f.toLowerCase().endsWith(ext));
  if (!matches.length) return null;
  let newest = null;
  let newestMs = -1;
  for (const name of matches) {
    const full = path.join(searchDir, name);
    const st = await stat(full);
    if (st.mtimeMs > newestMs) {
      newestMs = st.mtimeMs;
      newest = { filename: name, subfolder: subDir && subDir !== '.' ? subDir : '', type: 'output' };
    }
  }
  return newest;
}

async function runBiRefNetCutouts(config, stagedViews, prefix) {
  const { prompt, saveNodes } = buildBiRefNetCutoutPrompt(stagedViews, { prefix });
  const { entry } = await submitAndWaitComfyPrompt(config.comfyUiUrl, prompt, { timeoutMs: 300000 });
  await freeComfyMemory(config.comfyUiUrl);
  const inputDir = path.join(config.comfyUiDir, 'input');
  const cutoutViews = {};
  for (const [viewKey, nodeId] of Object.entries(saveNodes)) {
    const imgItem = entry.outputs?.[nodeId]?.images?.[0];
    if (!imgItem) {
      throw new Error(`BiRefNet cutout produced no output for view ${viewKey}`);
    }
    const outName = `${prefix}_${viewKey}_rgba.png`;
    await copyComfyOutputFile(config, imgItem, path.join(inputDir, outName));
    cutoutViews[viewKey] = outName;
  }
  return cutoutViews;
}

async function cmdGenerate(config, flags) {
  const quality = typeof flags.quality === 'string' ? flags.quality : 'standard';
  const multiview = Boolean(flags.multiview || flags.right || flags.left || flags.back);
  const explicitWorkflow = typeof flags.workflow === 'string' ? flags.workflow : '';
  const useFastBuiltIn = !multiview && !explicitWorkflow;
  const useBiRefNet = Boolean(flags.birefnet || multiview);
  const hqCandidate = config.comfyUiDir
    ? path.join(config.comfyUiDir, DEFAULT_TRELLIS2_HQ_WORKFLOW_REL)
    : null;
  let workflowPath = explicitWorkflow || config.trellis2Workflow;
  if (!explicitWorkflow && quality === 'high' && hqCandidate && existsSync(hqCandidate)) {
    workflowPath = hqCandidate;
  }
  if (!config.comfyUiDir || (!multiview && !useFastBuiltIn && !workflowPath)) {
    throw new Error('ComfyUI directory/workflow not configured. Add model3d config in .hgame.local.json or env vars.');
  }
  const inputFile = flags.input;
  const outFile = flags.out;
  if (!inputFile || !outFile) {
    throw new Error('Usage: node scripts/process-model3d.mjs generate --input <img.png> --out <out.glb> [options]');
  }

  const absOut = assertAsciiPath(path.resolve(outFile), 'Output GLB');
  const stamp = Date.now();
  const slug = sanitizeSlug(flags.name || path.basename(absOut, path.extname(absOut)));
  const comfyInputDir = path.join(config.comfyUiDir, 'input');
  const staged = await stageInputFile(inputFile, comfyInputDir, `hgame_t2_${slug}_${stamp}`, {
    panelMode: typeof flags.panel === 'string' ? flags.panel : (multiview ? 'left' : 'auto'),
  });

  const prefix = `hgame_t2_${slug}_${stamp}`;
  let prompt;
  let warnings = [];
  let exportNodeId;

  if (multiview) {
    const viewFiles = { front: { filename: staged.filename } };
    if (flags.back) {
      const sBack = await stageInputFile(flags.back, comfyInputDir, `${prefix}_back`);
      viewFiles.back = { filename: sBack.filename };
    }
    if (flags.left) {
      const sLeft = await stageInputFile(flags.left, comfyInputDir, `${prefix}_left`);
      viewFiles.left = { filename: sLeft.filename };
    }
    if (flags.right) {
      const sRight = await stageInputFile(flags.right, comfyInputDir, `${prefix}_right`);
      viewFiles.right = { filename: sRight.filename };
    } else if (!flags.left && staged.panelInfo?.split) {
      // Auto-extract right panel (character side profile) from 2:1 front+side sheets
      const sRight = await stageInputFile(inputFile, comfyInputDir, `${prefix}_right`, { panelMode: 'right' });
      viewFiles.right = { filename: sRight.filename };
    }

    const mvViews = useBiRefNet
      ? await runBiRefNetCutouts(config, viewFiles, `${prefix}_cut`)
      : Object.fromEntries(Object.entries(viewFiles).map(([k, v]) => [k, v.filename]));

    const built = buildTrellis2MultiviewPrompt({
      views: mvViews,
      prefix,
      faces: flags.faces !== undefined ? Number(flags.faces) : 200000,
      seed: flags.seed !== undefined ? Number(flags.seed) : undefined,
      steps: flags.steps !== undefined ? Number(flags.steps) : 12,
      sampler: typeof flags.sampler === 'string' ? flags.sampler : 'euler',
      pipelineType: typeof flags['pipeline-type'] === 'string' ? flags['pipeline-type'] : '1024_cascade',
      maxNumTokens: flags['max-num-tokens'] !== undefined ? Number(flags['max-num-tokens']) : 20480,
      textureSize: flags['texture-size'] ? Number(flags['texture-size']) : 2048,
      useRembgFallback: !useBiRefNet,
    });
    prompt = built.prompt;
    warnings = built.warnings;
    exportNodeId = built.exportNodeId;
  } else if (useFastBuiltIn) {
    let frontName = staged.filename;
    if (flags.birefnet) {
      const cut = await runBiRefNetCutouts(config, { front: { filename: staged.filename } }, `${prefix}_cut`);
      frontName = cut.front;
    }
    const built = buildTrellis2FastSinglePrompt({
      inputImageName: frontName,
      prefix,
      faces: flags.faces !== undefined ? Number(flags.faces) : (quality === 'high' ? 180000 : 120000),
      seed: flags.seed !== undefined ? Number(flags.seed) : undefined,
      steps: flags.steps !== undefined ? Number(flags.steps) : (quality === 'high' ? 12 : 10),
      sampler: typeof flags.sampler === 'string' ? flags.sampler : 'euler',
      pipelineType: typeof flags['pipeline-type'] === 'string' ? flags['pipeline-type'] : '1024_cascade',
      maxNumTokens: flags['max-num-tokens'] !== undefined ? Number(flags['max-num-tokens']) : 20480,
      textureSize: flags['texture-size'] ? Number(flags['texture-size']) : 2048,
      usePreCutout: Boolean(flags.birefnet),
    });
    workflowPath = 'builtin:trellis2-fast-lowvram-gguf';
    prompt = built.prompt;
    warnings = built.warnings;
    exportNodeId = built.exportNodeId;
  } else {
    const wfJson = JSON.parse(await readFile(workflowPath, 'utf8'));
    let frontName = staged.filename;
    if (flags.birefnet) {
      const cut = await runBiRefNetCutouts(config, { front: { filename: staged.filename } }, `${prefix}_cut`);
      frontName = cut.front;
    }
    const built = buildTrellis2Prompt(wfJson, {
      inputImageName: frontName,
      prefix,
      faces: flags.faces !== undefined ? Number(flags.faces) : (quality === 'high' ? 400000 : 10000),
      seed: flags.seed !== undefined ? Number(flags.seed) : undefined,
      reorient: flags.reorient,
      textureSize: flags['texture-size'] ? Number(flags['texture-size']) : undefined,
    });
    prompt = built.prompt;
    warnings = built.warnings;
    exportNodeId = built.exportNodeId;
  }

  const { promptId, entry } = await submitAndWaitComfyPrompt(config.comfyUiUrl, prompt, {
    timeoutMs: flags.timeout ? Number(flags.timeout) : 1800000,
  });

  let outItem = entry.outputs?.[exportNodeId]?.['3d']?.[0] || null;
  if (!outItem) {
    outItem = await findLatestComfyOutputByPrefix(path.join(config.comfyUiDir, 'output'), prefix, '.glb');
  }
  if (!outItem) {
    throw new Error(`Trellis2 prompt ${promptId} produced no 3d output on node ${exportNodeId}`);
  }

  const hasPost = Boolean(flags.normalize || flags.remesh);
  const rawOutPath = hasPost ? absOut.replace(/\.glb$/i, '.raw.glb') : absOut;
  await copyComfyOutputFile(config, outItem, rawOutPath);

  let normalizeSummary = null;
  let remeshSummary = null;
  let lowSummary = null;
  let qaSummary = null;
  const normTarget = flags.remesh ? absOut.replace(/\.glb$/i, '.norm.glb') : absOut;
  if (flags.normalize) {
    normalizeSummary = runBlenderHelper(config, buildBlenderNormalizeArgs(rawOutPath, normTarget, flags));
  }
  if (flags.remesh) {
    const remeshInput = flags.normalize ? normTarget : rawOutPath;
    const highPreset = resolveLowPolyPreset('high');
    remeshSummary = runBlenderHelper(config, buildBlenderRemeshBakeArgs(remeshInput, absOut, {
      ...flags,
      preset: undefined,
      role: undefined,
      'rig-run': false,
      'target-quads': flags['target-quads'] ?? flags.targetQuads ?? highPreset.targetQuads,
      'texture-size': flags['high-texture-size'] ?? flags['texture-size'] ?? highPreset.textureSize,
    }));
    if (flags['low-out']) {
      const lowPreset = resolveLowPolyPreset(flags.preset || flags.role || 'general');
      lowSummary = runBlenderHelper(config, buildBlenderRemeshBakeArgs(remeshInput, flags['low-out'], {
        ...flags,
        preset: lowPreset.name,
        'rig-run': flags['no-rig'] ? false : (flags['rig-run'] ?? flags.rigRun ?? true),
        'target-quads': flags['low-quads'] ?? lowPreset.targetQuads,
        'texture-size': flags['low-texture-size'] ?? lowPreset.textureSize,
        'normal-strength': flags['low-normal-strength'] ?? lowPreset.normalStrength,
        'qa-dir': flags['low-qa-dir'] || '',
      }));
    }
  } else if (!flags.normalize && (flags['qa-dir'] || flags.qaDir)) {
    qaSummary = runBlenderHelper(config, buildBlenderInspectArgs(absOut, {
      ...flags,
      'out-dir': flags['qa-dir'] || flags.qaDir,
    }, '4', '12'));
  }

  console.log(JSON.stringify({
    command: 'generate',
    quality,
    multiview,
    birefnet: useBiRefNet,
    workflowUsed: multiview ? 'builtin:Trellis2MultiView_GGUF' : workflowPath,
    promptId,
    warnings,
    stagedInput: staged.destPath,
    panelInfo: staged.panelInfo,
    rawOutput: rawOutPath,
    output: absOut,
    normalized: normalizeSummary,
    remeshed: remeshSummary,
    lowOutput: lowSummary,
    qa: qaSummary,
  }, null, 2));
}

async function cmdTexture(config, flags) {
  if (!config.comfyUiDir || !config.ultratexWorkflow) {
    throw new Error('ComfyUI directory/workflow not configured. Add model3d config in .hgame.local.json or env vars.');
  }
  const meshFile = flags.mesh;
  const refFile = flags.ref;
  const outFile = flags.out;
  if (!meshFile || !refFile || !outFile) {
    throw new Error('Usage: node scripts/process-model3d.mjs texture --mesh <mesh.glb> --ref <ref.png> --out <out.glb> [options]');
  }

  const absOut = assertAsciiPath(path.resolve(outFile), 'Output GLB');
  const stamp = Date.now();
  const slug = sanitizeSlug(flags.prefix || path.basename(absOut, path.extname(absOut)));

  const stagedMesh = await stageInputFile(meshFile, path.join(config.comfyUiDir, 'input', '3d'), `hgame_utx_${slug}_${stamp}`);
  const stagedRef = await stageInputFile(refFile, path.join(config.comfyUiDir, 'input'), `hgame_utx_${slug}_${stamp}`, {
    panelMode: typeof (flags['ref-panel'] || flags.panel) === 'string' ? (flags['ref-panel'] || flags.panel) : 'auto',
  });

  const utxWorkflowPath = typeof flags.workflow === 'string' ? flags.workflow : config.ultratexWorkflow;
  const wfJson = JSON.parse(await readFile(utxWorkflowPath, 'utf8'));
  const outPrefix = `ultratex/${slug}_${stamp}`;
  const quality = typeof flags.quality === 'string' ? flags.quality : 'standard';
  const { prompt, warnings, saveGlbNodeId, pbrNodeIds } = buildUltratexPrompt(wfJson, {
    meshFile: `3d/${stagedMesh.filename}`,
    refImageName: stagedRef.filename,
    prefix: outPrefix,
    quality,
    alignment: flags.alignment || 'front',
    uvMode: flags['uv-mode'],
    padding: flags.padding !== undefined ? Number(flags.padding) : undefined,
    atlasSize: flags['atlas-size'] ? Number(flags['atlas-size']) : undefined,
    viewRes: flags['view-res'] ? Number(flags['view-res']) : undefined,
    normalViewRes: flags['normal-view-res'] ? Number(flags['normal-view-res']) : undefined,
    cameraFit: typeof flags['camera-fit'] === 'string' ? flags['camera-fit'] : undefined,
    textureSize: flags['texture-size'] ? Number(flags['texture-size']) : undefined,
    steps: flags.steps !== undefined ? Number(flags.steps) : undefined,
    extraSteps: flags['extra-steps'] !== undefined ? Number(flags['extra-steps']) : undefined,
    seed: flags.seed !== undefined ? Number(flags.seed) : undefined,
    guidance: flags.guidance !== undefined ? Number(flags.guidance) : undefined,
    maxVramMb: flags['max-vram-mb'] !== undefined ? Number(flags['max-vram-mb']) : (quality === 'high' ? 3584 : undefined),
    tokenChunk: flags['token-chunk'] !== undefined ? Number(flags['token-chunk']) : (quality === 'high' ? 2048 : undefined),
    performanceMode: typeof flags['performance-mode'] === 'string' ? flags['performance-mode'] : (quality === 'high' ? 'conservative' : undefined),
    prompt: flags.prompt,
    negativePrompt: flags['negative-prompt'],
  });

  const { promptId, entry } = await submitAndWaitComfyPrompt(config.comfyUiUrl, prompt, {
    timeoutMs: flags.timeout ? Number(flags.timeout) : 1800000,
  });

  const glbItems = saveGlbsFromEntry(entry, saveGlbNodeId);
  if (!glbItems.length) {
    throw new Error(`UltraTex prompt ${promptId} produced no SaveGLB output on node ${saveGlbNodeId}`);
  }
  await copyComfyOutputFile(config, glbItems[0], absOut);

  const pbrOutputs = {};
  const pbrDir = flags['pbr-dir'] ? assertAsciiPath(path.resolve(flags['pbr-dir']), 'PBR output dir') : null;
  if (pbrDir) {
    await mkdir(pbrDir, { recursive: true });
    for (const [channel, nodeId] of Object.entries(pbrNodeIds)) {
      const imgItem = nodeId ? entry.outputs?.[nodeId]?.images?.[0] : null;
      if (imgItem) {
        const fileName = channel === 'baseColor' ? 'base_color.png' : `${channel}.png`;
        pbrOutputs[channel] = await copyComfyOutputFile(config, imgItem, path.join(pbrDir, fileName));
      }
    }
  }

  let qaSummary = null;
  if (flags['qa-dir']) {
    qaSummary = runBlenderHelper(config, buildBlenderInspectArgs(absOut, {
      ...flags,
      'out-dir': flags['qa-dir'],
    }, '4', '12'));
  }

  console.log(JSON.stringify({
    command: 'texture',
    quality,
    workflowUsed: utxWorkflowPath,
    promptId,
    warnings,
    stagedMesh: stagedMesh.destPath,
    stagedRef: stagedRef.destPath,
    refPanelInfo: stagedRef.panelInfo,
    output: absOut,
    pbrOutputs,
    qa: qaSummary,
  }, null, 2));
}

function saveGlbsFromEntry(entry, saveGlbNodeId) {
  if (!saveGlbNodeId) return [];
  const items = entry.outputs?.[saveGlbNodeId]?.['3d'];
  return Array.isArray(items) ? items : [];
}

/**
 * Enforce zero-debris watertight topology on character outputs before completion or WebAsset upload.
 */
export function assertCleanTopology(stats, label = 'mesh', maxVertices = null, maxTris = null) {
  const audit = stats?.topologyAudit;
  if (!audit) {
    throw new Error(`${label} missing topologyAudit report`);
  }
  const issues = [];
  if ((audit.looseVerts ?? 0) > 0) issues.push(`looseVerts=${audit.looseVerts}`);
  if ((audit.looseEdges ?? 0) > 0) issues.push(`looseEdges=${audit.looseEdges}`);
  if ((audit.boundaryEdges ?? 0) > 0) issues.push(`boundaryEdges=${audit.boundaryEdges}`);
  if ((audit.nonManifoldEdges ?? 0) > 0) issues.push(`nonManifoldEdges=${audit.nonManifoldEdges}`);
  if ((audit.zeroAreaFaces ?? 0) > 0) issues.push(`zeroAreaFaces=${audit.zeroAreaFaces}`);
  if ((audit.spatialIslands ?? 0) !== 1) issues.push(`spatialIslands=${audit.spatialIslands}`);
  if ((audit.tinyIslands ?? 0) > 0) issues.push(`tinyIslands=${audit.tinyIslands}`);
  const hardVertCap = maxVertices !== null ? Math.min(maxVertices, GLOBAL_MAX_GPU_VERTICES) : GLOBAL_MAX_GPU_VERTICES;
  if (typeof stats.vertices === 'number' && stats.vertices > hardVertCap) {
    issues.push(`vertices=${stats.vertices} > budget ${hardVertCap}`);
  }
  if (maxTris !== null && typeof stats.triangles === 'number' && stats.triangles > maxTris) {
    issues.push(`triangles=${stats.triangles} > budget ${maxTris}`);
  }
  if (issues.length > 0) {
    throw new Error(`${label} failed clean topology gate: ${issues.join(', ')}`);
  }
  return true;
}

export function buildCharacterPackPlans(inputPath, outDir, flags = {}) {
  const slug = String(flags['character-id'] || flags.slug || path.basename(inputPath, path.extname(inputPath)))
    .replace(/[^A-Za-z0-9_-]/g, '_');
  const absDir = assertAsciiPath(path.resolve(outDir), 'Character pack out-dir');
  const uvSolver = String(flags['uv-solver'] ?? flags.uvSolver ?? 'smart');
  const samples = String(flags.samples ?? 12);
  const lowPresetName = flags.preset || flags.role || 'low';
  const qaRoot = (flags['qa-dir'] || flags.qaDir)
    ? assertAsciiPath(path.resolve(flags['qa-dir'] || flags.qaDir), 'Character pack qa-dir')
    : '';

  const highOut = path.join(absDir, `${slug}_clean_high.glb`);
  const lowOut = path.join(absDir, `${slug}_clean_low_run.glb`);
  const highFlags = {
    preset: 'high',
    'uv-solver': uvSolver,
    samples,
    ...(qaRoot ? { 'qa-dir': path.join(qaRoot, 'high'), views: flags.views || '4', size: flags.size || '512' } : {}),
  };
  const lowFlags = {
    preset: lowPresetName,
    'uv-solver': uvSolver,
    samples,
    'rig-run': flags['no-rig'] ? false : true,
    ...(qaRoot ? { 'qa-dir': path.join(qaRoot, 'low'), views: flags.views || '4', size: flags.size || '512' } : {}),
  };
  return {
    slug,
    lowPresetName,
    highOut,
    lowOut,
    highArgs: buildBlenderRemeshBakeArgs(inputPath, highOut, highFlags),
    lowArgs: buildBlenderRemeshBakeArgs(inputPath, lowOut, lowFlags),
  };
}

async function cmdCharacterPack(config, flags) {
  const webassetUrl = String(flags['webasset-url'] || 'http://127.0.0.1:4174').replace(/\/+$/, '');
  const characterId = String(flags['character-id'] || flags.characterId || '').trim();
  const outDir = path.resolve(flags['out-dir'] || flags.outDir || path.join(process.cwd(), '.tmp', 'character-pack', characterId || 'asset'));
  await mkdir(outDir, { recursive: true });

  let inputPath = flags.input ? path.resolve(String(flags.input)) : '';
  if (!inputPath && flags['from-webasset']) {
    if (!characterId) throw new Error('character-pack --from-webasset requires --character-id <id>');
    const res = await fetch(`${webassetUrl}/api/assets?q=${encodeURIComponent(characterId)}`);
    if (!res.ok) throw new Error(`WebAsset lookup failed (${res.status}) for "${characterId}"`);
    const data = await res.json();
    const item = (data.items || []).find((x) => x.id === characterId) || data.items?.[0];
    const highModelUrl = item?.models?.high?.url;
    if (!highModelUrl) throw new Error(`Character "${characterId}" has no models.high in WebAsset`);
    const dl = await fetch(`${webassetUrl}${highModelUrl}`);
    if (!dl.ok) throw new Error(`Failed downloading raw high GLB (${dl.status})`);
    inputPath = path.join(outDir, `${characterId}_raw_high.glb`);
    await writeFile(inputPath, new Uint8Array(await dl.arrayBuffer()));
  }
  if (!inputPath) {
    throw new Error('character-pack requires --input <raw_high.glb> or (--from-webasset --character-id <id>)');
  }

  const plans = buildCharacterPackPlans(inputPath, outDir, flags);
  const highSummary = runBlenderHelper(config, plans.highArgs);
  assertCleanTopology(highSummary?.stats, 'clean_high');

  const lowSummary = runBlenderHelper(config, plans.lowArgs);
  const lowPreset = resolveLowPolyPreset(plans.lowPresetName);
  assertCleanTopology(lowSummary?.stats, 'clean_low', lowPreset.maxVertices, lowPreset.maxTris);

  let uploaded = null;
  if (flags.upload) {
    if (!characterId) throw new Error('character-pack --upload requires --character-id <id>');
    const uploadOne = async (mode, name, filePath) => {
      const bytes = await readFile(filePath);
      const url = `${webassetUrl}/api/character-models?characterId=${encodeURIComponent(characterId)}&mode=${mode}&name=${encodeURIComponent(name)}`;
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
      const json = await resp.json();
      if (!resp.ok) throw new Error(`WebAsset upload (${mode}) failed: ${JSON.stringify(json)}`);
      return json;
    };
    const highName = `${plans.slug}_clean_high.glb`;
    const lowName = flags['no-rig'] ? `${plans.slug}_clean_low.glb` : `${plans.slug}_clean_low_run.glb`;
    uploaded = {
      high: await uploadOne('high', highName, plans.highOut),
      low: await uploadOne('low', lowName, plans.lowOut),
    };
  }

  console.log(JSON.stringify({
    command: 'character-pack',
    input: inputPath,
    high: { output: plans.highOut, stats: highSummary?.stats, repair: highSummary?.repair },
    low: { output: plans.lowOut, stats: lowSummary?.stats, repair: lowSummary?.repair, rig: lowSummary?.rig },
    uploaded,
  }, null, 2));
}

async function main() {
  const { command, positional, flags } = parseProcessModel3dArgs(process.argv.slice(2));
  if (!command || command === 'help' || flags.help) {
    printUsage();
    return;
  }

  const config = resolveModel3dConfig(process.cwd(), {
    comfyUiUrl: typeof flags['comfy-url'] === 'string' ? flags['comfy-url'] : undefined,
    comfyUiDir: typeof flags['comfy-dir'] === 'string' ? flags['comfy-dir'] : undefined,
    blenderPath: typeof flags.blender === 'string' ? flags.blender : undefined,
  });

  if (command === 'doctor') {
    await cmdDoctor(config);
    return;
  }

  if (command === 'inspect') {
    const input = flags.input || positional[0];
    if (!input) throw new Error('Usage: node scripts/process-model3d.mjs inspect <mesh.glb> [--out-dir <dir>]');
    const summary = runBlenderHelper(config, buildBlenderInspectArgs(input, flags, '6', '0'));
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (command === 'qa') {
    const input = flags.input || positional[0];
    const outDir = flags['out-dir'] || flags.outDir;
    if (!input || !outDir) throw new Error('Usage: node scripts/process-model3d.mjs qa <mesh.glb> --out-dir <dir>');
    const summary = runBlenderHelper(config, buildBlenderInspectArgs(input, flags, '4', '12'));
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (command === 'normalize') {
    const input = flags.input || positional[0];
    const out = flags.out;
    if (!input || !out) throw new Error('Usage: node scripts/process-model3d.mjs normalize <mesh.glb> --out <out.glb> [options]');
    const summary = runBlenderHelper(config, buildBlenderNormalizeArgs(input, out, flags));
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (command === 'remesh-bake') {
    const input = flags.input || positional[0];
    const out = flags.out;
    if (!input || !out) throw new Error('Usage: node scripts/process-model3d.mjs remesh-bake --input <mesh.glb> --out <out.glb> [options]');
    const summary = runBlenderHelper(config, buildBlenderRemeshBakeArgs(input, out, flags));
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (command === 'character-pack') {
    await cmdCharacterPack(config, flags);
    return;
  }

  if (command === 'rig-run') {
    const input = flags.input || positional[0];
    const out = flags.out;
    if (!input || !out) throw new Error('Usage: node scripts/process-model3d.mjs rig-run --input <mesh.glb> --out <out.glb> [options]');
    const summary = runBlenderHelper(config, buildBlenderRigRunArgs(input, out, flags));
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (command === 'assemble-pbr') {
    const mesh = flags.mesh || positional[0];
    const out = flags.out;
    if (!mesh || !out) throw new Error('Usage: node scripts/process-model3d.mjs assemble-pbr --mesh <uv.glb> --base-color <png> --roughness <png> --out <out.glb>');
    const summary = runBlenderHelper(config, buildBlenderAssemblePbrArgs(mesh, out, flags));
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (command === 'generate') {
    await cmdGenerate(config, flags);
    return;
  }

  if (command === 'texture') {
    await cmdTexture(config, flags);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((err) => {
    console.error('process-model3d failed: ' + err.message);
    process.exitCode = 1;
  });
}
