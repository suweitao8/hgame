---
name: colab-comfyui-studio
description: Google Colab + ComfyUI + WebAsset `#studio` 远程生图与音视频生成自动化管线。Use whenever the user asks to 启动 Colab ComfyUI、重连或更新 Colab Notebook、切换 Colab GPU（T4/A100）、给 WebAsset「生成」Tab 新增/调试生图或视频模型（Qwen-Image-2.1-Turbo / FLUX.1-schnell / MiniMax H3），或更新 Cloudflare Tunnel 地址到 WebAsset。
---

# Colab + ComfyUI + WebAsset `#studio` 管线

通过 **Google Drive (`gdrive` CLI) + Colab (`browser` subagent) + 本地 WebAsset (`http://127.0.0.1:4174/#studio`)** 打通云端 GPU 推理与本地极简生图/音视频工作台。

## 核心组件与路径

| 组件 | 路径 / 入口 | 说明 |
|---|---|---|
| Colab Notebook | `tools-local/colab/comfyui_minimax_h3.ipynb` | gitignored 本地工作本，6 个 Cell（说明 + 5 个表单代码单元） |
| Drive 同步 | `gdrive` CLI（`gdrive` 插件） | `--mime-type "application/vnd.google.colaboratory"` 原地更新 |
| WebAsset 后端 | `webasset/lib/comfy-studio-server.mjs` | `/api/comfy/*`、`/files/comfy-studio/*`、任务队列与耗时持久化 |
| WebAsset 前端 | `webasset/public/js/hgame-studio.js` | `#studio` Tab（对话式队列、卡片右上角实时计时/耗时角标、详情区） |
| 后端配置与产物 | `webasset/.cache/comfy-studio/` | `config.json`（存 `url`）、`history.json`、`outputs/` |
| 单元测试 | `webasset/tests/comfy-studio.test.mjs` | 覆盖 `snapH3Frames`、工作流图构建、翻译回退与 HTTP 全链路 |

> **安全与卫生纪律**：禁止将个人邮箱、本机绝对路径、HF Token 或临时 `trycloudflare.com` 地址写入仓库提交文件中。

---

## 标准操作流

### 1. 启动 / 重连 Colab 并接入 WebAsset

1. **选择合适运行时**：
   - **L4（24GB）高 RAM（当前默认）**：日常生图与常规开发性价比最高，Cell 5 配 `EXTRA_ARGS = ""`（留空默认自动管理；若跑超大视频模型爆显存可降为 `--lowvram`）。
   - **G4（RTX PRO 6000 Blackwell 96GB）高 RAM**：大型模型与批量视频生成性价比最高（后续大量做视频时切换），Cell 5 配 `EXTRA_ARGS = "--highvram"`。
   - T4（15GB）高 RAM 仅作最低成本备用（`--lowvram`）。
   - **模型持久化**：Cell 1 默认开启 `CACHE_MODELS_ON_DRIVE = True`，将 `/content/ComfyUI/models` 软链到 `MyDrive/ComfyUI_Colab/models`；在 L4 与 G4 之间切换时，仅需跑 Cell 1（挂盘）→ Cell 2（~1 分钟装依赖）→ Cell 5（启动），模型自动跳过免重复下载。
2. **使用 `browser` subagent 操作 Colab**：
   - 首次登录或挂载 Google Drive（`accounts.google.com` OAuth 弹窗）属于受保护认证域，**必须暂停并请用户在浏览器面板手动点击确认**，随后用 `send_message` 唤醒同一 subagent 继续。
   - 若仅修改了 Notebook 局部单元，**刷新页面时保留当前已连接的运行时 VM（切勿断开/重置运行时）**，避免重复下载数十 GB 模型。
3. **注册最新 Tunnel 地址到本地 WebAsset**：
   - Cell 5 输出 `https://<random>.trycloudflare.com` 与 `To see the GUI go to` 后，通过接口写入配置并探活：
     ```powershell
     $body = @{ url = "https://<subdomain>.trycloudflare.com" } | ConvertTo-Json
     Invoke-RestMethod -Uri "http://127.0.0.1:4174/api/comfy/config" -Method Post -ContentType "application/json" -Body $body
     ```
   - 确认返回 `connected: true` 且 `models` 中包含预期权重（也支持环境变量 `WEBASSET_COMFY_URL` 或 `.hgame.local.json` 的 `comfyUrl` 回退）。

