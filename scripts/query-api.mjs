#!/usr/bin/env node
// Zero-blind-scan HGame API quick lookup over docs/api/API-INDEX.json and types/.
// Usage:
//   npm run api -- <keyword>
//   npm run api -- --module <name>
//   npm run api -- --list
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = path.join(root, 'docs', 'api', 'API-INDEX.json');
const typesRoot = path.join(root, 'types');

function printUsage() {
  console.log('Usage:');
  console.log('  npm run api -- <keyword>            Search modules, exports, and summaries');
  console.log('  npm run api -- --module <name>      List exports in matching module(s)');
  console.log('  npm run api -- --list               List all indexed runtime modules');
  console.log('  Options: --json                     Emit JSON output');
}

function parseArgs(argv) {
  let moduleQuery = '';
  let listOnly = false;
  let jsonOut = false;
  const keywords = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--module' || a === '-m') {
      moduleQuery = argv[++i] ?? '';
    } else if (a === '--list' || a === '-l') {
      listOnly = true;
    } else if (a === '--json') {
      jsonOut = true;
    } else if (a === '--help' || a === '-h') {
      printUsage();
      process.exit(0);
    } else {
      keywords.push(a);
    }
  }
  return { moduleQuery, listOnly, jsonOut, keyword: keywords.join(' ').trim() };
}

function extractDtsSignature(dtsText, exportName) {
  if (!dtsText) return null;
  const escaped = exportName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`export\\s+(?:function|class|const|declare\\s+(?:function|class|const))\\s+${escaped}\\b[^;{]*`, 'm');
  const m = re.exec(dtsText);
  if (!m) return null;
  return m[0].replace(/\s+/g, ' ').trim();
}

function readModuleDts(modPath) {
  const relDts = modPath.replace(/\.m?js$/i, '.d.ts');
  const absDts = path.join(typesRoot, relDts);
  if (!fs.existsSync(absDts)) return '';
  return fs.readFileSync(absDts, 'utf8');
}

function formatExport(exp, dtsText) {
  const sig = exp.signature ? `${exp.name}${exp.signature}` : exp.name;
  const dtsSig = extractDtsSignature(dtsText, exp.name);
  const lines = [`  [${exp.kind}] ${sig}`];
  if (dtsSig && dtsSig.length <= 200 && dtsSig !== sig) {
    lines.push(`    dts: ${dtsSig}`);
  }
  if (exp.summary) {
    lines.push(`    doc: ${exp.summary}`);
  }
  if (exp.returns?.length) {
    lines.push(`    returns: ${exp.returns.join(', ')}`);
  }
  if (exp.members?.length) {
    lines.push(`    members: ${exp.members.join(', ')}`);
  }
  if (exp.static?.length) {
    lines.push(`    static: ${exp.static.join(', ')}`);
  }
  if (exp.keys?.length && exp.keys.length <= 24) {
    lines.push(`    keys: ${exp.keys.join(', ')}`);
  }
  return lines.join('\n');
}

const args = parseArgs(process.argv.slice(2));
if (!fs.existsSync(indexPath)) {
  console.error('Missing docs/api/API-INDEX.json. Run: npm run build:api-index');
  process.exit(1);
}

const apiIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
const modules = apiIndex.modules || {};
const moduleEntries = Object.entries(modules);

if (args.listOnly) {
  const summary = moduleEntries.map(([modPath, info]) => ({
    module: modPath,
    tier: info.tier,
    exports: info.exports?.length ?? 0,
  }));
  if (args.jsonOut) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    for (const row of summary) {
      console.log(`vendor/hgame/${row.module} (${row.tier}, ${row.exports} exports)`);
    }
  }
  process.exit(0);
}

if (!args.moduleQuery && !args.keyword) {
  printUsage();
  process.exit(1);
}

const modNeedle = args.moduleQuery.toLowerCase();
const kwNeedle = args.keyword.toLowerCase();
const matches = [];

for (const [modPath, info] of moduleEntries) {
  const modLower = modPath.toLowerCase();
  if (modNeedle && !modLower.includes(modNeedle)) continue;

  const exportsList = info.exports || [];
  let matchedExports = exportsList;
  if (kwNeedle) {
    const modMatches = modLower.includes(kwNeedle);
    matchedExports = exportsList.filter((exp) => {
      if (modMatches && !args.moduleQuery && modLower !== 'index.js') return true;
      return (
        exp.name.toLowerCase().includes(kwNeedle) ||
        (exp.summary || '').toLowerCase().includes(kwNeedle) ||
        (exp.returns || []).some((r) => r.toLowerCase().includes(kwNeedle)) ||
        (exp.members || []).some((m) => m.toLowerCase().includes(kwNeedle))
      );
    });
  }

  if (matchedExports.length > 0) {
    matches.push({ module: modPath, tier: info.tier, exports: matchedExports });
  }
}

if (args.jsonOut) {
  console.log(JSON.stringify({ query: args, matches }, null, 2));
  process.exit(0);
}

if (matches.length === 0) {
  console.log(`No API matches found for ${args.moduleQuery ? `--module ${args.moduleQuery}` : args.keyword}`);
  process.exit(0);
}

for (const entry of matches) {
  const dtsText = readModuleDts(entry.module);
  console.log(`=== vendor/hgame/${entry.module} [${entry.tier}] ===`);
  for (const exp of entry.exports) {
    console.log(formatExport(exp, dtsText));
  }
}
