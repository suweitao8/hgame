# 混元 3D 图生模固定工作流（Playwright CDP）

> 2026-11-21 丑橘实测端到端通过：点击「立即生成」→ success 约 167 秒（1.5m 多视图）。
> 自动化运行时与站点细节见 `~/.agents/skills/browser-automation/workflows/hunyuan3d/SKILL.md` 及其 playbook；本文只记 WebAsset 固定流程。

## 流程总览

1. **输入**：角色定稿转面图（`assets/characters/<id>/generated/` 里最新一张 humanoid 转面图，含正视图 + 侧视图）。
2. **切图**：按背景色聚类把转面图切成单视图 PNG（正图、左图），存 `assets/characters/<id>/generated/views/`。
3. **上传**：CDP Chrome 打开 `https://3d.hunyuan.tencent.com/creation` → 图生3D → 多张图片 → 添加多视图 → setInputFiles 上传正图 + 左图。
4. **生成**：确认参数后点「立即生成」（消耗 1 次生成次数）；监听页面自身轮询直到 `status=success`。
5. **下载**：从 `creations/detail|list` 响应取 `result[].urlResult.glb` COS 直链，`fetchToFile` 保存，验 magic `676c5446`。
6. **登记**：`assets/characters/index.json` 对应角色 `models.high`（结构 `{name, path, bytes, updatedAt, source}`）。
7. **低模（统一 T5 规范）**：Blender `remesh-bake --preset low`（统一角色 ≤ 6,000 面 / ≤ 7,500 顶点，复杂配饰 `--preset complex` 硬上限 ≤ 8,000 面 / ≤ 10,000 顶点；单文件内嵌 `LOD0`(4权重) + `LOD1 ~1,600` 面(2权重) + `LOD2 ~350` 面(1权重刚性)，23(+3) 骨骼含 `root`），登记 `models.low`。

## 环境前置（一次性）

配套脚本（cd `~/.agents/skills/browser-automation/runtime` 执行）：

| 脚本 | 作用 |
|---|---|
| `_hy3d-upload-views.mjs` | setInputFiles 上传正图(input2)+左图(input4)，截图校验 |
| `_hy3d-generate.mjs` | 点「立即生成」+ 记录 `/api/3d/` 响应到 JSONL |
| `_hy3d-watch.mjs` | 后台监听指定 creationId 直到 success/failed（`id=<creationId>`） |
| `_hy3d-download.mjs` | 按 GLB/预览直链下载到本地（`glb= outGlb= preview= outPreview=`） |
| `_rawcdp-gen-one.mjs` | **裸 WebSocket CDP 一条龙**：切多张图片子页签→开弹窗→setFileInputFiles→点生成→返回 creationId（playwright 连接卡死时的可靠后备，2026-11-21 实测） |
| `_rawcdp-collect.mjs` | 裸 CDP：reload 页面→捕获 creations/list→直接下载 GLB+预览图 |

注意（裸 CDP 路径）：
- playwright 全量连接在多 target 下会卡死数分钟；裸 CDP 单 target 直连始终秒级可用。
- reload 后子页签会重置回「单张图片」，`_rawcdp-gen-one.mjs` 会自动切回「多张图片」再开弹窗。
- 子页签/弹窗触发用 `el.click()`（Input.dispatchMouseEvent 在这两处不生效）；「立即生成」用真实鼠标事件。

```powershell
# 专用 CDP Chrome（127.0.0.1:9222），在窗口里手动登录 3d.hunyuan.tencent.com
& "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="${env:LOCALAPPDATA}\GameHub-WebCdp-CDP" "https://3d.hunyuan.tencent.com/creation"

cd ~/.agents/skills/browser-automation/runtime
npm install
node src/run.mjs examples/smoke.mjs   # 能列出标签页即通
```

## 切图（步骤 2）

PIL 按背景色（四角采样）聚类含主体列，分左右两组裁剪，留 30px 边距。输出：
- `hunyuan-mv-front.png`（正视图）
- `hunyuan-mv-left.png`（左视图 = 鼻尖朝左的侧面；与混元弹窗「上传左图」示例方向一致）

要求：png/jpg/webp ≤10MB，≥128×128。

## 上传（步骤 3）★ 免点击直传

弹窗内 8 个槽位各有一个 `input[type=file]`（display:none），**DOM 顺序 = 槽位顺序**：

| index | 槽位 | index | 槽位 |
|---|---|---|---|
| 0 | 顶图 | 4 | 左图 |
| 1 | 左45°图 | 5 | 右图 |
| 2 | **正图（必填）** | 6 | 背图 |
| 3 | 右45°图 | 7 | 底图 |

```js
const inputs = page.locator('input[type=file]');   // 共 8 个，须先 count 校验
await inputs.nth(2).setInputFiles(frontPath);      // 正图
await inputs.nth(4).setInputFiles(leftPath);       // 左图
// 校验：.hy-upload-card--front / --left 出现 isSuccess 且 img 指向 /api/3d/resource/download
```

Min2：至少两张（正图 + 一个侧视图即可出全质量）；Max8。面板出现缩略图、「立即生成」变亮蓝即就绪。

