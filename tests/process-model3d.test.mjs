import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  assertAsciiPath,
  assertCleanTopology,
  buildBlenderNormalizeArgs,
  buildCharacterPackPlans,
  buildTrellis2Prompt,
  buildUltratexPrompt,
  convertComfyUiWorkflowToApi,
  extractSheetPanelPng,
  parseProcessModel3dArgs,
  resolveModel3dConfig,
  TRELLIS2_WIDGET_ORDER,
} from '../scripts/process-model3d.mjs';
import { decodePng, encodePng } from '../scripts/process-assets.mjs';

test('resolveModel3dConfig resolves .hgame.local.json and env var overrides', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hgame-model3d-cfg-'));
  try {
    fs.writeFileSync(
      path.join(tmpDir, '.hgame.local.json'),
      JSON.stringify({
        model3d: {
          rootDir: path.join(tmpDir, 'm3d'),
          comfyUiUrl: 'http://127.0.0.1:8199/',
          blenderPath: 'C:/Custom/blender.exe',
        },
      }),
      'utf8'
    );

    const prev = {
      dir: process.env.HGAME_MODEL3D_DIR,
      url: process.env.HGAME_MODEL3D_COMFY_URL,
      comfy: process.env.HGAME_MODEL3D_COMFY_DIR,
      blender: process.env.HGAME_MODEL3D_BLENDER,
    };
    delete process.env.HGAME_MODEL3D_DIR;
    delete process.env.HGAME_MODEL3D_COMFY_URL;
    delete process.env.HGAME_MODEL3D_COMFY_DIR;
    delete process.env.HGAME_MODEL3D_BLENDER;

    try {
      const cfg = resolveModel3dConfig(tmpDir);
      assert.equal(cfg.comfyUiUrl, 'http://127.0.0.1:8199');
      assert.equal(cfg.blenderPath, 'C:/Custom/blender.exe');
      assert.equal(cfg.comfyUiDir, path.resolve(tmpDir, 'm3d', 'ComfyUI-Easy-Install', 'ComfyUI'));
      assert.ok(cfg.trellis2Workflow.endsWith(path.join('PixelArtistry', 'MeshWithTexturing_Pixal3D_GGUF.json')));
      assert.ok(cfg.ultratexWorkflow.endsWith(path.join('PixelArtistry', 'PixelArtistry_UltraTex_03_LowVRAM_GGUF.json')));

      process.env.HGAME_MODEL3D_COMFY_URL = 'http://127.0.0.1:9001';
      process.env.HGAME_MODEL3D_BLENDER = 'blender-override';
      const envCfg = resolveModel3dConfig(tmpDir);
      assert.equal(envCfg.comfyUiUrl, 'http://127.0.0.1:9001');
      assert.equal(envCfg.blenderPath, 'blender-override');
    } finally {
      for (const [envKey, val] of [
        ['HGAME_MODEL3D_DIR', prev.dir],
        ['HGAME_MODEL3D_COMFY_URL', prev.url],
        ['HGAME_MODEL3D_COMFY_DIR', prev.comfy],
        ['HGAME_MODEL3D_BLENDER', prev.blender],
      ]) {
        if (val === undefined) delete process.env[envKey];
        else process.env[envKey] = val;
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('assertAsciiPath accepts ASCII paths and rejects non-ASCII paths', () => {
  assert.equal(assertAsciiPath('C:/hgame-fixture/model3d/duck_v2.glb', 'Model'), 'C:/hgame-fixture/model3d/duck_v2.glb');
  assert.throws(() => assertAsciiPath('C:/hgame-fixture/模型/duck.glb', 'Model'), /non-ASCII/);
  assert.throws(() => assertAsciiPath('', 'Model'), /must not be empty/);
});

test('parseProcessModel3dArgs parses subcommands and flags', () => {
  const parsed = parseProcessModel3dArgs([
    'normalize',
    'in.glb',
    '--out', 'out.glb',
    '--rx', '-90',
    '--origin=ground',
    '--help',
  ]);
  assert.equal(parsed.command, 'normalize');
  assert.deepEqual(parsed.positional, ['in.glb']);
  assert.equal(parsed.flags.out, 'out.glb');
  assert.equal(parsed.flags.rx, '-90');
  assert.equal(parsed.flags.origin, 'ground');
  assert.equal(parsed.flags.help, true);
});

test('buildTrellis2Prompt converts UI workflow, consumes control/linked widget slots, and applies overrides', () => {
  const workflow = {
    nodes: [
      { id: 1, type: 'Preview3D', widgets_values: ['ignored.glb', ''] },
      { id: 6, type: 'Trellis2LoadImageWithTransparency', widgets_values: ['old.png', 'image'], inputs: [] },
      { id: 209, type: 'PrimitiveInt', widgets_values: [500000, 'fixed'], inputs: [] },
      { id: 219, type: 'PrimitiveString', widgets_values: ['OldPrefix'], inputs: [] },
      { id: 303, type: 'Trellis2LoadModel_GGUF', widgets_values: ['Pixal3D-GGUF', 'GGUF Q4_K_M', 'flash_attn', 'cuda', true, true], inputs: [] },
      {
        id: 272,
        type: 'Trellis2SparseGenerator',
        widgets_values: [1000, 'fixed', 12, 7.5, 0.7, 5, 'euler', 32, 0.6, 1, false, 1, false, 0, 2, 'flood_fill', 0.92, false],
        inputs: [{ name: 'pipeline', link: 10 }],
      },
      {
        id: 300,
        type: 'Trellis2ShapeCascadeGenerator',
        widgets_values: [0, 1024, 32, 999999, 12, 7.5, 0.5, 3, 'euler', 0.6, 1, false, 0, 2, 0.92],
        inputs: [
          { name: 'from_resolution', type: 'INT', widget: { name: 'from_resolution' }, link: 11 },
          { name: 'sparse_structure_resolution', type: 'INT', widget: { name: 'sparse_structure_resolution' }, link: 12 },
        ],
      },
      {
        id: 218,
        type: 'Trellis2SimplifyMesh',
        widgets_values: [500000, 'Cumesh'],
        inputs: [{ name: 'target_face_num', type: 'INT', widget: { name: 'target_face_num' }, link: 13 }],
      },
      {
        id: 302,
        type: 'Trellis2UnWrapAndRasterizer',
        widgets_values: [60, 0, 1, 1, 2048, 'OPAQUE', false, false, true, 'telea', 'None'],
        inputs: [{ name: 'mesh', link: 14 }],
      },
      {
        id: 203,
        type: 'Trellis2ExportMesh',
        widgets_values: ['IgnoredPrefix', 'glb'],
        inputs: [
          { name: 'filename_prefix', type: 'STRING', widget: { name: 'filename_prefix' }, link: 15 },
          { name: 'trimesh', link: 16 },
        ],
      },
    ],
    links: [
      [10, 303, 0, 272, 0, 'PIPELINE'],
      [11, 272, 1, 300, 0, 'INT'],
      [12, 272, 2, 300, 1, 'INT'],
      [13, 209, 0, 218, 0, 'INT'],
      [14, 218, 0, 302, 0, 'MESH'],
      [15, 219, 0, 203, 0, 'STRING'],
      [16, 302, 0, 203, 1, 'TRIMESH'],
    ],
  };

  const { prompt, warnings, exportNodeId } = buildTrellis2Prompt(workflow, {
    inputImageName: 'hero_ref.png',
    prefix: 'hero_v1',
    faces: 8500,
    seed: 42,
    reorient: '90 degrees',
    textureSize: 1024,
  });

  assert.deepEqual(warnings, []);
  assert.equal(exportNodeId, '203');
  assert.equal(prompt['1'], undefined);
  assert.equal(prompt['6'].inputs.image, 'hero_ref.png');
  assert.equal(prompt['209'].inputs.value, 8500);
  assert.equal(prompt['219'].inputs.value, 'hero_v1');
  assert.equal(prompt['303'].inputs.modelname, 'TRELLIS.2-4B');
  assert.equal(prompt['272'].inputs.seed, 42);
  assert.equal(prompt['300'].inputs.seed, 42);
  assert.equal(prompt['300'].inputs.to_resolution, 1024);
  assert.deepEqual(prompt['300'].inputs.from_resolution, ['272', 1]);
  assert.deepEqual(prompt['218'].inputs.target_face_num, ['209', 0]);
  assert.equal(prompt['218'].inputs.method, 'Cumesh');
  assert.equal(prompt['302'].inputs.texture_size, 1024);
  assert.equal(prompt['302'].inputs.reorient_vertices, '90 degrees');
  assert.deepEqual(prompt['203'].inputs.filename_prefix, ['219', 0]);
  assert.equal(prompt['203'].inputs.file_format, 'glb');

  assert.throws(
    () => convertComfyUiWorkflowToApi({ nodes: [{ id: 1, type: 'UnknownCustomNode' }], links: [] }, TRELLIS2_WIDGET_ORDER),
    /Missing WIDGET_ORDER/
  );
});

test('buildUltratexPrompt converts UI workflow and maps PBR SaveImage slots cleanly', () => {
  const workflow = {
    nodes: [
      { id: 15, type: 'MarkdownNote', widgets_values: ['note'] },
      { id: 1, type: 'Load3DAdvanced', widgets_values: ['3d/old.glb', '', 512, 512], inputs: [] },
      { id: 3, type: 'LoadImage', widgets_values: ['old_ref.png', 'image'], inputs: [] },
      { id: 8, type: 'UTXTextEncode', widgets_values: [''], inputs: [{ name: 'clip', link: 1 }] },
      { id: 47, type: 'UTXTextEncode', widgets_values: [''], inputs: [{ name: 'clip', link: 1 }] },
      { id: 44, type: 'UTXUnwrapMeshUVV25', widgets_values: [4096, 'comfy_gpu', 16], inputs: [{ name: 'mesh', link: 2 }] },
      { id: 45, type: 'UTXPrepareTextureV25', widgets_values: ['front', 'foreground', 'auto_smooth', 1024, 'custom', 0, 0, 1], inputs: [{ name: 'mesh', link: 3 }] },
      {
        id: 9,
        type: 'UTXGenerateTextureViewsV23',
        widgets_values: ['ultratex_flux2.safetensors', 1, 'ultratex_flux2_decoder.pt', 'albedo', 1024, 12, 0, 'fixed', 4, 4, 1, 0.2, 'guided', 0.55, 4, true],
        inputs: [
          { name: 'source', link: 4 },
          { name: 'positive', link: 5 },
          { name: 'negative', link: 6 },
        ],
      },
      {
        id: 20,
        type: 'UTXGenerateTextureViewsV23',
        widgets_values: ['ultratex_flux2_mr.safetensors', 1, 'ultratex_flux2_decoder.pt', 'mr', 1024, 6, 0, 'fixed', 4, 4, 1, 0.2, 'independent', 0.55, 4, true],
        inputs: [
          { name: 'source', link: 4 },
          { name: 'positive', link: 5 },
          { name: 'negative', link: 6 },
        ],
      },
      { id: 11, type: 'UTXSaveViews', widgets_values: ['ultratex_views'], inputs: [{ name: 'views', link: 7 }] },
      { id: 48, type: 'UTXFastSurfaceTextureBaker', widgets_values: [2048, 'surface_fill', 'fast_detail', 'auto'], inputs: [{ name: 'albedo_views', link: 7 }] },
      { id: 13, type: 'SaveGLB', widgets_values: ['ultratex/textured', ''], inputs: [{ name: 'mesh', link: 8 }] },
      { id: 14, type: 'SaveImage', widgets_values: ['ultratex/base_color'], inputs: [{ name: 'images', link: 9 }] },
      { id: 22, type: 'SaveImage', widgets_values: ['ultratex/roughness'], inputs: [{ name: 'images', link: 10 }] },
      { id: 23, type: 'SaveImage', widgets_values: ['ultratex/metallic'], inputs: [{ name: 'images', link: 11 }] },
    ],
    links: [
      [1, 7, 0, 8, 0, 'CLIP'],
      [2, 2, 0, 44, 0, 'MESH'],
      [3, 44, 0, 45, 0, 'MESH'],
      [4, 45, 0, 9, 0, 'UTX_SOURCE'],
      [5, 8, 0, 9, 1, 'CONDITIONING'],
      [6, 47, 0, 9, 2, 'CONDITIONING'],
      [7, 9, 0, 48, 0, 'UTX_VIEWS'],
      [8, 48, 0, 13, 0, 'MESH'],
      [9, 48, 2, 14, 0, 'IMAGE'],
      [10, 48, 3, 22, 0, 'IMAGE'],
      [11, 48, 4, 23, 0, 'IMAGE'],
    ],
  };

  const { prompt, warnings, saveGlbNodeId, pbrNodeIds } = buildUltratexPrompt(workflow, {
    meshFile: '3d/duck_norm.glb',
    refImageName: 'duck_test.png',
    prefix: 'ultratex/duck_v2',
    alignment: 'front',
    uvMode: 'keep_existing',
    viewRes: 1536,
    textureSize: 2048,
    steps: 8,
    seed: 77,
    prompt: 'rubber duck',
    negativePrompt: 'blurry',
  });

  assert.deepEqual(warnings, []);
  assert.equal(saveGlbNodeId, '13');
  assert.deepEqual(pbrNodeIds, { baseColor: '14', roughness: '22', metallic: '23' });
  assert.equal(prompt['15'], undefined);
  assert.equal(prompt['1'].inputs.model_file, '3d/duck_norm.glb');
  assert.equal(prompt['3'].inputs.image, 'duck_test.png');
  assert.equal(prompt['44'].inputs.uv_mode, 'keep_existing');
  assert.equal(prompt['45'].inputs.alignment, 'front');
  assert.equal(prompt['9'].inputs.view_resolution, 1536);
  assert.equal(prompt['9'].inputs.steps, 8);
  assert.equal(prompt['9'].inputs.seed, 77);
  assert.equal(prompt['20'].inputs.seed, 77);
  assert.equal(prompt['8'].inputs.text, 'rubber duck');
  assert.equal(prompt['47'].inputs.text, 'blurry');
  assert.equal(prompt['13'].inputs.filename_prefix, 'ultratex/duck_v2/textured');
  assert.equal(prompt['14'].inputs.filename_prefix, 'ultratex/duck_v2/base_color');
  assert.equal(prompt['22'].inputs.filename_prefix, 'ultratex/duck_v2/roughness');
  assert.equal(prompt['23'].inputs.filename_prefix, 'ultratex/duck_v2/metallic');
  assert.equal(prompt['11'].inputs.prefix, 'ultratex_duck_v2_views');
});

test('extractSheetPanelPng splits 2:1 front+side sheets in auto/left/right mode and leaves square images intact', () => {
  const w = 16;
  const h = 8;
  const data = Buffer.alloc(w * h * 4, 255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const isLeft = x < w / 2;
      data[idx] = isLeft ? 200 : 20;
      data[idx + 1] = isLeft ? 30 : 210;
      data[idx + 2] = 40;
      data[idx + 3] = 255;
    }
  }
  const sheetPng = encodePng({ width: w, height: h, data });

  const autoRes = extractSheetPanelPng(sheetPng, 'auto');
  assert.equal(autoRes.extracted, true);
  assert.equal(autoRes.selectedPanel, 'left');
  assert.deepEqual(autoRes.outputSize, [8, 8]);
  assert.equal(decodePng(autoRes.buffer).data[0], 200);

  const sideRes = extractSheetPanelPng(sheetPng, 'right');
  assert.equal(sideRes.extracted, true);
  assert.equal(sideRes.selectedPanel, 'right');
  assert.equal(decodePng(sideRes.buffer).data[0], 20);

  const squarePng = encodePng({ width: 8, height: 8, data: Buffer.alloc(8 * 8 * 4, 128) });
  const sqAuto = extractSheetPanelPng(squarePng, 'auto');
  assert.equal(sqAuto.extracted, false);
  assert.deepEqual(sqAuto.outputSize, [8, 8]);
});

test('scripts/process-model3d.mjs --help exits cleanly', () => {
  const res = spawnSync(process.execPath, ['scripts/process-model3d.mjs', '--help'], { encoding: 'utf8' });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /Usage: node scripts\/process-model3d\.mjs/);
});

test('buildTrellis2Prompt handles High_Quality_GGUF multi-stage graph and selects final textured exporter', () => {
  const workflow = {
    nodes: [
      { id: 1, type: 'Trellis2LoadImageWithTransparency', widgets_values: ['in.png', 'image'], inputs: [] },
      { id: 2, type: 'Trellis2MeshWithVoxelAdvancedGenerator', widgets_values: [0, 'randomize', '1024_cascade', 50, 7.5, 0.5, 5.0, 50, 7.5, 0.5, 5.0, 25, 7.5, 0.5, 5.0, 9999999, 6, 32, true, 0.5, 1.0, 0.1, 1.0, 0.1, 1.0, true, 'euler'], inputs: [] },
      { id: 3, type: 'Trellis2MeshWithVoxelToTrimesh', widgets_values: ['90 degrees'], inputs: [{ name: 'voxelgrid', link: 1 }] },
      { id: 15, type: 'Trellis2ExportMesh', widgets_values: ['WhiteMesh', 'glb'], inputs: [{ name: 'trimesh', link: 2 }] },
      { id: 16, type: 'Trellis2MeshRefiner', widgets_values: [1, 'fixed', '1024_cascade', 50, 7.5, 0.5, 5.0, 25, 7.5, 0.5, 5.0, 999999, false, 1, 0.1, 1.0, 0.1, 1.0, true, 6, 'euler'], inputs: [{ name: 'mesh', link: 2 }] },
      { id: 21, type: 'Trellis2SmoothNormals', widgets_values: [], inputs: [{ name: 'mesh', link: 3 }] },
      { id: 22, type: 'Trellis2SimplifyMesh', widgets_values: [1000000, 'Cumsum'], inputs: [{ name: 'trimesh', link: 4 }] },
      { id: 24, type: 'Trellis2ExportMesh', widgets_values: ['Refined', 'glb'], inputs: [{ name: 'trimesh', link: 5 }] },
      { id: 25, type: 'Trellis2MeshTexturing', widgets_values: [1, 'fixed', 25, 7.5, 0.5, 5.0, '1024_cascade', 4096, 'OPAQUE', true, 0.1, 1.0, 6, false, true, 0.5, 'euler', true], inputs: [{ name: 'trimesh', link: 5 }] },
      { id: 26, type: 'Trellis2ExportMesh', widgets_values: ['Textured', 'glb'], inputs: [{ name: 'trimesh', link: 6 }] },
    ],
    links: [
      [1, 2, 0, 3, 0, 'VOXELGRID'],
      [2, 3, 0, 15, 0, 'TRIMESH'],
      [3, 3, 0, 16, 0, 'MESH'],
      [4, 16, 0, 21, 0, 'MESH'],
      [5, 21, 0, 22, 0, 'TRIMESH'],
      [6, 25, 0, 26, 0, 'TRIMESH'],
    ],
  };

  const { prompt, warnings, exportNodeId } = buildTrellis2Prompt(workflow, {
    inputImageName: 'cat_front.png',
    prefix: 'hgame_t2_cat_hq',
    faces: 400000,
    seed: 123,
    textureSize: 4096,
  });

  assert.deepEqual(warnings, []);
  assert.equal(exportNodeId, '26');
  assert.equal(prompt['1'].inputs.image, 'cat_front.png');
  assert.equal(prompt['2'].inputs.seed, 123);
  assert.equal(prompt['2'].inputs.fill_holes, true);
  assert.equal(prompt['2'].inputs.keep_only_shell, true);
  assert.equal(prompt['16'].inputs.seed, 123);
  assert.equal(prompt['16'].inputs.dino_substeps, 4);
  assert.equal(prompt['22'].inputs.target_face_num, 400000);
  assert.equal(prompt['25'].inputs.seed, 123);
  assert.equal(prompt['25'].inputs.texture_size, 4096);
  assert.equal(prompt['25'].inputs.dino_foundation_cap, 1);
  assert.equal(prompt['26'].inputs.filename_prefix, 'hgame_t2_cat_hq');
  assert.equal(prompt['15'].inputs.filename_prefix, 'hgame_t2_cat_hq_WhiteMesh');
  assert.equal(prompt['24'].inputs.filename_prefix, 'hgame_t2_cat_hq_Refined');
});

test('buildUltratexPrompt applies high quality defaults without breaking explicit overrides', () => {
  const workflow = {
    nodes: [
      { id: 1, type: 'Load3DAdvanced', widgets_values: ['3d/in.glb'], inputs: [] },
      { id: 3, type: 'LoadImage', widgets_values: ['ref.png', 'image'], inputs: [] },
      { id: 44, type: 'UTXUnwrapMeshUVV25', widgets_values: [4096, 'xatlas', 16], inputs: [{ name: 'mesh', link: 1 }] },
      { id: 45, type: 'UTXPrepareTextureV25', widgets_values: ['front', 'foreground', 'auto_smooth', 1024, 'custom', 0, 0, 1], inputs: [{ name: 'mesh', link: 2 }] },
      { id: 9, type: 'UTXGenerateTextureViewsV23', widgets_values: ['m.safetensors', 1, 'd.pt', 'albedo', 1024, 12, 0, 'fixed', 4, 4, 1, 0.2, 'guided', 0.55, 4, true], inputs: [{ name: 'source', link: 3 }] },
      { id: 48, type: 'UTXFastSurfaceTextureBaker', widgets_values: [2048, 'surface_fill', 'fast_detail', 'auto'], inputs: [{ name: 'albedo_views', link: 4 }] },
      { id: 13, type: 'SaveGLB', widgets_values: ['ultratex/textured', ''], inputs: [{ name: 'mesh', link: 5 }] },
    ],
    links: [
      [1, 1, 0, 44, 0, 'MESH'],
      [2, 44, 0, 45, 0, 'MESH'],
      [3, 45, 0, 9, 0, 'UTX_SOURCE'],
      [4, 9, 0, 48, 0, 'UTX_VIEWS'],
      [5, 48, 0, 13, 0, 'MESH'],
    ],
  };

  const { prompt, warnings } = buildUltratexPrompt(workflow, {
    meshFile: '3d/cat.glb',
    refImageName: 'cat_front.png',
    prefix: 'ultratex/cat_hq',
    quality: 'high',
    cameraFit: 'full',
  });

  assert.deepEqual(warnings, []);
  assert.equal(prompt['44'].inputs.uv_mode, 'keep_existing');
  assert.equal(prompt['44'].inputs.padding, 4);
  assert.equal(prompt['45'].inputs.normal_view_resolution, 2048);
  assert.equal(prompt['45'].inputs.camera_fit, 'full');
  assert.equal(prompt['9'].inputs.view_resolution, 768);
  assert.equal(prompt['9'].inputs.steps, 20);
  assert.equal(prompt['9'].inputs.extra_steps, 12);
  assert.equal(prompt['48'].inputs.texture_size, 2048);
});

import {
  buildBiRefNetCutoutPrompt,
  buildTrellis2FastSinglePrompt,
  resolveLowPolyPreset,
  CHARACTER_POLY_PRESETS,
  buildTrellis2MultiviewPrompt,
  buildBlenderRemeshBakeArgs,
  buildBlenderRigRunArgs,
  buildBlenderLaunchArgs,
  buildBlenderAssemblePbrArgs,
} from '../scripts/process-model3d.mjs';

test('buildBiRefNetCutoutPrompt wires RemoveBackground -> InvertMask -> JoinImageWithAlpha -> SaveImage', () => {
  const { prompt, saveNodes } = buildBiRefNetCutoutPrompt(
    { front: { filename: 'ck_front.png' }, right: { filename: 'ck_side.png' } },
    { prefix: 'ck_cut' }
  );
  assert.equal(prompt['1'].class_type, 'LoadBackgroundRemovalModel');
  assert.equal(prompt['1'].inputs.bg_removal_name, 'birefnet.safetensors');
  assert.ok(saveNodes.front);
  assert.ok(saveNodes.right);
  const saveFront = prompt[saveNodes.front];
  assert.equal(saveFront.class_type, 'SaveImage');
  const joinFront = prompt[String(saveFront.inputs.images[0])];
  assert.equal(joinFront.class_type, 'JoinImageWithAlpha');
  const invFront = prompt[String(joinFront.inputs.alpha[0])];
  assert.equal(invFront.class_type, 'InvertMask');
});

test('buildTrellis2MultiviewPrompt wires GGUF MultiView with RGBA inputs and heun 1024_cascade', () => {
  const { prompt, exportNodeId } = buildTrellis2MultiviewPrompt({
    views: { front: 'front_rgba.png', right: 'side_rgba.png' },
    prefix: 'ck_mv',
    steps: 14,
    sampler: 'heun',
  });
  assert.equal(prompt['1'].class_type, 'Trellis2LoadModel_GGUF');
  assert.equal(prompt['1'].inputs.model_format, 'GGUF Q4_K_M');
  assert.equal(prompt['2'].class_type, 'Trellis2LoadImageWithTransparency_GGUF');
  assert.equal(prompt['3'].class_type, 'Trellis2PreProcessImage_GGUF');
  assert.equal(prompt['3'].inputs.padding, 0);
  assert.equal(prompt['3'].inputs.remove_background, false);
  assert.deepEqual(prompt['3'].inputs.image, ['2', 2]);
  assert.equal(prompt['21'].class_type, 'Trellis2MeshWithVoxelMultiViewGenerator_GGUF');
  assert.equal(prompt['21'].inputs.pipeline_type, '1024_cascade');
  assert.equal(prompt['21'].inputs.shape_sampler, 'heun');
  assert.equal(prompt['21'].inputs.max_num_tokens, 32768);
  assert.ok(prompt['21'].inputs.right_image);
  assert.equal(prompt[exportNodeId].class_type, 'Trellis2ExportMesh_GGUF');
  assert.equal(prompt[exportNodeId].inputs.filename_prefix, 'ck_mv');
});

test('buildUltratexPrompt applies runtime VRAM caps and attaches negative UTXTextEncode when unlinked', () => {
  const workflow = {
    nodes: [
      { id: 0, type: 'CLIPLoader', widgets_values: ['qwen_3_8b_fp8mixed.safetensors', 'flux2', 'default'] },
      { id: 1, type: 'UnetLoaderGGUF', widgets_values: ['flux-2-klein-base-9b-Q4_0.gguf'] },
      { id: 2, type: 'UTXTextEncode', inputs: [{ name: 'clip', type: 'CLIP', link: 11 }], widgets_values: ['pos'] },
      { id: 3, type: 'Load3DAdvanced', widgets_values: ['3d/in.glb', 1024, 1024] },
      { id: 4, type: 'LoadImage', widgets_values: ['ref.png', 'image'] },
      { id: 8, type: 'UTXConfigureRuntime', widgets_values: ['', 256, 16, 2048, 768, 4096, 12, 512, 64, 'adaptive', 0, false] },
      { id: 44, type: 'UTXUnwrapMeshUVV25', widgets_values: [4096, 'comfy_gpu', 4] },
      { id: 45, type: 'UTXPrepareTextureV25', widgets_values: ['front', 'background', 'auto_smooth', 1024, 'native_mesh_fit', 2, 8, 1] },
      { id: 9, type: 'UTXGenerateTextureViewsV23', inputs: [{ name: 'positive', type: 'CONDITIONING', link: 10 }], widgets_values: ['ultratex_flux2.safetensors', 1, 'ultratex_flux2_decoder.pt', 'albedo', 1024, 10, 0, 6, 4, 1, 0.2, 'guided', 0.55, 4, true] },
      { id: 48, type: 'UTXFastSurfaceTextureBaker', widgets_values: [2048, 'surface_fill', 'fast_detail', 'auto'] },
    ],
    links: [[10, 2, 0, 9, 0, 'CONDITIONING'], [11, 0, 0, 2, 0, 'CLIP']],
  };
  const { prompt } = buildUltratexPrompt(workflow, {
    quality: 'high',
    maxVramMb: 3584,
    tokenChunk: 2048,
    performanceMode: 'conservative',
    negativePrompt: 'black back of head',
  });
  assert.equal(prompt['8'].inputs.max_vram_mb, 3584);
  assert.equal(prompt['8'].inputs.token_chunk, 2048);
  assert.equal(prompt['8'].inputs.performance_mode, 'conservative');
  const negId = String(prompt['9'].inputs.negative[0]);
  assert.equal(prompt[negId].class_type, 'UTXTextEncode');
  assert.equal(prompt[negId].inputs.text, 'black back of head');
});

test('buildBlenderRemeshBakeArgs and buildBlenderAssemblePbrArgs construct clean CLI args', () => {
  const rbArgs = buildBlenderRemeshBakeArgs('in.glb', 'out.glb', {
    'target-quads': 4400,
    'smooth-head-z': 1.12,
    'clean-uv-out': 'clean.glb',
    'flip-v': true,
  });
  assert.equal(rbArgs[0], 'remesh-bake');
  assert.ok(rbArgs.includes('4400'));
  assert.ok(rbArgs.includes('1.12'));
  assert.ok(rbArgs.some((a) => a.endsWith('clean.glb')));

  const asmArgs = buildBlenderAssemblePbrArgs('uv.glb', 'final.glb', {
    'base-color': 'bc.png',
    roughness: 'rg.png',
    metallic: 'mt.png',
    normal: 'nm.png',
    'flip-v': true,
  });
  assert.equal(asmArgs[0], 'assemble-pbr');
  assert.ok(asmArgs.includes('--flip-v'));
});

test('buildTrellis2FastSinglePrompt wires 12GB low-VRAM single-view GGUF with euler and bounded tokens', () => {
  const { prompt, exportNodeId } = buildTrellis2FastSinglePrompt({
    inputImageName: 'front.png',
    prefix: 'ck_fast',
  });
  assert.equal(prompt['1'].class_type, 'Trellis2LoadModel_GGUF');
  assert.equal(prompt['1'].inputs.model_format, 'GGUF Q4_K_M');
  assert.equal(prompt['1'].inputs.low_vram, true);
  assert.equal(prompt['2'].class_type, 'LoadImage');
  assert.equal(prompt['3'].inputs.remove_background, true);
  assert.equal(prompt['3'].inputs.padding, 10);
  assert.equal(prompt['4'].inputs.pipeline_type, '1024_cascade');
  assert.equal(prompt['4'].inputs.shape_sampler, 'euler');
  assert.equal(prompt['4'].inputs.texture_sampler, 'euler');
  assert.equal(prompt['4'].inputs.max_num_tokens, 20480);
  assert.equal(prompt['4'].inputs.texture_guidance_strength, 3.0);
  assert.equal(prompt['5'].inputs.texture_size, 2048);
  assert.deepEqual(prompt['5'].inputs.bvh, ['4', 1]);
  assert.equal(prompt[exportNodeId].class_type, 'Trellis2ExportMesh_GGUF');
  assert.equal(prompt[exportNodeId].inputs.filename_prefix, 'ck_fast');
});

test('resolveLowPolyPreset enforces unified T5 (<=7500 verts / <=6000 tris) and complex ceiling (<=10000 / <=8000) with LOD1/LOD2/LOD3', () => {
  assert.equal(CHARACTER_POLY_PRESETS.low.maxVertices, 7500);
  assert.equal(CHARACTER_POLY_PRESETS.low.maxTris, 6000);
  assert.equal(CHARACTER_POLY_PRESETS.complex.maxVertices, 10000);
  assert.equal(CHARACTER_POLY_PRESETS.complex.maxTris, 8000);
  assert.equal(resolveLowPolyPreset('t5').targetQuads, 2800);
  assert.equal(resolveLowPolyPreset('low').targetQuads, 2800);
  assert.equal(resolveLowPolyPreset('general').targetQuads, 2800);
  assert.equal(resolveLowPolyPreset('npc').targetQuads, 2800);
  assert.equal(resolveLowPolyPreset('complex').name, 'complex');
  assert.equal(resolveLowPolyPreset('player').targetQuads, 3800);

  const lowArgs = buildBlenderRemeshBakeArgs('in.glb', 'char.glb', { preset: 'low' });
  assert.equal(lowArgs[lowArgs.indexOf('--target-quads') + 1], '2800');
  assert.equal(lowArgs[lowArgs.indexOf('--lod1-tris') + 1], '2400');
  assert.equal(lowArgs[lowArgs.indexOf('--lod2-tris') + 1], '1200');
  assert.equal(lowArgs.includes('--lod3-tight'), false);
  assert.equal(lowArgs[lowArgs.indexOf('--texture-size') + 1], '1024');
});

test('buildBlenderRemeshBakeArgs forwards --rig-run and buildBlenderRigRunArgs targets Run clip', () => {
  const bakeRigArgs = buildBlenderRemeshBakeArgs('high.glb', 'low.glb', { preset: 'low', 'rig-run': true });
  assert.ok(bakeRigArgs.includes('--rig-run'));
  assert.equal(bakeRigArgs[bakeRigArgs.indexOf('--rig-engine') + 1], 'auto');

  const bakeNativeArgs = buildBlenderRemeshBakeArgs('high.glb', 'low.glb', {
    preset: 'low',
    'rig-run': true,
    'rig-engine': 'native',
  });
  assert.equal(bakeNativeArgs[bakeNativeArgs.indexOf('--rig-engine') + 1], 'native');

  const bakeNoRigArgs = buildBlenderRemeshBakeArgs('high.glb', 'low.glb', { preset: 'low' });
  assert.equal(bakeNoRigArgs.includes('--rig-run'), false);
  assert.equal(bakeNoRigArgs.includes('--rig-engine'), false);

  const rigArgs = buildBlenderRigRunArgs('low.glb', 'low_run.glb', { 'qa-dir': 'qa_out', size: 512 });
  assert.equal(rigArgs[0], 'rig-run');
  assert.equal(rigArgs[rigArgs.indexOf('--action-name') + 1], 'Run');
  assert.equal(rigArgs[rigArgs.indexOf('--rig-engine') + 1], 'auto');
  assert.equal(rigArgs[rigArgs.indexOf('--lod1-tris') + 1], '2400');
  assert.equal(rigArgs[rigArgs.indexOf('--lod2-tris') + 1], '1200');
  assert.equal(rigArgs.includes('--lod3-tight'), false);
  assert.ok(rigArgs.includes('--qa-dir'));
  assert.equal(rigArgs[rigArgs.indexOf('--size') + 1], '512');

  const rigOptOutArgs = buildBlenderRigRunArgs('low.glb', 'low_run.glb', {
    'no-lod1': true,
    'no-lod2': true,
    'no-lod3': true,
    'rig-engine': 'native',
  });
  assert.equal(rigOptOutArgs[rigOptOutArgs.indexOf('--rig-engine') + 1], 'native');
  assert.equal(rigOptOutArgs.includes('--lod1-tris'), false);
  assert.equal(rigOptOutArgs.includes('--lod2-tris'), false);
  assert.equal(rigOptOutArgs.includes('--lod3-tight'), false);

  const rigLaunch = buildBlenderLaunchArgs(['rig-run', '--input', 'a.glb']);
  assert.equal(rigLaunch.includes('--factory-startup'), false);
  const remeshLaunch = buildBlenderLaunchArgs(['remesh-bake', '--input', 'a.glb']);
  assert.equal(remeshLaunch.includes('--factory-startup'), false);
  const inspectLaunch = buildBlenderLaunchArgs(['inspect', '--input', 'a.glb']);
  assert.ok(inspectLaunch.includes('--factory-startup'));

  const rigWebArgs = parseProcessModel3dArgs([
    'rig-run',
    '--from-webasset',
    '--character-id', 'dafeiyu',
    '--upload',
  ]);
  assert.equal(rigWebArgs.command, 'rig-run');
  assert.equal(rigWebArgs.flags['from-webasset'], true);
  assert.equal(rigWebArgs.flags['character-id'], 'dafeiyu');
  assert.equal(rigWebArgs.flags.upload, true);
});

test('resolveModel3dConfig resolves optional runAnimGlb without hardcoded paths', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hgame-m3d-runanim-'));
  try {
    fs.writeFileSync(path.join(dir, '.hgame.local.json'), JSON.stringify({
      model3d: {
        rootDir: path.join(dir, 'm3d'),
        runAnimGlb: 'anims/run_fwd.glb',
      },
    }), 'utf8');
    const cfg = resolveModel3dConfig(dir);
    assert.equal(cfg.runAnimGlb, path.join(dir, 'm3d', 'anims', 'run_fwd.glb'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('buildBlenderNormalizeArgs forwards topology repair and whisker pruning flags cleanly', () => {
  const args = buildBlenderNormalizeArgs('high.glb', 'low.glb', {
    'target-faces': 4000,
    'prune-whiskers': true,
    'keep-largest-island': true,
  });
  assert.equal(args[0], 'normalize');
  assert.ok(args.includes('--prune-whiskers'));
  assert.ok(args.includes('--keep-largest-island'));
  assert.equal(args.includes('--no-repair'), false);

  const rawArgs = buildBlenderNormalizeArgs('high.glb', 'raw.glb', { 'no-repair': true });
  assert.ok(rawArgs.includes('--no-repair'));
});

test('assertCleanTopology enforces watertight zero-debris gate, 16-bit 65535 cap, and T5 buildCharacterPackPlans flow', () => {
  const cleanStats = {
    vertices: 5400,
    triangles: 4800,
    topologyAudit: {
      looseVerts: 0,
      looseEdges: 0,
      boundaryEdges: 0,
      nonManifoldEdges: 0,
      zeroAreaFaces: 0,
      spatialIslands: 1,
      tinyIslands: 0,
    },
  };
  assert.equal(assertCleanTopology(cleanStats, 'clean_low', 7500, 6000), true);

  assert.throws(
    () => assertCleanTopology({ ...cleanStats, vertices: 7600 }, 'clean_low', 7500, 6000),
    /vertices=7600 > budget 7500/
  );
  assert.throws(
    () => assertCleanTopology({ ...cleanStats, triangles: 6200 }, 'clean_low', 7500, 6000),
    /triangles=6200 > budget 6000/
  );
  assert.throws(
    () => assertCleanTopology({ ...cleanStats, vertices: 70000 }, 'clean_high'),
    /vertices=70000 > budget 65535/
  );
  assert.throws(
    () => assertCleanTopology({
      vertices: 1000,
      topologyAudit: { ...cleanStats.topologyAudit, looseEdges: 2, spatialIslands: 4 },
    }, 'dirty_low'),
    /looseEdges=2, spatialIslands=4/
  );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hgame-charpack-'));
  try {
    const plans = buildCharacterPackPlans(path.join(tmpDir, 'raw_high.glb'), tmpDir, {
      'character-id': 'chouju',
      'qa-dir': path.join(tmpDir, 'qa'),
    });
    assert.ok(plans.highArgs.includes('remesh-bake'));
    assert.equal(plans.highArgs[plans.highArgs.indexOf('--target-quads') + 1], '16000');
    assert.equal(plans.highArgs[plans.highArgs.indexOf('--uv-solver') + 1], 'smart');
    assert.equal(plans.lowArgs[plans.lowArgs.indexOf('--target-quads') + 1], '2800');
    assert.equal(plans.lowArgs[plans.lowArgs.indexOf('--lod1-tris') + 1], '2400');
    assert.equal(plans.lowArgs[plans.lowArgs.indexOf('--lod2-tris') + 1], '1200');
    assert.equal(plans.lowArgs.includes('--lod3-tight'), false);
    assert.ok(plans.lowArgs.includes('--rig-run'));
    assert.ok(plans.lowArgs.some((a) => a.endsWith('low')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
