import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const reverseRoot = fileURLToPath(new URL('../', import.meta.url));
const skillsRoot = path.resolve(reverseRoot, '..');
const read = file => readFileSync(path.join(reverseRoot, file), 'utf8');

test('hgame-reverse-engineering is the single lightweight game-only reverse entrypoint', () => {
  const skill = read('SKILL.md');
  assert.match(skill, /LeanRea/);
  assert.match(skill, /唯一.*游戏逆向入口/);
  assert.match(skill, /playbooks\/tool-catalog\.md/);
  assert.match(skill, /gameplay-video-evidence\.md/);
  assert.match(skill, /native-game-binary-fast-paths\.md/);
  assert.match(skill, /production-contract\.md/);
  assert.doesNotMatch(skill, /craft-anything-game-adapter/);
});

test('Craft Anything game capabilities are mapped into the local tool catalog without an MCP dependency', () => {
  const doc = read('references/playbooks/tool-catalog.md');
  assert.ok(doc.length > 3000, 'tool catalog must not be empty or a stub');
  for (const name of [
    'game_archives_list', 'game_pak_list', 'game_pak_extract', 'game_iostore_list',
    'game_unity_list', 'game_unity_bundle_list', 'game_unity_asset_export',
    'game_unreal_texture_export', 'game_unity_code_names_show',
    'core_feature_find', 'native_function_study', 'app_call_path_find',
    'app_runtime_correlate', 'runtime_walkthrough_record', 'runtime_captures_compare',
    'app_ledger_build', 'app_coverage_evaluate', 'app_rebuild_claim_check'
  ]) assert.ok(doc.includes(name), `missing mapped Craft capability: ${name}`);
  assert.match(doc, /不安装、不启动、不连接 Craft Anything 完整 CLI\/MCP/);
  assert.match(doc, /已实现同类能力/);
  assert.match(doc, /未移植/);
  assert.doesNotMatch(doc, /craft-anything-cli setup|mcp --deep --all-tools/i);
});

test('active game workflow references resolve to the consolidated Skill files', () => {
  const files = [
    'references/playbooks/framework.md',
    'references/playbooks/workflow.md',
    'references/playbooks/engine-playbooks.md',
    'references/portable-workflow.md',
    'tools/game-reverse-scanner/README.md'
  ];
  for (const file of files) {
    const content = read(file);
    assert.doesNotMatch(content, /\.agents\/skills\/game-analysis-to-html/);
    assert.doesNotMatch(content, /GAME_REVERSE_ENGINEERING_ENGINE_PLAYBOOKS\.md/);
    assert.doesNotMatch(content, /GAME_REVERSE_ENGINEERING_FRAMEWORK\.md/);
  }
  assert.ok(existsSync(path.join(reverseRoot, 'references/playbooks/tool-catalog.md')));
  assert.equal(existsSync(path.join(reverseRoot, 'references/craft-anything-game-adapter.md')), false);
});

test('gameplay video evidence records timestamps and separates fact, inference, and unknown', () => {
  const doc = read('references/gameplay-video-evidence.md');
  assert.match(doc, /timestamp/i);
  assert.match(doc, /observed fact/i);
  assert.match(doc, /inference/i);
  assert.match(doc, /unknown/i);
  assert.match(doc, /ffmpeg/i);
});

test('native binary fast paths are restricted to game targets', () => {
  const doc = read('references/native-game-binary-fast-paths.md');
  assert.match(doc, /Unity IL2CPP/i);
  assert.match(doc, /Unreal/i);
  assert.match(doc, /Godot/i);
  assert.match(doc, /APK/i);
  assert.match(doc, /WASM/i);
  assert.match(doc, /not a general software reverse/i);
});

test('general reverse and video helper skills are folded into the game skill', () => {
  assert.equal(existsSync(path.join(skillsRoot, 'leanrea', 'SKILL.md')), false);
  assert.equal(existsSync(path.join(skillsRoot, 'bili-video-analysis', 'SKILL.md')), false);
});
