import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const validatorScript = path.join(repoRoot, '.agents', 'skills', 'hgame-spec-forge', 'scripts', 'validate-spec.mjs');
const pipelineScript = path.join(repoRoot, 'scripts', 're-pipeline.mjs');

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
    const mockLocalPath = ['C:', 'Users', 'dev', 'Games', 'Sample', 'GameAssembly.dll'].join('\\');
    const leakySpec = {
      schemaVersion: 1,
      specKind: 'hgame-clean-spec',
      slug: 'leaky-test',
      recommendedProfile: '2d',
      mechanics: {
        note: `Pulled from ${mockLocalPath}`,
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

test('re-pipeline forge orchestrates extract -> spec -> scaffold using HGAME_RE_WORKSPACE', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hgame-re-pipeline-'));
  const sourceDir = path.join(dir, 'sample-game');
  const workspaceDir = path.join(dir, 're-workspace');
  const outGameDir = path.join(dir, 'forged-game');
  try {
    mkdirSync(path.join(sourceDir, 'Game_Data', 'Managed'), { recursive: true });
    writeFileSync(path.join(sourceDir, 'UnityPlayer.dll'), 'MZ');
    writeFileSync(path.join(sourceDir, 'Game_Data', 'Managed', 'Assembly-CSharp.dll'), 'MZ');

    const res = spawnSync(
      process.execPath,
      [pipelineScript, 'forge', '--source', sourceDir, '--slug', 'pipe-smoke', '--out', outGameDir, '--dry-run', '--json'],
      {
        encoding: 'utf8',
        env: { ...process.env, HGAME_RE_WORKSPACE: workspaceDir },
      },
    );
    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.ok(existsSync(path.join(workspaceDir, 'projects', 'pipe-smoke', 'raw', 'fast-extract-plan.json')));
    assert.ok(existsSync(path.join(workspaceDir, 'specs-out', 'pipe-smoke.clean-spec.json')));
    assert.ok(existsSync(path.join(outGameDir, 'src', 'sim', 'spec.json')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('HGame repository files contain zero hardcoded machine-specific RE paths', () => {
  const trackedExts = new Set(['.md', '.mjs', '.js', '.json', '.ps1']);
  const ls = spawnSync('git', ['-C', repoRoot, 'ls-files'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  assert.equal(ls.status, 0, ls.stderr);

  const candidates = new Set(ls.stdout.split(/\r?\n/).filter(Boolean));
  // Also scan newly created skill/script files even before staging/committing
  const unmerged = spawnSync('git', ['-C', repoRoot, 'ls-files', '--others', '--exclude-standard', '.agents', 'scripts', 'tests', '.hgame.local.example.json'], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (unmerged.status === 0) {
    for (const f of unmerged.stdout.split(/\r?\n/).filter(Boolean)) candidates.add(f);
  }

  const forbiddenLiterals = [
    ['C:', 'Users', ''].join('\\'),
    ['C:', 'Users', ''].join('/'),
    ['D:', 'Apps', 'RE'].join('\\'),
    ['D:', 'Apps', 'RE'].join('/'),
    ['D:', 'RE-Workspace'].join('\\'),
    ['D:', 'RE-Workspace'].join('/'),
  ];

  const hits = [];
  for (const rel of candidates) {
    if (!trackedExts.has(path.extname(rel).toLowerCase())) continue;
    const abs = path.join(repoRoot, rel);
    if (!existsSync(abs)) continue;
    const content = readFileSync(abs, 'utf8');
    for (const needle of forbiddenLiterals) {
      if (content.includes(needle)) {
        hits.push(`${rel} contains forbidden path literal "${needle}"`);
      }
    }
  }
  assert.deepEqual(hits, [], hits.join('\n'));
});

test('package-game excludes RE local files in game mode while keeping RE skills/scripts in --engine mode', () => {
  const pkgGameSrc = readFileSync(path.join(repoRoot, 'scripts', 'package-game.mjs'), 'utf8');
  assert.match(pkgGameSrc, /\.hgame\.local/);
  assert.match(pkgGameSrc, /re-pipeline\.mjs/);
  assert.match(pkgGameSrc, /copyTree\('\.agents\/skills'\)/);
});
