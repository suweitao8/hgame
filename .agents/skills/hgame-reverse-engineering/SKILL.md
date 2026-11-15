---
name: hgame-reverse-engineering
description: LeanRea's lightweight, game-only reverse engineering workflow for HGame clean-room reconstruction across Unity, Unreal, Godot, RPG Maker, GameMaker, Ren'Py, and HTML5/Web engines. Analyzes user-accessible, unencrypted game data strictly read-only without bypassing DRM or anti-cheat.
---

# HGame 净室游戏逆向入口（`hgame-reverse-engineering`）

**本技能为 HGame 唯一的游戏逆向入口**（已合并 LeanRea 取证纪律、引擎适配与实况视频分析规范；不依赖外部 MCP 服务）。**仅分析用户有权访问的未加密/开放游戏数据，绝不触碰或绕过 DRM、反作弊或在线认证。**

**进入代码生成前必须配合 [`../hgame/SKILL.md`](../hgame/SKILL.md) 与 [`../hgame-spec-forge/SKILL.md`](../hgame-spec-forge/SKILL.md)**。私有工具路径与沙盒目录通过 `.hgame.local.json`（`reToolchainPath` / `reWorkspaceDir`）或环境变量（`HGAME_RE_TOOLCHAIN` / `HGAME_RE_WORKSPACE`）读取，研究产物强制落在原游戏安装目录之外，再经 `export-clean-spec.mjs` 脱敏导出为 `*.clean-spec.json` 交接 HGame。

## 研发铁律：先做减法再做加法（1-1-2-1 最小切片毕业制 + 双门禁）

1. **初版 `clean-spec.json` 只准收敛 `1-1-2-1` 最小可玩切片（MVP Slice）**：仅限 1 套角色与相机参数、1~2 把核心武器、2~3 种代表敌人、1 套 ~60 秒基础波次、最多 5 个核心升级项；禁止第一版就搬运全量武器/怪物/外围系统。
2. **SI 物理单位归一化 + 零 `unknown`**：必须声明 `unitSystem: "SI_METERS_SECONDS_RADIANS"` 与 `unitConversions`（写明原版单位换算系数，如 Source Hammer `* 0.01905`、2D 像素按角色身高转米、帧数 `* tickHz` 转秒）；核心 3C 与黄金三角未逆向出的底层参数必须显式标为 `status: "hgame-fallback"` 并填入引擎推荐标准值，禁止保留 `"unknown"` / `null` / `NaN`。
3. **双门禁通关前严禁扩充内容**：在同时跑通第一道门 **`npm run re:eval`（评分 >= 90 且 4 个无量纲手感比值全绿）** 和第二道门 **`npm run re:doctor`（30 秒实机四项生命体征全绿）** 之前，**严禁**扩充武器库、**严禁**堆砌外围系统、**严禁**盲目开启十万同屏二创。

## 省 Token 与快速取证铁律

1. **原版只读 + 单次批量探测**：将多个独立探针合并为一次 Shell 调用（`;` + 分段标记），输出加 `head` / 行数上限；搜索解包目录用 `rg -uu`（避免漏掉隐藏/忽略目录）。
2. **严禁整文件读取大文件或压缩代码**：先用 `rg` 定位偏移/行号，再按行号/字符窗口切片读取。
3. **三态证据标注**：所有数值与机制必须标注 **`seen`**（实锤值，附 `file:line` 或偏移）、**`inferred`**（推算值，附依据）或 **`hgame-fallback`**（交由 HGame 原生接管）；未查证写 **`unknown`**，严禁把类型名/资源导出当成"100% 还原"。

## 按内容维度的「拆与造」分割表

| 精力分配 | 目标内容 | 处置规范 |
|---|---|---|
| **全力从原游戏提取（80% 精力）** | 武器/角色数值表、商店刷新与掉落概率权重、波次导演公式、技能前后摇/打断状态机、核心 3C 手感常数（移速 / FOV / 弹簧臂距离 / 顿帧时长） | 优先通过 `extract-fast.mjs` 抽源码/配置/IL2CPP `dump.cs`/UE `DataTable`，用 `rg -uu` 定向切片取证并标 `seen`。 |
| **严禁浪费时间硬逆向（0% 精力）** | 原版底层渲染 Shader、骨骼状态机细节、寻路网格底层、物理碰撞求解器、私有美术贴图与音频资源 | **直接标 `hgame-fallback`**，一律交由 `HGame` 原生子系统重现（`SwarmSimulation`、`BoneVatCrowd3D`、`createVfxSystem`、`playSynth`、`camera3d`、`navmesh3d`）。 |

## 标准一键工作流（`HGame` 根目录下执行）

```powershell
# 1. 快拆 + 自动探针初稿 + 导出脱敏规格 -> 第一道门（逆向完备度 >= 90 且 4 项比值全绿才准毕业建工程）
npm run re:extract -- "<original-game-dir>" --slug <slug> [--max-extract-mb 500] --json
npm run re:probe -- --slug <slug>          # 自动扫 raw/ 数值并按 SI 单位归一化写入 spec-draft.json
npm run re:spec -- --slug <slug> --probe --ip-terms "TermA,TermB"
npm run re:eval -- --slug <slug>

# 2. 门禁放行后装配 1-1-2-1 最小切片工程（可附 --assets-from 白名单导入安全 PNG/WAV/GLB）：
npm run re:forge -- --slug <slug> [--out "<new-game-dir>"] [--assets-from "<curated-dir>"]
# （也可传 --source "<original-game-dir>" 一键串联 extract -> probe -> spec -> scaffold）
node .agents/skills/hgame-spec-forge/scripts/validate-spec.mjs "<reWorkspaceDir>/specs-out/<slug>.clean-spec.json" --scaffold "<new-game-dir>"

# 3. 编写 1-1-2-1 切片与 window.__HGAME_DOCTOR__ 后 -> 第二道门（30 秒实机四项体检）：
npm run re:doctor -- "<new-game-dir>"

# 4. 磁盘体积巡检与无损归档 raw/ 解包产物（防 D 盘膨胀）：
npm run re:clean -- --audit --max-mb 500
```

