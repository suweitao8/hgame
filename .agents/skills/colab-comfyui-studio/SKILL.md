---
name: colab-comfyui-studio
description: Google Colab + ComfyUI + WebAsset `#studio` 远程生图与音视频生成自动化管线。Use whenever the user asks to 启动或停机 Colab ComfyUI、重连或更新 Colab Notebook、切换 Colab GPU（L4/G4/T4）、给 WebAsset「生成」Tab 新增或调试生图/视频模型（Z-Image-Turbo / RealVisXL V5.0 Lightning / Qwen-Image-2.1-Turbo / FLUX.1-schnell / MiniMax H3 Heretic），或更新 Cloudflare Tunnel 地址到 WebAsset。
---

# Colab + ComfyUI + WebAsset `#studio` 管线

通过 **Google Drive (`gdrive` CLI) + Colab (`browser` subagent) + 本地 WebAsset (`http://127.0.0.1:4174/#studio`)** 打通云端 GPU 推理与本地极简生图/音视频工作台。

## 核心组件与路径

| 组件 | 路径 / 入口 | 说明 |
|---|---|---|
| Colab Notebook | `tools-local/colab/comfyui_minimax_h3.ipynb` | gitignored 本地工作本，6 个 Cell（说明 + 5 个表单代码单元） |
| Drive 同步 | `gdrive` CLI（`gdrive` 插件） | `--mime-type "application/vnd.google.colaboratory"` 原地更新 |
| WebAsset 后端 | `webasset/lib/comfy-studio-server.mjs` | `/api/comfy/*`、`/files/comfy-studio/*`、分辨率换算、任务队列与耗时持久化 |
| WebAsset 前端 | `webasset/public/index.html`、`webasset/public/js/hgame-studio.js` | `#studio` Tab（模型切换 `RealVisXL`/`Z-Image`/`Qwen2.1`、规格+比例、实时计时角标、图生视频联动） |
| 后端配置与产物 | `webasset/.cache/comfy-studio/` | `config.json`（存 `url`）、`history.json`、`outputs/` |
| 单元测试 | `webasset/tests/comfy-studio.test.mjs` | 覆盖 `snapH3Frames`、`resolveStudioDimensions`、模型路由、工作流构建与 HTTP 全链路 |

> **安全与卫生纪律**：禁止将个人邮箱、本机绝对路径、HF Token 或临时 `trycloudflare.com` 地址写入仓库提交文件中。

---

## 标准操作流

### 1. GPU 分级与 Drive 模型持久化

- **L4（24GB）高 RAM（当前默认）**：日常生图与常规开发性价比最高；Cell 5 `EXTRA_ARGS = ""`（留空即默认 `NORMAL_VRAM` + `DynamicVRAM`；若跑超大 H3 视频爆显存可降为 `--lowvram`）。
- **G4（RTX PRO 6000 Blackwell 96GB）高 RAM**：大型模型与高分辨率批量视频生成性价比最高（跑 `1080p` / `8s–10s` 视频建议切至此卡），Cell 5 配 `EXTRA_ARGS = "--highvram"`。
- **T4（15GB）高 RAM**：仅作低成本备用，Cell 5 固定 `EXTRA_ARGS = "--lowvram"`。
- **模型持久化（`CACHE_MODELS_ON_DRIVE = True`）**：Cell 1 默认勾选，将 `/content/ComfyUI/models` 软链到 `MyDrive/ComfyUI_Colab/models`（需网盘剩余空间 ≥ 120 GB）。切换 L4 / G4 或重新开机时，**仅需跑 Cell 1（挂盘）→ Cell 2（约 1 分钟装依赖与插件）→ Cell 5（启动）**，全程约 **2–3 分钟**，已存模型自动跳过免重复下载。

### 2. 启动、热加模型与停机释放算力

1. **使用 `browser` subagent 操作 Colab**：
   - 首次登录、`accounts.google.com` OAuth 弹窗或 Google reCAPTCHA 人机验证属于受保护流程，**必须立即暂停并请用户在浏览器面板手动确认**，随后用 `send_message` 唤醒同一 subagent 继续。
   - 切换 GPU 类型前，先在 **代码执行程序 → 管理会话（正在进行的会话）** 删除旧会话再切换并连接，避免 Colab 自动重连旧 VM。
   - 若仅修改 Notebook 局部单元，刷新时保留已连接运行时；若仅需往已运行实例热加模型，可直接打开 Colab 底部 **终端** 下载至 `/content/ComfyUI/models/`（会同步落盘 Google Drive），无需重启 Cell 5，`probeComfyModels` 即可检出新权重。
