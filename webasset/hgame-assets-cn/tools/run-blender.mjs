import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SPEC_PATH = path.join(ROOT, 'manifests', 'asset_spec.json');

export function resolveBlenderBin() {
  if (process.env.BLENDER_BIN && fs.existsSync(process.env.BLENDER_BIN)) {
    return process.env.BLENDER_BIN;
  }
  const commonPaths = [
    'D:\\Apps\\Blender\\blender.exe',
    'D:\\Program Files\\Blender Foundation',
    'C:\\Program Files\\Blender Foundation',
  ];
  for (const candidate of commonPaths) {
    if (!fs.existsSync(candidate)) continue;
    if (candidate.toLowerCase().endsWith('.exe')) {
      return candidate;
    }
    const dirs = fs.readdirSync(candidate)
      .filter((d) => /^Blender\s+\d+/i.test(d))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const d of dirs) {
      const exe = path.join(candidate, d, 'blender.exe');
      if (fs.existsSync(exe)) return exe;
    }
  }
  return 'blender';
}

export function verifyBlenderMinVersion(bin, minVersion = '5.0') {
  const probe = spawnSync(bin, ['--version'], { encoding: 'utf8' });
  if (probe.error) {
    throw new Error(`Failed to execute Blender (${bin}): ${probe.error.message}`);
  }
  const out = `${probe.stdout || ''}\n${probe.stderr || ''}`;
  const m = /Blender\s+(\d+)\.(\d+)/i.exec(out);
  if (!m) {
    throw new Error(`Unable to parse Blender version from "${bin}": ${out.trim()}`);
  }
  const [reqMaj, reqMin] = minVersion.split('.').map(Number);
  const maj = Number(m[1]);
  const min = Number(m[2]);
  if (maj < reqMaj || (maj === reqMaj && min < (reqMin || 0))) {
    throw new Error(`Blender >= ${minVersion} required, found ${maj}.${min} at ${bin}`);
  }
  return `${maj}.${min}`;
}

export function runBlender(scriptPath, extraArgs = []) {
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));
  const bin = resolveBlenderBin();
  const ver = verifyBlenderMinVersion(bin, spec.blenderMinVersion || '5.0');
  const absScript = path.isAbsolute(scriptPath) ? scriptPath : path.resolve(ROOT, scriptPath);
  console.log(`[run-blender] Blender ${ver} (${bin}) -> ${path.relative(ROOT, absScript)}`);
  const res = spawnSync(
    bin,
    ['--background', '--factory-startup', '--python', absScript, '--', ...extraArgs],
    { stdio: 'inherit', cwd: ROOT },
  );
  if (res.status !== 0) {
    throw new Error(`Blender exited with status ${res.status ?? 1}`);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [scriptPath, ...extraArgs] = process.argv.slice(2);
  if (!scriptPath) {
    console.error('Usage: node tools/run-blender.mjs <script.py> [args...]');
    process.exit(1);
  }
  try {
    runBlender(scriptPath, extraArgs);
  } catch (err) {
    console.error(`[run-blender] ERROR: ${err.message}`);
    process.exit(1);
  }
}
