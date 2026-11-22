---
name: hunyuan3d-highpoly
description: 为 WebAsset 角色制作高模（腾讯混元3D 网页自动化，已实测的 CDP 管线）。Use whenever the user asks to 制作高模、出模、给角色生成 3D 模型、跑混元3D、Hunyuan3D modeling, or wants to batch-process characters that lack models.high — even if they just say "把剩下的角色做了" or name a character id alone. Covers turnaround slicing, billing-gated generation, GLB download and server-API registration.
---

# 混元 3D 角色高模制作

通过用户已登录的 CDP Chrome（127.0.0.1:9222）操作 `3d.hunyuan.tencent.com/creation`，
把角色定稿转面图变成带纹理的 1.5m GLB 并登记进 WebAsset。

**纪律（每条都有过教训，不要省略）：**
- 「立即生成」消耗账号次数（计费动作）。每批开始前把角色清单+参数报给用户确认；**只跑一次，失败不自动重试**（重复提交会重复扣次数）。
- **登记必须走服务端 API**（`register.mjs`）。手改 index.json 时运行中的服务端看不到，UI 会一直显示旧模型（2026-11-21 实测踩坑，服务端重启前内存目录是唯一真相）。
- 每个模型登记前**必须 Read 预览图核对内容**（确认是本角色，防止上传错图生成错模）。
- 遇到登录跳转、验证码、页面状态不明：停下报告，不猜测成功。

## 一次性准备

1. 专用 CDP Chrome 在跑且已登录混元（用户通常已开好）：
   ```powershell
   & "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="${env:LOCALAPPDATA}\GameHub-WebCdp-CDP" "https://3d.hunyuan.tencent.com/creation"
   ```
2. `cd <本项目>/.agents/skills/hunyuan3d-highpoly/scripts && npm install`（装 `ws`，一次性）。
3. WebAsset 服务在跑：`curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4174/` 应为 200；不在则 `npm run webasset`（HGame 根目录）或 `node webasset/server.mjs`。

## 管线（单角色约 4 分钟，全部脚本裸 WebSocket CDP，不依赖 playwright）

> 为什么用裸 CDP：playwright 全量连接在该 Chrome（100+ targets）下会卡死数分钟甚至永久挂起；
> 裸 CDP 单 target 直连始终秒级可用。生成任务在网页端运行，脚本中断不影响它，重新采集即可。

### Step 0 — 盘点缺高模的角色

```bash
node --input-type=module -e "import {openAssetDb,resolveDefaultDbPath} from './webasset/lib/asset-db.mjs';const db=openAssetDb(resolveDefaultDbPath('./webasset'));console.log(db.listCharacters().filter(x=>!x.models?.high).map(x=>x.id).join('\n'));db.close()"
```

### Step 1 — 切图（每个角色两张：正图+左图）

```bash
python .agents/skills/hunyuan3d-highpoly/scripts/slice-views.py <characterId>
```

规则（15 张实测归纳）：按背景色聚类主体列；间隙 ≤6px 合并；**非末位**且与前沿间隙 <100px 的小段（悬浮拳头碎块）并入前视图；末位大段为左视图。切完**必须 Read 两张切图目检**：主体完整、无贴边切割、左视图鼻尖朝左。

特例：若定稿图本身有切割缺陷（手臂被块缝切断且拳头离断口很远），先问用户——默认跳过该角色等重图（2026-11-21 阿诺/杰哥因此跳过）。

### Step 2 — 配额与计费确认

```bash
node .agents/skills/hunyuan3d-highpoly/scripts/check-quota.mjs
```

`quotaCandidates` 里的个位数为剩余次数。向用户报：角色清单、参数（图生3D·多视图2张 · V3.1 · 面数1.5m · 每次 1 次），确认后才进入 Step 3。

### Step 3 — 生成

```bash
node .agents/skills/hunyuan3d-highpoly/scripts/gen-one.mjs <front.png> <left.png> <before.png> <after.png>
```

自动完成：切「多张图片」子页签（reload 后会重置回单张）→ 开多视图弹窗 → 正图/左图上传（带 isSuccess 轮询+一次重试；正图上传会引发卡片重渲染，左图必须重新取节点）→ 点击「立即生成」→ 返回 `{"detailIds":[creationId]}`。约 45 秒。

### Step 4 — 采集（等约 210 秒后开始轮询）

```bash
node .agents/skills/hunyuan3d-highpoly/scripts/collect.mjs <creationId> <outGlb> <outPreview>
```

reload 页面捕获页面自身的 `creations/list`，取 COS 直链下载 GLB+预览图。仍在生成则输出 `{"status":"processing"}`（exit 2），60 秒后再试。**下载后验证 GLB magic `676c5446`。**

### Step 5 — 登记

```bash
node .agents/skills/hunyuan3d-highpoly/scripts/register.mjs <characterId> high <outGlb>
```

服务端写文件+更新内存/磁盘目录+退役旧文件，UI 即时可见。

### Step 6 — 验证

Read 预览图，确认主体与本角色一致；不一致（上传错图/生成错模）立即停下报告，不要登记（已登记则修正）。

## 排错

| 症状 | 处理 |
|---|---|
| `hunyuan tab not found` | CDP Chrome 没开或没登录，提示用户 |
| upload verify left=false 反复失败 | 见 Step 3 内置重试；仍失败则截图 `_pre-*.png` 检查弹窗状态 |
| collect 报 `creation not in list` | 任务太新，等 30 秒重试；或 totalCount 分页超 10 条，用 reload 重试 |
| quota 显示 0 | 当日配额用尽，报告剩余清单等刷新 |
| WebAsset UI 显示旧模型 | 确认登记走的是 register.mjs 而非手改 index.json；必要时重启 `node server.mjs` |

## 记录

每批结束后把 `角色 | 参数 | 结果(status/大小/assetId/creationId)` 追加到
`docs/HUNYUAN3D-MODELING-WORKFLOW.md` 的「已验证记录」表，并更新「剩余待生成」清单。
