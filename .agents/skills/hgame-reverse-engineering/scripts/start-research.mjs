#!/usr/bin/env node
import { cp, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = fileURLToPath(new URL('../', import.meta.url));
const scanner = path.join(skillRoot, 'tools', 'game-reverse-scanner', 'bin', 'game-reverse-scan.mjs');
const coverageTemplate = path.join(skillRoot, 'assets', 'coverage.template.csv');

function parse(argv) {
  const options = { source: null, out: null, gameId: null, name: null, maxFiles: 50000, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--out') options.out = argv[++i];
    else if (token === '--game-id') options.gameId = argv[++i];
    else if (token === '--name') options.name = argv[++i];
    else if (token === '--max-files') options.maxFiles = Number(argv[++i]);
    else if (token === '--dry-run') options.dryRun = true;
    else if (!token.startsWith('-') && !options.source) options.source = token;
    else throw new Error('Unknown or incomplete argument: ' + token);
  }
  if (!options.source || !options.out || !options.gameId) {
    throw new Error('Usage: node start-research.mjs <original-game-directory> --out <new-research-directory> --game-id <slug> [--name display-name] [--max-files 50000] [--dry-run]');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(options.gameId)) throw new Error('game-id must be a simple folder slug');
  options.name ??= options.gameId;
  if (!options.name.trim() || options.name.length > 80) throw new Error('Game name must be 1–80 characters');
  if (!Number.isInteger(options.maxFiles) || options.maxFiles < 1 || options.maxFiles > 500000) throw new Error('max-files must be 1..500000');
  return options;
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

// Resolve any existing ancestor: prevents junction aliases from defeating the
// source/output separation check, even when the final output is not created yet.
async function resolveFuture(target) {
  const tail = [];
  let parent = path.resolve(target);
  while (true) {
    try {
      const canonical = await realpath(parent);
      return path.resolve(canonical, ...tail.reverse());
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const up = path.dirname(parent);
      if (up === parent) throw error;
      tail.push(path.basename(parent));
      parent = up;
    }
  }
}

async function main() {
  const args = parse(process.argv.slice(2));
  const source = await realpath(path.resolve(args.source));
  if (!(await stat(source)).isDirectory()) throw new Error('Original game source must be a directory');
  const target = await resolveFuture(args.out);
  if (isInside(source.toLowerCase(), target.toLowerCase())) {
    throw new Error('Research output must be outside the original game source');
  }
  try {
    await stat(target);
    throw new Error('Target research directory already exists; refusing to overwrite');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (args.dryRun) {
    console.log(JSON.stringify({ action: 'start-game-research', source, output: target,
      gameId: args.gameId, scanner: 'GameReverseScanner', createsFiles: false }, null, 2));
    return;
  }

  const parent = path.dirname(target);
  await mkdir(parent, { recursive: true });
  const staging = path.join(parent, '.' + path.basename(target) + '.staging-' + process.pid);
  try {
    await stat(staging);
    throw new Error('Research staging path already exists; refusing to reuse it');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    const raw = path.join(staging, 'raw', 'scanner');
    const extracted = path.join(staging, 'raw', 'extracted-data');
    const production = path.join(staging, 'production');
    await mkdir(raw, { recursive: true });
    await mkdir(extracted, { recursive: true });
    await mkdir(production, { recursive: true });
    const scan = spawnSync(process.execPath,
      [scanner, 'scan', source, '--out', raw, '--max-files', String(args.maxFiles)],
      { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    if (scan.error || scan.status !== 0) throw new Error('GameReverseScanner failed: ' + (scan.stderr || scan.error?.message || scan.stdout));

    const profile = JSON.parse(await readFile(path.join(raw, 'engine-profile.json'), 'utf8'));
    // This is a candidate profile from the scanner, not human-reviewed truth.
    profile.game.id = args.gameId;
    profile.game.name = args.name;
    await writeFile(path.join(production, 'engine-profile.json'), JSON.stringify(profile, null, 2) + '\n');
    await cp(coverageTemplate, path.join(production, 'coverage.csv'));
    const functionIndex = JSON.parse(await readFile(path.join(skillRoot, 'assets', 'function-index.template.json'), 'utf8'));
    functionIndex.gameId = args.gameId;
    functionIndex.sourceBuild = 'unverified';
    await writeFile(path.join(production, 'function-index.json'), JSON.stringify(functionIndex, null, 2) + '\n');
    await cp(path.join(skillRoot, 'assets', 'data-schema.template.json'), path.join(production, 'data-schema.json'));
    await cp(path.join(skillRoot, 'assets', 'trace-map.template.json'), path.join(production, 'trace-map.json'));
    await cp(path.join(skillRoot, 'assets', 'verification-plan.template.json'), path.join(production, 'verification-plan.json'));
    await cp(path.join(skillRoot, 'assets', 'game-trace-recorder.template.mjs'), path.join(production, 'trace-recorder.template.mjs'));
    await mkdir(path.join(production, 'traces'), { recursive: true });
    await writeFile(path.join(staging, 'baseline.json'), JSON.stringify({
      schemaVersion: 1, gameId: args.gameId, name: args.name, sourcePath: source,
      scannerStatus: 'unreviewed', scannerOutput: 'raw/scanner',
      profile: 'production/engine-profile.json',
      coverage: 'production/coverage.csv',
      functionIndex: 'production/function-index.json',
      dataSchema: 'production/data-schema.json',
      traceMap: 'production/trace-map.json',
      verificationPlan: 'production/verification-plan.json',
      traces: 'production/traces',
      notes: 'Scanner output is a candidate; verify engine, build, version, and gameplay evidence independently.',
    }, null, 2) + '\n');
    await writeFile(path.join(staging, 'README.md'), [
      '# ' + args.name + ' · 逆向研究',
      '',
      '原版输入只读：' + source,
      '',
      '- raw/scanner/ 是一次扫描的原始证据，不直接修改。',
      '- production/engine-profile.json 是唯一可编辑的引擎画像；当前仅为未复核候选。',
      '- 使用两项独立证据复核引擎/版本后，才将 baseline.json 的 scannerStatus 改为 reviewed；否则综合验收会保持 incomplete。',
      '- production/coverage.csv 是唯一覆盖账本，初始为空，不代表 100% 完成。',
      '- production/function-index.json 记录有来源锚点的函数和调用边；必须区分 static / observed / inferred。',
      '- production/data-schema.json 声明数据表主键与跨表引用；提取副本放在 raw/extracted-data/。',
      '- production/data-inventory.json 由 analyze-data-tables.mjs 生成，核对记录数、重复 ID 和引用。',
      '- production/traces/ 保存同一测试场景的原版与 HTML JSONL 轨迹；trace-map.json 定义字段映射与容差。',
      '- production/verification-plan.json 声明哪些门禁适用于本游戏；仅对适用项目启用函数/数据/轨迹强制门禁。',
      '- 先确认游戏版本、引擎与代码后端，再研究程序规则、数据、内容及关卡。',
      '- 仅在完成对应验证后将 verification_status 标为 passed。',
      '- 审计：node <global-skill>/scripts/audit-coverage.mjs production/coverage.csv --json',
      '- 函数链：node <global-skill>/scripts/audit-function-index.mjs production/function-index.json --json',
      '- 数据表：node <global-skill>/scripts/analyze-data-tables.mjs raw/extracted-data --schema production/data-schema.json --out production/data-inventory.json',
      '- 行为对比：node <global-skill>/scripts/compare-game-traces.mjs production/traces/original.jsonl production/traces/html.jsonl --map production/trace-map.json --json',
      '- 综合验收：node <global-skill>/scripts/audit-research.mjs . --json；最终门禁加 --require-complete',
      '',
    ].join('\n'));
    await rename(staging, target);
    console.log(JSON.stringify({ success: true, research: target, source,
      files: ['baseline.json', 'production/engine-profile.json', 'production/coverage.csv',
        'production/function-index.json', 'production/data-schema.json', 'production/trace-map.json',
        'production/verification-plan.json',
        'production/trace-recorder.template.mjs', 'production/traces/', 'raw/extracted-data/',
        'raw/scanner/inventory.json', 'raw/scanner/engine-profile.json',
        'raw/scanner/tool-recommendations.json', 'raw/scanner/report.md'],
      engineIsConfirmed: false }, null, 2));
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

main().catch(error => { console.error('Research bootstrap failed: ' + error.message); process.exitCode = 1; });
