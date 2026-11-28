import { existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createStaticHandler } from './server-core.mjs';

function sendJson(response, status, data) {
  const body = Buffer.from(JSON.stringify(data));
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

async function readJsonBody(request, maxBytes = 25 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  return text ? JSON.parse(text) : {};
}

function normalizeComfyUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('无效的 ComfyUI URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('仅支持 http:// 或 https:// 地址');
  }
  return parsed.origin + parsed.pathname.replace(/\/+$/, '');
}

export function snapH3Frames(seconds) {
  const raw = Math.max(5, Math.round(Number(seconds || 3) * 24));
  return raw + ((5 - (raw % 17) + 17) % 17);
}

export async function translatePromptToEnglish(text, fetchImpl = fetch) {
  const raw = String(text || '').trim();
  if (!raw || !/[\u4e00-\u9fff]/.test(raw)) return raw;
  const providers = [
    async (signal) => {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(raw)}`;
      const res = await fetchImpl(url, { signal });
      if (!res.ok) throw new Error(`google HTTP ${res.status}`);
      const data = await res.json();
      return Array.isArray(data?.[0])
        ? data[0].map((seg) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : '')).join('').trim()
        : '';
    },
    async (signal) => {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(raw)}&langpair=zh-CN|en`;
      const res = await fetchImpl(url, { signal });
      if (!res.ok) throw new Error(`mymemory HTTP ${res.status}`);
      const data = await res.json();
      return typeof data?.responseData?.translatedText === 'string'
        ? data.responseData.translatedText.trim()
        : '';
    },
  ];
  for (const queryProvider of providers) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const translated = await queryProvider(controller.signal);
      if (translated) return translated;
    } catch (error) {
      console.warn('[ComfyStudio] translate failed:', error?.message || error);
    } finally {
      clearTimeout(timer);
    }
  }
  return raw;
}

export function buildFluxImagePrompt({
  ckptName,
  prompt,
  width = 1024,
  height = 1024,
  steps = 4,
  seed,
}) {
  const resolvedSeed = Number.isFinite(Number(seed)) ? Math.trunc(Number(seed)) : Math.floor(Math.random() * 2 ** 31);
  return {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: ckptName },
    },
    '2': {
      class_type: 'CLIPTextEncode',
      inputs: { clip: ['1', 1], text: String(prompt || '') },
    },
    '3': {
      class_type: 'ConditioningZeroOut',
      inputs: { conditioning: ['2', 0] },
    },
    '4': {
      class_type: 'EmptySD3LatentImage',
      inputs: {
        width: Math.max(64, Math.round(Number(width) || 1024)),
        height: Math.max(64, Math.round(Number(height) || 1024)),
        batch_size: 1,
      },
    },
    '5': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
        seed: resolvedSeed,
        steps: Math.max(1, Math.round(Number(steps) || 4)),
        cfg: 1.0,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1.0,
      },
    },
    '6': {
      class_type: 'VAEDecode',
      inputs: { samples: ['5', 0], vae: ['1', 2] },
    },
    '7': {
      class_type: 'SaveImage',
      inputs: { images: ['6', 0], filename_prefix: 'studio/flux' },
    },
  };
}

const DEFAULT_SDXL_NEGATIVE_PROMPT = '(octane render, render, drawing, anime, bad photo, bad photography:1.3), (worst quality, low quality, blurry:1.2), (bad teeth, deformed teeth, deformed lips), (bad anatomy, bad proportions:1.1), (deformed iris, deformed pupils), (deformed eyes, bad eyes), (deformed face, ugly face, bad face), (deformed hands, bad hands, fused fingers), morbid, mutilated, mutation, disfigured';

