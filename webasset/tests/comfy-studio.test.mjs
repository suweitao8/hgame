import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWebAssetServer } from '../server.mjs';
import {
  buildFluxImagePrompt,
  buildMiniMaxH3VideoPrompt,
  buildQwenImage21Prompt,
  buildSdxlRealisticImagePrompt,
  buildZImageTurboPrompt,
  resolveStudioDimensions,
  snapH3Frames,
  translatePromptToEnglish,
} from '../lib/comfy-studio-server.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl+6gAAAABJRU5ErkJggg==', 'base64');
const fakeMp4 = Buffer.from('00000018667479706d703432000000006d70343269736f6d', 'hex');

test('snapH3Frames snaps durations to ComfyUI 17k+5 frame grid', () => {
  assert.equal(snapH3Frames(3), 73); // 72 -> 73 (17*4 + 5)
  assert.equal(snapH3Frames(5), 124); // 120 -> 124 (17*7 + 5)
  assert.equal(snapH3Frames(8), 192); // 192 = 17*11 + 5
  assert.equal(snapH3Frames(10), 243); // 240 -> 243 (17*14 + 5)
  assert.equal(snapH3Frames(0.1), 5);
});

test('resolveStudioDimensions computes 32-aligned sizes from resolution tier and aspect ratio', () => {
  assert.deepEqual(resolveStudioDimensions('1080p', '16:9'), { width: 1920, height: 1088 });
  assert.deepEqual(resolveStudioDimensions('1080p', '4:3'), { width: 1440, height: 1088 });
  assert.deepEqual(resolveStudioDimensions('1080p', '1:1'), { width: 1088, height: 1088 });
  assert.deepEqual(resolveStudioDimensions('1080p', '3:4'), { width: 1088, height: 1440 });
  assert.deepEqual(resolveStudioDimensions('1080p', '9:16'), { width: 1088, height: 1920 });
  assert.deepEqual(resolveStudioDimensions('720p', '16:9'), { width: 1280, height: 736 });
  assert.deepEqual(resolveStudioDimensions('720p', '4:3'), { width: 960, height: 736 });
  assert.deepEqual(resolveStudioDimensions('480p', '16:9'), { width: 864, height: 480 });
});

