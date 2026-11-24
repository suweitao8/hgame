import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
export const DEFAULT_SCORECARD_PATH = path.join(DEFAULT_REPO_ROOT, 'docs', 'scorecard', 'engine-scorecard.json');
export const DEFAULT_DOC_PATH = path.join(DEFAULT_REPO_ROOT, 'docs', 'ENGINE-SCORECARD.md');

const EXPECTED_DIMENSIONS = new Map([
  ['A', 18],
  ['R', 30],
  ['P', 24],
  ['S', 20],
  ['N', 8]
]);

const REQUIRED_ENGINES = ['hgame', 'unity', 'cocos', 'godot'];

const SECTION_MARKERS = {
  runtime: ['<!-- scorecard:runtime:start -->', '<!-- scorecard:runtime:end -->'],
  items: ['<!-- scorecard:items:start -->', '<!-- scorecard:items:end -->'],
  exemptions: ['<!-- scorecard:exemptions:start -->', '<!-- scorecard:exemptions:end -->']
};

export function normalizeNewlines(text) {
  return String(text).replace(/\r\n/g, '\n');
}

export function loadScorecard(scorecardPath = DEFAULT_SCORECARD_PATH) {
  const raw = fs.readFileSync(scorecardPath, 'utf8');
  return JSON.parse(raw);
}

function isHalfStepScore(value) {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 10 &&
    Math.abs(value * 2 - Math.round(value * 2)) < 1e-9
  );
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isExemptEntry(entry) {
  return entry?.exempt === true;
}

// Exempt entries (out of scope by product positioning) are neither required nor met, so they
// stay out of the maturity tag and maxAllowed instead of counting against the item.
export function summarizeChecklist(item) {
  const checklist = Array.isArray(item?.hgame?.industrialChecklist) ? item.hgame.industrialChecklist : [];
  let met = 0;
  let exempt = 0;
  for (const entry of checklist) {
    if (isExemptEntry(entry)) {
      exempt += 1;
    } else if (entry?.met === true) {
      met += 1;
    }
  }
  return { met, exempt, applicable: checklist.length - exempt, total: checklist.length };
}