## 生成与监听（步骤 4）

- 计费确认：报参数（模式/视图数/V3.1/面数/预计消耗 1 次）给用户，确认后点击。**只跑一次，失败不自动重试。**
- 点击：`page.getByText('立即生成', { exact: true }).first().click()`。
- 提交后：余额 -1；页面开始自动轮询 `creations/detail`（含 creationId）与 `creations/list`。
- **监听方式**：后台任务脚本挂 `page.on('response')`，只解析页面自己发出的 `/api/3d/creations/*` 响应（ctx.request 重放会被签名拒绝，不得直调）。从首次 `creations/detail?creationsId=<id>` 记录 creationId，等到 `status=success|failed|banned` 终态。
- 实测耗时：1.5m 多视图约 167s（含排队）。

## 下载（步骤 5）

`result[].urlResult` 里：游戏主取 `glb`（带纹理）；可选 `obj`(zip)/`mtl`、`geometryGlb`、`pbrImage` 等。全部 COS 签名直链，`cdp.fetchToFile` 直接存。保存名沿用服务端约定：`models/high-<assetId>.glb`。

## 登记（步骤 6）

**必须走服务端接口**（直接手改 index.json 会和服务端内存目录脱节，UI 显示旧模型；2026-11-21 实测踩坑）：

```bash
curl -X POST "http://127.0.0.1:4174/api/character-models?characterId=<id>&mode=high&name=<id>_hunyuan3d_mv_high.glb" \
  --data-binary @<下载的.glb>
```

服务端写文件、更新内存+磁盘目录、自动退役旧文件，UI 即时可见。溯源信息（assetId/taskId/creationId/输入图）记录在本文档「已验证记录」表，不写入 index.json。

## 已验证记录

| 日期 | 角色 | 参数 | 结果 |
|---|---|---|---|
| 2026-11-21 | 丑橘 | 多视图2张（正图+左图）· V3.1 · 1.5m | success，78MB GLB，167s，assetId `b6ceaa35-622e-428b-b7d0-5dba28245b0b`（当日晚间已被用户经 UI 上传的新模型替换） |
| 2026-11-21 | 猫咪骑士（重制） | 多视图2张 · V3.1 · 1.5m | success，89MB GLB，assetId `e34c1682-d971-4d3f-9db4-c44e78b455a7`，creationId `0853063d-ee5e-48ef-926c-4b969c692253` |
| 2026-11-21 | 呆盾狗 | 多视图2张 · V3.1 · 1.5m | success，83MB GLB，assetId `e4e797b7-b984-4027-8c3c-ac7b5c3ee272`，creationId `316068aa-be4d-4476-8477-1bb965625159` |
| 2026-11-21 | 刘华强 | 多视图2张 · V3.1 · 1.5m | success，69MB GLB，assetId `1c9b88b7-9b22-4fd6-acb4-b5b547ef835b`，creationId `8977f74a-2a9c-44c2-9c53-97b19f5dbbcd` |
| 2026-11-21 | 奶娃 | 多视图2张 · V3.1 · 1.5m | success，71MB GLB，assetId `f6434353-d883-4ef9-af46-1d941ad5afff`，creationId `58a3df59-40bb-4b3a-85f1-4d188bb47bb8` |

**2026-11-21/22 批量轮**（多视图2张 · V3.1 · 1.5m，全部 success 且预览核对无误，经 `.agents/skills/hunyuan3d-highpoly/` 管线登记）：

| 角色 | 大小 | assetId | creationId |
|---|---|---|---|
| 猫咪骑士（重制） | 89MB | `e34c1682-d971-4d3f-9db4-c44e78b455a7` | `0853063d-ee5e-48ef-926c-4b969c692253` |
| 呆盾狗 | 83MB | `e4e797b7-b984-4027-8c3c-ac7b5c3ee272` | `316068aa-be4d-4476-8477-1bb965625159` |
| nailong | 69MB | `5bc1404d-6f36-47b4-80ec-48bbd9b5b334` | `03b5d09a-cbde-4647-9ca4-4148df5588dd` |
| maodie | 83MB | `1a62310d-7693-4ad8-92af-a4a141f95f6e` | `2ac0cdcb-1ccf-408f-92c7-bd2bb99963fb` |
| haoge | 74MB | `76cd2348-49d3-4da2-bf9c-b23c6e27c402` | `6eab6313-ec6f-466b-84fc-f030e4afc290` |
| bananacat | 74MB | `bc4fca17-fc37-435f-83fa-44923f3d0846` | `18d5bc0c-1bae-4437-abcd-ac6432415397` |
| claude | 82MB | `6fef32b9-a805-448b-90fc-d4c1bed86cc4` | `36080645-3225-4b68-82b9-7cfcb791aec7` |
| doubao | 76MB | `d28eba02-3b44-48e0-9159-cd49056d0916` | `77d79444-0b02-49c3-bec8-dedbf84853c3` |
| gpt | 78MB | `facb21b9-8f5a-4e31-b138-063d2ee80a66` | `3807d590-65e5-42a1-bb20-d1404a0b0f06` |
| grok | 86MB | `5a845386-6c5d-4b74-95aa-7667a9bbe497` | `e704a9cb-0df8-444b-a639-a9e8b314883a` |
| 阿伟 character-5bf3a802 | 74MB | `1841c2e7-37a5-44ad-b80b-a8e3e74f22b0` | `539aedc7-119a-44db-b2f3-c4ff9c097312` |

