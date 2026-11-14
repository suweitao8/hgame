# 4.10 中国商业化分层红点系统（Trie 树 + DAG 跨入口去重 + DOM 绑定）

> 子系统速查(AI Agent 用)。完整 API 签名见 `docs/api/API-INDEX.json`。

- **文件**：`vendor/hgame/ui/red-dot.js`、`vendor/hgame/integrations/red-dot-dom.js`
- **何时用**：大厅页签、养成模块、背包、邮件、活动、每日特惠等存在**多层父子红点联动**时使用。父节点自动汇总所有子节点状态——**只要还有一个子页面没点完/没领完，父页面红点就不会误灭**；支持菱形拓扑 `link(entryPath, targetPath)` 防止多个入口指向同一叶子时重复累计数字；支持功能解锁拦截（`setUnlocked`）、防骚扰静音（`setMuted`）和诊断原因查询（`explain(path)`）。

**内建 4 类叶子触发源**：
1. **条件/数量计数（`setValue` / `registerRule`）**：未领取奖励不熄灭，自动展示数字与 `99+` 上限。
2. **新获得未读 `NEW`（`markUnread` / `clearUnread` / `syncUnreadScope`）**：点击即消并自动持久化，支持清理已过期物品 ID。
3. **每日重置提醒（`registerDaily` / `acknowledgeDaily`）**：内建凌晨 5 点刷新、时区偏移 `tzOffsetMinutes` 与 `computeCommercialDayKey`。
4. **冷却就绪时间戳（`setReadyAt` / `clearReadyAt`）**：到点自动点亮（免费抽卡、体力恢复等）。

```js
import { HGame } from '../vendor/hgame/index.js';
import { bindRedDotDOM } from '../vendor/hgame/integrations/red-dot-dom.js';

const redDot = HGame.createRedDotSystem({
  storage: localStorage,
  resetHour: 5,
  tzOffsetMinutes: 480, // UTC+8，跨天凌晨 5 点自动刷新
});

redDot.registerRule('Lobby/Mail/Claim', ctx => ({ count: ctx.unclaimedMails, style: 'number' }));
redDot.registerDaily('Lobby/Shop/DailyFree', { style: 'dot' });
redDot.markUnread('Lobby/Bag/NewSword', 'new');
// 如主城快捷按钮也指向每日免费：自动去重
redDot.link('Lobby/QuickBar/Free', 'Lobby/Shop/DailyFree');
redDot.evaluate({ unclaimedMails: 3 });

// HTML 元素只需写 data-red-dot 路径与可选 data-red-dot-ack="true"：
// <button data-red-dot="Lobby/Shop/DailyFree" data-red-dot-ack="true">每日免费</button>
const domBinder = bindRedDotDOM({ system: redDot, root: document.body });
```
