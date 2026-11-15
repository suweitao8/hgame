#!/usr/bin/env node
// Unified CLI dispatcher for HGame reverse-engineering -> clean-spec -> scaffold pipeline.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveReConfig } from '../.agents/skills/hgame-reverse-engineering/scripts/local-config.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const extractScript = path.join(repoRoot, '.agents', 'skills', 'hgame-reverse-engineering', 'scripts', 'extract-fast.mjs');
const exportSpecScript = path.join(repoRoot, '.agents', 'skills', 'hgame-reverse-engineering', 'scripts', 'export-clean-spec.mjs');
const validateSpecScript = path.join(repoRoot, '.agents', 'skills', 'hgame-spec-forge', 'scripts', 'validate-spec.mjs');

function runStep(script, args, label) {
  const res = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit' });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`${label} exited with code ${res.status}`);
  }
}

function parseForgeArgs(argv) {
  const opts = { source: null, slug: null, out: null, ipTerms: null, dryRun: false, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--source' || token === '-s') opts.source = argv[++i];
    else if (token === '--slug') opts.slug = argv[++i];
    else if (token === '--out' || token === '-o') opts.out = argv[++i];
    else if (token === '--ip-terms') opts.ipTerms = argv[++i];
    else if (token === '--dry-run') opts.dryRun = true;
    else if (token === '--json') opts.json = true;
    else if (token === '--help' || token === '-h') opts.help = true;
    else throw new Error(`Unknown or incomplete forge argument: ${token}`);
  }
  return opts;
}

function main() {
  const argv = process.argv.slice(2);
  let mode = 'forge';
  let rest = argv;
  if (argv[0] === 'extract' || argv[0] === 'spec' || argv[0] === 'forge') {
    mode = argv[0];
    rest = argv.slice(1);
  }

  if (mode === 'extract') {
    runStep(extractScript, rest, 're:extract');
    return;
  }

  if (mode === 'spec') {
    runStep(exportSpecScript, rest, 're:spec');
    return;
  }

  const opts = parseForgeArgs(rest);
  if (opts.help || !opts.slug || !opts.out) {
    console.log(
      'Usage:\n' +
      '  npm run re:extract -- "<original-game-dir>" --slug <slug>\n' +
      '  npm run re:spec -- --slug <slug> [--ip-terms "TermA,TermB"]\n' +
      '  npm run re:forge -- --slug <slug> --out "<new-game-dir>" [--source "<original-game-dir>"] [--ip-terms "TermA,TermB"] [--dry-run]',
    );
    if (!opts.help) process.exitCode = 1;
    return;
  }

  const cfg = resolveReConfig(repoRoot);
  const specPath = path.join(cfg.reWorkspaceDir, 'specs-out', `${opts.slug}.clean-spec.json`);

  if (opts.source) {
    const extractArgs = [opts.source, '--slug', opts.slug];
    if (opts.dryRun) extractArgs.push('--dry-run');
    runStep(extractScript, extractArgs, 'extract-fast');

    const specArgs = ['--slug', opts.slug, '--out', specPath];
    if (opts.ipTerms) specArgs.push('--ip-terms', opts.ipTerms);
    runStep(exportSpecScript, specArgs, 'export-clean-spec');
  }

  const forgeArgs = [specPath, '--scaffold', opts.out];
  if (opts.json) forgeArgs.push('--json');
  runStep(validateSpecScript, forgeArgs, 'validate-spec --scaffold');
}

try {
  main();
} catch (err) {
  console.error('re-pipeline failed: ' + err.message);
  process.exitCode = 1;
}
