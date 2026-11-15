// report.mjs — Markdown report renderer for the Game Reverse Scanner.
//
// renderMarkdownReport(scanResult) produces a human-readable review document:
// ranked candidates, evidence, confidence, version/platform/runtime findings,
// warnings, skipped paths and explicit next steps. Rendering is deterministic
// and never invents findings that detection did not report.

function line(tokens) {
  return `| ${tokens.join(' | ')} |`;
}

function evidenceLines(candidate) {
  return candidate.evidence.map(evidence =>
    `  - \`${evidence.path}\` — rule \`${evidence.rule}\` (${evidence.strength}): ${evidence.detail}`);
}

function candidateSection(candidates) {
  const rows = [
    line(['Rank', 'Engine', 'Score', 'Confidence', 'Version']),
    line(['---', '---', '---', '---', '---']),
  ];
  candidates.forEach((candidate, index) => {
    rows.push(line([String(index + 1), candidate.name, String(candidate.score), candidate.confidence, candidate.version || 'unknown']));
  });
  return rows.join('\n');
}

function detailSections(candidates) {
  const blocks = [];
  for (const candidate of candidates) {
    const parts = [`### ${candidate.name} (\`${candidate.id}\`)`, '', `- Score: ${candidate.score} (${candidate.confidence})`, `- Version: ${candidate.version || 'unknown'}`];
    if (candidate.versionConflict?.length) {
      parts.push('- **Conflicting explicit versions** (resolve manually before extraction):');
      for (const conflict of candidate.versionConflict) {
        parts.push(`  - ${conflict.version} — \`${conflict.path}\` (${conflict.rule})`);
      }
    }
    if (candidate.platforms.length) parts.push(`- Platforms: ${candidate.platforms.join(', ')}`);
    if (candidate.runtimes.length) {
      parts.push('- Runtimes:');
      for (const runtime of candidate.runtimes) {
        parts.push(`  - ${runtime.name} ${runtime.version === 'unknown' ? '(version unknown)' : runtime.version} — \`${runtime.evidence}\``);
      }
    }
    if (candidate.containers.length) parts.push(`- Containers: ${candidate.containers.join(', ')}`);
    parts.push('- Evidence:');
    parts.push(...evidenceLines(candidate));
    blocks.push(parts.join('\n'));
  }
  return blocks.join('\n\n');
}

function warningSection(warnings) {
  if (!warnings.length) return 'None.';
  const rows = [line(['Code', 'Path', 'Detail']), line(['---', '---', '---'])];
  for (const warning of warnings) {
    rows.push(line([warning.code, warning.path || '—', (warning.detail || warning.message || '').replace(/\|/g, '\\|')]));
  }
  return rows.join('\n');
}

function skippedSection(skipped) {
  if (!skipped.length) return 'None.';
  const byReason = new Map();
  for (const item of skipped) {
    if (!byReason.has(item.reason)) byReason.set(item.reason, []);
    byReason.get(item.reason).push(item.path);
  }
  const parts = [];
  for (const [reason, paths] of [...byReason.entries()].sort((left, right) => (left[0] < right[0] ? -1 : 1))) {
    const preview = paths.slice(0, 20).map(path => `\`${path}\``).join(', ');
    parts.push(`- **${reason}** (${paths.length}): ${preview}${paths.length > 20 ? ', …' : ''}`);
  }
  return parts.join('\n');
}

/** Render the human-readable Markdown report for a completed scan. */
export function renderMarkdownReport(scanResult) {
  const candidates = scanResult.candidates || [];
  const inventory = scanResult.inventory || { files: [], skipped: [], warnings: [], stats: {} };
  const metadataWarnings = scanResult.metadata?.warnings || [];
  const archiveWarnings = (scanResult.archives || []).flatMap(archive => archive.warnings || []);
  const allWarnings = [...(inventory.warnings || []), ...archiveWarnings, ...metadataWarnings, ...(scanResult.warnings || [])];
  const platforms = [...new Set((scanResult.metadata?.platformHints || []).map(hint => hint.name))];

  const sections = [];
  sections.push('# Game Reverse Scanner report');
  sections.push('');
  sections.push(`- Input: \`${scanResult.input?.label ?? scanResult.input?.root ?? 'unknown'}\``);
  sections.push(`- Scanned at: ${scanResult.scannedAt || 'unknown'}`);
  sections.push(`- Files: ${inventory.stats?.fileCount ?? inventory.files.length} in ${inventory.stats?.dirCount ?? '?'} directories`);
  sections.push(`- Limits: max-files=${scanResult.options?.maxFiles ?? 'default'}, max-depth=${scanResult.options?.maxDepth ?? 'default'}, include-cache=${scanResult.options?.includeCache ? 'yes' : 'no'}, hash-key-files=${scanResult.options?.hashKeyFiles ? 'yes' : 'no'}`);
  if (inventory.stats?.truncated) sections.push('- **Traversal was truncated; the listed inventory is not the complete tree.**');
  sections.push('');
  sections.push('## Engine candidates');
  sections.push('');
  if (candidates.length) {
    sections.push(candidateSection(candidates));
    sections.push('');
    sections.push(detailSections(candidates));
  } else {
    sections.push('No engine candidate reached the evidence threshold. The engine is **unknown** — do not guess; extend the scan with the generic tools below or gather more build files.');
  }
  sections.push('');
  sections.push('## Scan-level platforms');
  sections.push('');
  sections.push(platforms.length ? platforms.join(', ') : 'unknown');
  sections.push('');
  sections.push('## Containers indexed');
  sections.push('');
  const archives = scanResult.archives || [];
  if (archives.length) {
    const rows = [line(['Archive', 'Format', 'Entries', 'Warnings']), line(['---', '---', '---', '---'])];
    for (const archive of archives) {
      rows.push(line([`\`${archive.path}\``, archive.format, String(archive.entries?.length ?? 0), String(archive.warnings?.length ?? 0)]));
    }
    sections.push(rows.join('\n'));
  } else {
    sections.push('None (no ZIP-family archive was indexed).');
  }
  sections.push('');
  sections.push('## Warnings');
  sections.push('');
  sections.push(warningSection(allWarnings));
  sections.push('');
  sections.push('## Skipped paths');
  sections.push('');
  sections.push(skippedSection(inventory.skipped || []));
  sections.push('');
  sections.push('## What this scan does not prove');
  sections.push('');
  sections.push('- The scanner is a read-only first-pass tool: identifying an engine does not recover gameplay rules, data, or offline scope.');
  sections.push('- Version fields come only from explicit allowlisted metadata; absence stays `unknown`.');
  sections.push('- Recommended tools were not checked for availability or version compatibility.');
  sections.push('- Skipped paths (VCS/cache directories, symlinks, depth/file limits) were not inspected.');
  sections.push('');
  sections.push('## Next steps');
  sections.push('');
  sections.push('1. Review the ranked candidates and their evidence above; correct the primary engine manually if needed.');
  sections.push('2. After manual confirmation, record the profile in the game project and follow the matching engine playbook in `docs/GAME_REVERSE_ENGINEERING_ENGINE_PLAYBOOKS.md`.');
  sections.push('3. Use `tool-recommendations.json` as the starting tool list; verify availability yourself before running any tool.');
  sections.push('');
  return `${sections.join('\n')}\n`;
}
