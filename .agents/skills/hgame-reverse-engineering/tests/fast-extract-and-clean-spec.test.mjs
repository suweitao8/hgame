import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const extractFast = path.join(root, 'scripts', 'extract-fast.mjs');
const exportCleanSpec = path.join(root, 'scripts', 'export-clean-spec.mjs');

const runNode = (script, ...args) =>
  spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });

test('extract-fast routes Mono to green, IL2CPP to yellow (no default Ghidra), and EAC to red circuit breaker', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'fast-extract-smoke-'));
  try {
    // 1. Unity Mono -> green
    const monoSrc = path.join(temp, 'mono-game');
    const monoOut = path.join(temp, 'out-mono');
    await mkdir(path.join(monoSrc, 'Game_Data', 'Managed'), { recursive: true });
    await writeFile(path.join(monoSrc, 'UnityPlayer.dll'), 'MZ');
    await writeFile(path.join(monoSrc, 'Game_Data', 'Managed', 'Assembly-CSharp.dll'), 'MZ');
    const rMono = runNode(extractFast, monoSrc, '--slug', 'mono-demo', '--out', monoOut, '--dry-run', '--json');
    assert.equal(rMono.status, 0, rMono.stderr);
    const monoJson = JSON.parse(rMono.stdout);
    assert.equal(monoJson.channel, 'green');
    assert.equal(monoJson.circuitBreakerTriggered, false);

    // 2. Unity IL2CPP -> yellow, never invokes Ghidra unless --deep-ghidra
    const ilSrc = path.join(temp, 'il2cpp-game');
    const ilOut = path.join(temp, 'out-il2cpp');
    await mkdir(path.join(ilSrc, 'Game_Data', 'il2cpp_data', 'Metadata'), { recursive: true });
    await writeFile(path.join(ilSrc, 'UnityPlayer.dll'), 'MZ');
    await writeFile(path.join(ilSrc, 'GameAssembly.dll'), 'MZ');
    await writeFile(path.join(ilSrc, 'Game_Data', 'il2cpp_data', 'Metadata', 'global-metadata.dat'), 'meta');
    const rIl = runNode(extractFast, ilSrc, '--slug', 'il-demo', '--out', ilOut, '--dry-run', '--json');
    assert.equal(rIl.status, 0, rIl.stderr);
    const ilJson = JSON.parse(rIl.stdout);
    assert.equal(ilJson.channel, 'yellow');
    const ilPlan = JSON.parse(await readFile(path.join(ilOut, 'raw', 'fast-extract-plan.json'), 'utf8'));
    assert.equal(ilPlan.steps.some((s) => s.tool === 'Ghidra-Headless'), false);

    // 3. Strong Anti-Cheat -> 0-second red circuit breaker
    const eacSrc = path.join(temp, 'eac-game');
    const eacOut = path.join(temp, 'out-eac');
    await mkdir(path.join(eacSrc, 'EasyAntiCheat'), { recursive: true });
    await writeFile(path.join(eacSrc, 'EasyAntiCheat', 'EasyAntiCheat_EOS.sys'), 'eac');
    const rEac = runNode(extractFast, eacSrc, '--slug', 'eac-demo', '--out', eacOut, '--json');
    assert.equal(rEac.status, 0, rEac.stderr);
    const eacJson = JSON.parse(rEac.stdout);
    assert.equal(eacJson.channel, 'red');
    assert.equal(eacJson.circuitBreakerTriggered, true);
    assert.equal(eacJson.fallbackMode, 'blackbox-observation');

    // 4. Rejects writing output inside original game folder
    const rUnsafe = runNode(extractFast, monoSrc, '--slug', 'unsafe', '--out', path.join(monoSrc, 'raw-inside'));
    assert.notEqual(rUnsafe.status, 0);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('export-clean-spec strips local paths, binary names, IP terms, and >3-line decompiled snippets', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'clean-spec-smoke-'));
  try {
    const researchDir = path.join(temp, 'research');
    await mkdir(path.join(researchDir, 'production'), { recursive: true });
    const mockWinPath = ['X:', 'MockFixtures', 'SecretGameTitle'].join('\\');
    const mockDllPath = `${mockWinPath}\\Assembly-CSharp.dll`;
    await writeFile(path.join(researchDir, 'baseline.json'), JSON.stringify({
      schemaVersion: 1,
      gameId: 'arena-test',
      name: 'SecretGameTitle',
      sourcePath: mockWinPath,
    }));
    await writeFile(path.join(researchDir, 'production', 'spec-draft.json'), JSON.stringify({
      recommendedProfile: '2d',
      ipTerms: ['SecretBossName'],
      mechanics: {
        coreLoop: { status: 'seen', note: `Loaded from ${mockDllPath} for SecretBossName` },
        leakedCode: 'public class Weapon {\n  public int dmg = 10;\n  public float cd = 0.5f;\n  public void Fire() {}\n}',
      },
      tables: {
        weapons: [{ id: 'sword', dmg: 18, note: 'from data.win and /Users/dev/dump' }],
      },
    }));

    const outSpec = path.join(temp, 'arena-test.clean-spec.json');
    const res = runNode(exportCleanSpec, researchDir, '--out', outSpec, '--json');
    assert.equal(res.status, 0, res.stderr);
    const specText = await readFile(outSpec, 'utf8');
    const spec = JSON.parse(specText);
    assert.equal(spec.specKind, 'hgame-clean-spec');
    assert.equal(spec.slug, 'arena-test');
    assert.doesNotMatch(specText, /MockFixtures|\/Users\/dev/);
    assert.doesNotMatch(specText, /Assembly-CSharp\.dll|data\.win/);
    assert.doesNotMatch(specText, /SecretGameTitle|SecretBossName/);
    assert.equal(spec.mechanics.leakedCode, '[REDACTED_CODE_SNIPPET]');
    assert.ok(spec.sanitizationReport.strippedPaths >= 2);
    assert.ok(spec.sanitizationReport.strippedBinaryRefs >= 2);
    assert.ok(spec.sanitizationReport.strippedIpTerms >= 1);
    assert.equal(spec.sanitizationReport.redactedCodeSnippets, 1);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
