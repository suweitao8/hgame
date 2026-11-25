# 微信与抖音小游戏打包

HGame 可从同一个原生入口导出微信和抖音小游戏。每次构建生成一个可供平台开发者工具导入的工程目录，以及同名 ZIP。两个平台各自拥有 AppID 和发布流程。

## 导出命令

在 HGame 仓库根目录运行，使用相应平台分配的 AppID。

```powershell
npm run package:wechat -- <游戏目录> --appid <微信小游戏AppID>
npm run package:douyin -- <游戏目录> --appid <抖音小游戏AppID>
```

默认使用 `game.config.json` 的版本号，可用 `--version` 覆盖。工程位于游戏目录的 `build/<id>_<version>_wechat/` 和 `build/<id>_<version>_douyin/`。工程和 ZIP 的根目录包含 `game.js`、`game.json`、`project.config.json` 以及本地运行资源。开发者工具导入工程目录。省略 `--appid` 也能构建产物，平台预览和上传使用开发者工具所要求的 AppID 和账号权限。

可以直接构建仓库自带的点靶样板。

```powershell
npm run package:wechat -- tests/fixtures/minigame-canvas
npm run package:douyin -- tests/fixtures/minigame-canvas
```

新生成的游戏也可在本目录运行 `npm run package:wechat` 和 `npm run package:douyin`。从游戏目录运行需要先安装本项目的 esbuild 开发依赖。已有游戏可直接调用 HGame 根目录的命令，已显式同步打包脚本的项目可用 `node scripts/package-game.mjs --target wechat` 或 `--target douyin`。

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
- `assets` 枚举要发布的 `assets/` 下的本地文件。打包器优先使用项目文件，缺失时按 `assets.manifest.json` 从 HGame 资产库读取。两端保留同一资源相对路径。当前生成单包，微信 4 MiB、抖音 20 MiB（按工程未压缩体积预检）。双端图片可使用 PNG 或 JPG，字体可使用 WOFF，抖音上传格式列表见下方开发指南。

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

发布前在微信和抖音开发者工具中预览，并在 Android、iOS 宿主上验证启动、触控、声音、前后台切换和持久存档。

[微信官方示例](https://github.com/wechat-miniprogram/minigame-demo) · [抖音小游戏开发指南](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/guide/dev-guide/bytedance-mini-game)
