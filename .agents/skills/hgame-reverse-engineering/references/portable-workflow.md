# 通用游戏逆向工程法（精简执行规范）

> 本文为跨项目可移植执行规范；详细引擎 Playbook 与工作流参考保留于 `references/playbooks/` 下。实际执行以当前工程 `AGENTS.md`、[`SKILL.md`](../SKILL.md) 的「拆与造分割表」与净室合规边界为准。

## 一、四层架构

| 层 | 职责 |
|---|---|
| A. 控制流程 | 原作版本基线、只读权限、三态证据（`seen`/`inferred`/`hgame-fallback`）、进度账本与门禁 |
| B. 引擎适配器 | 识别 Mono/IL2CPP、Unreal、Godot、RPG Maker、GameMaker、Ren'Py、Web/Electron 等 |
| C. 快拆调度器 | 通过 `extract-fast.mjs` + `.hgame.local.json`（`reToolchainPath` / `HGAME_RE_TOOLCHAIN`）按绿/黄/红灯通道按需取证 |
| D. HGame 目标工程 | 通过 `export-clean-spec.mjs` 导出净室规格，交由 `HGame` 引擎原生模块重构 |

## 二、分阶段推进（避免无效深挖）

1. **接手与只读初扫**：优先复用 `<reWorkspaceDir>/projects/<slug>` 已有索引；首次研究运行 `npm run re:extract` 或 `scripts/start-research.mjs`，绝不向原游戏目录写入任何文件。
2. **双证据定画像**：用两项独立证据确认引擎、脚本后端、版本与容器，复核后更新 `production/engine-profile.json` 与 `baseline.json`（`scannerStatus: "reviewed"`）。
3. **80/0 分割取证**：集中提取数值表、掉落/商店权重、波次导演公式、技能前后摇/打断状态机与 3C 手感常数；渲染 Shader、骨骼、寻路底层、物理求解与私有视听资源一律标 `hgame-fallback` 交由 HGame。
4. **净室导出与装配**：运行 `npm run re:spec` 生成 `<reWorkspaceDir>/specs-out/<slug>.clean-spec.json`，再通过 `npm run re:forge`（内部串联 `hgame-spec-forge` 合规校验与 `create-game.mjs --bare`）生成独立工程并通过 `sim-balance.mjs`、`check-level.mjs` 与 `snapshot` 验收。

## 三、唯一覆盖账本与证据闭环

复杂项目从 `assets/coverage.template.csv` 建立 `production/coverage.csv`，列结构：
`id, domain, item, scope, source_ref, evidence_kind, evidence_ref, extracted_output, target_path, reverse_status, implementation_status, verification_status, blocker, notes`

- **状态流转**：`reverse_status` (`unseen → indexed → extracted → understood` / `unknown` / `blocked`)；`implementation_status` (`not-started → in-progress → implemented` / `not-applicable`)；`verification_status` (`deferred` / `not-run` / `passed` / `failed`)。
- **配套审计脚本**（完整规范见 `evidence-pipeline.md`）：
  - `scripts/audit-coverage.mjs`：检查重复 ID、非法状态、缺失证据与假 `passed`；`--require-complete` 仅表示已登记范围闭合。
  - `scripts/audit-function-index.mjs`：审计 `function-index.json` 入口可达性与调用链锚点。
  - `scripts/analyze-data-tables.mjs`：按 `data-schema.json` 统计 JSON/CSV 记录数、SHA-256、重复 ID 与跨表引用（未配 Schema 仅为启发式发现）。
  - `scripts/compare-game-traces.mjs`：按 `trace-map.json` 对比 `production/traces/` 中原版与 HTML JSONL 行为轨迹。
  - `scripts/audit-research.mjs`：汇总 `verification-plan.json` 启用的门禁结果。

## 四、Playbooks 参考阅读顺序

1. `playbooks/tool-catalog.md`：外部逆向工具清单规范与能力对照。
2. `playbooks/engine-playbooks.md`：按需只读目标引擎章节。
3. `playbooks/framework.md` / `workflow.md` / `strict-fidelity.md`：仅在严格单机玩法复刻任务时按需查阅。