2. **注册最新 Tunnel 地址到本地 WebAsset**：
   - Cell 5 输出 `https://<random>.trycloudflare.com` 与 `To see the GUI go to` 后，写入配置并探活：
     ```powershell
     $body = @{ url = "https://<subdomain>.trycloudflare.com" } | ConvertTo-Json
     Invoke-RestMethod -Uri "http://127.0.0.1:4174/api/comfy/config" -Method Post -ContentType "application/json" -Body $body
     ```
   - 确认返回 `connected: true` 且 `models` 中包含预期权重（也支持环境变量 `WEBASSET_COMFY_URL` 或 `.hgame.local.json` 的 `comfyUrl` 回退）。
3. **停机释放算力**：
   - 停止 Cell 5 → **代码执行程序 → 断开连接并删除运行时** → 打开 **管理会话** 核验 `没有正在进行的会话`，防止继续扣除算力。

### 3. 修改并热更新 Colab Notebook

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

### 4. 分辨率、宽高比与时长规范

- **`resolveStudioDimensions(resolution, aspectRatio)`**（32 像素对齐，支持前端直算或后端传 `resolution` + `aspectRatio`）：
  - `1080p`：`16:9 → 1920×1088`、`4:3 → 1440×1088`、`1:1 → 1088×1088`、`3:4 → 1088×1440`、`9:16 → 1088×1920`
  - `720p`：`16:9 → 1280×736`、`4:3 → 960×736`、`1:1 → 736×736`、`3:4 → 736×960`、`9:16 → 736×1280`
  - `480p`（视频）：`16:9 → 864×480`、`4:3 → 640×480`、`1:1 → 480×480`
- **H3 帧数对齐 `snapH3Frames(seconds)`**：24fps 对齐 `17k + 5` 网格（`3s → 73`、`5s → 124`、`8s → 192`、`10s → 243`）。
- **前端不要写死 `steps`**：`hgame-studio.js` 不传固定 `steps`，由后端按实际命中的模型自动使用最佳步数。

### 5. 修改 WebAsset 后端后的重启与验收

1. 跑单元测试：`node --test webasset/tests/comfy-studio.test.mjs` 与 `npm run test:webasset`。
2. **必须重启运行中的 `node webasset/server.mjs`（4174/4175）**，否则内存中的旧路由不会更新。
3. 端到端实机冒烟：提交真实请求到 `POST http://127.0.0.1:4174/api/comfy/generate/image`，轮询 `GET /api/comfy/jobs/<promptId>` 至 `done`，并**实际读取生成的图片文件目检**提示词还原度与画质。

---

## 已验证模型与节点配方（ComfyUI 0.46.0 + CUDA 13）

> **边界提示**：生图模型（`Z-Image` / `RealVisXL` / `Qwen2.1`）与视频模型（`MiniMax H3`）底层完全独立，在 `#studio` 中通过「转视频」实现 **首帧图 → H3 图生视频** 联动。

### 1. 生图：Z-Image-Turbo（原生中英、9 步极速）
- **模型来源**：`Comfy-Org/z_image_turbo`
  - `split_files/diffusion_models/z_image_turbo_bf16.safetensors`（11.46 GB，放 `models/diffusion_models/`）
  - `split_files/text_encoders/qwen_3_4b.safetensors`（7.49 GB，放 `models/text_encoders/`）
  - `split_files/vae/ae.safetensors`（320 MB，放 `models/vae/`）
- **节点连线**（`buildZImageTurboPrompt`）：
  - `UNETLoader` → `ModelSamplingAuraFlow(shift=3.0)` → `KSampler(steps=9, cfg=1.0, sampler="res_multistep", scheduler="simple")`
  - `CLIPLoader(type="lumina2")` → `CLIPTextEncode`（正）+ `ConditioningZeroOut`（负）→ `KSampler`
  - `EmptySD3LatentImage` → `KSampler` → `VAEDecode` → `SaveImage`
- **特性与边界**：原生理解中英文，直接传原始提示词；L4 从 Drive 冷加载出首图约 `83.6s`，热缓存后约 `17.7s`。属官方预训练底模，对露骨 NSFW 内容仍有限制。