export function validateScorecard(data, { repoRoot = DEFAULT_REPO_ROOT } = {}) {
  const errors = [];
  if (!data || typeof data !== 'object') {
    return ['Scorecard root must be a JSON object.'];
  }

  const engineIds = Array.isArray(data.engines) ? data.engines.map((e) => e.id) : [];
  for (const reqId of REQUIRED_ENGINES) {
    if (!engineIds.includes(reqId)) {
      errors.push(`Missing required engine definition "${reqId}".`);
    }
  }

  if (!Array.isArray(data.dimensions) || data.dimensions.length !== EXPECTED_DIMENSIONS.size) {
    errors.push(`Dimensions must contain exactly ${EXPECTED_DIMENSIONS.size} entries (A, R, P, S, N).`);
  } else {
    let dimWeightSum = 0;
    for (const dim of data.dimensions) {
      const expectedWeight = EXPECTED_DIMENSIONS.get(dim.id);
      if (expectedWeight === undefined) {
        errors.push(`Unexpected dimension id "${dim.id}".`);
      } else if (dim.weight !== expectedWeight) {
        errors.push(`Dimension "${dim.id}" weight must be ${expectedWeight}, got ${dim.weight}.`);
      }
      dimWeightSum += Number(dim.weight) || 0;
    }
    if (dimWeightSum !== 100) {
      errors.push(`Total dimension weights must equal 100, got ${dimWeightSum}.`);
    }
  }

  const evidenceLevels = data.evidenceLevels || {};
  const items = Array.isArray(data.items) ? data.items : [];
  if (items.length === 0) {
    errors.push('Runtime items list must not be empty.');
  }

  const dimItemWeights = new Map();
  let runtimeWeightSum = 0;

  for (const item of items) {
    const label = item?.id || '<unknown>';
    if (!isNonEmptyString(item?.id) || !isNonEmptyString(item?.name)) {
      errors.push(`Runtime item "${label}" must have non-empty id and name.`);
    }
    if (!EXPECTED_DIMENSIONS.has(item?.dimension)) {
      errors.push(`Runtime item "${label}" has invalid dimension "${item?.dimension}".`);
    } else {
      dimItemWeights.set(
        item.dimension,
        (dimItemWeights.get(item.dimension) || 0) + (Number(item.weight) || 0)
      );
    }
    if (typeof item?.weight !== 'number' || item.weight <= 0) {
      errors.push(`Runtime item "${label}" weight must be a positive number.`);
    }
    runtimeWeightSum += Number(item?.weight) || 0;

    for (const engId of REQUIRED_ENGINES) {
      const score = item?.scores?.[engId];
      if (!isHalfStepScore(score)) {
        errors.push(`Runtime item "${label}" score for "${engId}" must be a 0.5 step in [0, 10], got ${score}.`);
      }
    }

    const hg = item?.hgame;
    const hScore = item?.scores?.hgame;
    if (!hg || typeof hg !== 'object') {
      errors.push(`Runtime item "${label}" missing "hgame" metadata block.`);
    } else {
      const ev = evidenceLevels[hg.evidence];
      if (!ev || typeof ev.cap !== 'number') {
        errors.push(`Runtime item "${label}" has unknown capability level "${hg.evidence}".`);
      } else if (typeof hScore === 'number' && hScore > ev.cap) {
        errors.push(
          `Runtime item "${label}" HGame score ${hScore} exceeds capability level "${hg.evidence}" cap ${ev.cap}.`
        );
      }

      if (typeof hg.defaultPath !== 'boolean') {
        errors.push(`Runtime item "${label}" hgame.defaultPath must be boolean.`);
      } else if (hg.defaultPath === false && typeof hScore === 'number' && hScore > 7) {
        errors.push(
          `Runtime item "${label}" HGame score ${hScore} violates Hard Cap #1 (defaultPath=false caps score at 7).`
        );
      }

      const checklist = hg.industrialChecklist;
      if (!Array.isArray(checklist) || checklist.length < 3 || checklist.length > 5) {
        errors.push(`Runtime item "${label}" hgame.industrialChecklist must contain 3 to 5 entries.`);
      } else {
        let metCount = 0;
        let exemptCount = 0;
        for (let i = 0; i < checklist.length; i++) {
          const entry = checklist[i];
          if (!isNonEmptyString(entry?.point)) {
            errors.push(`Runtime item "${label}" industrialChecklist[${i}].point must be non-empty.`);
          }
          if (typeof entry?.met !== 'boolean') {
            errors.push(`Runtime item "${label}" industrialChecklist[${i}].met must be boolean.`);
          } else if (entry.met) {
            metCount += 1;
          }
          if (entry?.exempt !== undefined && typeof entry.exempt !== 'boolean') {
            errors.push(`Runtime item "${label}" industrialChecklist[${i}].exempt must be boolean when present.`);
          } else if (isExemptEntry(entry)) {
            exemptCount += 1;
            if (entry.met === true) {
              errors.push(`Runtime item "${label}" industrialChecklist[${i}] is exempt and cannot also be met.`);
            }
            if (!isNonEmptyString(entry?.exemptReason)) {
              errors.push(
                `Runtime item "${label}" industrialChecklist[${i}].exemptReason must be non-empty for exempt entries.`
              );
            }
          }
          if (!isNonEmptyString(entry?.proof)) {
            errors.push(`Runtime item "${label}" industrialChecklist[${i}].proof must be non-empty.`);
          }
        }

        const applicableCount = checklist.length - exemptCount;
        if (applicableCount < 3) {
          errors.push(
            `Runtime item "${label}" must keep at least 3 non-exempt checklist entries, got ${applicableCount}.`
          );
        }

        if (hg.evidence === 'C4' && metCount !== applicableCount) {
          errors.push(
            `Runtime item "${label}" capability level C4 requires all ${applicableCount} non-exempt checklist items met, got ${metCount}.`
          );
        }
        if (hg.evidence === 'C3' && metCount < 1) {
          errors.push(
            `Runtime item "${label}" capability level C3 requires at least 1 checklist item met, got ${metCount}.`
          );
        }

        if (typeof hg.defaultPath === 'boolean' && typeof hScore === 'number') {
          const maxAllowed = hg.defaultPath ? 8 + (2 * metCount) / applicableCount : 7;
          if (hScore > maxAllowed + 1e-9) {
            errors.push(
              `Runtime item "${label}" HGame score ${hScore} exceeds industrialChecklist maxAllowed ${maxAllowed.toFixed(2)} (${metCount}/${applicableCount} non-exempt met).`
            );
          }
        }
      }

      if (!Array.isArray(hg.proofFiles) || hg.proofFiles.length === 0) {
        errors.push(`Runtime item "${label}" hgame.proofFiles must be a non-empty array.`);
      } else {
        for (const relPath of hg.proofFiles) {
          if (!isNonEmptyString(relPath)) {
            errors.push(`Runtime item "${label}" contains empty proofFile entry.`);
            continue;
          }
          const absPath = path.resolve(repoRoot, relPath);
          if (!fs.existsSync(absPath)) {
            errors.push(`Runtime item "${label}" proofFile does not exist: "${relPath}".`);
          }
        }
      }

      if (!isNonEmptyString(hg.note)) {
        errors.push(`Runtime item "${label}" hgame.note must be non-empty.`);
      }
    }

    if (!isNonEmptyString(item?.gap)) {
      errors.push(`Runtime item "${label}" gap must be non-empty.`);
    }

    for (const compId of ['unity', 'cocos', 'godot']) {
      if (!isNonEmptyString(item?.competitorNotes?.[compId])) {
        errors.push(`Runtime item "${label}" competitorNotes.${compId} must be non-empty.`);
      }
    }
  }

  for (const [dimId, expectedWeight] of EXPECTED_DIMENSIONS.entries()) {
    const actualWeight = dimItemWeights.get(dimId) || 0;
    if (actualWeight !== expectedWeight) {
      errors.push(`Dimension "${dimId}" items weight sum must equal ${expectedWeight}, got ${actualWeight}.`);
    }
  }
  if (runtimeWeightSum !== 100) {
    errors.push(`Total runtime items weight sum must equal 100, got ${runtimeWeightSum}.`);
  }

  // Evidence hardening: benchmark files must exist; competitor scores must declare their basis;
  // recorded measurements must stay inside declared budgets.
  for (const item of items) {
    for (const relPath of item?.hgame?.benchmarkFiles || []) {
      if (!isNonEmptyString(relPath) || !fs.existsSync(path.resolve(repoRoot, relPath))) {
        errors.push(`Runtime item "${item?.id}" benchmarkFile does not exist: "${relPath}".`);
      }
    }
  }
  for (const compId of ['unity', 'cocos', 'godot']) {
    const b = data.competitorBasis?.[compId];
    if (!b || !isNonEmptyString(b.version) || !isNonEmptyString(b.source) || !isNonEmptyString(b.measuredAt)) {
      errors.push(`competitorBasis.${compId} must declare version, source and measuredAt.`);
    } else if (!['qualitative', 'measured'].includes(b.basis) || !['low', 'medium', 'high'].includes(b.confidence)) {
      errors.push(`competitorBasis.${compId} basis must be qualitative|measured and confidence low|medium|high.`);
    }
  }
  const budgets = data.budgets || {};
  for (const [key, value] of Object.entries(data.measurements || {})) {
    if (typeof budgets[key] !== 'number') {
      errors.push(`measurements.${key} has no matching budget in "budgets".`);
    } else if (value > budgets[key]) {
      errors.push(`measurements.${key}=${value} exceeds budget ${budgets[key]}.`);
    }
  }

  return errors;
}

