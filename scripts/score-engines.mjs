import fs from 'node:fs';
import path from 'node:path';
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
  items: ['<!-- scorecard:items:start -->', '<!-- scorecard:items:end -->']
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
          if (!isNonEmptyString(entry?.proof)) {
            errors.push(`Runtime item "${label}" industrialChecklist[${i}].proof must be non-empty.`);
          }
        }

        if (hg.evidence === 'C4' && metCount !== checklist.length) {
          errors.push(
            `Runtime item "${label}" capability level C4 requires all ${checklist.length} checklist items met, got ${metCount}.`
          );
        }
        if (hg.evidence === 'C3' && metCount < 1) {
          errors.push(
            `Runtime item "${label}" capability level C3 requires at least 1 checklist item met, got ${metCount}.`
          );
        }

        if (typeof hg.defaultPath === 'boolean' && typeof hScore === 'number') {
          const maxAllowed = hg.defaultPath ? 8 + (2 * metCount) / checklist.length : 7;
          if (hScore > maxAllowed + 1e-9) {
            errors.push(
              `Runtime item "${label}" HGame score ${hScore} exceeds industrialChecklist maxAllowed ${maxAllowed.toFixed(2)} (${metCount}/${checklist.length} met).`
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

  for (const item of data.items) {
    const hScore = fmt1(item.scores.hgame);
    const checklist = item.hgame.industrialChecklist || [];
    const metCount = checklist.filter((c) => c.met).length;
    const tag = item.hgame.defaultPath
      ? `${item.hgame.evidence} (${metCount}/${checklist.length})`
      : `${item.hgame.evidence} (非默认·${metCount}/${checklist.length})`;
    itemRows.push(
      `| ${item.id} | ${item.name}（${item.weight}） | **${hScore}** | ${tag} | ${fmt1(item.scores.unity)} | ${fmt1(item.scores.cocos)} | ${fmt1(item.scores.godot)} | ${item.gap} |`
    );
  }

  return {
    runtime: runtimeRows.join('\n'),
    items: itemRows.join('\n')
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

function runCli() {
  const args = process.argv.slice(2);
  const wantJson = args.includes('--json');
  const wantWrite = args.includes('--write');
  const wantCheck = args.includes('--check');

  const data = loadScorecard(DEFAULT_SCORECARD_PATH);
  const errors = validateScorecard(data, { repoRoot: DEFAULT_REPO_ROOT });
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
