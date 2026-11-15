# 游戏实况视频取证

本模块只服务于游戏逆向：从实况、录屏、官方演示或用户提供的视频中恢复可观察的玩法、UI 语义、关卡结构和时序证据。它不能代替程序/数据取证，也不能从视频单独推断不可见的内部实现。

## 工作流

1. **元数据**：记录标题、来源 URL、上传者、发布日期、时长、分辨率、视频 ID 和分 P。多分 P 时先检查 pages/playlist 元数据，再只下载目标分 P；目标不明确时先询问，不默认下载整个合集。
2. **下载**：使用 yt-dlp 下载用户指定或允许访问的视频；保留原始文件、元数据 JSON 和下载日志。不要导出浏览器 Cookie、绕过访问控制或访问未授权内容。
3. **快速概览**：用 ffprobe 读取帧率/时长/尺寸；游戏实况通常每 10–15 秒抽一帧，慢节奏 UI/菜单可放宽到 20–30 秒。先生成带时间戳的 contact sheet，不要把长视频逐帧全量解码。
4. **定位关键段**：结合场景切换候选、字幕/转写和概览图，定位开始、教程、战斗、失败、胜利、升级、地图切换、菜单等关键事件。
5. **局部复核**：只对关键时段提取原分辨率帧或局部裁剪，放大难辨认的 HUD、卡牌、按钮、状态图标和文字；模糊内容标记为未确认。
6. **形成证据**：每条关键结论写明视频 ID、分 P、时间戳、截图路径和事实等级。保留原始视频、元数据、帧图、网格、转写和分析文档，不覆盖源文件。

## Bilibili 单分 P 取证命令

先从 URL 识别 BV 号，再读取分 P 元数据；不要用全合集下载来代替选段：

    curl.exe -sS -H "User-Agent: Mozilla/5.0" -H "Referer: https://www.bilibili.com/" "https://api.bilibili.com/x/web-interface/view?bvid=<BV号>"

检查返回 JSON 的 title、duration、pages[]、part、cid 和每个分 P 的 duration。多分 P 视频必须由用户指定或按明确标题匹配目标分 P；匹配不确定时先问。

只下载选定的分 P（480p 通常足以做玩法概览；需要更高分辨率时先确认是否值得）：

    python -m yt_dlp --playlist-items <N> -f "bv*[height<=480][vcodec!=none]/bv*[height<=480]" -o "downloads/P<N>.%(ext)s" --no-part --newline "<URL>"

若需要分析语音/音效，才另外获取音轨或下载含音频的视频；不需要音频时优先下载纯视频流以减少体积。更高清内容需要登录时，必须得到用户明确授权后才可使用浏览器现有登录态；不复制或导出 Cookie。

下载后校验媒体信息：

    ffprobe -v error -show_entries format=duration -show_entries stream=width,height,codec_name -of json "downloads/P<N>.mp4"

## 抽帧与网格

以 12 秒为例（可按内容改成 10–15 秒），先生成概览帧：

    ffmpeg -i "downloads/input.mp4" -vf "fps=1/12,scale=640:-2" -q:v 4 "frames/f_%04d.jpg"

每 12 帧拼成 4×3 网格：

    ffmpeg -framerate 1 -i "frames/f_%04d.jpg" -vf "tile=4x3" -q:v 4 "grids/grid_%03d.jpg"

时间换算：`grid N` 的第 `k` 帧对应 `t = ((N - 1) × 12 + k) × 12` 秒。按采样间隔 N 秒时，帧索引只能用于快速定位；精确时间以 ffprobe/ffmpeg 的媒体时间戳和分 P 起始偏移为准。网格用于建立全片时间轴，不用于判读模糊小字。

## 场景切换与定点复核

场景切换检测可用于候选定位（阈值按素材调整）：

    ffmpeg -i "downloads/input.mp4" -vf "select='gt(scene,0.3)',showinfo" -f null - 2> "scene-cuts.log"

从 showinfo 中读取 pts_time，再在切换点后约 0.5、2.5、5.5 秒抽取稳定画面；也可按网格线索定点抽帧：

    ffmpeg -ss 300 -i "downloads/input.mp4" -frames:v 1 -q:v 3 "probe/t300.jpg" -y

对低分辨率下有歧义的 UI/图标进行裁剪放大，不要靠猜：

    ffmpeg -i "probe/t2380.jpg" -vf "crop=560:80:150:0,scale=1680:-1" "probe/t2380_detail.jpg" -y

分析顺序：先通读网格建立时间轴；用切换点定位关卡/章节边界；在边界后的稳定态复核 HUD/装备/资源栏；最后才对关键帧局部放大。每条结论都记录来源时间戳，供之后回查。

## 证据等级

- **Observed fact**：画面/声音中直接可见或可听的事实，必须附 timestamp 和截图/片段。
- **Inference**：从多个重复行为推断出的规则，说明推理依据并标为推断。
- **Unknown**：视频无法证明的内容，明确列为待查问题，不用同类型游戏惯例补全。

必须区分玩家输入、自动动画、AI 决策、脚本演出和镜头剪辑。单帧或低帧率视频不能确定精确 hitbox、冷却、随机概率、物理参数或内部帧时序；这些需要程序证据或重复实验。

## 分析范围

提取：核心循环、目标、操作、状态切换、资源、胜败条件、敌人/技能行为、关卡/遭遇结构、UI/HUD 语义、节奏/难度、音频事件和实现风险。

在严格干净室重构项目中，严格遵守目标仓库 `AGENTS.md`：视频只用于玩法和可读 UI 证据，不做原作画风、材质、灯光、Shader、后处理、粒子外观或像素级布局复刻。其他项目按用户明确范围决定。

## 输出目录

- 统一使用独立研究工作区目录（`<reWorkspaceDir>/projects/<slug>/video/`），按 `metadata/`、`original/`、`frames/`、`transcripts/`、`evidence/` 分开，严禁写入原版游戏目录。
- 超过 10 分钟的视频不要逐帧全量解码；先稀疏概览，再按事件和场景切换定点复核。