### 2. 修改并热更新 Colab Notebook

1. 编辑 `tools-local/colab/comfyui_minimax_h3.ipynb`。
2. **校验 JSON 与全单元 Python 语法**后再上传：
   ```powershell
   python -c "import json, ast; nb = json.load(open(r'tools-local/colab/comfyui_minimax_h3.ipynb', encoding='utf-8')); assert nb['nbformat'] == 4; [ast.parse(''.join(c['source'])) for c in nb['cells'] if c['cell_type'] == 'code']; print('NB_OK')"
   ```
3. 使用 `gdrive` CLI 原地覆盖更新（保持同一个 Colab URL 不变）：
   ```powershell
   gdrive readonly search --name-exact "comfyui_minimax_h3.ipynb" --json
   gdrive mutate update <FILE_ID> "tools-local/colab/comfyui_minimax_h3.ipynb" --mime-type "application/vnd.google.colaboratory"
   ```

### 3. 修改 WebAsset 后端后的重启与验收

1. 跑单元测试：`node --test webasset/tests/comfy-studio.test.mjs`（以及全量 `npm run test:webasset`）。
2. **必须重启运行中的 `node webasset/server.mjs`（4174/4175）**，否则内存中的旧路由不会更新。
3. 端到端实机冒烟：提交一条真实请求到 `POST http://127.0.0.1:4174/api/comfy/generate/image`，轮询 `GET /api/comfy/jobs/<promptId>` 至 `done`，并**实际读取生成的图片文件目检**提示词还原度与画质。

---

## 已验证模型与节点配方（ComfyUI 0.46.0 + CUDA 13）

### 1. 生图主选：Qwen-Image-2.1-Turbo（原生中文，8 步极速）
- **模型来源**：`Comfy-Org/Qwen-Image-2.1`
  - `diffusion_models/qwen_image_2.1_turbo_int8_convrot.safetensors`
  - `text_encoders/qwen3vl_8b_w4a8.safetensors`
  - `vae/qwen_image_2.1_vae_bf16.safetensors`
- **节点连线**（`buildQwenImage21Prompt`）：
  - `UNETLoader` → `QwenImage21Cache(device="auto", dtype="default")` → `KSampler(steps=8, cfg=1.0, sampler="euler", scheduler="simple")`
  - `CLIPLoader(type="qwen_image")` → `TextEncodeQwenImage21(resolution按32取整)` → `KSampler`
  - `EmptyLatentImage` → `KSampler` → `VAEDecode` → `SaveImage`
- **特性**：原生理解中文，直接传原始中文提示词；T4 `--lowvram` 下 `1024×1024` 首次加载含推理约 `73s`。

### 2. 生图备选：FLUX.1-schnell FP8（4 步）
- **模型来源**：`Comfy-Org/flux1-schnell`
- **节点连线**（`buildFluxImagePrompt`）：`CheckpointLoaderSimple` → `CLIPTextEncode`（正）+ `ConditioningZeroOut`（负）→ `EmptySD3LatentImage` → `KSampler(steps=4, cfg=1.0, sampler="euler", scheduler="simple")` → `VAEDecode` → `SaveImage`。
- **特性**：英文编码器，后端检测到汉字时自动调用 `translatePromptToEnglish`（Google Translate → MyMemory 双路回退）再送入节点。

### 3. 音视频同出：MiniMax H3
- **基础模型来源**：`Comfy-Org/MiniMax-H3`
  - `minimax_h3_fl2va_int8_convrot.safetensors`（非 pruned 完整版，兼容 Turbo LoRA）或 `minimax_h3_fl2va_pruned_fp8_scaled.safetensors`
  - `minimax_h3_video_vae_fp16.safetensors` + `minimax_h3_audio_vae_fp32.safetensors`
