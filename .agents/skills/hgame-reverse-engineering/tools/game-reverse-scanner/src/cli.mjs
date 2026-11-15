// cli.mjs — command-line orchestration for the Game Reverse Scanner.
//
// runScan(inputPath, options) chains bounded traversal, ZIP central-directory
// indexing, allowlisted metadata collection, evidence-based detection,
// optional key-artifact hashing and artifact building. writeOutputs validates
// the output location again before writing exactly the four named artifacts.
// Exit codes: 0 success, 1 scan/write failure, 2 invalid arguments,
// 3 unsafe output placement.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { walkInput, toInventoryEntry, DEFAULT_MAX_FILES, DEFAULT_MAX_DEPTH } from './walk.mjs';
import { indexZipFile } from './zip-index.mjs';
import { collectMetadata } from './metadata.mjs';
import { detectEngines } from './detect.mjs';
import { buildEngineProfile } from './profile.mjs';
import { buildRecommendations } from './recommendations.mjs';
import { renderMarkdownReport } from './report.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version: CLI_VERSION } = require('../package.json');

const INVENTORY_SCHEMA_VERSION = 1;
const ZIP_EXTENSIONS = new Set(['.zip', '.jar', '.apk', '.ipa', '.aar']);
const HASHABLE_KINDS = new Set(['executable', 'archive', 'container', 'database', 'bytecode']);
const HASH_BUDGET_BYTES = 4 * 1024 * 1024 * 1024;

const USAGE = `Game Reverse Scanner — read-only first-pass game build fingerprinting

Usage:
  node game-reverse-scan.mjs scan <input-path> --out <output-dir>
    [--max-files <count>] [--max-depth <count>] [--include-cache] [--hash-key-files]
  node game-reverse-scan.mjs --help
  node game-reverse-scan.mjs --version

The scanner never executes the target, extracts archive members, follows
symlinks, accesses the network, or writes beneath the input path.
Exit codes: 0 success, 1 scan/write failure, 2 invalid arguments,
3 unsafe output placement.
`;