/**
 * Non-fatal findings that hint at self-assessment inflation or weak evidence.
 */
export function collectWarnings(data, { repoRoot = DEFAULT_REPO_ROOT } = {}) {
  const warnings = [];
  const items = Array.isArray(data.items) ? data.items : [];
  for (const item of items) {
    const ev = item?.hgame?.evidence;
    const benches = item?.hgame?.benchmarkFiles || [];
    if ((ev === 'C3' || ev === 'C4') && benches.length === 0) {
      warnings.push(`${item.id}: evidence ${ev} has no benchmarkFiles (no automated real-run proof).`);
    }
    for (const rel of item?.hgame?.proofFiles || []) {
      const abs = path.resolve(repoRoot, rel);
      if (fs.existsSync(abs) && fs.statSync(abs).isFile() && fs.statSync(abs).size < 200) {
        warnings.push(`${item.id}: proofFile "${rel}" is nearly empty (<200 bytes).`);
      }
    }
  }
  const high = items.filter((it) => it?.scores?.hgame >= 8.5).length;
  if (items.length > 0 && high / items.length > 0.7) {
    warnings.push(`${high}/${items.length} items score >= 8.5 (>70%): low discriminative power, review for inflation.`);
  }
  const perfectGaps = items.filter((it) => it?.scores?.hgame >= 9).length;
  if (perfectGaps > 3) {
    warnings.push(`${perfectGaps} items score >= 9: confirm each has independent benchmark evidence.`);
  }
  return warnings;
}

