# 微信、抖音与 TapTap 小游戏打包

HGame 可从同一个原生入口导出微信、抖音和 TapTap 小游戏。每次构建生成原生工程目录和同名 ZIP。各平台使用自己的 AppID 和发行流程。

## 导出命令

在 HGame 仓库根目录运行，使用相应平台分配的 AppID。

```powershell
npm run package:wechat -- <游戏目录> --appid <微信小游戏AppID>
npm run package:douyin -- <游戏目录> --appid <抖音小游戏AppID>
npm run package:taptap -- <游戏目录> --appid <TapTap小游戏AppID>
```

默认使用 `game.config.json` 的版本号，可用 `--version` 覆盖。工程位于游戏目录的 `build/<id>_<version>_<platform>/`。目录和默认 ZIP 的根目录包含 `game.js`、`game.json`、`project.config.json` 以及本地运行资源。

微信和抖音开发者工具使用工程目录。TapTap 使用根目录平铺的 ZIP，并将版本写成三段式，例如 `1.2` 会写成 `1.2.0`。省略 `--appid` 可导出本地验证样板，平台预览和上传使用真实小游戏 AppID 与账号权限。TapTap 真机调试也可从工程目录启动官方调试插件。[TapTap 包体规范](https://developer.taptap.cn/minigameapidoc/quick-start/guide/creation-improvement/) · [TapTap 真机调试](https://developer.taptap.cn/minigameapidoc/dev/dev-support/debugging/)

可以直接构建仓库自带的点靶样板。

```powershell
npm run package:wechat -- tests/fixtures/minigame-canvas
npm run package:douyin -- tests/fixtures/minigame-canvas
npm run package:taptap -- tests/fixtures/minigame-canvas
```

新生成的游戏也可在本目录运行对应的 npm 打包命令，运行前安装本项目的 esbuild 开发依赖。已有游戏可直接调用 HGame 根目录的命令。已同步打包脚本的项目可以使用 `node scripts/package-game.mjs --target <platform>`。

## 游戏入口

在游戏根目录添加 `minigame.config.json`。

```json
{
  "entry": "src/minigame.js",
  "deviceOrientation": "portrait",
  "assets": ["assets/level.json", "assets/hit.wav"]
}
```

- `entry` 指向 `src/` 下的 JavaScript 或 TypeScript 文件，导出 `start(host)`。编译器将它及静态依赖合并为 `game.js`。游戏代码、数据模块可从 `src/` 相对导入，也可用 `@hgame/platform/storage.js` 一类路径引用 HGame 模块。异步初始化写在 `start` 内。
- `deviceOrientation` 支持 `portrait`、`landscape`，默认竖屏。
- `assets` 枚举要发布的 `assets/` 下的本地文件。打包器优先使用项目文件，缺失时按 `assets.manifest.json` 从 HGame 资产库读取。三端保留同一资源相对路径。单包预检按未压缩工程体积计算，微信 4 MiB、抖音 20 MiB、TapTap 60 MiB。TapTap 审核规范另列 20 MB，发布时以开发者后台的实际门槛为准。三端图片可使用 PNG 或 JPG，抖音的上传格式参见其开发指南。[TapTap 开发限制](https://developer.taptap.cn/minigameapidoc/dev/tutorial/overview/) · [TapTap 审核规范](https://developer.taptap.cn/minigameapidoc/tap-operation/operation-standards/review-standards/)

点靶源码位于 HGame 仓库的 `tests/fixtures/minigame-canvas/src/main.js`。项目可以共享关卡和玩法模块，同时保留各自的浏览器入口和小游戏入口。原生运行时使用平台画布和触控，HTML/CSS 界面需要使用画布重绘。当前样板验证 Canvas 2D，使用 Pixi、Three.js、Rapier WASM 或浏览器专用 API 的项目需要单独适配及验证。

使用 HGame 调度器的项目可分模块导入 `@hgame/core/application.js` 和 `@hgame/integrations/canvas2d.js`，给 `createGameApplication` 传入原生 `platform` 服务，以及 `host.requestFrame` 和 `host.cancelFrame`，把 DOM 或浏览器平台服务留在 Web 入口。Canvas 2D 入口使用 `physics: 'none'`。

## 宿主接口

| 接口 | 用途 |
| --- | --- |
| `host.canvas` | 原生上屏画布，像素尺寸随窗口更新 |
| `host.viewport` | `width`、`height` 为逻辑像素，`pixelRatio` 为像素密度 |
| `host.onTouch(phase, listener)` | 接收 `start`、`move`、`end`、`cancel`，坐标为窗口逻辑像素 |
| `host.onResize(listener)`、`host.onVisibility(listener)` | 在尺寸变化时重绘，在前后台变化时调整循环及音频。订阅返回取消函数 |
| `host.requestFrame(callback)`、`host.cancelFrame(id)` | 使用宿主帧调度 |
| `host.assets.readText/readJson/readArrayBuffer/loadImage(path)` | 读取包内声明的资源 |
| `host.assets.createAudio(path, options)` | 返回平台音频对象，游戏可调用 `play`、`pause` 和 `destroy` |
| `host.storage` | 供 HGame `createSaveStore` 使用的本地存储后端 |
| `host.target`、`host.game` | 目标平台及游戏 ID、名称、版本 |

## 平台 SDK

微信、抖音和 TapTap 的 `start(host)` 都可以调用 `host.sdk`。在用户主动触发登录、分享或激励视频的交互时调用对应接口。

| 接口 | 行为 |
| --- | --- |
| `sdk.supports(name)` | 判断宿主是否提供 `login`、`checkSession`、`getLaunchOptions`、`share`、`rewardedVideo` 对应接口 |
| `await sdk.login()` | 返回一次性账号凭证 `{ code }`。项目服务端用它换取平台登录态 |
| `await sdk.checkSession()`、`sdk.getLaunchOptions()` | 查询宿主登录态是否仍有效，或读取分享等启动参数 |
| `await sdk.share(options)` | 微信用 `title`、`imageUrl`、`query`。抖音用 `title`、`query`、`templateId`、`channel`。TapTap 用后台配置的 `templateId` 和可选的 `sceneParam` |
| `await sdk.showRewardedVideo(adUnitId)` | 等待广告关闭，只有宿主明确确认播完时才返回 `{ completed: true }`。使用各平台自己的广告位 ID |
| `sdk.native` | 提供 `wx`、`tt` 或 `tap` 的原生接口，供云存档、排行榜和各平台专属能力使用 |

分享结果中，微信的 `requested` 表示已请求分享，抖音的 `shared` 或 `cancelled` 表示平台已回调结果，TapTap 的 `opened` 表示已打开面板。TapTap 的实际分享结果可用 `sdk.native.onShareMessage` 监听。[抖音分享 API](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/api/javascript-api/open-capacity/retweet/tt-share-app-message) · [TapTap 分享 API](https://developer.taptap.cn/minigameapidoc/dev/api/open-api/share/tap.showShareboard/)

账号会话交换、AppSecret 和广告配置由各游戏项目提供。TapTap 发布包需要实际接入 TapTap 登录，内置样板用于本地验证。微信、抖音和 TapTap 均应在相应客户端验证登录与广告。B 站 Toy 继续使用 `createToyBridge`。[TapTap 登录管理](https://developer.taptap.cn/minigameapidoc/dev/tutorial/open-capabilities/login-management/) · [TapTap 审核规范](https://developer.taptap.cn/minigameapidoc/tap-operation/operation-standards/review-standards/)

[微信官方示例](https://github.com/wechat-miniprogram/minigame-demo) · [抖音小游戏开发指南](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/guide/dev-guide/bytedance-mini-game) · [TapTap 原生小游戏开发指南](https://developer.taptap.cn/minigameapidoc/dev/tutorial/overview/)
