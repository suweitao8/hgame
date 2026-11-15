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

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const blenderHelperPath = path.join(scriptDir, 'blender-model3d.py');

export const DEFAULT_TRELLIS2_WORKFLOW_REL = 'user/default/workflows/PixelArtistry/MeshWithTexturing_Pixal3D_GGUF.json';
export const DEFAULT_ULTRATEX_WORKFLOW_REL = 'user/default/workflows/PixelArtistry/PixelArtistry_UltraTex_03_LowVRAM_GGUF.json';

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

  return {
    configPath,
    rootDir,
    comfyUiUrl,
    comfyUiDir,
    blenderPath,
    trellis2Workflow,
    ultratexWorkflow,
    startBatPath,
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

/** Builds a calibrated Trellis2-GGUF `/prompt` payload for image-to-3D GLB generation. */
export function buildTrellis2Prompt(workflowJson, opts = {}) {
  const { prompt, warnings } = convertComfyUiWorkflowToApi(workflowJson, TRELLIS2_WIDGET_ORDER);

  const loadImgs = findNodesByClass(prompt, 'Trellis2LoadImageWithTransparency');
  if (loadImgs.length === 0) throw new Error('Trellis2 workflow missing Trellis2LoadImageWithTransparency');
  if (opts.inputImageName) {
    loadImgs[0].node.inputs.image = assertAsciiPath(opts.inputImageName, 'Input image name');
  }

  const exporters = findNodesByClass(prompt, 'Trellis2ExportMesh');
  if (exporters.length === 0) throw new Error('Trellis2 workflow missing Trellis2ExportMesh');
  if (opts.prefix) {
    setLinkedOrDirectInput(prompt, exporters[0].node, 'filename_prefix', assertAsciiPath(opts.prefix, 'Output prefix'));
  }

  const simplifiers = findNodesByClass(prompt, 'Trellis2SimplifyMesh');
  if (simplifiers.length > 0 && opts.faces !== undefined && opts.faces !== null) {
    const faces = Number(opts.faces);
    if (!Number.isInteger(faces) || faces < 100) {
      throw new RangeError('--faces must be an integer >= 100');
    }
    setLinkedOrDirectInput(prompt, simplifiers[0].node, 'target_face_num', faces);
  }

  for (const { node } of findNodesByClass(prompt, 'Trellis2LoadModel_GGUF')) {
    if (!node.inputs.modelname || node.inputs.modelname === 'Pixal3D-GGUF') {
      node.inputs.modelname = opts.modelName || 'TRELLIS.2-4B';
    }
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
    exportNodeId: exporters[0].id,
  };
}

/** Builds a calibrated UltraTex LowVRAM GGUF `/prompt` payload for GLB re-texturing. */
export function buildUltratexPrompt(workflowJson, opts = {}) {
  const { prompt, warnings } = convertComfyUiWorkflowToApi(workflowJson, ULTRATEX_WIDGET_ORDER);

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

  const prepNodes = findNodesByClass(prompt, 'UTXPrepareTextureV25');
  for (const { node } of prepNodes) {
    if (opts.alignment) node.inputs.alignment = opts.alignment;
  }

  const unwrapNodes = findNodesByClass(prompt, 'UTXUnwrapMeshUVV25');
  for (const { node } of unwrapNodes) {
    if (opts.uvMode) node.inputs.uv_mode = opts.uvMode;
    if (opts.atlasSize) node.inputs.atlas_size = Number(opts.atlasSize);
  }

  const genNodes = findNodesByClass(prompt, 'UTXGenerateTextureViewsV23');
  for (const { node } of genNodes) {
    if (opts.viewRes) node.inputs.view_resolution = Number(opts.viewRes);
    if (opts.steps !== undefined && opts.steps !== null) node.inputs.steps = Number(opts.steps);
    if (opts.seed !== undefined && opts.seed !== null) node.inputs.seed = Number(opts.seed);
  }

  const bakers = findNodesByClass(prompt, 'UTXFastSurfaceTextureBaker');
  const bakerIds = new Set(bakers.map((b) => b.id));
  for (const { node } of bakers) {
    if (opts.textureSize) node.inputs.texture_size = Number(opts.textureSize);
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
      if (opts.negativePrompt !== undefined && Array.isArray(negLink) && prompt[String(negLink[0])]) {
        prompt[String(negLink[0])].inputs.text = String(opts.negativePrompt);
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
  const res = spawnSync(config.blenderPath, fullArgs, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
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

async function stageInputFile(srcPath, destDir, prefixSlug) {
  const absSrc = path.resolve(srcPath);
  const st = await stat(absSrc);
  if (!st.isFile()) throw new Error(`Input file not found: ${absSrc}`);
  const ext = path.extname(absSrc).toLowerCase() || '';
  const safeBase = `${sanitizeSlug(prefixSlug)}${ext}`;
  const destPath = path.join(destDir, safeBase);
  assertAsciiPath(destPath, 'Staged ComfyUI input path');
  await mkdir(destDir, { recursive: true });
  await copyFile(absSrc, destPath);
  return { absSrc, destPath, filename: safeBase };
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
    '  qa <mesh.glb> --out-dir <dir>                  Render multi-view QA images and print mesh/texture diagnostics',
    '  generate --input <img.png> --out <out.glb>     Run Trellis2-GGUF image-to-3D (default --faces 10000)',
    '  texture --mesh <glb> --ref <png> --out <glb>   Run UltraTex LowVRAM GGUF PBR texturing on a normalized mesh',
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

function buildBlenderNormalizeArgs(inputPath, outPath, flags) {
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
  if (flags['qa-dir'] || flags.qaDir) {
    args.push('--qa-dir', assertAsciiPath(path.resolve(flags['qa-dir'] || flags.qaDir), 'QA render dir'));
  }
  if (flags.views) args.push('--views', String(flags.views));
  if (flags.size) args.push('--size', String(flags.size));
  if (flags.elev !== undefined) args.push('--elev', String(flags.elev));
  if (flags.engine) args.push('--engine', String(flags.engine));
  return args;
}

async function cmdGenerate(config, flags) {
  if (!config.comfyUiDir || !config.trellis2Workflow) {
    throw new Error('ComfyUI directory/workflow not configured. Add model3d config in .hgame.local.json or env vars.');
  }
  const inputFile = flags.input;
  const outFile = flags.out;
  if (!inputFile || !outFile) {
    throw new Error('Usage: node scripts/process-model3d.mjs generate --input <img.png> --out <out.glb> [options]');
  }

  const absOut = assertAsciiPath(path.resolve(outFile), 'Output GLB');
  const slug = sanitizeSlug(flags.name || path.basename(absOut, path.extname(absOut)));
  const staged = await stageInputFile(inputFile, path.join(config.comfyUiDir, 'input'), `hgame_t2_${slug}_${Date.now()}`);

  const wfJson = JSON.parse(await readFile(config.trellis2Workflow, 'utf8'));
  const prefix = `hgame_t2_${slug}_${Date.now()}`;
  const { prompt, warnings, exportNodeId } = buildTrellis2Prompt(wfJson, {
    inputImageName: staged.filename,
    prefix,
    faces: flags.faces !== undefined ? Number(flags.faces) : 10000,
    seed: flags.seed !== undefined ? Number(flags.seed) : undefined,
    reorient: flags.reorient,
    textureSize: flags['texture-size'] ? Number(flags['texture-size']) : undefined,
  });

  const { promptId, entry } = await submitAndWaitComfyPrompt(config.comfyUiUrl, prompt, {
    timeoutMs: flags.timeout ? Number(flags.timeout) : 1800000,
  });

  const outItems = entry.outputs?.[exportNodeId]?.['3d'];
  if (!Array.isArray(outItems) || outItems.length === 0) {
    throw new Error(`Trellis2 prompt ${promptId} produced no 3d output on node ${exportNodeId}`);
  }

  const rawOutPath = flags.normalize ? absOut.replace(/\.glb$/i, '.raw.glb') : absOut;
  await copyComfyOutputFile(config, outItems[0], rawOutPath);

  let normalizeSummary = null;
  if (flags.normalize) {
    normalizeSummary = runBlenderHelper(config, buildBlenderNormalizeArgs(rawOutPath, absOut, flags));
  }

  console.log(JSON.stringify({
    command: 'generate',
    promptId,
    warnings,
    stagedInput: staged.destPath,
    rawOutput: rawOutPath,
    output: absOut,
    normalized: normalizeSummary,
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
  const stagedRef = await stageInputFile(refFile, path.join(config.comfyUiDir, 'input'), `hgame_utx_${slug}_${stamp}`);

  const wfJson = JSON.parse(await readFile(config.ultratexWorkflow, 'utf8'));
  const outPrefix = `ultratex/${slug}_${stamp}`;
  const { prompt, warnings, saveGlbNodeId, pbrNodeIds } = buildUltratexPrompt(wfJson, {
    meshFile: `3d/${stagedMesh.filename}`,
    refImageName: stagedRef.filename,
    prefix: outPrefix,
    alignment: flags.alignment || 'front',
    uvMode: flags['uv-mode'],
    atlasSize: flags['atlas-size'] ? Number(flags['atlas-size']) : undefined,
    viewRes: flags['view-res'] ? Number(flags['view-res']) : undefined,
    textureSize: flags['texture-size'] ? Number(flags['texture-size']) : undefined,
    steps: flags.steps !== undefined ? Number(flags.steps) : undefined,
    seed: flags.seed !== undefined ? Number(flags.seed) : undefined,
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
    promptId,
    warnings,
    stagedMesh: stagedMesh.destPath,
    stagedRef: stagedRef.destPath,
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