**2026-11-23 批量轮**（多视图2张 · V3.1 · 1.5m，全部 success 且预览核对无误；本批新增**输入图 SHA256 核验**——服务端 `imageList` 与本地切片逐字节一致、`extraInputs=0`，杜绝旧图/草稿污染）：

| 角色 | 大小 | assetId | creationId | 登记 |
|---|---|---|---|---|
| 梁子 character-1efd121d | 79.4MB | `d0abe421-1353-4169-b6c3-419f1e2886fa` | `f878efd1-1e81-475d-9144-95cf6dcae3cd` | `high-9e8ec220` / `low-dc8d0d5a` |
| 梁圣 character-5a7a1e23 | 76.4MB | `7ec08b07-8bde-44b5-b9f5-fcfe358f9e29` | `ceb9ed48-0dd5-485d-befe-734eccdcf204` | `high-73f7821c` / `low-5a21c3fc` |
| 雨姐 character-6ce0c029 | 79.9MB | `a186c55f-fdb0-4b08-b669-e6fa471d25a5` | `f021f518-3ab0-48c7-b26f-427bdb7316cd` | `high-1e93f7d8` / `low-c61df3eb` |
| jiege character-3dca756f | 68.3MB | `f43d19a7-eea5-4c89-b75b-613e228ab9b4` | `a7b7b667-f525-4384-a7cd-2a949952bacf` | `high-6f03676b` / `low-d61afc88` |
| anuo character-2dec31e2 | 74.8MB | `4f1c81a2-c30a-42b1-87dd-801692c02b0e` | `28c53136-09af-4523-bea7-a0fb0b916129` | `high-0fe4069c` / `low-ba3a1591` |
| gemini character-0eef1539 | 82.3MB | `e38ce346-7247-408f-9204-c833055e0743` | `6ecbcea5-5d32-4ead-b368-0df42144b40e` | `high-815d6d67` / `low-3e204b7a` |
| qianwen character-b3a75eb1 | 81.1MB | `514e1cc9-503a-42f3-9c23-4e76d79cb13f` | `3392b37d-2d52-4d91-a741-b432f93f0770` | `high-0d3c6378` / `low-e3ea5fd3` |
| dafeiyu | 86.4MB | `50fee7c6-10c1-404b-8563-2cce815d9fc6` | `142a2f44-ace3-4e04-b899-4849cecd8d41` | `high-7f7154e1` / `low-c7570004` |

当日提交前做了三遍复核 + 后台 100 轮审计（91 个图像文件 SHA256 快照零变更、切图判定零翻转）；gemini/qianwen/dafeiyu 三单由后台编排器（`build/hunyuan-debug/pipeline-orchestrator.mjs`，≤2 并发排队 + 采集 + 登记）自动完成，预览图已统一目检无误；同日 8 角色统一 T5 低模（`LOD0` PBR + `LOD1 2400/256px/4w` + `LOD2 1200/128px/2w` + `LOD3 2-tri Run-Only` + Auto-Rig Pro `PSEUDO_VOXELS` 23 骨 Anim58 `Run`）已全部烘焙登记并通过 `verify-character-lods.mjs`；脚本坑与防御见「注意」。

**剩余待生成（0 个）**：22 角色已全部具备高模与统一 T5 低模（2026-11-23 收尾）。备用项：gpt、grok、doubao 的高模为 11-21 长裙版、与 low 模服装不一致，其 `tpose-wide-20261123` 切图已重切并像素验证通过，如需服装统一替换（各耗 1 次配额）待用户决定。

## 注意

- CDP Chrome 视口可能卡「加载中 0%」（webgl1 缺失），左面板与 setInputFiles 不受影响；顶栏「资产」点不开属已知环境坑，走直链下载绕过。
- AI 生成素材在确认商用授权前按本地原型素材处理。
- **`DOM.setFileInputFiles` 必须传绝对路径**：相对路径由 Chrome 浏览器进程按其 cwd 解析，解析失败会触发渲染进程崩溃（`RESULT_CODE_KILLED_BAD_MESSAGE`）。
- 混元页全页只有一个「立即生成」（左栏 `button.sideBarLeft-generateBtn`），弹窗上传完成后点它提交；**有任务 processing 时点击会被静默吞掉**（不报错不扣费），须等无 processing 再提交。
- 页面会轮询 processing creation 的 `creations/detail`：捕获 detailIds 必须排除已知 id，只认新 id；`attach()` 勿漏 `Network.enable`。
- 提交后用 creation 详情 `imageList` 的输入图 URL 做 SHA256 核验（等于本地切片、且无多余输入）才可信；防御性脚本见 `build/hunyuan-debug/upload-stepwise.mjs`、`verify-creation-inputs.mjs`（后续可回灌 skill）。
