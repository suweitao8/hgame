# 4.2 补间动画 Tween 与弹簧阻尼手感

> 子系统速查(AI Agent 用)。完整 API 签名见 `docs/api/API-INDEX.json`。

- **文件**：`vendor/hgame/time/tween.js`（同时由 `index.js` 导出 `EASING`、`TweenManager`、`damp`、`dampAngle`、`stepSpring1D`、`SpringDamper1D`、`SpringDamper2D`、`SpringDamper3D`）
- **何时用**：UI 弹窗弹入、受击缩放、2D 纸片人呼吸/奔跑/攻击突刺/击飞倒地，以及无抽搐的帧率无关平滑插值。

```js
const sprite = hero.getComponent(Sprite2D);
scene.tweens.idle(sprite); // 连续呼吸待机，只改 sprite.offsetX/offsetY/scaleX/scaleY/rotation，不影响物理坐标
scene.tweens.run(sprite, { bobHeight: 5, tiltRad: 0.12 });
scene.tweens.attackLunge(sprite, { dirX: 1, dirY: 0, distance: 18 });

// 弹簧阻尼平滑追踪数值
const hpBarSpring = new HGame.SpringDamper1D({ halfLife: 0.12 });
const visualHp = hpBarSpring.step(targetHp, dt);
```

## 易错点
- 活动补间数量读取 `scene.tweens.tweens.size`(没有 `scene.tweens.size`)。