function gzipBytes(buffer) {
  return zlib.gzipSync(buffer).length;
}

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * Re-measures gzip payloads from the working tree so recorded numbers cannot silently go stale.
 */
export function measureRuntime(repoRoot = DEFAULT_REPO_ROOT) {
  const MB = 1024 * 1024;
  const runtimeDir = path.join(repoRoot, 'assets', 'runtime');
  const files = walkFiles(runtimeDir);
  const isVendor = (f) => f.split(path.sep).includes('vendor');
  const jsFiles = files.filter((f) => f.endsWith('.js') && !isVendor(f));
  const runtimeJs = gzipBytes(Buffer.concat(jsFiles.map((f) => fs.readFileSync(f))));
  const vendorSize = (name) => {
    const dir = path.join(runtimeDir, 'vendor', name);
    return walkFiles(dir).reduce((sum, f) => sum + gzipBytes(fs.readFileSync(f)), 0);
  };
  const round2 = (n) => Math.round((n / MB) * 100) / 100;
  return {
    runtimeJsGzipMB: round2(runtimeJs),
    rapier3dGzipMB: round2(vendorSize('rapier3d')),
    rapier2dGzipMB: round2(vendorSize('rapier2d'))
  };
}

export function checkMeasurementDrift(data, measured) {
  const tol = typeof data.measurementTolerance === 'number' ? data.measurementTolerance : 0.1;
  const errors = [];
  for (const [key, actual] of Object.entries(measured)) {
    const recorded = data.measurements?.[key];
    if (typeof recorded !== 'number') continue;
    if (actual > (data.budgets?.[key] ?? Infinity)) {
      errors.push(`measured ${key}=${actual} exceeds budget ${data.budgets[key]}.`);
    }
    if (recorded > 0 && Math.abs(actual - recorded) / recorded > tol) {
      errors.push(`measurements.${key} recorded ${recorded} drifted from live ${actual} (> ${(tol * 100).toFixed(0)}%).`);
    }
  }
  return errors;
}

function round1(value) {
  return Math.round((Math.round(value * 1e6) / 1e6) * 10) / 10;
}