### 2. 生图：RealVisXL V5.0 Lightning（写实人像、6 步极速）
- **模型来源**：`SG161222/RealVisXL_V5.0_Lightning`
  - `RealVisXL_V5.0_Lightning_fp16.safetensors`（约 6.46 GB，OpenRAIL++，放 `models/checkpoints/`）
- **节点连线**（`buildSdxlRealisticImagePrompt`）：
  - `CheckpointLoaderSimple` → `CLIPTextEncode`（正 + 写实负向提示词）→ `EmptyLatentImage` → `KSampler(steps=6, cfg=1.8, sampler="dpmpp_sde", scheduler="karras")` → `VAEDecode` → `SaveImage`
- **特性**：写实社区底模（`#studio` 默认选中 `sdxl`），中文提示词自动走 `translatePromptToEnglish`。

### 3. 生图：Qwen-Image-2.1-Turbo（原生中文、8 步极速）
- **模型来源**：`Comfy-Org/Qwen-Image-2.1`
  - `diffusion_models/qwen_image_2.1_turbo_int8_convrot.safetensors`
  - `text_encoders/qwen3vl_8b_w4a8.safetensors`
  - `vae/qwen_image_2.1_vae_bf16.safetensors`
- **节点连线**（`buildQwenImage21Prompt`）：
  - `UNETLoader` → `QwenImage21Cache(device="auto", dtype="default")` → `KSampler(steps=8, cfg=1.0, sampler="euler", scheduler="simple")`
  - `CLIPLoader(type="qwen_image")` → `TextEncodeQwenImage21(resolution按32取整)` → `KSampler`
  - `EmptyLatentImage` → `KSampler` → `VAEDecode` → `SaveImage`
- **特性**：原生理解中文，T4 `--lowvram` 下 `1024×1024` 首次加载含推理约 `73s`。

### 4. 生图备选（轻量）：FLUX.1-schnell FP8（4 步）
- **模型来源**：`Comfy-Org/flux1-schnell`
- **节点连线**（`buildFluxImagePrompt`）：`CheckpointLoaderSimple` → `CLIPTextEncode`（正）+ `ConditioningZeroOut`（负）→ `EmptySD3LatentImage` → `KSampler(steps=4, cfg=1.0, sampler="euler", scheduler="simple")` → `VAEDecode` → `SaveImage`。
- **特性**：英文编码器，检测到汉字自动走 `translatePromptToEnglish`（Google Translate → MyMemory 双路回退）。

### 5. 音视频同出：MiniMax H3（Heretic 越狱 + Turbo LoRA）
- **基础模型来源**：`Comfy-Org/MiniMax-H3`
  - `minimax_h3_fl2va_int8_convrot.safetensors`（32 GB，非 pruned 完整版，兼容 Turbo LoRA）或 `minimax_h3_fl2va_pruned_fp8_scaled.safetensors`
  - `minimax_h3_video_vae_fp16.safetensors`（4.9 GB）+ `minimax_h3_audio_vae_fp32.safetensors`（578 MB）
- **越狱文本编码器（Heretic）**：`ethanfel/Qwen3-VL-32B-Ultra-Heretic-MiniMax-H3-ComfyUI-INT8-ConvRot`
  - `qwen3vl_32b_h3_ultra_uncensored_heretic_int8_convrot.safetensors`（24.55 GB，推荐；`bf16` 为 47.97 GB）
  - 可选增强尾层：`qwen3vl_32b_h3_generation_tail_50_63_int8_convrot.safetensors`（7.09 GB，仅用于 Prompt Enhancer，**不可作为 `CLIPLoader` 主模型**，后端已过滤 `*generation_tail*`）
- **Turbo LoRA 加速（4–8 步）**：`t8star/minimax-h3-4step-turbo-loras-comfyui-exp`
  - `minimax_h3_turbo_v4_step600_comfyui_T8-convert.safetensors`（744 MB，放 `models/loras/`）
  - **严格约束**：必须搭配未裁剪（non-pruned）主模型（如 `minimax_h3_fl2va_int8_convrot.safetensors`）并通过 `LoraLoaderModelOnly` 挂载；采样器固定 `euler`、调度器 `beta`、建议 `8` 步（4 步单采样易爆音）。