- **绿灯直出（限时 10–15m）**：Godot (`gdre_tools`)、Unity Mono (`ilspycmd` 定向类)、RPG Maker (`data/*.json` / `RPGMakerDecrypter`)、Ren'Py (`unrpa` + `unrpyc` 在 `raw/` 副本运行)、GameMaker (`UndertaleModCli`)、Java (`vineflower`)、Electron/Web (`@electron/asar`)、Source (`.cfg`/`.txt` + `source-kit/vpk.mjs` 只读按需抽 `scripts/` 与 `keyvalues.mjs` 自动归一化 `weapons.kv.json`)。
- **黄灯半明文（限时 10m）**：Unity IL2CPP 调 `Il2CppDumper` 提取 `dump.cs` + `script.json`；Unreal 调 `repak`/`UAssetGUI`/`FModel` 仅抽 DataTables/CurveTables（受 `--max-extract-mb` 预算约束）。**默认禁止自动拉起 Ghidra 全量反编译**；仅当显式传入 `--deep-ghidra --symbol <target>` 狙击个别核心公式时才调 `export-ghidra-function-index.ps1`。
- **红灯熔断（0 秒止损）**：检测到强反作弊/重壳保护特征、加密失败或超时立即熔断，切换黑盒观测（录屏帧数测算前后摇 + 公开数据表 + `hgame-fallback`）。

## 按需加载模块路由

| 任务 | 读取文档 |
|---|---|
| 本机工具清单规范（`.hgame.local.json`）与工具目录对照 | `references/playbooks/tool-catalog.md` |
| 引擎细节（Unity/UE/Godot 等）、工作流与证据规范 | `references/portable-workflow.md`、`references/playbooks/engine-playbooks.md` |
| Unity 二维/三维判定与 HGame 模块映射 | `references/UNITY-SOURCE-TO-HTML.md` |
| 游戏实况/录屏抽帧与时序取证（含网格抽帧与时间戳公式） | `references/gameplay-video-evidence.md` |
| 原生二进制快速路径（IL2CPP / UE / APK / WASM / Ghidra 狙击） | `references/native-game-binary-fast-paths.md` |
| 通用制造包与净室制作契约 | `references/production-contract.md`、`assets/handoff/` |

## 逆向证据闭环与审计命令

详细产物格式见 `references/evidence-pipeline.md`；需要完整研究骨架、覆盖账本与多门禁审计时按需执行（**`--require-complete` 仅表示已登记范围闭合，不代表 100% 逆向**）：

```powershell
$re = ".agents/skills/hgame-reverse-engineering"

# 初始化完整研究目录（含 engine-profile.json、coverage.csv、function-index.json 等模板）
node "$re/scripts/start-research.mjs" "<original-game-dir>" --out "<reWorkspaceDir>/projects/<slug>" --game-id <slug> --name "<game-name>"

# 架构方案落盘（须基于双证据，严禁仅因 Unity 标签默认选 3D）
node "$re/scripts/plan-rebuild.mjs" "<reWorkspaceDir>/projects/<slug>" --profile 2d --target "<new-game-dir>" --evidence "ortho camera + 2D collider"

# 覆盖账本 / 函数调用链 / 数据表 / 轨迹 / 综合门禁
node "$re/scripts/audit-coverage.mjs" "<reWorkspaceDir>/projects/<slug>/production/coverage.csv" --json
node "$re/scripts/audit-function-index.mjs" "<reWorkspaceDir>/projects/<slug>/production/function-index.json" --json
node "$re/scripts/audit-research.mjs" "<reWorkspaceDir>/projects/<slug>" --json   # 交付前加 --require-complete
node "$re/scripts/compare-tick-traces.mjs" windows-ticks.csv web-ticks.csv --json
node "$re/scripts/validate-packet.mjs" "<reWorkspaceDir>/projects/<slug>/production/packet.json"
```

- 复杂游戏静态调用链：`export-ghidra-function-index.ps1` → `merge-function-index.mjs` → `audit-function-index.mjs`。
- 帧同步与逐 Tick 回放对照：使用 `HGame` `createConfirmedFrameScheduler`（`assets/runtime/lockstep/confirmed-frames.js`）配合 `compare-tick-traces.mjs`。
- 行为轨迹录制：HGame 项目优先使用 `createTraceRecorder()`（严禁另建 RAF/Timer），`compare-game-traces.mjs` 对齐事件；不同 Tick 频率须先归一化到 `scenarioStep`。
- 仅问"是否可逆向"时只做 `scripts/inventory.mjs` 或 `tools/game-reverse-scanner/bin/game-reverse-scan.mjs` 只读盘点；独立 HTML 工程一律使用 `HGame` 底座生成与预览，不污染原游戏目录。
