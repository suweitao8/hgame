# LeanRea → HGame：可验证逆向复刻闭环

本流程将原版研究、程序/数据提取、HTML 实现和行为验证连接起来。它不会把扫描结果、资源导出或 AI 推断自动升级为“已逆向”。

## 1. 研究目录新增产物

- `raw/scanner/`：原始只读扫描证据，不覆盖、不手工修饰。
- `production/engine-profile.json`：扫描器给出的候选引擎画像，人工复核后才可视为确认。
- `production/coverage.csv`：唯一进度账本，分别记录 reverse / implementation / verification。
- `production/function-index.json`：规范化函数和调用边索引；来源可以是 ILSpy、Ghidra、源码、日志或人工确认。
- `production/data-schema.json`：数据表 Schema，声明文件、记录数组路径、主键和引用字段。
- `production/data-inventory.json`：数据表统计结果，包含源文件 SHA-256、记录数、字段、重复 ID 和未解析引用。
- `production/trace-map.json`：原版与 HTML 事件字段的对照规则。
- `production/verification-plan.json`：声明本游戏必须通过哪些门禁，避免把不适用的函数/数据/轨迹要求强加给所有游戏。
- `production/traces/`：同一场景、同一输入脚本的原版与 HTML JSONL 行为轨迹。

## 2. 函数调用链

`function-index.json` 的结构：

```json
{
  "schemaVersion": 1,
  "gameId": "example",
  "sourceBuild": "1.2.3",
  "entryPoints": ["game.start"],
  "sources": [{"id":"src-1","path":"dump/Gameplay.cs","sha256":"...","tool":"ILSpy","toolVersion":"..."}],
  "functions": [{"id":"game.start","name":"Game.Start","sourceRef":"dump/Gameplay.cs:20","evidenceKind":"static"}],
  "calls": [{"from":"game.start","to":"player.spawn","kind":"static","confidence":"confirmed","evidenceRef":"dump/Gameplay.cs:27"}]
}
```

`kind` 只能是 `static`、`observed`、`inferred`。只有有明确来源锚点的 confirmed 调用边才可计为已确认。Ghidra / ILSpy 导出的地址、方法名和调用边需由适配步骤映射到该结构；此索引器本身不反汇编原生二进制，也不从函数名猜测真实调用关系。

```powershell
node "$skill\scripts\audit-function-index.mjs" "$research\production\function-index.json" --entry game.start --target combat.applyDamage --json
```

本机安装 Ghidra 12.2 时，可直接导出原生 EXE 的函数和直接静态调用边：

```powershell
powershell -ExecutionPolicy Bypass -File "$skill\scripts\export-ghidra-function-index.ps1" `
  -ResearchRoot "$research" -ProgramPath "D:\Games\Original\Game.exe"
node "$skill\scripts\merge-function-index.mjs" `
  "$research\production\function-index.json" `
  "$research\raw\ghidra-function-index.json" `
  --out "$research\production\function-index.merged.json"
node "$skill\scripts\audit-function-index.mjs" `
  "$research\production\function-index.merged.json" --require-resolved --json
```

导出器使用独立 Ghidra 项目，要求输入 EXE 位于 baseline 记录的原版游戏目录内，输出到 research/raw/，拒绝覆盖已有项目/导出。它收集 Ghidra 当前识别到的本地函数、外部导入符号和直接 call 引用；不恢复间接调用、虚函数/委托动态分派、UnityPlayer 内部代码或运行时行为。entryPoints 必须由研究者按实际入口复核后填写，不能仅凭函数名自动判断玩法入口。

## 3. 数据表提取审计

先用 AssetRipper、FModel、GDRE Tools 或目标引擎对应工具提取到 `research/raw/extracted-data/`。再根据真实读取 Schema 编辑 `production/data-schema.json`：

```powershell
node "$skill\scripts\analyze-data-tables.mjs" "$research\raw\extracted-data" --schema "$research\production\data-schema.json" --out "$research\production\data-inventory.json" --json
```

不提供 Schema 时只做 JSON 顶层记录数组和 CSV 的启发式盘点，并明确标记语义/引用未验证。Schema 模式可核对主键重复、缺失 ID、记录总数和跨表引用。支持 JSON、CSV；二进制表、YAML、SQLite 或自定义容器必须先由对应适配器导出为可读格式，不能伪装成已支持。

## 4. 原版与 HTML 动态轨迹

每个 JSONL 文件首行是 header，后续每行一个 event。两端必须使用相同 `gameId`、`scenarioId`，并以相同测试输入执行；Tick 语义必须一致。若原版与 HTML 的 Tick 不同，先定义可比的 `scenarioStep` 或事件键，不要直接按不同频率的 Tick 硬比。

```powershell
node "$skill\scripts\compare-game-traces.mjs" `
  "$research\production\traces\original.jsonl" `
  "$research\production\traces\html.jsonl" `
  --map "$research\production\trace-map.json" --json
```

比较器按 `keyFields` 对齐事件，再按 `compareFields` 比较值和数值容差；报告缺失事件、多余事件、字段差异及第一处分歧。它不自动证明两个不同版本的游戏规则等价，也不替代视觉、音频、手感和人工试玩验收。

HGame 项目优先使用 Runtime 的 `createTraceRecorder()`（见 HGame `docs/guides/TRACE-RECORDER.md`），通过项目自己的 `emit(line)` 接入文件、测试收集器或浏览器控制台。其他引擎可复制 `assets/game-trace-recorder.template.mjs` 作为适配器。只记录已提交/确认的真实逻辑事件，不新增 RAF、Tick 或修改模拟状态。

## 5. 完成门禁

1. Scanner：报告完整、未截断，关键文件与版本证据复核。
2. 程序：关键入口、状态机、公式和调用链有静态或动态证据；推断和未知独立标记。
3. 数据：每个目标表有 Schema、源 Hash、记录总数、主键统计和引用核对；不支持格式列为 blocker。
4. 实现：每个已实现账目都有 HTML 目标路径。
5. 验证：相同场景轨迹比较、浏览器实际操作、内容/引用数量检查及必要的人工体验验收。
6. 仅当覆盖账本条目通过 `audit-coverage.mjs` 且原始资源/程序/数据的总量与调用链范围经过独立检查，才能说“当前登记范围闭合”；仍不能据此声称发现了原版所有隐藏机制。

## 6. 一次性综合审计

编辑 `production/verification-plan.json`，按目标游戏启用 `functionIndex`、`dataInventory`、`traceComparison` 等门禁。最后运行：

```powershell
node "$skill\scripts\audit-research.mjs" "$research" --json
node "$skill\scripts\audit-research.mjs" "$research" --require-complete
```

综合审计只汇总已配置门禁，不会把未运行的项目自动标为通过。Scanner 门禁要求扫描产物存在，并且研究者用两项独立证据复核引擎/版本后，将 baseline.json 的 scannerStatus 设为 reviewed；不能仅因文件存在就通过。即使 `--require-complete` 通过，也只代表登记范围和所选门禁闭合，不代表发现了原版全部隐藏机制。
