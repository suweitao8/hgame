# HGame

HGame 是一个独立的 HTML5 游戏运行时与项目生成器，支持 2D、3D 和 UI/卡牌类游戏。它采用统一的 Scene / Entity / Component 核心，按项目配置加载 Canvas 2D、Three.js、DOM、物理、动画、地图和平台服务。

当前运行时版本：**1.0.0**。

## 目录

```text
assets/
  runtime/          # 唯一运行时源码
  template/         # 独立游戏工程模板
  profiles/         # 2D / 3D / UI 启动配置
  optional/three/   # 仅 3D 模板使用的 Three.js 文件及 MIT 许可
scripts/
  create-game.mjs   # 生成独立游戏项目
  preview.mjs       # 本机回环预览服务器
  build-physics.mjs # 从固定 npm 版本重建 Rapier ESM/WASM
tests/              # Runtime 单测与可选浏览器验收
network/            # 独立安装的多人联网基础设施
docs/               # 架构、物理、渲染与验收规范
```

## 环境

- Node.js `>=22.12.0`
- npm `>=10`
- Windows / macOS / Linux；浏览器端以现代 Chromium 为主要验收环境

## 创建游戏

```powershell
npm ci

# 2D Canvas 游戏
node scripts/create-game.mjs "D:\Games\my-2d-game" --profile 2d --name "我的 2D 游戏"

# 3D Three.js 游戏
node scripts/create-game.mjs "D:\Games\my-3d-game" --profile 3d --name "我的 3D 游戏"

# UI / 卡牌 / 剧情游戏（不创建空转 RAF）
node scripts/create-game.mjs "D:\Games\my-ui-game" --profile ui --name "我的卡牌游戏"

# 显式启用确定性物理
node scripts/create-game.mjs "D:\Games\my-physics-game" --profile 3d --with physics3d
```

生成器拒绝覆盖已存在目录。每个游戏拥有自己的源码、配置和 Git；引擎运行时复制到游戏的 `vendor/hgame/`，只保留所选维度的 Rapier WASM。3D 项目才会复制 Three.js。

## 预览

```powershell
node scripts/preview.mjs "D:\Games\my-3d-game" --port 4176
```

然后打开 `http://127.0.0.1:4176/`。预览服务仅监听回环地址，并拒绝访问 `.git`、环境文件和开发目录。

## 测试与构建

```powershell
npm test
npm run check:physics
npm run build:physics
npm ci --prefix network
npm run check:all
```

浏览器验收需要单独提供 `playwright-core` 和 Chromium：

```powershell
node tests/browser-profiles.mjs --playwright "C:\path\to\playwright-core" --chrome "C:\path\to\chrome.exe"
```

## 多人联网（可选）

联网基础设施位于 `network/`，独立于 Runtime npm 依赖：

```powershell
cd network
npm ci
npm test
npm run check
npm run build
```

它提供 Colyseus 状态同步 / 预测验证 / 确认输入封帧 relay 的基础实现和本地 conformance lab，不提供游戏规则、可信游戏模拟、完整回滚、生产级匹配或持久化服务。详见 [`docs/architecture/NETWORK.md`](docs/architecture/NETWORK.md)。

## 重要边界

- 固定时间步不等于跨平台确定性帧同步。
- Rapier snapshot 不包含游戏 AI、输入、规则、RNG 和完整游戏状态。
- Renderer、AI、关卡和游戏规则由各个游戏决定；HGame 不会自动迁移旧项目。
- 运行时不依赖 CDN。未选择的物理维度不会进入游戏包体。
- 本仓库不包含本机精选 PBR 贴图库、Unreal 导出资源或原版游戏逆向资料。

## 许可

仓库暂未指定整体开源许可证。公开可见不代表获得再分发、修改或商业使用授权。第三方文件按各自附带的许可证处理；HGame 自有代码的授权方式待仓库所有者决定。