function cliError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isInsideOrEqual(child, parent) {
  const normalizedChild = process.platform === 'win32' ? path.resolve(child).toLowerCase() : path.resolve(child);
  const normalizedParent = process.platform === 'win32' ? path.resolve(parent).toLowerCase() : path.resolve(parent);
  const rel = path.relative(normalizedParent, normalizedChild);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Resolve the deepest existing ancestor of a path and rejoin the not-yet-
// existing remainder, so junction/symlink aliases are compared by their real
// target rather than their literal text.
function deepestExistingRealPath(target) {
  let current = path.resolve(target);
  const suffix = [];
  for (;;) {
    try {
      return { real: fs.realpathSync(current), suffix };
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return { real: current, suffix };
      suffix.unshift(path.basename(current));
      current = parent;
    }
  }
}

/** Reject output directories that are equal to or nested inside the scan root. */
export function ensureSafeOutputPath(inputRoot, outputDir) {
  const inputReal = deepestExistingRealPath(inputRoot).real;
  const outputReal = deepestExistingRealPath(outputDir);
  const outputCandidate = outputReal.suffix.length
    ? path.join(outputReal.real, ...outputReal.suffix)
    : outputReal.real;
  if (isInsideOrEqual(outputCandidate, inputReal)) {
    throw cliError('UNSAFE_OUTPUT', `output directory must be outside the scanned input: ${outputDir}`);
  }
}

function hashKeyArtifacts(files) {
  const hashes = {};
  let budget = HASH_BUDGET_BYTES;
  for (const file of files) {
    if (!HASHABLE_KINDS.has(file.kind)) continue;
    if (file.sizeBytes > budget) return { hashes, truncated: true };
    const fd = fs.openSync(file.absolutePath, 'r');
    try {
      const hash = crypto.createHash('sha256');
      const chunk = Buffer.alloc(1024 * 1024);
      let position = 0;
      let hashed = 0;
      while (position < file.sizeBytes) {
        const length = Math.min(chunk.length, file.sizeBytes - position);
        const read = fs.readSync(fd, chunk, 0, length, position);
        if (read <= 0) break;
        hash.update(chunk.subarray(0, read));
        position += read;
        hashed += read;
      }
      if (hashed === file.sizeBytes) {
        hashes[file.path] = hash.digest('hex');
        budget -= hashed;
      }
    } catch {
      // Unreadable files keep no hash entry; the walk already warned.
    } finally {
      fs.closeSync(fd);
    }
  }
  return { hashes, truncated: false };
}

/** Run a complete read-only scan and build all four output artifacts. */
export async function runScan(inputPath, options = {}) {
  const scanOptions = {
    maxFiles: options.maxFiles,
    maxDepth: options.maxDepth,
    includeCache: options.includeCache === true,
  };
  const walk = walkInput(inputPath, scanOptions);

  const archives = [];
  for (const file of walk.files) {
    const isZipFamily = file.magic?.id === 'zip' || ZIP_EXTENSIONS.has(file.extension);
    if (!isZipFamily) continue;
    archives.push(indexZipFile(file.absolutePath, file.path));
  }

  const metadata = await collectMetadata(walk.root, walk.files, archives);
  const candidates = detectEngines({ files: walk.files, archives, metadata });

  let keyFileHashes = {};
  let hashTruncated = false;
  if (options.hashKeyFiles === true) {
    const hashed = hashKeyArtifacts(walk.files);
    keyFileHashes = hashed.hashes;
    hashTruncated = hashed.truncated;
  }

  const warnings = [...walk.warnings];
  if (hashTruncated) {
    warnings.push({ code: 'hash-budget-exceeded', path: '.', detail: `Key-artifact hashing stopped after the ${HASH_BUDGET_BYTES}-byte budget; remaining key files were not hashed.` });
  }

  const inventory = {
    schema_version: INVENTORY_SCHEMA_VERSION,
    scanned_at: new Date().toISOString(),
    input: {
      label: path.basename(path.resolve(inputPath)),
      path: walk.root,
      kind: walk.files.length === 1 && walk.skipped.length === 0 && fs.statSync(inputPath).isFile() ? 'file' : 'directory',
    },
    options: {
      maxFiles: scanOptions.maxFiles ?? DEFAULT_MAX_FILES,
      maxDepth: scanOptions.maxDepth ?? DEFAULT_MAX_DEPTH,
      includeCache: scanOptions.includeCache,
      hashKeyFiles: options.hashKeyFiles === true,
    },
    stats: walk.stats,
    files: walk.files.map(toInventoryEntry),
    archives,
    skipped: walk.skipped,
    warnings,
  };
  if (metadata.warnings.length) inventory.warnings.push(...metadata.warnings.map(warning => ({ source: 'metadata', ...warning })));

  const scanResult = {
    input: { root: walk.root, label: inventory.input.label, isFile: inventory.input.kind === 'file' },
    scannedAt: inventory.scanned_at,
    options: inventory.options,
    inventory,
    archives,
    metadata,
    candidates,
    keyFileHashes,
    warnings,
  };

  return {
    inventory,
    profile: buildEngineProfile(scanResult),
    recommendations: buildRecommendations(candidates),
    report: renderMarkdownReport(scanResult),
  };
}

/** Write the four output artifacts into a validated output directory. */
export async function writeOutputs(outputDir, result) {
  const inputRoot = result.inventory?.input?.path;
  if (!inputRoot) throw cliError('UNSAFE_OUTPUT', 'scan result is missing its input root; refusing to write');
  ensureSafeOutputPath(inputRoot, outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  const artifacts = [
    ['inventory.json', `${JSON.stringify(result.inventory, null, 2)}\n`],
    ['engine-profile.json', `${JSON.stringify(result.profile, null, 2)}\n`],
    ['tool-recommendations.json', `${JSON.stringify(result.recommendations, null, 2)}\n`],
    ['report.md', result.report],
  ];
  const writtenFiles = [];
  for (const [name, content] of artifacts) {
    const target = path.join(outputDir, name);
    fs.writeFileSync(target, content, 'utf8');
    writtenFiles.push(target);
  }
  return { writtenFiles };
}

function parsePositiveInteger(value, flag) {
  if (!/^\d+$/.test(value)) throw cliError('INVALID_ARGUMENTS', `${flag} expects a positive integer, got: ${value}`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw cliError('INVALID_ARGUMENTS', `${flag} expects a positive integer, got: ${value}`);
  return parsed;
}

export function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { command: 'help' };
  if (argv.includes('--version')) return { command: 'version' };
  if (argv[0] !== 'scan') throw cliError('INVALID_ARGUMENTS', `unknown command: ${argv[0] || '(none)'}; expected "scan"`);
  const parsed = { command: 'scan', input: undefined, out: undefined, maxFiles: undefined, maxDepth: undefined, includeCache: false, hashKeyFiles: false };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out') {
      parsed.out = argv[index + 1];
      if (!parsed.out) throw cliError('INVALID_ARGUMENTS', '--out requires a directory argument');
      index += 1;
    } else if (arg === '--max-files') {
      parsed.maxFiles = parsePositiveInteger(argv[index + 1], '--max-files');
      index += 1;
    } else if (arg === '--max-depth') {
      parsed.maxDepth = parsePositiveInteger(argv[index + 1], '--max-depth');
      index += 1;
    } else if (arg === '--include-cache') {
      parsed.includeCache = true;
    } else if (arg === '--hash-key-files') {
      parsed.hashKeyFiles = true;
    } else if (arg.startsWith('--')) {
      throw cliError('INVALID_ARGUMENTS', `unknown option: ${arg}`);
    } else if (parsed.input === undefined) {
      parsed.input = arg;
    } else {
      throw cliError('INVALID_ARGUMENTS', `unexpected extra argument: ${arg}`);
    }
  }
  if (!parsed.input) throw cliError('INVALID_ARGUMENTS', 'scan requires an input path');
  if (!parsed.out) throw cliError('INVALID_ARGUMENTS', 'scan requires --out <output-dir>');
  return parsed;
}

