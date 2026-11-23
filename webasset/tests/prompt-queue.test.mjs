import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

async function exportQueueFor(dogImagePath) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'webasset-prompt-queue-'));
  try {
    for (const folder of ['scripts', 'lib', 'docs', 'assets/characters']) {
      await mkdir(path.join(dir, folder), { recursive: true });
    }
    await copyFile(path.join(root, 'scripts', 'export-character-image-prompts.mjs'), path.join(dir, 'scripts', 'export-character-image-prompts.mjs'));
    await copyFile(path.join(root, 'lib', 'character-image-prompt.mjs'), path.join(dir, 'lib', 'character-image-prompt.mjs'));
    const characters = [
      { id: 'daodun-dog', name: '刀盾狗', assets: [], generatedAssets: [{ path: dogImagePath, mode: 'default' }] },
      { id: 'liuhuaqiang', name: '刘华强', assets: [], generatedAssets: [{ path: 'characters/liuhuaqiang/generated/new.png', mode: 'default' }] },
      { id: 'naiwa', name: '奶蛙', assets: [], generatedAssets: [] },
    ];
    await writeFile(path.join(dir, 'assets', 'characters', 'index.json'), JSON.stringify({ characters }));
    const command = spawnSync(process.execPath, [path.join(dir, 'scripts', 'export-character-image-prompts.mjs')], {
      cwd: dir, encoding: 'utf8',
    });
    assert.equal(command.status, 0, command.stderr);
    return await readFile(path.join(dir, 'docs', 'CHARACTER_IMAGE_GENERATION_QUEUE.md'), 'utf8');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('replaced white-background dog image is no longer queued for regeneration', async () => {
  const report = await exportQueueFor('characters/daodun-dog/generated/default-6view-daodun-dog-20261110-v2.png');
  assert.match(report, /默认形态（四栏六视图）：\*\*1 个任务\*\*/);
  assert.match(report, /\| 刀盾狗 \| 已有 \| 待生成 \|/);
  assert.match(report, /\| 刘华强 \| 已有 \| 待生成 \|/);
  assert.doesNotMatch(report.split('## 二、模型参考')[0], /### \d+\. 刀盾狗/);
  assert.match(report, /影视图：`characters\/daodun-dog\/generated\/default-6view-daodun-dog-20261110-v2.png`/);
  assert.match(report, /奶蛙[\s\S]*?请先生成影视图/);
});

test('legacy white-background dog image still appears in regeneration queue', async () => {
  const report = await exportQueueFor('characters/daodun-dog/generated/codex-1793853550758-7532b2e9.png');
  assert.match(report, /默认形态（四栏六视图）：\*\*2 个任务\*\*/);
  assert.match(report, /\| 刀盾狗 \| 重生成 \| 待生成 \|/);
  assert.match(report.split('## 二、模型参考')[0], /### \d+\. 刀盾狗/);
});
