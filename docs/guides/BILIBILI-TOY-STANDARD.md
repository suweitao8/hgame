# Bilibili Toy 平台接入与打包发布标准

本文档定义 HGame 项目面向 **B 站 Toy 平台**（`https://www.bilibili.com/toy/<slug>/index.html`）的最终打包规范、运行时 SDK 接入方式与审核前校验流程。

## 1. 核心目标与规范来源

- 官方发布与能力文档：`https://www.bilibili.com/toy/publish/sdk`、`/sdk/cli`、`/sdk/skill`、`/guide`
- 官方 CLI & Skill 仓库：`https://github.com/bilibili/toy`（`toy` CLI `v0.6.6+`）
- 对应引擎技能包：[.agents/skills/hgame-bilibili-toy/SKILL.md](../../.agents/skills/hgame-bilibili-toy/SKILL.md)

## 2. 打包标准（`--target toy`）

禁止直接提交源码目录或带外层文件夹的普通 ZIP。所有面向 B 站 Toy 的发布包统一通过 `--target toy` 生成：

```powershell
# 在引擎根目录执行
npm run package:toy -- "<game-dir>" --version 1.0 --slug <slug> --poster cover.png --icon icon.png

# 或在独立游戏工程内执行
npm run package:toy -- --version 1.0 --slug <slug>
```

`--target toy` 强制执行的标准：
1. **扁平 ZIP 根目录（`flatZip: true`）**：`index.html` 直接位于压缩包与输出目录根目录。
2. **内容指纹（`contenthash`）**：自动为入口 `style.css` / `src/main.js` 生成带 8 位 SHA-256 指纹的文件名并重写 `index.html` 引用，命中 Toy CDN 跨版本资源复用优化。
3. **按需注入 `toy-sdk.js`**：当启用 `--toy-sdk`、`game.config.json` 配置 `"toy": { "sdk": true }`、或代码引用 `integrations/bilibili-toy.js` / `window.toy` 时，自动在 `<head>` 注入 `<script src="//s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js"></script>`。
4. **自动执行 Toy 预检门禁（`scripts/toy-preflight.mjs`）**：
   - **ERROR（直接阻断）**：入口 `index.html` 解压后 > 1 MB（服务端错误码 `307000`）、根相对路径 `/assets/...` 或 `location.href = "/..."`、本地引用缺失、图片宽高 >= 10000 px、非法 `slug`/`poster`/`icon`（icon 须 <= 512 KB 且 <= 1024×1024 px）、包内含 `.git`/`node_modules`/`toy.yaml` 等杂物。
   - **WARN（必须告知）**：非入口 HTML >= 12 MB、缺少 `<title>`、修改 `location.hash`/`history.pushState`、循环/定时器/高频帧回调调用云存储或排行榜且未处理 `307044` 限流退避、缺少 contenthash、以及所需账号能力权限提醒（`AUDIO_VIDEO_UPLOAD`、`EXTERNAL_SERVICE_ACCESS`、`USER_CONTENT_INPUT`、`CHARGE_UNLOCK`、`LARGE_PACKAGE_UPLOAD`）。

## 3. HGame Toy SDK 桥接（`integrations/bilibili-toy.js`）

```js
import {
  createToyBridge,
  createToyCloudSaveAdapter,
  loadBilibiliToySdk,
} from '../vendor/hgame/integrations/bilibili-toy.js';

await loadBilibiliToySdk();
const toy = createToyBridge({ gameId: gameConfig.id });
const cloudSave = createToyCloudSaveAdapter({ bridge: toy });
```

- **本地无痛调试**：在本地 `preview.mjs` 或无头测试中无 `window.toy` 时自动回退到 `localStorage` / 内存，确保同一套代码在本地与 B 站线上均可运行。
- **内置防限流规范**：云存储按「内存读写 + 关键节点/切后台批量 `flush()`」，并内置 `307044` 抖动指数退避重试。
- **全能力覆盖**：支持用户/作者/视频互动数据、云存储、跨作品共享存档（`sharedStorage`）、排行榜（1–5 榜位）、输入内容安全检测（`checkInputSafety`）、二维码与 App/Web 自适应保存图片、容器模式控制、摄像头/麦克风及充电档位解锁（`minPrice` 单位为分，建议 >= 1200）。

## 4. 提交流程（两段式预览确认）

1. 运行 `npm run package:toy -- ...`（或 `npm run toy:check -- <dir|zip>`）。
2. 先执行不带 `--yes` 的 `toy create <dir|zip> --json ...`（或 `toy update <id> <dir|zip> --json`）获取 `preview_url`。
3. 人工在浏览器/B 站 App 核验预览效果并明确确认后，再带同参数与 `--yes` 提交审核。
4. 发布后分享请使用 `https://www.bilibili.com/toy/<slug>/index.html`。
