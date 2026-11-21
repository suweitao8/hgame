import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const projectDir = process.cwd();
const recipe = JSON.parse(readFileSync(path.join(projectDir, 'engine.config.json'), 'utf8'));
const isBare = ['src/bare.js', 'src/main.js'].some(rel => {
  const abs = path.join(projectDir, rel);
  return existsSync(abs) && readFileSync(abs, 'utf8').includes('TODO: add entities/components');
});

async function clickVisibleCenter(page, locator) {
  await locator.waitFor({ state: 'visible', timeout: 5000 });
  const box = await locator.boundingBox();
  if (!box || box.width <= 0 || box.height <= 0) {
    throw new Error('Target button has no visible bounding box');
  }
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

export async function run({ page, readState, checkpoint, auditUi }) {
  await mkdir(path.join(projectDir, 'build', 'acceptance'), { recursive: true });

  await checkpoint('engine boots with valid state hook', async () => {
    const state = await readState();
    assert.ok(state && typeof state === 'object', 'window.__hgameState() must return a state object');
    assert.notEqual(state.disposed, true, 'application must not be disposed at startup');
  });

  if (auditUi) await auditUi('startup');

  if (!isBare) {
    // Dismiss an optional live-canvas title action button if one is visible.
    const titleStart = page.locator('#title button:visible, #start:visible, #play:visible, [data-ui-phase="title"] button:visible').first();
    if ((await titleStart.count()) > 0 && (await titleStart.isVisible())) {
      await clickVisibleCenter(page, titleStart);
      await page.waitForTimeout(150);
      if (auditUi) await auditUi('playing');
    }

    if (recipe.profile === 'ui' || recipe.renderer === 'dom') {
      await checkpoint('UI interaction mutates state', async () => {
        const before = await readState();
        const btn = page.locator('button:visible:not([disabled])').first();
        assert.ok((await btn.count()) > 0, 'Expected at least one visible interactive button');
        await clickVisibleCenter(page, btn);
        await page.waitForTimeout(180);
        const after = await readState();
        assert.notDeepEqual(after, before, 'Primary UI action should mutate game state');
      });
    } else {
      await checkpoint('gameplay responds to player input', async () => {
        const before = await readState();
        await page.keyboard.down('d');
        await page.waitForTimeout(320);
        await page.keyboard.up('d');
        await page.keyboard.down('w');
        await page.waitForTimeout(200);
        await page.keyboard.up('w');
        await page.waitForTimeout(80);
        const after = await readState();
        assert.notDeepEqual(after, before, 'Player input should advance or mutate game state');
        const moverBefore = before.player ?? before.hero;
        const moverAfter = after.player ?? after.hero;
        if (moverBefore && moverAfter && typeof moverBefore.x === 'number' && typeof moverAfter.x === 'number') {
          const dist = Math.hypot(
            moverAfter.x - moverBefore.x,
            (moverAfter.z ?? moverAfter.y ?? 0) - (moverBefore.z ?? moverBefore.y ?? 0),
          );
          assert.ok(dist > 0.05, `Expected player to move on WASD input (moved ${dist.toFixed(4)})`);
        }
      });
    }
    if (auditUi) await auditUi('after-input');
  }

  // Extend this scenario with game-specific checkpoints:
  // core loop (combat/scoring/objectives), upgrade/shop UI via auditUi('upgrade'),
  // win/gameover via auditUi('gameover'), restart, and reload persistence.
  await page.screenshot({ path: path.join(projectDir, 'build', 'acceptance', 'scenario.png') });
}