- **自定义节点**：`ethanfel/ComfyUI-MiniMax-H3-Guide`、`T8mars/comfyui-minimax-h3-audio-T8`
- **节点连线**（`buildMiniMaxH3VideoPrompt`）：
  - `UNETLoader`（有 Turbo LoRA 且存在非 pruned 主模型时串接 `LoraLoaderModelOnly`）+ `CLIPLoader(type="minimax")` + 双 `VAELoader` → `MiniMaxH3ImageToVideo`（图生视频时通过 `/upload/image` 上传并连 `first_frame`）
  - `RandomNoise` + `BasicGuider` + `KSamplerSelect`（Turbo: `euler`，默认: `res_multistep`）+ `BasicScheduler`（Turbo: `beta`/8 步，默认: `simple`/20 步）→ `SamplerCustomAdvanced`
  - `VAEDecode` + `VAEDecodeAudio` → `CreateVideo(fps=24)` → `SaveVideo(format="mp4", codec="auto")`

---

## 已踩坑与排错清单

| 现象 / 错误 | 根因 | 解决方案 |
|---|---|---|
| `ModuleNotFoundError: No module named 'torchsde'` | Cell 2 过滤 `requirements.txt` 时用了 `startswith("torch")`，误杀 `torchsde` | 必须使用精确正则 `^(?:torch\|torchvision\|torchaudio)(?:$\|[<>=!~;\s\[])` |
| `RuntimeError: Given normalized_shape=[4096], expected input with shape [*4096], but got input of size[1, 512, 12288]` | `ComfyUI-GGUF` 的 `CLIPLoaderGGUF` 加载 Qwen3-VL GGUF 时堆叠了 3 层隐藏态（`3×4096=12288`），与 `qwen_image_2.1_turbo_int8_convrot` 的 `4096` 维不匹配 | 对 `Qwen-Image-2.1-Turbo` 统一使用原生 `CLIPLoader(type="qwen_image")` + `qwen3vl_8b_w4a8.safetensors` |
| `AtomicChat/Qwen-Image-2.1-Turbo-Uncensored-GGUF` 生图无越狱效果 | 该仓库面向 `stable-diffusion.cpp`，仅移除文本编码器聊天拒绝方向，官方 7B Denoiser 预训练已过滤 NSFW（作者 README 实测 45 条提示词 0 变化） | 不在 ComfyUI 中安装该 GGUF；改用 `RealVisXL` 等社区微调底模 |
| `CLIPLoader` 误选 `qwen3vl_32b_h3_generation_tail_*` 报错 | `generation_tail_50_63` 仅为第 50–63 层尾块，按字母序排在 `ultra_uncensored_heretic` 之前 | `comfy-studio-server.mjs` 自动过滤 `*generation_tail*` 并优先匹配 `ultra_uncensored_heretic` |
| `main.py: error: unrecognized arguments: --normalvram` | ComfyUI 0.46.0 无 `--normalvram` 参数（仅支持 `--gpu-only`/`--highvram`/`--lowvram`/`--novram`/`--cpu`） | L4 等 24GB+ 卡将 `EXTRA_ARGS` 留空 `""`（默认自动管理）或降为 `--lowvram` |
| T4（15GB VRAM）启动爆显存 | Cell 5 默认 `--highvram` | T4 固定使用 `--lowvram`；切换 G4/A100 后再改 `--highvram` |
| 切换 GPU 时一直自动重连旧 T4 会话 | 旧运行时仍在 Colab 后台存活 | 先打开 **管理会话** 删除旧会话，再修改运行时类型并连接 |
| 前端写死 `steps: 4` / `steps: 20` 覆盖后端最优步数 | `hgame-studio.js` 旧代码强传固定 `steps` | 前端不传 `steps`，交由后端按模型自动选用（RealVisXL `6`、Z-Image `9`、H3 Turbo `8`） |
| `FLUX.1-schnell` 对中文画出雪屋/乱码汉字 | CLIP-L/T5 不理解中文语义，且单路翻译超时会静默回退原文 | 首选 `Z-Image-Turbo` / `Qwen2.1`；英文底模走 `translatePromptToEnglish` 双路翻译回退 |
| 改完 `comfy-studio-server.mjs` 后页面仍是 404/旧行为 | 本机 `4174` 进程未重启 | 停止旧 `node webasset/server.mjs` 进程后重新拉起 daemon 再验 |
