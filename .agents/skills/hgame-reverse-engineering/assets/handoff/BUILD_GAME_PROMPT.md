# 给执行 AI 的净室制作指令（填完再交接）

使用 `$hgame-reverse-engineering` 与 `$hgame-spec-forge` 检查位于 `<research-dir>/production/packet.json` 的制作包（或 `<reWorkspaceDir>/specs-out/<slug>.clean-spec.json`），然后按净室 `production-spec.md` 与 `HGame` 规范制作 `<target-slug>` HTML 游戏。

默认交付是**离线 HTML 单机版本**：只提取公开或只读未加密单机玩法与数值规则，原作联网/认证/云服务/匹配/支付等标为 `excluded-online`，不构建对应服务端，绝不绕过反作弊或 DRM。

先读 `packet.json` / `clean-spec.json` 引用的全部文档与目标数据，确认 status、approval、blockers。返回一条完整玩家路径、关键规则及实现顺序；关键缺口须定位到字段并报告。

若已具备实施条件：按当前规则使用 `npm run re:forge` / `scripts/create-game.mjs --bare` 在 `<new-game-dir>` 生成 HGame 工程，实现 `src/sim/` 纯数据与表现分离。渲染/骨骼/寻路/物理/特效/合成音效等底层细节直接标为 `hgame-fallback`，交由 HGame 原生子系统重现。

依任务依赖完成验收：执行 `npm run check`、`sim-balance.mjs`、`check-level.mjs` 与 `npm run snapshot` / `npm run playtest`；记录控制台、资源请求、未验证项与实际命令结果，严禁未运行测试即宣称通过。