export function buildSdxlRealisticImagePrompt({
  ckptName,
  prompt,
  negativePrompt = DEFAULT_SDXL_NEGATIVE_PROMPT,
  width = 1024,
  height = 1024,
  steps = 6,
  cfg = 1.8,
  samplerName = 'dpmpp_sde',
  scheduler = 'karras',
  seed,
}) {
  const resolvedSeed = Number.isFinite(Number(seed)) ? Math.trunc(Number(seed)) : Math.floor(Math.random() * 2 ** 31);
  return {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: ckptName },
    },
    '2': {
      class_type: 'CLIPTextEncode',
      inputs: { clip: ['1', 1], text: String(prompt || '') },
    },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: { clip: ['1', 1], text: String(negativePrompt ?? '') },
    },
    '4': {
      class_type: 'EmptyLatentImage',
      inputs: {
        width: Math.max(64, Math.round(Number(width) || 1024)),
        height: Math.max(64, Math.round(Number(height) || 1024)),
        batch_size: 1,
      },
    },
    '5': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
        seed: resolvedSeed,
        steps: Math.max(1, Math.round(Number(steps) || 6)),
        cfg: Number.isFinite(Number(cfg)) ? Number(cfg) : 1.8,
        sampler_name: samplerName,
        scheduler,
        denoise: 1.0,
      },
    },
    '6': {
      class_type: 'VAEDecode',
      inputs: { samples: ['5', 0], vae: ['1', 2] },
    },
    '7': {
      class_type: 'SaveImage',
      inputs: { images: ['6', 0], filename_prefix: 'studio/realvis' },
    },
  };
}

export function buildQwenImage21Prompt({
  unetName,
  clipName,
  vaeName,
  prompt,
  width = 1024,
  height = 1024,
  steps = 8,
  seed,
  clipLoaderClass = 'CLIPLoader',
}) {
  const resolvedSeed = Number.isFinite(Number(seed)) ? Math.trunc(Number(seed)) : Math.floor(Math.random() * 2 ** 31);
  const w = Math.max(64, Math.round(Number(width) || 1024));
  const h = Math.max(64, Math.round(Number(height) || 1024));
  const resolution = Math.max(256, Math.min(2048, Math.round(Math.max(w, h) / 32) * 32));
  return {
    '1': {
      class_type: 'UNETLoader',
      inputs: { unet_name: unetName, weight_dtype: 'default' },
    },
    '2': {
      class_type: 'QwenImage21Cache',
      inputs: { model: ['1', 0], device: 'auto', dtype: 'default' },
    },
    '3': {
      class_type: clipLoaderClass,
      inputs: { clip_name: clipName, type: 'qwen_image' },
    },
    '4': {
      class_type: 'VAELoader',
      inputs: { vae_name: vaeName },
    },
    '5': {
      class_type: 'TextEncodeQwenImage21',
      inputs: {
        clip: ['3', 0],
        prompt: String(prompt || ''),
        negative_prompt: '',
        resolution,
      },
    },
    '6': {
      class_type: 'EmptyLatentImage',
      inputs: { width: w, height: h, batch_size: 1 },
    },
    '7': {
      class_type: 'KSampler',
      inputs: {
        model: ['2', 0],
        positive: ['5', 0],
        negative: ['5', 1],
        latent_image: ['6', 0],
        seed: resolvedSeed,
        steps: Math.max(1, Math.round(Number(steps) || 8)),
        cfg: 1.0,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1.0,
      },
    },
    '8': {
      class_type: 'VAEDecode',
      inputs: { samples: ['7', 0], vae: ['4', 0] },
    },
    '9': {
      class_type: 'SaveImage',
      inputs: { images: ['8', 0], filename_prefix: 'studio/qwen21' },
    },
  };
}

export function buildZImageTurboPrompt({
  unetName,
  clipName,
  vaeName,
  prompt,
  width = 1024,
  height = 1024,
  steps = 9,
  shift = 3.0,
  seed,
}) {
  const resolvedSeed = Number.isFinite(Number(seed)) ? Math.trunc(Number(seed)) : Math.floor(Math.random() * 2 ** 31);
  return {
    '1': {
      class_type: 'UNETLoader',
      inputs: { unet_name: unetName, weight_dtype: 'default' },
    },
    '2': {
      class_type: 'ModelSamplingAuraFlow',
      inputs: { model: ['1', 0], shift: Number.isFinite(Number(shift)) ? Number(shift) : 3.0 },
    },
    '3': {
      class_type: 'CLIPLoader',
      inputs: { clip_name: clipName, type: 'lumina2' },
    },
    '4': {
      class_type: 'VAELoader',
      inputs: { vae_name: vaeName },
    },
    '5': {
      class_type: 'CLIPTextEncode',
      inputs: { clip: ['3', 0], text: String(prompt || '') },
    },
    '6': {
      class_type: 'ConditioningZeroOut',
      inputs: { conditioning: ['5', 0] },
    },
    '7': {
      class_type: 'EmptySD3LatentImage',
      inputs: {
        width: Math.max(64, Math.round(Number(width) || 1024)),
        height: Math.max(64, Math.round(Number(height) || 1024)),
        batch_size: 1,
      },
    },
    '8': {
      class_type: 'KSampler',
      inputs: {
        model: ['2', 0],
        positive: ['5', 0],
        negative: ['6', 0],
        latent_image: ['7', 0],
        seed: resolvedSeed,
        steps: Math.max(1, Math.round(Number(steps) || 9)),
        cfg: 1.0,
        sampler_name: 'res_multistep',
        scheduler: 'simple',
        denoise: 1.0,
      },
    },
    '9': {
      class_type: 'VAEDecode',
      inputs: { samples: ['8', 0], vae: ['4', 0] },
    },
    '10': {
      class_type: 'SaveImage',
      inputs: { images: ['9', 0], filename_prefix: 'studio/z_image_turbo' },
    },
  };
}

