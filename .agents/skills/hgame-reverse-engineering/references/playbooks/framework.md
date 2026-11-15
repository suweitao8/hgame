# 净室逆向框架参考

> **权威入口**：日常逆向请直接遵循 `SKILL.md` 与 `references/portable-workflow.md`。本文定义离线单机净室重构的四层架构约束与门禁摘要。

## 核心边界

1. **目标统一**：交付为 `HGame` 离线单机 HTML 游戏；非必要账号、认证、匹配、云服务、支付与反作弊统一标为 `excluded-online`。
2. **四层架构**：`A. 控制流程`（基线/证据/账本/门禁）→ `B. 引擎适配器` → `C. 工具与格式适配器` → `D. HTML 单机装配`。
3. **证据等级**：`static` / `observed` / `inferred` / `unknown` / `excluded-online`；禁止把"工具可读/导出成功"当作规则已理解或验收通过。
4. **进度账本**：统一使用 `coverage.csv`（`unseen → indexed → extracted → understood`；实现 `not-started / in-progress / implemented / not-applicable`；验证 `deferred / not-run / passed / failed`）。
5. **合规与安全**：原始输入只读；绝不绕过 DRM/认证/反作弊；禁止将原作受版权保护的音画资源或超限反编译片段写入开源仓库。
