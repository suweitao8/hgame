import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const moduleUrl = new URL('../scripts/check-visual-regression.mjs', import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const reference = () => ({ schemaVersion: 1, revision: '865f9467505671a42a4735117bdb544a2bb226c2', viewport: '960x540',
  scenarios: [{ id: 'survivor-2d', steps: 120, keys: 'd:300', query: 'seed=1', threshold: 0.01 }] });

test('visual reference requires an explicit accepted revision and valid deterministic scenarios', async () => {
  const { validateVisualReference } = await import(moduleUrl);
  assert.deepEqual(validateVisualReference(reference()), reference());
  for (const revision of ['', 'HEAD', '--help']) {
    assert.throws(() => validateVisualReference({ ...reference(), revision }), /revision/i);
  }
  for (const viewport of ['0x540', '960xNaN', '960x-1']) {
    assert.throws(() => validateVisualReference({ ...reference(), viewport }), /viewport/i);
  }
  for (const patch of [{ id: '../outside' }, { steps: -1 }, { steps: 1.5 }, { steps: NaN }, { threshold: -1 }, { threshold: 2 }, { threshold: NaN }]) {
    const cfg = reference();
    Object.assign(cfg.scenarios[0], patch);
    assert.throws(() => validateVisualReference(cfg));
  }
  assert.throws(() => validateVisualReference({ ...reference(), scenarios: [] }), /scenario/i);
  const duplicate = reference();
  duplicate.scenarios.push({ ...duplicate.scenarios[0] });
  assert.throws(() => validateVisualReference(duplicate), /duplicate/i);
});

test('visual reference resolves commits and rejects missing or CLI-shaped revisions', async () => {
  const { resolveReferenceRevision } = await import(moduleUrl);
  const cfg = reference();
  assert.equal(resolveReferenceRevision(root, cfg.revision), cfg.revision);
  assert.throws(() => resolveReferenceRevision(root, '--help'), /revision/i);
  assert.throws(() => resolveReferenceRevision(root, 'missing-visual-reference-927184'), /reference|revision/i);
});
