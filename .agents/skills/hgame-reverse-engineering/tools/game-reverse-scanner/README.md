# Game Reverse Scanner

只读、免安装、零运行时依赖的 Node.js CLI。对游戏安装目录（或单个文件）做一次**初筛扫描**：建立有界文件清单、索引 ZIP 家族容器、给出带证据的引擎候选排序，并产出供后续逆向流程使用的引擎画像与工具推荐。

**这是初筛与任务规划工具，不是反编译器或解包器。** 识别出引擎不等于恢复玩法、数据或离线单机范围；候选证据必须人工核对后才可写入具体游戏的 `production/engine-profile.json`。

## 运行要求

- Node.js `>=22.12.0`（Workspace 基线 v22.x）。
- 无需 `npm install`：零运行时依赖，全部使用 Node 内置模块。

## 用法

```powershell
node tools/GameReverseScanner/bin/game-reverse-scan.mjs scan "<游戏安装目录>" --out "<输出目录>" ^
  [--max-files <count>] [--max-depth <count>] [--include-cache] [--hash-key-files]
```

```bash
node tools/GameReverseScanner/bin/game-reverse-scan.mjs scan "<游戏安装目录>" --out "<输出目录>" \
  [--max-files <count>] [--max-depth <count>] [--include-cache] [--hash-key-files]

node tools/GameReverseScanner/bin/game-reverse-scan.mjs --help
node tools/GameReverseScanner/bin/game-reverse-scan.mjs --version
```

也可以在该目录内直接 `npm test` 运行全部单元/集成测试。

| 参数 | 说明 |
| --- | --- |
| `scan <input>` | 要扫描的游戏目录或单个文件（只读）。 |
| `--out <dir>` | **必填**。输出目录；必须位于被扫描输入之外，否则退出码 3。 |
| `--max-files <count>` | 文件数上限，默认 50000；到达后停止遍历并记录截断警告。 |
| `--max-depth <count>` | 目录层级上限，默认 40 层（根目录下的子目录层级）；超出部分记录为跳过。 |
| `--include-cache` | 包含默认跳过的 VCS/依赖/工程缓存目录（VCS：`.git`、`.svn`、`.hg`；依赖与工具：`node_modules`、`__pycache__`、`.gradle`、`.idea`、`.vs`、`.cache`、`.pytest_cache`、`.next`、`.vite`；引擎工程缓存：`.godot`、`Library`、`Intermediate`、`DerivedDataCache`、`obj`、`Cache(s)`、`Temp`、`tmp`、`Logs`）。`build`/`dist`/存档类目录不默认跳过。 |
| `--hash-key-files` | 仅对识别出的关键工件（可执行、归档、容器、数据库、字节码）计算 SHA-256；不对全部文件做无差别 hash，总量受 4 GiB 预算保护。 |

**退出码：** `0` 扫描完成（包含未知引擎或有界警告）；`1` 扫描/写入失败（含输入路径不存在）；`2` 参数错误；`3` 输出位置不安全（等于或位于输入内部；Windows 上大小写不敏感比较）。

## 输出产物

`--out` 目录内恰好四个文件，全部 JSON 均为可 `JSON.parse` 的 UTF-8：

- `inventory.json` — 扫描时间戳、输入标签、限额/选项、文件条目（相对路径、大小、扩展名、魔数、kind）、归档成员名索引、跳过路径与警告、聚合统计。文件条目不携带内部绝对路径；`input.path` 仅记录一次被扫描的根目录本身，便于复现扫描。
- `engine-profile.json` — 与 `docs/reverse-engineering/templates/engine-profile.template.json`（schema_version 1）对齐的画像：主引擎放在 `engine`，其余可信候选保留在 `engine_components`；来源路径相对扫描根；未计算 hash 保持空串；不虚构 `offline_scope`。
- `tool-recommendations.json` — 按候选引擎和任务推荐工具与用途；每条 `availability` 恒为 `"not_checked"`，扫描器不探测、不安装、不执行任何工具。
- `report.md` — 人工复核用摘要：候选排序、置信度、证据、版本/平台/运行时/容器发现、版本冲突、警告、跳过项与下一步建议。

## 证据与置信度

- `high`：两个以上相互独立的强标记一致，或显式版本字段被其他引擎标记佐证。
- `medium`：一个强标记，或多个独立中等标记。
- `low`：仅有弱文件名/扩展名/路径线索。
- `unknown`：无正证据。缺失证据保持 unknown，不会伪装成事实。

每条证据包含 `{ path, rule, strength, detail }`。版本只从显式、受限的元数据提取（如 Unity `ProjectVersion.txt`、Unreal `Build.version`、Godot `project.godot` 的 `config/features` 等）；多个互相冲突的显式版本保持 `unknown` 并在 `versionConflict` 中列明。平台归属按证据邻近性推导，无法归属时保留为扫描级平台线索，不复制给所有候选。APK/IPA/Electron 是发布容器/启动壳，不是底层引擎。

## 安全边界

- 对输入只读：不执行目标程序、不注入、不附加调试器、不解包、不修改任何游戏文件。
- ZIP 家族只读取 EOCD 与中央目录（上限 32 MiB），不解压任何成员；ZIP64/损坏/越界/超限返回结构化警告，不猜测结果。
- 不跟随符号链接与目录联接；跳过项逐条记录，不暗示扫描完整。
- 不访问网络、不下载、不安装、不升级、不执行第三方逆向工具。
- 不逆向 DRM/认证/反作弊；产物不推断单机范围或在线依赖。

## 引擎检测范围（v0.1）

Unity（Mono/IL2CPP）、Unreal（Pak/IoStore）、Godot 3/4、RPG Maker MV/MZ/RGSS（XP/VX/VX Ace）、GameMaker、Cocos Creator/cocos2d-x、Ren'Py、Electron 与 Web/HTML5、Source/Source 2、Flash/AIR、Defold、LÖVE、libGDX/JVM；PE/ELF/Mach-O/WASM/Java class 等通用签名只作为运行时/平台证据，不单凭签名判定引擎。未覆盖的引擎/专有容器保持 `unknown`。

## 测试

```bash
cd tools/GameReverseScanner
npm test
```

覆盖：全部魔数签名、有界遍历（深度/文件上限、缓存跳过、符号链接跳过）、ZIP 索引（EOCD/中央目录/损坏/ZIP64）、各引擎家族检测器、元数据解析（显式/损坏/缺失版本）、画像 schema、工具推荐 `not_checked`、报告渲染、CLI 端到端与输出安全。

## 在逆向流程中的位置

1. 对新目标运行本扫描器（或通过 `npm run re:extract` / `scripts/extract-fast.mjs` 自动调度）。
2. 人工核对 `report.md` 中的候选与证据；纠正主引擎判断后，把确认结果登记到研究目录的 `production/engine-profile.json`。
3. 按确认的引擎进入 `references/playbooks/engine-playbooks.md` 对应 Playbook，开展程序、策划与语义槽位提取。
4. 工具推荐仅说明用途与边界；使用前自行确认可用性与版本兼容（`references/playbooks/tool-catalog.md` 的检查清单）。
