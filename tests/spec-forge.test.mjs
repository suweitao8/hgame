import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const validatorScript = path.join(repoRoot, '.agents', 'skills', 'hgame-spec-forge', 'scripts', 'validate-spec.mjs');

test('hgame-spec-forge validator accepts clean demo spec', () => {
  const res = spawnSync(process.execPath, [validatorScript, '--demo', '--json'], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.slug, 'demo-clean-arena');
  assert.ok(out.mappedFallbacks.length >= 4);
});

test('hgame-spec-forge validator rejects local paths, binary names, and >3-line code snippets', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hgame-spec-leak-'));
  try {
    const leakySpec = {
      schemaVersion: 1,
      specKind: 'hgame-clean-spec',
      slug: 'leaky-test',
      recommendedProfile: '2d',
      mechanics: {
        note: 'Pulled from C:\\Users\\dev\\Games\\Sample\\GameAssembly.dll',
        snippet: 'public class Foo {\n  void Start() {\n    int x = 1;\n    return;\n  }\n}',
      },
      hgameFallbackModules: ['renderer-shader'],
    };
    const specPath = path.join(dir, 'leaky.clean-spec.json');
    writeFileSync(specPath, JSON.stringify(leakySpec, null, 2), 'utf8');

    const res = spawnSync(process.execPath, [validatorScript, specPath], { encoding: 'utf8' });
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /local disk path detected/);
    assert.match(res.stderr, /proprietary binary\/archive filename detected/);
    assert.match(res.stderr, /multi-line source\/decompiled snippet/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hgame-spec-forge scaffolds an HGame project from a clean spec', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hgame-spec-scaffold-'));
  const targetDir = path.join(dir, 'scaffolded-game');
  try {
    const cleanSpec = {
      schemaVersion: 1,
      specKind: 'hgame-clean-spec',
      slug: 'arena-survivor-test',
      recommendedProfile: '2d',
      engineRecipe: { profile: '2d', renderer: 'webgl2d', physics: 'none', tickHz: 60 },
      mechanics: { coreLoop: { status: 'seen', waveDurationSec: 45 } },
      tables: { enemies: [{ id: 'grunt', hp: 30, speed: 120 }] },
      hgameFallbackModules: ['renderer-shader', 'vfx-particles', 'synth-audio'],
    };
    const specPath = path.join(dir, 'arena-survivor-test.clean-spec.json');
    writeFileSync(specPath, JSON.stringify(cleanSpec, null, 2), 'utf8');

    const res = spawnSync(process.execPath, [validatorScript, specPath, '--scaffold', targetDir, '--json'], {
      encoding: 'utf8',
    });
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.scaffoldedTo, path.resolve(targetDir));
    assert.ok(existsSync(path.join(targetDir, 'package.json')));
    assert.ok(existsSync(path.join(targetDir, 'src', 'sim', 'spec.json')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
