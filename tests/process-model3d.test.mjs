import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  assertAsciiPath,
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
  assert.equal(assertAsciiPath('D:/Tools/model3d/duck_v2.glb', 'Model'), 'D:/Tools/model3d/duck_v2.glb');
  assert.throws(() => assertAsciiPath('D:/Tools/模型/duck.glb', 'Model'), /non-ASCII/);
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