export function buildMiniMaxH3VideoPrompt({
  unetName,
  clipName,
  videoVaeName,
  audioVaeName,
  prompt,
  width = 608,
  height = 352,
  duration = 3,
  steps,
  seed,
  uploadedImageName = null,
  loraName = null,
  loraStrength = 1.0,
}) {
  const resolvedSeed = Number.isFinite(Number(seed)) ? Math.trunc(Number(seed)) : Math.floor(Math.random() * 2 ** 31);
  const useLora = Boolean(loraName);
  const resolvedSteps = Math.max(1, Math.round(Number(steps ?? (useLora ? 8 : 20)) || (useLora ? 8 : 20)));
  const modelRef = useLora ? ['16', 0] : ['1', 0];
  const graph = {
    '1': {
      class_type: 'UNETLoader',
      inputs: { unet_name: unetName, weight_dtype: 'default' },
    },
    '2': {
      class_type: 'CLIPLoader',
      inputs: { clip_name: clipName, type: 'minimax' },
    },
    '3': {
      class_type: 'VAELoader',
      inputs: { vae_name: videoVaeName },
    },
    '4': {
      class_type: 'VAELoader',
      inputs: { vae_name: audioVaeName },
    },
    '5': {
      class_type: 'MiniMaxH3ImageToVideo',
      inputs: {
        clip: ['2', 0],
        vae: ['3', 0],
        prompt: String(prompt || ''),
        width: Math.max(64, Math.round(Number(width) || 608)),
        height: Math.max(64, Math.round(Number(height) || 352)),
        length: snapH3Frames(duration),
        ...(uploadedImageName ? { first_frame: ['15', 0] } : {}),
      },
    },
    '6': {
      class_type: 'RandomNoise',
      inputs: { noise_seed: resolvedSeed },
    },
    '7': {
      class_type: 'BasicGuider',
      inputs: { model: modelRef, conditioning: ['5', 0] },
    },
    '8': {
      class_type: 'KSamplerSelect',
      inputs: { sampler_name: useLora ? 'euler' : 'res_multistep' },
    },
    '9': {
      class_type: 'BasicScheduler',
      inputs: {
        model: modelRef,
        scheduler: useLora ? 'beta' : 'simple',
        steps: resolvedSteps,
        denoise: 1.0,
      },
    },
    '10': {
      class_type: 'SamplerCustomAdvanced',
      inputs: {
        noise: ['6', 0],
        guider: ['7', 0],
        sampler: ['8', 0],
        sigmas: ['9', 0],
        latent_image: ['5', 1],
      },
    },
    '11': {
      class_type: 'VAEDecode',
      inputs: { samples: ['10', 0], vae: ['3', 0] },
    },
    '12': {
      class_type: 'VAEDecodeAudio',
      inputs: { samples: ['10', 0], vae: ['4', 0] },
    },
    '13': {
      class_type: 'CreateVideo',
      inputs: { images: ['11', 0], audio: ['12', 0], fps: 24 },
    },
    '14': {
      class_type: 'SaveVideo',
      inputs: { video: ['13', 0], filename_prefix: 'video/MiniMax_H3', format: 'mp4', codec: 'auto' },
    },
  };
  if (uploadedImageName) {
    graph['15'] = {
      class_type: 'LoadImage',
      inputs: { image: uploadedImageName },
    };
  }
  if (useLora) {
    graph['16'] = {
      class_type: 'LoraLoaderModelOnly',
      inputs: {
        model: ['1', 0],
        lora_name: loraName,
        strength_model: Number.isFinite(Number(loraStrength)) ? Number(loraStrength) : 1.0,
      },
    };
  }
  return graph;
}

