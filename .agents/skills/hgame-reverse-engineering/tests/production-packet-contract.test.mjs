import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const reverseRoot = fileURLToPath(new URL('../', import.meta.url));
const skillsRoot = path.resolve(reverseRoot, '..');
const read = file => readFileSync(path.join(reverseRoot, file), 'utf8');

test('clean-room handoff prompt points at hgame-reverse-engineering and hgame-spec-forge', () => {
  const prompt = read('assets/handoff/BUILD_GAME_PROMPT.md');
  assert.match(prompt, /\$hgame-reverse-engineering/);
  assert.match(prompt, /\$hgame-spec-forge/);
  assert.doesNotMatch(prompt, /\$game-analysis-to-html/);
  assert.match(prompt, /npm run re:forge/);
});

test('HGame remains an implementation backend, not a second reverse entrypoint', () => {
  const engine = readFileSync(path.join(skillsRoot, 'hgame', 'SKILL.md'), 'utf8');
  assert.match(engine, /Complete workflow and API runbook/);
  assert.doesNotMatch(engine, /description:.*唯一.*逆向入口/);
  assert.match(read('SKILL.md'), /hgame\/SKILL\.md/);
});