export function computeScores(data) {
  const engines = data.engines;
  const dimensions = data.dimensions;
  const items = data.items;

  const byEngine = {};

  for (const engine of engines) {
    const id = engine.id;
    const dimStats = {};
    for (const dim of dimensions) {
      dimStats[dim.id] = { id: dim.id, name: dim.name, weight: dim.weight, points: 0, pct: 0 };
    }

    let runtimeTotalRaw = 0;
    for (const item of items) {
      const pts = (item.weight * item.scores[id]) / 10;
      runtimeTotalRaw += pts;
    }

    for (const dim of dimensions) {
      let rawPts = 0;
      for (const item of items) {
        if (item.dimension === dim.id) {
          rawPts += (item.weight * item.scores[id]) / 10;
        }
      }
      dimStats[dim.id].pointsRaw = rawPts;
      dimStats[dim.id].points = round1(rawPts);
      dimStats[dim.id].pct = round1((rawPts / dim.weight) * 100);
    }

    byEngine[id] = {
      id,
      name: engine.name,
      dimensions: dimStats,
      runtimeTotalRaw,
      runtimeTotal: round1(runtimeTotalRaw),
      vsUnityPct: 0
    };
  }

  const unityBase = byEngine.unity?.runtimeTotalRaw || 100;
  for (const engine of engines) {
    const st = byEngine[engine.id];
    st.vsUnityPct = round1((st.runtimeTotalRaw / unityBase) * 100);
  }

  const ranked = engines
    .map((e) => byEngine[e.id])
    .sort((a, b) => b.runtimeTotalRaw - a.runtimeTotalRaw);

  return {
    version: data.version,
    date: data.date,
    byEngine,
    ranked
  };
}

function fmt1(num) {
  return Number(num).toFixed(1);
}

export function renderSections(data, computed = computeScores(data)) {
  const runtimeRows = [
    '| 引擎 | A 架构(18) | R 渲染(30) | P 性能(24) | S 子系统(20) | N 联机(8) | 能力总分 / 100 | 对 Unity 比值 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
  ];

  for (const row of computed.ranked) {
    const isHgame = row.id === 'hgame';
    const b = (text) => (isHgame ? `**${text}**` : text);
    const d = row.dimensions;
    runtimeRows.push(
      `| ${b(row.name)} | ${fmt1(d.A.pct)}% | ${fmt1(d.R.pct)}% | ${fmt1(d.P.pct)}% | ${fmt1(d.S.pct)}% | ${fmt1(d.N.pct)}% | ${b(fmt1(row.runtimeTotal))} | ${fmt1(row.vsUnityPct)}% |`
    );
  }

  const itemRows = [
    '| 编号 | 项（权重） | HGame | 成熟度（清单） | Unity | Cocos | Godot | HGame 短板 |',
    '| --- | --- | ---: | :---: | ---: | ---: | ---: | --- |'
  ];

  const exemptionRows = [
    '| 编号 | 项 | 豁免的能力 | 豁免理由 |',
    '| --- | --- | --- | --- |'
  ];

  for (const item of data.items) {
    const hScore = fmt1(item.scores.hgame);
    const counts = summarizeChecklist(item);
    const exemptTag = counts.exempt > 0 ? ` · 豁免 ${counts.exempt}` : '';
    const tag = item.hgame.defaultPath
      ? `${item.hgame.evidence} (${counts.met}/${counts.applicable}${exemptTag})`
      : `${item.hgame.evidence} (非默认·${counts.met}/${counts.applicable}${exemptTag})`;

    for (const entry of item.hgame.industrialChecklist || []) {
      if (isExemptEntry(entry)) {
        exemptionRows.push(`| ${item.id} | ${item.name} | ${entry.point} | ${entry.exemptReason} |`);
      }
    }

    itemRows.push(
      `| ${item.id} | ${item.name}（${item.weight}） | **${hScore}** | ${tag} | ${fmt1(item.scores.unity)} | ${fmt1(item.scores.cocos)} | ${fmt1(item.scores.godot)} | ${item.gap} |`
    );
  }

  if (exemptionRows.length === 2) {
    exemptionRows.push('| — | — | （无） | — |');
  }

  return {
    runtime: runtimeRows.join('\n'),
    items: itemRows.join('\n'),
    exemptions: exemptionRows.join('\n')
  };
}

