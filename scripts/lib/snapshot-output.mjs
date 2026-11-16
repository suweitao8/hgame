import { existsSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

function atomicWrite(destination, bytes) {
  mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, bytes, { flag: 'wx' });
    renameSync(temporary, destination);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function destinationKey(destination) {
  const parent = path.dirname(destination);
  const canonical = path.join(existsSync(parent) ? realpathSync(parent) : parent, path.basename(destination));
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

/** Write diagnostic output and replace an explicitly accepted baseline only for a valid capture. */
export function writeSnapshotOutput({ png, outputPath, baselinePath = '', updateBaseline = false, valid }) {
  const output = path.resolve(outputPath);
  const baseline = baselinePath ? path.resolve(baselinePath) : '';
  const sharedPath = Boolean(baseline) && destinationKey(output) === destinationKey(baseline);
  if (sharedPath && !updateBaseline) {
    throw new Error('Snapshot output equals its reference baseline. Use a separate output path or explicitly update the baseline.');
  }
  if (!sharedPath) atomicWrite(output, png);
  if (baseline && updateBaseline && valid) {
    atomicWrite(baseline, png);
    return { baselineUpdated: baselinePath };
  }
  return {};
}