/** CLI entry point; returns the process exit code. */
export async function main(argv, streams = {}) {
  const stdout = streams.stdout ?? process.stdout;
  const stderr = streams.stderr ?? process.stderr;
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    if (error.code === 'INVALID_ARGUMENTS') {
      stderr.write(`${error.message}\n\n${USAGE}`);
      return 2;
    }
    throw error;
  }
  if (parsed.command === 'help') {
    stdout.write(USAGE);
    return 0;
  }
  if (parsed.command === 'version') {
    stdout.write(`${CLI_VERSION}\n`);
    return 0;
  }

  try {
    const result = await runScan(parsed.input, {
      maxFiles: parsed.maxFiles,
      maxDepth: parsed.maxDepth,
      includeCache: parsed.includeCache,
      hashKeyFiles: parsed.hashKeyFiles,
    });
    ensureSafeOutputPath(result.inventory.input.path, parsed.out);
    await writeOutputs(parsed.out, result);
    stdout.write(`Scan complete: ${result.inventory.files.length} files, ${result.inventory.archives.length} archives indexed, ${result.profile.engine.name} leading candidate.\nOutput: ${path.resolve(parsed.out)}\n`);
    return 0;
  } catch (error) {
    if (error?.code === 'UNSAFE_OUTPUT') {
      stderr.write(`Unsafe output placement: ${error.message}\n`);
      return 3;
    }
    if (error?.code === 'INPUT_NOT_FOUND' || error?.code === 'INPUT_NOT_FILE_OR_DIR') {
      stderr.write(`Scan failed: ${error.message}\n`);
      return 1;
    }
    stderr.write(`Scan failed: ${error?.stack || error}\n`);
    return 1;
  }
}