export function applySections(markdown, sections) {
  let result = normalizeNewlines(markdown);
  for (const [key, [startMarker, endMarker]] of Object.entries(SECTION_MARKERS)) {
    const startIdx = result.indexOf(startMarker);
    const endIdx = result.indexOf(endMarker);
    if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
      throw new Error(`Missing or invalid scorecard markers for section "${key}".`);
    }
    const before = result.slice(0, startIdx + startMarker.length);
    const after = result.slice(endIdx);
    const body = normalizeNewlines(sections[key]).trim();
    result = `${before}\n${body}\n${after}`;
  }
  return result;
}

/**
 * Human-readable breakdown: per-dimension and per-item score, the reason (evidence level, checklist,
 * caps), points lost, and the concrete next step to raise the score.
 */
export function renderExplanation(data, computed = computeScores(data)) {
  const h = computed.byEngine.hgame;
  const lines = [];
  lines.push(`# HGame 评分明细（${data.version} · ${data.date}）`, '');
  lines.push(`总分 **${fmt1(h.runtimeTotal)} / 100**；对比 Unity ${fmt1(computed.byEngine.unity.runtimeTotal)}、Cocos ${fmt1(computed.byEngine.cocos.runtimeTotal)}、Godot ${fmt1(computed.byEngine.godot.runtimeTotal)}。`);
  lines.push('', '> 计分：条目得分点数 = 权重 × 条目分 / 10。HGame 条目分上限 = min(证据等级上限, 默认路径? 8 + 2×清单满足数/适用数 : 7)。竞品分为定性评估，见 `competitorBasis`。', '');
  lines.push('## 维度分', '', '| 维度 | 得分/权重 | 得分率 | Unity | Cocos | Godot |', '| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const dim of data.dimensions) {
    const cell = (id) => `${fmt1(computed.byEngine[id].dimensions[dim.id].pct)}%`;
    const d = h.dimensions[dim.id];
    lines.push(`| ${dim.id} ${dim.name ?? ''} | ${fmt1(d.points)}/${dim.weight} | ${fmt1(d.pct)}% | ${cell('unity')} | ${cell('cocos')} | ${cell('godot')} |`);
  }
  lines.push('', '## 逐项明细（按丢分从多到少）', '');
  const rows = data.items
    .map((item) => {
      const lost = (item.weight * (10 - item.scores.hgame)) / 10;
      return { item, lost };
    })
    .sort((a, b) => b.lost - a.lost);
  for (const { item, lost } of rows) {
    const hg = item.hgame;
    const { met, applicable, exempt } = summarizeChecklist(item);
    const cap = data.evidenceLevels[hg.evidence].cap;
    const maxAllowed = hg.defaultPath ? 8 + (2 * met) / applicable : 7;
    const bound = Math.min(cap, maxAllowed);
    const unmet = (hg.industrialChecklist || []).filter((e) => !e.exempt && !e.met);
    const vsUnity = item.scores.hgame - item.scores.unity;
    lines.push(`### ${item.id} ${item.name}（权重 ${item.weight}）— ${fmt1(item.scores.hgame)}/10，丢 ${lost.toFixed(2)} 分`);
    lines.push(`- **为什么是这个分**：证据 ${hg.evidence}（${data.evidenceLevels[hg.evidence].label}，上限 ${cap}）；清单 ${met}/${applicable} 满足${exempt ? `，豁免 ${exempt}` : ''}；默认路径 ${hg.defaultPath ? '是' : '否（上限 7）'}；理论上限 ${fmt1(bound)}。${hg.note}`);
    lines.push(`- **对比**：Unity ${fmt1(item.scores.unity)}（${vsUnity >= 0 ? '+' : ''}${fmt1(vsUnity)}）、Cocos ${fmt1(item.scores.cocos)}、Godot ${fmt1(item.scores.godot)}。`);
    lines.push(`- **证据**：${(hg.proofFiles || []).join('，')}${hg.benchmarkFiles?.length ? `；基准 ${hg.benchmarkFiles.join('，')}` : '；基准 无'}`);
    const todo = [];
    for (const e of unmet) todo.push(`补齐清单「${e.point}」（现状：${e.proof}）`);
    if (unmet.length === 0 && hg.evidence !== 'C4') {
      todo.push(`清单已全满足，升到 C4 需有独立实测基准或真机数据证明（上限 ${data.evidenceLevels.C4.cap}）`);
    }
    if (!hg.benchmarkFiles?.length && (hg.evidence === 'C3' || hg.evidence === 'C4')) todo.push('补一个自动化基准/浏览器实测文件');
    if (item.gap && !/已全部满足/.test(item.gap)) todo.push(`短板：${item.gap}`);
    lines.push(`- **如何改进**：${todo.length ? todo.join('；') : '已达当前上限，维持现状并保持基准通过。'}`);
    lines.push('');
  }
  return lines.join('\n');
}