- **越狱文本编码器（Heretic）**：`ethanfel/Qwen3-VL-32B-Ultra-Heretic-MiniMax-H3-ComfyUI-INT8-ConvRot`
  - `qwen3vl_32b_h3_ultra_uncensored_heretic_int8_convrot.safetensors`（24.55 GB，推荐；`bf16` 为 47.97 GB）
  - 可选增强尾层：`qwen3vl_32b_h3_generation_tail_50_63_int8_convrot.safetensors`（7.09 GB，仅用于 Prompt Enhancer，**不可作为 `CLIPLoader` 主模型**，后端已过滤 `*generation_tail*`）
- **Turbo LoRA 加速（4–8 步）**：`t8star/minimax-h3-4step-turbo-loras-comfyui-exp`
  - `minimax_h3_turbo_v4_step600_comfyui_T8-convert.safetensors`（放 `models/loras/`）
  - **严格约束**：必须搭配未裁剪（non-pruned）主模型（如 `minimax_h3_fl2va_int8_convrot.safetensors`）并通过 `LoraLoaderModelOnly` 挂载；采样器固定 `euler`、调度器 `beta`、建议 `8` 步（4 步单采样易爆音）。
- **自定义节点**：`ethanfel/ComfyUI-MiniMax-H3-Guide`、`T8mars/comfyui-minimax-h3-audio-T8`
- **节点连线**（`buildMiniMaxH3VideoPrompt`）：
  - `UNETLoader`（有 Turbo LoRA 且存在非 pruned 主模型时串接 `LoraLoaderModelOnly`）+ `CLIPLoader(type="minimax")` + 双 `VAELoader` → `MiniMaxH3ImageToVideo`（图生视频时通过 `/upload/image` 上传并连 `first_frame`）
  - `RandomNoise` + `BasicGuider` + `KSamplerSelect`（Turbo: `euler`，默认: `res_multistep`）+ `BasicScheduler`（Turbo: `beta`/8 步，默认: `simple`/20 步）→ `SamplerCustomAdvanced`
  - `VAEDecode` + `VAEDecodeAudio` → `CreateVideo(fps=24)` → `SaveVideo(format="mp4", codec="auto")`
- **帧数对齐**：`length` 必须对齐 `17k + 5` 网格（`snapH3Frames`：`3s → 73`，`5s → 124`）。

---

## 已踩坑与排错清单

| 现象 / 错误 | 根因 | 解决方案 |
|---|---|---|
| `ModuleNotFoundError: No module named 'torchsde'` | Cell 2 过滤 `requirements.txt` 时用了 `startswith("torch")`，误杀 `torchsde` | 必须使用精确正则 `^(?:torch\|torchvision\|torchaudio)(?:$\|[<>=!~;\s\[])` |
| `RuntimeError: Given normalized_shape=[4096], expected input with shape [*4096], but got input of size[1, 512, 12288]` | `ComfyUI-GGUF` 的 `CLIPLoaderGGUF` 加载 Qwen3-VL GGUF 时堆叠了 3 层隐藏态（`3×4096=12288`），与 `qwen_image_2.1_turbo_int8_convrot` 的 `4096` 维不匹配 | 对 `Qwen-Image-2.1-Turbo` 统一使用原生 `CLIPLoader(type="qwen_image")` + `qwen3vl_8b_w4a8.safetensors` |
| `FLUX.1-schnell` 对中文画出雪屋/乱码汉字 | CLIP-L/T5 不理解中文语义，且单路翻译超时会静默回退原文 | 首选 `Qwen-Image-2.1-Turbo` 原生中文；FLUX 走双路翻译回退并记录警告日志 |
| T4（15GB VRAM）启动爆显存 | Cell 5 默认 `--highvram` | T4 固定使用 `--lowvram`；切换 A100/G4 后再改回 `--highvram` |
| `main.py: error: unrecognized arguments: --normalvram` | ComfyUI 0.46.0 无 `--normalvram` 参数（仅支持 `--gpu-only`/`--highvram`/`--lowvram`/`--novram`/`--cpu`） | L4 等 24GB+ 卡将 `EXTRA_ARGS` 留空 `""`（默认自动管理）或降为 `--lowvram` |
| 改完 `comfy-studio-server.mjs` 后页面仍是 404/旧行为 | 本机 `4174` 进程未重启 | 停止旧 `node webasset/server.mjs` 进程后重新拉起 daemon 再验 |