test('translatePromptToEnglish falls back to secondary provider when Google fails', async () => {
  const translated = await translatePromptToEnglish('蓝色泳装美女', async (url) => {
    if (String(url).includes('translate.googleapis.com')) {
      throw new Error('timeout');
    }
    return new Response(JSON.stringify({ responseData: { translatedText: 'A beauty in blue swimsuit' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  assert.equal(translated, 'A beauty in blue swimsuit');
});

test('prompt builders match ComfyUI FLUX and MiniMax H3 schemas', () => {
  const flux = buildFluxImagePrompt({
    ckptName: 'flux1-schnell-fp8.safetensors',
    prompt: 'a lantern',
    width: 1024,
    height: 1024,
    steps: 4,
    seed: 42,
  });
  assert.equal(flux['1'].class_type, 'CheckpointLoaderSimple');
  assert.equal(flux['3'].class_type, 'ConditioningZeroOut');
  assert.deepEqual(flux['3'].inputs.conditioning, ['2', 0]);
  assert.equal(flux['5'].inputs.seed, 42);
  assert.equal(flux['5'].inputs.cfg, 1.0);

  const qwen21 = buildQwenImage21Prompt({
    unetName: 'qwen_image_2.1_turbo_int8_convrot.safetensors',
    clipName: 'qwen3vl_8b_w4a8.safetensors',
    vaeName: 'qwen_image_2.1_vae_bf16.safetensors',
    prompt: '一个蓝色泳装比基尼的美女',
    width: 1024,
    height: 1024,
    steps: 8,
    seed: 99,
  });
  assert.equal(qwen21['1'].class_type, 'UNETLoader');
  assert.equal(qwen21['2'].class_type, 'QwenImage21Cache');
  assert.equal(qwen21['3'].inputs.type, 'qwen_image');
  assert.equal(qwen21['5'].class_type, 'TextEncodeQwenImage21');
  assert.equal(qwen21['5'].inputs.prompt, '一个蓝色泳装比基尼的美女');
  assert.equal(qwen21['7'].inputs.steps, 8);
  assert.equal(qwen21['7'].inputs.cfg, 1.0);

  const t2v = buildMiniMaxH3VideoPrompt({
    unetName: 'minimax_h3_fl2va_pruned_fp8_scaled.safetensors',
    clipName: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
    videoVaeName: 'minimax_h3_video_vae_fp16.safetensors',
    audioVaeName: 'minimax_h3_audio_vae_fp32.safetensors',
    prompt: 'wind blowing',
    duration: 3,
    seed: 7,
  });
  assert.equal(t2v['5'].class_type, 'MiniMaxH3ImageToVideo');
  assert.equal(t2v['5'].inputs.first_frame, undefined);
  assert.equal(t2v['15'], undefined);
  assert.equal(t2v['5'].inputs.length, 73);

  const i2v = buildMiniMaxH3VideoPrompt({
    unetName: 'minimax_h3_fl2va_pruned_fp8_scaled.safetensors',
    clipName: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
    videoVaeName: 'minimax_h3_video_vae_fp16.safetensors',
    audioVaeName: 'minimax_h3_audio_vae_fp32.safetensors',
    prompt: 'camera orbit',
    duration: 5,
    seed: 8,
    uploadedImageName: 'ref.png',
  });
  assert.deepEqual(i2v['5'].inputs.first_frame, ['15', 0]);
  assert.equal(i2v['15'].class_type, 'LoadImage');
  assert.equal(i2v['15'].inputs.image, 'ref.png');
  assert.equal(i2v['5'].inputs.length, 124);

  const turbo = buildMiniMaxH3VideoPrompt({
    unetName: 'minimax_h3_fl2va_int8_convrot.safetensors',
    clipName: 'qwen3vl_32b_h3_ultra_uncensored_heretic_int8_convrot.safetensors',
    videoVaeName: 'minimax_h3_video_vae_fp16.safetensors',
    audioVaeName: 'minimax_h3_audio_vae_fp32.safetensors',
    prompt: 'neon street',
    duration: 3,
    seed: 9,
    loraName: 'minimax_h3_turbo_v4_step600_comfyui_T8-convert.safetensors',
  });
  assert.equal(turbo['16'].class_type, 'LoraLoaderModelOnly');
  assert.deepEqual(turbo['16'].inputs.model, ['1', 0]);
  assert.equal(turbo['16'].inputs.lora_name, 'minimax_h3_turbo_v4_step600_comfyui_T8-convert.safetensors');
  assert.deepEqual(turbo['7'].inputs.model, ['16', 0]);
  assert.deepEqual(turbo['9'].inputs.model, ['16', 0]);
  assert.equal(turbo['8'].inputs.sampler_name, 'euler');
  assert.equal(turbo['9'].inputs.scheduler, 'beta');
  assert.equal(turbo['9'].inputs.steps, 8);

  const sdxl = buildSdxlRealisticImagePrompt({
    ckptName: 'RealVisXL_V5.0_Lightning_fp16.safetensors',
    prompt: 'photorealistic beach portrait at sunset',
    width: 896,
    height: 1152,
    seed: 123,
  });
  assert.equal(sdxl['1'].class_type, 'CheckpointLoaderSimple');
  assert.equal(sdxl['1'].inputs.ckpt_name, 'RealVisXL_V5.0_Lightning_fp16.safetensors');
  assert.equal(sdxl['2'].class_type, 'CLIPTextEncode');
  assert.equal(sdxl['3'].class_type, 'CLIPTextEncode');
  assert.match(sdxl['3'].inputs.text, /bad anatomy/);
  assert.equal(sdxl['4'].class_type, 'EmptyLatentImage');
  assert.equal(sdxl['5'].inputs.sampler_name, 'dpmpp_sde');
  assert.equal(sdxl['5'].inputs.scheduler, 'karras');
  assert.equal(sdxl['5'].inputs.steps, 6);
  assert.equal(sdxl['5'].inputs.cfg, 1.8);

  const zimg = buildZImageTurboPrompt({
    unetName: 'z_image_turbo_bf16.safetensors',
    clipName: 'qwen_3_4b.safetensors',
    vaeName: 'ae.safetensors',
    prompt: '海边夕阳下的写实人像摄影',
    width: 1024,
    height: 1024,
    seed: 321,
  });
  assert.equal(zimg['1'].class_type, 'UNETLoader');
  assert.equal(zimg['2'].class_type, 'ModelSamplingAuraFlow');
  assert.equal(zimg['2'].inputs.shift, 3.0);
  assert.equal(zimg['3'].class_type, 'CLIPLoader');
  assert.equal(zimg['3'].inputs.type, 'lumina2');
  assert.equal(zimg['5'].inputs.text, '海边夕阳下的写实人像摄影');
  assert.equal(zimg['6'].class_type, 'ConditioningZeroOut');
  assert.equal(zimg['8'].inputs.sampler_name, 'res_multistep');
  assert.equal(zimg['8'].inputs.scheduler, 'simple');
  assert.equal(zimg['8'].inputs.steps, 9);
  assert.equal(zimg['8'].inputs.cfg, 1.0);
});

test('WebAsset studio API connects to ComfyUI, generates image + video, and serves outputs', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'webasset-comfy-studio-'));

  const submittedPrompts = [];
  let uploadedCount = 0;
  let promptCounter = 0;

  const mockComfy = createServer(async (req, res) => {
    const u = new URL(req.url || '/', 'http://127.0.0.1');
    if (u.pathname === '/object_info/CheckpointLoaderSimple') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        CheckpointLoaderSimple: { input: { required: { ckpt_name: [['flux1-schnell-fp8.safetensors']] } } },
      }));
      return;
    }
    if (u.pathname === '/object_info/UNETLoader') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        UNETLoader: { input: { required: { unet_name: [['minimax_h3_fl2va_pruned_fp8_scaled.safetensors']] } } },
      }));
      return;
    }
    if (u.pathname === '/object_info/CLIPLoader') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        CLIPLoader: { input: { required: { clip_name: [['qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors']] } } },
      }));
      return;
    }
    if (u.pathname === '/object_info/VAELoader') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        VAELoader: { input: { required: { vae_name: [['minimax_h3_audio_vae_fp32.safetensors', 'minimax_h3_video_vae_fp16.safetensors']] } } },
      }));
      return;
    }
    if (u.pathname === '/upload/image' && req.method === 'POST') {
      for await (const _chunk of req) { /* drain */ }
      uploadedCount += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ name: `uploaded-${uploadedCount}.png`, subfolder: '', type: 'input' }));
      return;
    }
    if (u.pathname === '/prompt' && req.method === 'POST') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      promptCounter += 1;
      const promptId = `pid-${promptCounter}`;
      submittedPrompts.push({ promptId, graph: parsed.prompt });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ prompt_id: promptId }));
      return;
    }
    if (u.pathname.startsWith('/history/')) {
      const promptId = u.pathname.slice('/history/'.length);
      const isVideo = promptId !== 'pid-1';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        [promptId]: {
          status: { status_str: 'success' },
          outputs: isVideo
            ? { '14': { images: [{ filename: `${promptId}.mp4`, subfolder: 'video', type: 'output' }] } }
            : { '7': { images: [{ filename: `${promptId}.png`, subfolder: '', type: 'output' }] } },
        },
      }));
      return;
    }
    if (u.pathname === '/view') {
      const filename = u.searchParams.get('filename') || '';
      const isMp4 = filename.endsWith('.mp4');
      res.writeHead(200, { 'Content-Type': isMp4 ? 'video/mp4' : 'image/png' });
      res.end(isMp4 ? fakeMp4 : tinyPng);
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise((resolve) => mockComfy.listen(0, '127.0.0.1', resolve));
  const comfyUrl = `http://127.0.0.1:${mockComfy.address().port}`;

  const server = createWebAssetServer({
    siteRoot: root,
    imageRoot: path.join(dir, 'assets'),
    characterCatalog: path.join(dir, 'assets', 'characters', 'index.json'),
    gamesRoot: path.join(dir, 'games'),
    comfyStudioCacheDir: path.join(dir, 'comfy-cache'),
    comfyFetch: async (targetUrl, init) => {
      if (String(targetUrl).startsWith('https://translate.googleapis.com/')) {
        return new Response(JSON.stringify([[['a glowing forest', '发光的森林']]]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return fetch(targetUrl, init);
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {

  // 1) HTML exposes studio tab without manual connect UI, and includes prompt detail container
  const html = await (await fetch(base)).text();
  assert.match(html, /id="nav-studio"/);
  assert.match(html, /data-workspace="studio"/);
  assert.match(html, /id="studio-view"/);
  assert.match(html, /id="studio-img-model"/);
  assert.match(html, /id="studio-img-ratio"/);
  assert.match(html, /id="studio-vid-ratio"/);
  assert.match(html, /id="studio-detail-prompt"/);
  assert.doesNotMatch(html, /id="studio-connect-btn"|id="studio-comfy-url"/);

  // 2) Connect config
  const cfgRes = await fetch(`${base}/api/comfy/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: comfyUrl }),
  });
  const cfgJson = await cfgRes.json();
  assert.equal(cfgJson.connected, true);
  assert.deepEqual(cfgJson.models.checkpoints, ['flux1-schnell-fp8.safetensors']);

  // 3) Image generation (Chinese prompt auto-translated to English for FLUX, original preserved)
  const imgGen = await (await fetch(`${base}/api/comfy/generate/image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '发光的森林', width: 1024, height: 1024 }),
  })).json();
  assert.equal(imgGen.promptId, 'pid-1');
  assert.equal(submittedPrompts[0].graph['2'].inputs.text, 'a glowing forest');

  const midCfg = await (await fetch(`${base}/api/comfy/config`)).json();
  assert.equal(midCfg.pending.length, 1);
  assert.equal(midCfg.pending[0].promptId, 'pid-1');
  assert.equal(midCfg.pending[0].prompt, '发光的森林');

  const imgJob = await (await fetch(`${base}/api/comfy/jobs/pid-1`)).json();
  assert.equal(imgJob.status, 'done');
  assert.equal(imgJob.item.kind, 'image');
  assert.equal(imgJob.item.prompt, '发光的森林');
  assert.equal(imgJob.item.effectivePrompt, 'a glowing forest');
  assert.equal(typeof imgJob.item.durationMs, 'number');
  assert.ok(imgJob.item.durationMs >= 0);
  const imgFileRes = await fetch(`${base}${imgJob.item.url}`);
  assert.equal(imgFileRes.status, 200);
  assert.deepEqual(Buffer.from(await imgFileRes.arrayBuffer()), tinyPng);

  // 4) Video T2V
  const vidT2V = await (await fetch(`${base}/api/comfy/generate/video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'ocean waves', duration: 3 }),
  })).json();
  assert.equal(vidT2V.promptId, 'pid-2');
  assert.equal(submittedPrompts[1].graph['5'].inputs.first_frame, undefined);

  const t2vJob = await (await fetch(`${base}/api/comfy/jobs/pid-2`)).json();
  assert.equal(t2vJob.status, 'done');
  assert.equal(t2vJob.item.kind, 'video');

  // 5) Video I2V reusing generated image via localAssetId
  const vidI2V = await (await fetch(`${base}/api/comfy/generate/video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'camera zoom', duration: 5, localAssetId: imgJob.item.id }),
  })).json();
  assert.equal(vidI2V.promptId, 'pid-3');
  assert.equal(uploadedCount, 1);
  assert.deepEqual(submittedPrompts[2].graph['5'].inputs.first_frame, ['15', 0]);

  const i2vJob = await (await fetch(`${base}/api/comfy/jobs/pid-3`)).json();
  assert.equal(i2vJob.status, 'done');
  assert.equal(i2vJob.item.kind, 'video');

  // 6) Config GET returns persisted history
  const finalCfg = await (await fetch(`${base}/api/comfy/config`)).json();
  assert.equal(finalCfg.url, comfyUrl);
  assert.equal(finalCfg.items.length, 3);
  assert.equal(typeof finalCfg.items[0].durationMs, 'number');
  } finally {
    server.closeAllConnections?.();
    mockComfy.closeAllConnections?.();
    await Promise.all([
      new Promise((resolve) => server.close(resolve)),
      new Promise((resolve) => mockComfy.close(resolve)),
    ]);
    await rm(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('WebAsset studio prefers Qwen-Image-2.1-Turbo with raw Chinese prompt when available', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'webasset-comfy-qwen21-'));
  let capturedPrompt = null;

  const mockComfy = createServer(async (req, res) => {
    const u = new URL(req.url || '/', 'http://127.0.0.1');
    if (u.pathname === '/object_info/CheckpointLoaderSimple') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [['flux1-schnell-fp8.safetensors']] } } } }));
      return;
    }
    if (u.pathname === '/object_info/UNETLoader') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ UNETLoader: { input: { required: { unet_name: [['minimax_h3_fl2va_pruned_fp8_scaled.safetensors', 'qwen_image_2.1_turbo_int8_convrot.safetensors']] } } } }));
      return;
    }
    if (u.pathname === '/object_info/CLIPLoader') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ CLIPLoader: { input: { required: { clip_name: [['qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors', 'qwen3vl_8b_w4a8.safetensors']] } } } }));
      return;
    }
    if (u.pathname === '/object_info/VAELoader') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ VAELoader: { input: { required: { vae_name: [['qwen_image_2.1_vae_bf16.safetensors']] } } } }));
      return;
    }
    if (u.pathname === '/object_info/CLIPLoaderGGUF') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ CLIPLoaderGGUF: { input: { required: { clip_name: [['Qwen-Image-2.1-Turbo-Uncensored-AD-Q6_K.gguf']] } } } }));
      return;
    }
    if (u.pathname === '/prompt' && req.method === 'POST') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      capturedPrompt = JSON.parse(Buffer.concat(chunks).toString('utf8')).prompt;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ prompt_id: 'qwen-pid-1' }));
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise((resolve) => mockComfy.listen(0, '127.0.0.1', resolve));
  const comfyUrl = `http://127.0.0.1:${mockComfy.address().port}`;
  const server = createWebAssetServer({
    siteRoot: root,
    imageRoot: path.join(dir, 'assets'),
    characterCatalog: path.join(dir, 'assets', 'characters', 'index.json'),
    gamesRoot: path.join(dir, 'games'),
    comfyStudioCacheDir: path.join(dir, 'comfy-cache'),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fetch(`${base}/api/comfy/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: comfyUrl }),
    });
    const res = await (await fetch(`${base}/api/comfy/generate/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '海边夕阳下的蓝发少女', width: 1024, height: 1024 }),
    })).json();
    assert.equal(res.promptId, 'qwen-pid-1');
    assert.equal(res.effectivePrompt, undefined);
    assert.equal(capturedPrompt['5'].class_type, 'TextEncodeQwenImage21');
    assert.equal(capturedPrompt['5'].inputs.prompt, '海边夕阳下的蓝发少女');
    assert.equal(capturedPrompt['1'].inputs.unet_name, 'qwen_image_2.1_turbo_int8_convrot.safetensors');
    assert.equal(capturedPrompt['3'].class_type, 'CLIPLoader');
    assert.equal(capturedPrompt['3'].inputs.clip_name, 'qwen3vl_8b_w4a8.safetensors');
  } finally {
    server.closeAllConnections?.();
    mockComfy.closeAllConnections?.();
    await Promise.all([
      new Promise((resolve) => server.close(resolve)),
      new Promise((resolve) => mockComfy.close(resolve)),
    ]);
    await rm(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('WebAsset studio skips generation_tail, prefers Heretic encoder, and gates Turbo LoRA on unpruned UNet', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'webasset-comfy-heretic-'));
  const submitted = [];
  let unetsAvailable = ['minimax_h3_fl2va_pruned_fp8_scaled.safetensors', 'minimax_h3_fl2va_int8_convrot.safetensors'];

  const mockComfy = createServer(async (req, res) => {
    const u = new URL(req.url || '/', 'http://127.0.0.1');
    if (u.pathname === '/object_info/CheckpointLoaderSimple') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [[]] } } } }));
      return;
    }
    if (u.pathname === '/object_info/UNETLoader') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ UNETLoader: { input: { required: { unet_name: [unetsAvailable] } } } }));
      return;
    }
    if (u.pathname === '/object_info/CLIPLoader') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        CLIPLoader: {
          input: {
            required: {
              clip_name: [[
                'qwen3vl_32b_h3_generation_tail_50_63_int8_convrot.safetensors',
                'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
                'qwen3vl_32b_h3_ultra_uncensored_heretic_int8_convrot.safetensors',
              ]],
            },
          },
        },
      }));
      return;
    }
    if (u.pathname === '/object_info/VAELoader') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        VAELoader: { input: { required: { vae_name: [['minimax_h3_video_vae_fp16.safetensors', 'minimax_h3_audio_vae_fp32.safetensors']] } } },
      }));
      return;
    }
    if (u.pathname === '/object_info/LoraLoaderModelOnly') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        LoraLoaderModelOnly: { input: { required: { lora_name: [['minimax_h3_turbo_v4_step600_comfyui_T8-convert.safetensors']] } } },
      }));
      return;
    }
    if (u.pathname === '/prompt' && req.method === 'POST') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      submitted.push(JSON.parse(Buffer.concat(chunks).toString('utf8')).prompt);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ prompt_id: `heretic-${submitted.length}` }));
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise((resolve) => mockComfy.listen(0, '127.0.0.1', resolve));
  const comfyUrl = `http://127.0.0.1:${mockComfy.address().port}`;
  const server = createWebAssetServer({
    siteRoot: root,
    imageRoot: path.join(dir, 'assets'),
    characterCatalog: path.join(dir, 'assets', 'characters', 'index.json'),
    gamesRoot: path.join(dir, 'games'),
    comfyStudioCacheDir: path.join(dir, 'comfy-cache'),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fetch(`${base}/api/comfy/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: comfyUrl }),
    });

    // 1) Unpruned UNet present -> selects Heretic clip (not generation_tail, not nvfp4_awq) + unpruned UNet + Turbo LoRA
    await fetch(`${base}/api/comfy/generate/video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'cyberpunk rain', duration: 3 }),
    });
    const g1 = submitted[0];
    assert.equal(g1['1'].inputs.unet_name, 'minimax_h3_fl2va_int8_convrot.safetensors');
    assert.equal(g1['2'].inputs.clip_name, 'qwen3vl_32b_h3_ultra_uncensored_heretic_int8_convrot.safetensors');
    assert.equal(g1['16'].class_type, 'LoraLoaderModelOnly');
    assert.equal(g1['16'].inputs.lora_name, 'minimax_h3_turbo_v4_step600_comfyui_T8-convert.safetensors');
    assert.equal(g1['8'].inputs.sampler_name, 'euler');
    assert.equal(g1['9'].inputs.scheduler, 'beta');
    assert.equal(g1['9'].inputs.steps, 8);

    // 2) Only pruned UNet present -> skips Turbo LoRA, keeps Heretic clip
    unetsAvailable = ['minimax_h3_fl2va_pruned_fp8_scaled.safetensors'];
    await fetch(`${base}/api/comfy/generate/video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'calm ocean', duration: 3 }),
    });
    const g2 = submitted[1];
    assert.equal(g2['1'].inputs.unet_name, 'minimax_h3_fl2va_pruned_fp8_scaled.safetensors');
    assert.equal(g2['2'].inputs.clip_name, 'qwen3vl_32b_h3_ultra_uncensored_heretic_int8_convrot.safetensors');
    assert.equal(g2['16'], undefined);
    assert.equal(g2['8'].inputs.sampler_name, 'res_multistep');
    assert.equal(g2['9'].inputs.scheduler, 'simple');
    assert.equal(g2['9'].inputs.steps, 20);
  } finally {
    server.closeAllConnections?.();
    mockComfy.closeAllConnections?.();
    await Promise.all([
      new Promise((resolve) => server.close(resolve)),
      new Promise((resolve) => mockComfy.close(resolve)),
    ]);
    await rm(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('WebAsset studio prefers realistic SDXL checkpoint with English translation and Lightning sampler when present', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'webasset-comfy-realvis-'));
  const submitted = [];

  const mockComfy = createServer(async (req, res) => {
    const u = new URL(req.url || '/', 'http://127.0.0.1');
    if (u.pathname === '/object_info/CheckpointLoaderSimple') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [['RealVisXL_V5.0_Lightning_fp16.safetensors']] } } } }));
      return;
    }
    if (u.pathname === '/object_info/UNETLoader') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ UNETLoader: { input: { required: { unet_name: [['qwen_image_2.1_turbo_int8_convrot.safetensors']] } } } }));
      return;
    }
    if (u.pathname === '/object_info/CLIPLoader') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ CLIPLoader: { input: { required: { clip_name: [['qwen3vl_8b_w4a8.safetensors']] } } } }));
      return;
    }
    if (u.pathname === '/object_info/VAELoader') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ VAELoader: { input: { required: { vae_name: [['qwen_image_2.1_vae_bf16.safetensors']] } } } }));
      return;
    }
    if (u.pathname === '/prompt' && req.method === 'POST') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      submitted.push(JSON.parse(Buffer.concat(chunks).toString('utf8')).prompt);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ prompt_id: `realvis-pid-${submitted.length}` }));
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise((resolve) => mockComfy.listen(0, '127.0.0.1', resolve));
  const comfyUrl = `http://127.0.0.1:${mockComfy.address().port}`;
  const server = createWebAssetServer({
    siteRoot: root,
    imageRoot: path.join(dir, 'assets'),
    characterCatalog: path.join(dir, 'assets', 'characters', 'index.json'),
    gamesRoot: path.join(dir, 'games'),
    comfyStudioCacheDir: path.join(dir, 'comfy-cache'),
    comfyFetch: async (targetUrl, init) => {
      if (String(targetUrl).startsWith('https://translate.googleapis.com/')) {
        return new Response(JSON.stringify([[['photorealistic sunset portrait on beach', '海边夕阳下的写实人像']]]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return fetch(targetUrl, init);
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fetch(`${base}/api/comfy/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: comfyUrl }),
    });
    const res1 = await (await fetch(`${base}/api/comfy/generate/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '海边夕阳下的写实人像', width: 896, height: 1152 }),
    })).json();
    assert.equal(res1.promptId, 'realvis-pid-1');
    assert.equal(res1.effectivePrompt, 'photorealistic sunset portrait on beach');
    assert.equal(submitted[0]['1'].inputs.ckpt_name, 'RealVisXL_V5.0_Lightning_fp16.safetensors');
    assert.equal(submitted[0]['5'].inputs.sampler_name, 'dpmpp_sde');
    assert.equal(submitted[0]['5'].inputs.scheduler, 'karras');
    assert.equal(submitted[0]['5'].inputs.steps, 6);
    assert.equal(submitted[0]['5'].inputs.cfg, 1.8);

    const res2 = await (await fetch(`${base}/api/comfy/generate/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '海边夕阳下的写实人像', model: 'qwen', width: 1024, height: 1024 }),
    })).json();
    assert.equal(res2.promptId, 'realvis-pid-2');
    assert.equal(submitted[1]['5'].class_type, 'TextEncodeQwenImage21');
  } finally {
    server.closeAllConnections?.();
    mockComfy.closeAllConnections?.();
    await Promise.all([
      new Promise((resolve) => server.close(resolve)),
      new Promise((resolve) => mockComfy.close(resolve)),
    ]);
    await rm(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('WebAsset studio prefers Z-Image-Turbo with raw Chinese prompt and lumina2 CLIP when available', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'webasset-comfy-zimage-'));
  const submitted = [];

  const mockComfy = createServer(async (req, res) => {
    const u = new URL(req.url || '/', 'http://127.0.0.1');
    if (u.pathname === '/object_info/CheckpointLoaderSimple') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [['RealVisXL_V5.0_Lightning_fp16.safetensors']] } } } }));
      return;
    }
    if (u.pathname === '/object_info/UNETLoader') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ UNETLoader: { input: { required: { unet_name: [['qwen_image_2.1_turbo_int8_convrot.safetensors', 'z_image_turbo_bf16.safetensors']] } } } }));
      return;
    }
    if (u.pathname === '/object_info/CLIPLoader') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ CLIPLoader: { input: { required: { clip_name: [['qwen3vl_8b_w4a8.safetensors', 'qwen_3_4b.safetensors']] } } } }));
      return;
    }
    if (u.pathname === '/object_info/VAELoader') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ VAELoader: { input: { required: { vae_name: [['ae.safetensors', 'qwen_image_2.1_vae_bf16.safetensors']] } } } }));
      return;
    }
    if (u.pathname === '/prompt' && req.method === 'POST') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      submitted.push(JSON.parse(Buffer.concat(chunks).toString('utf8')).prompt);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ prompt_id: `zimg-pid-${submitted.length}` }));
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise((resolve) => mockComfy.listen(0, '127.0.0.1', resolve));
  const comfyUrl = `http://127.0.0.1:${mockComfy.address().port}`;
  const server = createWebAssetServer({
    siteRoot: root,
    imageRoot: path.join(dir, 'assets'),
    characterCatalog: path.join(dir, 'assets', 'characters', 'index.json'),
    gamesRoot: path.join(dir, 'games'),
    comfyStudioCacheDir: path.join(dir, 'comfy-cache'),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fetch(`${base}/api/comfy/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: comfyUrl }),
    });
    const res = await (await fetch(`${base}/api/comfy/generate/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '海边夕阳下的写实人像摄影，自然光影', width: 1024, height: 1024 }),
    })).json();
    assert.equal(res.promptId, 'zimg-pid-1');
    assert.equal(res.effectivePrompt, undefined);
    assert.equal(submitted[0]['1'].inputs.unet_name, 'z_image_turbo_bf16.safetensors');
    assert.equal(submitted[0]['2'].class_type, 'ModelSamplingAuraFlow');
    assert.equal(submitted[0]['2'].inputs.shift, 3.0);
    assert.equal(submitted[0]['3'].inputs.clip_name, 'qwen_3_4b.safetensors');
    assert.equal(submitted[0]['3'].inputs.type, 'lumina2');
    assert.equal(submitted[0]['4'].inputs.vae_name, 'ae.safetensors');
    assert.equal(submitted[0]['5'].inputs.text, '海边夕阳下的写实人像摄影，自然光影');
    assert.equal(submitted[0]['8'].inputs.sampler_name, 'res_multistep');
    assert.equal(submitted[0]['8'].inputs.scheduler, 'simple');
    assert.equal(submitted[0]['8'].inputs.steps, 9);

    // Explicit model='sdxl' selects RealVisXL even when Z-Image-Turbo is installed
    const resSdxl = await (await fetch(`${base}/api/comfy/generate/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'beach portrait', model: 'sdxl', width: 1024, height: 1024 }),
    })).json();
    assert.equal(resSdxl.promptId, 'zimg-pid-2');
    assert.equal(submitted[1]['1'].inputs.ckpt_name, 'RealVisXL_V5.0_Lightning_fp16.safetensors');

    // Explicit model='zimage' selects Z-Image-Turbo
    const resZimg = await (await fetch(`${base}/api/comfy/generate/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '海边夕阳下的写实人像', model: 'zimage', width: 1024, height: 1024 }),
    })).json();
    assert.equal(resZimg.promptId, 'zimg-pid-3');
    assert.equal(submitted[2]['1'].inputs.unet_name, 'z_image_turbo_bf16.safetensors');
  } finally {
    server.closeAllConnections?.();
    mockComfy.closeAllConnections?.();
    await Promise.all([
      new Promise((resolve) => server.close(resolve)),
      new Promise((resolve) => mockComfy.close(resolve)),
    ]);
    await rm(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});