function runCli() {
  const args = process.argv.slice(2);
  const wantJson = args.includes('--json');
  const wantWrite = args.includes('--write');
  const wantCheck = args.includes('--check');
  const wantMeasure = args.includes('--measure');
  if (args.includes('--explain')) {
    const explainData = loadScorecard(DEFAULT_SCORECARD_PATH);
    console.log(renderExplanation(explainData));
    return;
  }

  const data = loadScorecard(DEFAULT_SCORECARD_PATH);
  const errors = validateScorecard(data, { repoRoot: DEFAULT_REPO_ROOT });
  if (wantMeasure) {
    errors.push(...checkMeasurementDrift(data, measureRuntime(DEFAULT_REPO_ROOT)));
  }
  const warnings = collectWarnings(data, { repoRoot: DEFAULT_REPO_ROOT });
  if (!wantJson) {
    for (const w of warnings) console.warn(`[scorecard:warn] ${w}`);
  }
  const computed = computeScores(data);

  if (errors.length > 0) {
    if (wantJson) {
      console.log(JSON.stringify({ ok: false, errors, computed }, null, 2));
    } else {
      console.error('Scorecard validation failed:');
      for (const err of errors) {
        console.error(`  - ${err}`);
      }
    }
    process.exit(1);
  }

  const sections = renderSections(data, computed);

  if (wantWrite) {
    const currentDoc = fs.readFileSync(DEFAULT_DOC_PATH, 'utf8');
    const updatedDoc = applySections(currentDoc, sections);
    fs.writeFileSync(DEFAULT_DOC_PATH, updatedDoc, 'utf8');
    console.log(`Updated ${path.relative(DEFAULT_REPO_ROOT, DEFAULT_DOC_PATH)} (${data.version}).`);
  }

  if (wantCheck) {
    const currentDoc = normalizeNewlines(fs.readFileSync(DEFAULT_DOC_PATH, 'utf8'));
    const expectedDoc = applySections(currentDoc, sections);
    if (currentDoc !== expectedDoc) {
      console.error('Scorecard markdown drift detected! Run: node scripts/score-engines.mjs --write');
      process.exit(1);
    }
  }

  if (wantJson) {
    console.log(JSON.stringify({ ok: true, errors: [], computed }, null, 2));
    return;
  }

  console.log(`HGame Engine Scorecard (${data.version} · ${data.date})`);
  for (const row of computed.ranked) {
    console.log(
      `  ${row.name.padEnd(32)} Score=${fmt1(row.runtimeTotal)}/100 (vsUnity=${fmt1(row.vsUnityPct)}%)`
    );
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runCli();
}