function extractComboOptions(objectInfo, nodeName, fieldName) {
  const req = objectInfo?.[nodeName]?.input?.required?.[fieldName];
  if (!Array.isArray(req) || !Array.isArray(req[0])) return [];
  return req[0].filter((item) => typeof item === 'string');
}

function pickPreferred(options, patterns) {
  for (const pat of patterns) {
    const found = options.find((name) => name.toLowerCase().includes(pat.toLowerCase()));
    if (found) return found;
  }
  return options[0] || '';
}

function decodeDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(String(dataUrl || '').trim());
  if (!match) throw new Error('无效的图片数据格式');
  const mime = match[1].toLowerCase();
  const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg'
    : mime.includes('webp') ? 'webp'
      : 'png';
  return {
    buffer: Buffer.from(match[2], 'base64'),
    mime,
    ext,
  };
}

export function createComfyStudioHandler({
  siteRoot,
  cacheDir = path.join(siteRoot, '.cache', 'comfy-studio'),
  fetchImpl = fetch,
} = {}) {
  const resolvedCacheDir = path.resolve(cacheDir);
  const outputsDir = path.join(resolvedCacheDir, 'outputs');
  const configPath = path.join(resolvedCacheDir, 'config.json');
  const historyPath = path.join(resolvedCacheDir, 'history.json');
  mkdirSync(outputsDir, { recursive: true });

  const serveOutputs = createStaticHandler(outputsDir, { basePath: '/files/comfy-studio' });
  const pendingJobs = new Map();

  async function readConfig() {
    try {
      const raw = JSON.parse(await readFile(configPath, 'utf8'));
      const saved = normalizeComfyUrl(raw?.url || '');
      if (saved) return { url: saved };
    } catch { /* fall through */ }
    if (process.env.WEBASSET_COMFY_URL?.trim()) {
      try {
        return { url: normalizeComfyUrl(process.env.WEBASSET_COMFY_URL) };
      } catch { /* fall through */ }
    }
    try {
      const localCfg = JSON.parse(await readFile(path.resolve(siteRoot, '..', '.hgame.local.json'), 'utf8'));
      if (typeof localCfg?.comfyUrl === 'string' && localCfg.comfyUrl.trim()) {
        return { url: normalizeComfyUrl(localCfg.comfyUrl) };
      }
    } catch { /* fall through */ }
    return { url: '' };
  }

  async function writeConfig(config) {
    mkdirSync(resolvedCacheDir, { recursive: true });
    await writeFile(configPath, JSON.stringify({ url: config.url || '' }, null, 2));
  }

  async function readHistory() {
    try {
      const raw = JSON.parse(await readFile(historyPath, 'utf8'));
      const items = Array.isArray(raw?.items) ? raw.items : [];
      return items.filter((item) => item?.filename && existsSync(path.join(outputsDir, item.filename)));
    } catch {
      return [];
    }
  }

  async function writeHistory(items) {
    mkdirSync(resolvedCacheDir, { recursive: true });
    await writeFile(historyPath, JSON.stringify({ items: items.slice(0, 60) }, null, 2));
  }

  async function fetchComfyJson(baseUrl, apiPath, options = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${baseUrl}${apiPath}`, { ...options, signal: controller.signal });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error?.message || data?.message || `ComfyUI HTTP ${res.status}`);
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  async function probeComfyModels(baseUrl) {
    const [ckptInfo, unetInfo, clipInfo, vaeInfo, ggufClipInfo, loraInfo] = await Promise.all([
      fetchComfyJson(baseUrl, '/object_info/CheckpointLoaderSimple'),
      fetchComfyJson(baseUrl, '/object_info/UNETLoader'),
      fetchComfyJson(baseUrl, '/object_info/CLIPLoader'),
      fetchComfyJson(baseUrl, '/object_info/VAELoader'),
      fetchComfyJson(baseUrl, '/object_info/CLIPLoaderGGUF').catch(() => ({})),
      fetchComfyJson(baseUrl, '/object_info/LoraLoaderModelOnly').catch(() => ({})),
    ]);
    return {
      checkpoints: extractComboOptions(ckptInfo, 'CheckpointLoaderSimple', 'ckpt_name'),
      unets: extractComboOptions(unetInfo, 'UNETLoader', 'unet_name'),
      clips: extractComboOptions(clipInfo, 'CLIPLoader', 'clip_name'),
      vaes: extractComboOptions(vaeInfo, 'VAELoader', 'vae_name'),
      ggufClips: extractComboOptions(ggufClipInfo, 'CLIPLoaderGGUF', 'clip_name'),
      loras: extractComboOptions(loraInfo, 'LoraLoaderModelOnly', 'lora_name'),
    };
  }

  async function submitComfyPrompt(baseUrl, graph) {
    const res = await fetchComfyJson(baseUrl, '/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: graph }),
    }, 15000);
    if (!res?.prompt_id) {
      throw new Error(res?.node_errors ? JSON.stringify(res.node_errors) : 'ComfyUI 未返回 prompt_id');
    }
    return res.prompt_id;
  }

  return async (request, response) => {
    const reqUrl = new URL(request.url || '/', 'http://127.0.0.1');
    const pathname = reqUrl.pathname;

    if (pathname.startsWith('/files/comfy-studio/')) {
      await serveOutputs(request, response, () => {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not Found');
      });
      return;
    }

    if (pathname === '/api/comfy/config' && request.method === 'GET') {
      const [config, items] = await Promise.all([readConfig(), readHistory()]);
      const donePromptIds = new Set(items.map((item) => item.promptId).filter(Boolean));
      const pending = [...pendingJobs.values()]
        .filter((job) => !donePromptIds.has(job.promptId))
        .sort((a, b) => (b.startedAtMs || 0) - (a.startedAtMs || 0))
        .map((job) => ({
          id: `job-${job.promptId}`,
          promptId: job.promptId,
          kind: job.kind,
          prompt: job.prompt,
          ...(job.effectivePrompt ? { effectivePrompt: job.effectivePrompt } : {}),
          status: 'queued',
          startedAtMs: job.startedAtMs,
          createdAt: job.createdAt,
        }));
      sendJson(response, 200, { url: config.url, items, pending });
      return;
    }

    if (pathname === '/api/comfy/config' && request.method === 'POST') {
      try {
        const body = await readJsonBody(request);
        const url = normalizeComfyUrl(body?.url);
        if (!url) {
          sendJson(response, 400, { ok: false, error: 'INVALID_URL', message: '请输入有效的 ComfyUI 地址' });
          return;
        }
        await writeConfig({ url });
        try {
          const models = await probeComfyModels(url);
          sendJson(response, 200, { ok: true, url, connected: true, models });
        } catch (probeErr) {
          sendJson(response, 200, {
            ok: true,
            url,
            connected: false,
            models: { checkpoints: [], unets: [], clips: [], vaes: [], ggufClips: [], loras: [] },
            error: probeErr.message || String(probeErr),
          });
        }
      } catch (error) {
        sendJson(response, 400, { ok: false, error: 'BAD_REQUEST', message: error.message || String(error) });
      }
      return;
    }

    if (pathname === '/api/comfy/generate/image' && request.method === 'POST') {
      try {
        const { url } = await readConfig();
        if (!url) {
          sendJson(response, 400, { error: 'NO_COMFY_URL', message: '请先连接 ComfyUI 地址' });
          return;
        }
        const body = await readJsonBody(request);
        const prompt = String(body?.prompt || '').trim();
        if (!prompt) {
          sendJson(response, 400, { error: 'EMPTY_PROMPT', message: '请输入提示词' });
          return;
        }
        const models = await probeComfyModels(url);
        const zImageUnet = pickPreferred(
          models.unets.filter((n) => n.toLowerCase().includes('z_image_turbo')),
          ['bf16', 'int8_convrot', 'z_image_turbo'],
        );
        const zImageClip = pickPreferred(
          models.clips.filter((n) => n.toLowerCase().includes('qwen_3_4b')),
          ['qwen_3_4b.safetensors', 'qwen_3_4b'],
        );
        const zImageVae = pickPreferred(
          models.vaes.filter((n) => n.toLowerCase() === 'ae.safetensors' || n.toLowerCase().endsWith('/ae.safetensors')),
          ['ae.safetensors'],
        );
        const sdxlCkpt = pickPreferred(
          models.checkpoints.filter((n) => /realvis|juggernaut|lustify|biglust|sdxl/i.test(n)),
          ['realvisxl_v5.0_lightning', 'realvis', 'juggernaut', 'sdxl'],
        );
        const qwenUnet = pickPreferred(
          models.unets.filter((n) => n.toLowerCase().includes('qwen_image_2.1')),
          ['turbo_int8', 'turbo', 'qwen_image_2.1'],
        );
        const qwenClip = pickPreferred(
          models.clips.filter((n) => n.toLowerCase().includes('qwen3vl_8b')),
          ['w4a8', 'int8', 'bf16'],
        );
        const qwenVae = pickPreferred(
          models.vaes.filter((n) => n.toLowerCase().includes('qwen_image_2.1_vae')),
          ['bf16', 'fp16'],
        );

        const requestedModel = String(body?.model || '').toLowerCase();
        const hasZImage = Boolean(zImageUnet && zImageClip && zImageVae);
        const hasSdxl = Boolean(sdxlCkpt);
        const hasQwen = Boolean(qwenUnet && qwenClip && qwenVae);
        let selectedBackend = '';
        if (requestedModel === 'sdxl' && hasSdxl) selectedBackend = 'sdxl';
        else if (requestedModel === 'zimage' && hasZImage) selectedBackend = 'zimage';
        else if (requestedModel === 'qwen' && hasQwen) selectedBackend = 'qwen';
        else if (hasZImage && !['sdxl', 'qwen'].includes(requestedModel)) selectedBackend = 'zimage';
        else if (hasSdxl && requestedModel !== 'qwen') selectedBackend = 'sdxl';
        else if (hasQwen) selectedBackend = 'qwen';

        let effectivePrompt = prompt;
        let graph;
        if (selectedBackend === 'zimage') {
          graph = buildZImageTurboPrompt({
            unetName: zImageUnet,
            clipName: zImageClip,
            vaeName: zImageVae,
            prompt,
            width: body?.width,
            height: body?.height,
            steps: body?.steps ?? 9,
            seed: body?.seed,
          });
        } else if (selectedBackend === 'sdxl') {
          const isLightning = /lightning|turbo/i.test(sdxlCkpt);
          effectivePrompt = await translatePromptToEnglish(prompt, fetchImpl);
          graph = buildSdxlRealisticImagePrompt({
            ckptName: sdxlCkpt,
            prompt: effectivePrompt,
            width: body?.width,
            height: body?.height,
            steps: body?.steps ?? (isLightning ? 6 : 25),
            cfg: isLightning ? 1.8 : 5.0,
            samplerName: isLightning ? 'dpmpp_sde' : 'dpmpp_2m_sde',
            scheduler: 'karras',
            seed: body?.seed,
          });
        } else if (selectedBackend === 'qwen') {
          graph = buildQwenImage21Prompt({
            unetName: qwenUnet,
            clipName: qwenClip,
            clipLoaderClass: 'CLIPLoader',
            vaeName: qwenVae,
            prompt,
            width: body?.width,
            height: body?.height,
            steps: 8,
            seed: body?.seed,
          });
        } else {
          const ckptName = pickPreferred(models.checkpoints, ['flux', 'schnell']);
          if (!ckptName) {
            sendJson(response, 400, { error: 'NO_CHECKPOINT', message: 'ComfyUI 未检测到生图模型' });
            return;
          }
          effectivePrompt = await translatePromptToEnglish(prompt, fetchImpl);
          graph = buildFluxImagePrompt({
            ckptName,
            prompt: effectivePrompt,
            width: body?.width,
            height: body?.height,
            steps: body?.steps,
            seed: body?.seed,
          });
        }
        const promptId = await submitComfyPrompt(url, graph);
        pendingJobs.set(promptId, {
          promptId,
          kind: 'image',
          prompt,
          ...(effectivePrompt !== prompt ? { effectivePrompt } : {}),
          startedAtMs: Date.now(),
          createdAt: new Date().toISOString(),
        });
        sendJson(response, 200, {
          ok: true,
          promptId,
          kind: 'image',
          ...(effectivePrompt !== prompt ? { effectivePrompt } : {}),
        });
      } catch (error) {
        sendJson(response, 502, { error: 'COMFY_ERROR', message: error.message || String(error) });
      }
      return;
    }

    if (pathname === '/api/comfy/generate/video' && request.method === 'POST') {
      try {
        const { url } = await readConfig();
        if (!url) {
          sendJson(response, 400, { error: 'NO_COMFY_URL', message: '请先连接 ComfyUI 地址' });
          return;
        }
        const body = await readJsonBody(request);
        const prompt = String(body?.prompt || '').trim();
        if (!prompt && !body?.imageDataUrl && !body?.localAssetId) {
          sendJson(response, 400, { error: 'EMPTY_INPUT', message: '请输入提示词或提供参考图' });
          return;
        }

        let uploadedImageName = null;
        if (body?.localAssetId) {
          const items = await readHistory();
          const matched = items.find((item) => item.id === body.localAssetId);
          if (!matched) {
            sendJson(response, 404, { error: 'ASSET_NOT_FOUND', message: '未找到所选本地生成图' });
            return;
          }
          const imgBuf = await readFile(path.join(outputsDir, matched.filename));
          const form = new FormData();
          form.append('image', new Blob([imgBuf], { type: 'image/png' }), matched.filename);
          const upRes = await fetchImpl(`${url}/upload/image`, { method: 'POST', body: form });
          const upJson = await upRes.json().catch(() => ({}));
          if (!upRes.ok || !upJson?.name) {
            throw new Error(upJson?.message || `上传参考图失败 (HTTP ${upRes.status})`);
          }
          uploadedImageName = upJson.subfolder ? `${upJson.subfolder}/${upJson.name}` : upJson.name;
        } else if (body?.imageDataUrl) {
          const { buffer, mime, ext } = decodeDataUrl(body.imageDataUrl);
          const form = new FormData();
          form.append('image', new Blob([buffer], { type: mime }), `ref-${Date.now()}.${ext}`);
          const upRes = await fetchImpl(`${url}/upload/image`, { method: 'POST', body: form });
          const upJson = await upRes.json().catch(() => ({}));
          if (!upRes.ok || !upJson?.name) {
            throw new Error(upJson?.message || `上传参考图失败 (HTTP ${upRes.status})`);
          }
          uploadedImageName = upJson.subfolder ? `${upJson.subfolder}/${upJson.name}` : upJson.name;
        }

        const models = await probeComfyModels(url);
        const validClips = models.clips.filter((n) => !n.toLowerCase().includes('generation_tail'));
        const clipName = pickPreferred(validClips, ['ultra_uncensored_heretic', 'heretic', 'minimax_h3', 'qwen3', 'minimax']);
        const turboLora = pickPreferred(models.loras || [], ['minimax_h3_turbo_v4', 'minimax_h3_turbo', 'minimax_h3_fl2v_turbo']);
        const unprunedUnet = pickPreferred(
          models.unets.filter((n) => n.toLowerCase().includes('minimax_h3_fl2va') && !n.toLowerCase().includes('pruned')),
          ['int8_convrot', 'bf16', 'minimax_h3_fl2va'],
        );
        const useTurboLora = Boolean(turboLora && unprunedUnet);
        const unetName = useTurboLora
          ? unprunedUnet
          : pickPreferred(models.unets, ['minimax_h3_fl2va', 'minimax_h3', 'fl2va']);
        const videoVaeName = pickPreferred(models.vaes, ['video_vae', 'minimax_h3_video']);
        const audioVaeName = pickPreferred(models.vaes, ['audio_vae', 'minimax_h3_audio']);
        if (!unetName || !clipName || !videoVaeName || !audioVaeName) {
          sendJson(response, 400, { error: 'MISSING_H3_MODELS', message: 'ComfyUI 缺少 MiniMax H3 模型文件' });
          return;
        }

        const graph = buildMiniMaxH3VideoPrompt({
          unetName,
          clipName,
          videoVaeName,
          audioVaeName,
          prompt,
          width: body?.width,
          height: body?.height,
          duration: body?.duration,
          steps: body?.steps,
          seed: body?.seed,
          uploadedImageName,
          loraName: useTurboLora ? turboLora : null,
        });
        const promptId = await submitComfyPrompt(url, graph);
        pendingJobs.set(promptId, { promptId, kind: 'video', prompt, startedAtMs: Date.now(), createdAt: new Date().toISOString() });
        sendJson(response, 200, { ok: true, promptId, kind: 'video' });
      } catch (error) {
        sendJson(response, 502, { error: 'COMFY_ERROR', message: error.message || String(error) });
      }
      return;
    }

    if (pathname.startsWith('/api/comfy/jobs/') && request.method === 'GET') {
      const promptId = decodeURIComponent(pathname.slice('/api/comfy/jobs/'.length)).trim();
      if (!promptId) {
        sendJson(response, 400, { status: 'error', message: '缺少 promptId' });
        return;
      }
      try {
        const existingItems = await readHistory();
        const existing = existingItems.find((item) => item.promptId === promptId);
        if (existing) {
          sendJson(response, 200, { status: 'done', item: existing });
          return;
        }

        const { url } = await readConfig();
        if (!url) {
          sendJson(response, 400, { status: 'error', message: '未配置 ComfyUI 地址' });
          return;
        }

        const historyData = await fetchComfyJson(url, `/history/${encodeURIComponent(promptId)}`);
        const entry = historyData?.[promptId];
        if (entry) {
          if (entry?.status?.status_str === 'error') {
            pendingJobs.delete(promptId);
            const errMsgs = entry.status?.messages || [];
            sendJson(response, 200, { status: 'error', message: JSON.stringify(errMsgs) || '生成失败' });
            return;
          }
          const outputs = entry?.outputs || {};
          let pickedFile = null;
          for (const nodeOut of Object.values(outputs)) {
            const files = [
              ...(Array.isArray(nodeOut?.videos) ? nodeOut.videos : []),
              ...(Array.isArray(nodeOut?.gifs) ? nodeOut.gifs : []),
              ...(Array.isArray(nodeOut?.images) ? nodeOut.images : []),
            ];
            if (files.length > 0) {
              pickedFile = files[0];
              break;
            }
          }
          if (pickedFile?.filename) {
            const viewParams = new URLSearchParams({
              filename: pickedFile.filename,
              subfolder: pickedFile.subfolder || '',
              type: pickedFile.type || 'output',
            });
            const fileRes = await fetchImpl(`${url}/view?${viewParams.toString()}`);
            if (!fileRes.ok) {
              throw new Error(`下载产物失败 (HTTP ${fileRes.status})`);
            }
            const fileBuf = Buffer.from(await fileRes.arrayBuffer());
            const jobMeta = pendingJobs.get(promptId);
            const ext = path.extname(pickedFile.filename).toLowerCase()
              || (jobMeta?.kind === 'video' ? '.mp4' : '.png');
            const kind = ['.mp4', '.webm', '.mov', '.mkv', '.gif'].includes(ext)
              ? 'video'
              : (jobMeta?.kind || 'image');
            const id = randomUUID();
            const localFilename = `${id}${ext}`;
            await writeFile(path.join(outputsDir, localFilename), fileBuf);
            const durationMs = typeof jobMeta?.startedAtMs === 'number'
              ? Math.max(0, Date.now() - jobMeta.startedAtMs)
              : null;
            const item = {
              id,
              promptId,
              kind,
              prompt: jobMeta?.prompt || '',
              ...(jobMeta?.effectivePrompt ? { effectivePrompt: jobMeta.effectivePrompt } : {}),
              filename: localFilename,
              url: `/files/comfy-studio/${localFilename}`,
              durationMs,
              createdAt: jobMeta?.createdAt || new Date().toISOString(),
            };
            await writeHistory([item, ...existingItems]);
            pendingJobs.delete(promptId);
            sendJson(response, 200, { status: 'done', item });
            return;
          }
        }

        const queueData = await fetchComfyJson(url, '/queue');
        const running = Array.isArray(queueData?.queue_running) ? queueData.queue_running : [];
        const isRunning = running.some((item) => Array.isArray(item) && item[1] === promptId);
        const jobMeta = pendingJobs.get(promptId);
        const elapsedMs = typeof jobMeta?.startedAtMs === 'number'
          ? Math.max(0, Date.now() - jobMeta.startedAtMs)
          : null;
        sendJson(response, 200, { status: isRunning ? 'running' : 'queued', elapsedMs });
      } catch (error) {
        sendJson(response, 502, { status: 'error', message: error.message || String(error) });
      }
      return;
    }

    sendJson(response, 404, { error: 'NOT_FOUND', message: 'Not Found' });
  };
}
