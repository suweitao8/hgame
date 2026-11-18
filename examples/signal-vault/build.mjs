import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('./', import.meta.url));
const target = process.argv[2] && path.resolve(process.argv[2]);
if (!target || path.basename(target) !== 'signal-vault') throw new Error('Pass the generated signal-vault directory');
const game = JSON.parse(await readFile(path.join(target, 'game.config.json'), 'utf8'));
const profile = JSON.parse(await readFile(path.join(target, 'hgame.project.json'), 'utf8'));
if (game.id !== 'signal-vault' || profile.preset !== 'pixi2d') throw new Error('Expected the generated Signal Vault Pixi project');
const engine = JSON.parse(await readFile(path.join(target, 'engine.config.json'), 'utf8'));
if (engine.tickHz !== 0) throw new Error('Generate Signal Vault with --tick-hz 0');
for (const file of ['index.source.html', 'vault.css', 'src']) {
  await cp(path.join(source, file), path.join(target, file), { recursive: true, force: true });
}
const hostVendor = path.join(target, 'assets', 'vendor', 'hgame');
await mkdir(hostVendor, { recursive: true });
await cp(path.join(target, 'vendor', 'hgame'), hostVendor, { recursive: true, force: true });
const result = spawnSync(process.execPath, ['scripts/install-pixi-build.mjs', '--build'], { cwd: target, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
