// Command line of scripts/snapshot.mjs, kept apart so its rules can be tested without a browser.
import path from 'node:path';
import { numberOption, viewportOption } from './cli-numbers.mjs';

// Options that take no value, so a bare word after one of them is the game dir.
const BOOLEAN_FLAGS = new Set(['--update-baseline', '--freeze-time', '--check-ui', '--check-layout', '--allow-blank']);

/**
 * Reads the snapshot command line. Throws for anything unusable, with a one-line message.
 * @param {string[]} argv The arguments after `node scripts/snapshot.mjs`.
 * @returns {{
 *   gameDir: string, outPath: string, selector: string, ready: string, visualReady: string,
 *   baseline: string, entryPath: string, query: string, evalExpr: string, stateHook: string,
 *   chrome: string, freeze: boolean, checkUi: boolean, checkLayout: boolean, allowBlank: boolean,
 *   updateBaseline: boolean, waitMs: number, threshold: number, requestedSteps: number | undefined,
 *   viewport: { width: number, height: number }, maxHudRatio: number, maxHudButtons: number,
 *   keys: Array<{ key: string, ms: number }>,
 * }}
 */
export function parseSnapshotArgs(argv) {
  const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
  const flag = name => argv.includes(name);
  // The game dir is the first bare argument that is not the value of an option.
  const gameDir = argv.find((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && !BOOLEAN_FLAGS.has(argv[i - 1])));
  if (!gameDir) throw new Error('Usage: node scripts/snapshot.mjs <game-dir> [options] (see file header)');

  const entry = opt('--entry', '/');
  const url = new URL(entry, 'http://127.0.0.1');
  if (!entry || url.origin !== 'http://127.0.0.1' || url.search || url.hash) {
    throw new Error('--entry must be a path inside the fixture');
  }
  return {
    gameDir,
    outPath: opt('--out', path.join(gameDir, 'build', 'snapshot.png')),
    selector: opt('--selector', '#game'),
    ready: opt('--ready', ''),
    visualReady: opt('--visual-ready', ''),
    baseline: opt('--baseline', ''),
    entryPath: url.pathname,
    query: opt('--query', ''),
    evalExpr: opt('--eval', ''),
    stateHook: opt('--state-hook', '__hgameState'),
    chrome: opt('--chrome', ''),
    freeze: flag('--freeze-time') || argv.includes('--steps'),
    checkUi: flag('--check-ui'),
    checkLayout: flag('--check-layout'),
    allowBlank: flag('--allow-blank'),
    updateBaseline: flag('--update-baseline'),
    waitMs: numberOption(opt('--wait', 800), '--wait'),
    threshold: numberOption(opt('--threshold', 0.01), '--threshold', { max: 1 }),
    viewport: viewportOption(opt('--viewport', '960x540')),
    maxHudRatio: numberOption(opt('--max-hud-ratio', 0.10), '--max-hud-ratio', { max: 1 }),
    maxHudButtons: numberOption(opt('--max-hud-buttons', 1), '--max-hud-buttons', { integer: true }),
    requestedSteps: argv.includes('--steps') ? numberOption(opt('--steps', ''), '--steps', { integer: true }) : undefined,
    keys: opt('--keys', '').split(',').filter(Boolean).map(token => {
      const [key, ms] = token.split(':');
      return { key: key === 'space' ? ' ' : key, ms: numberOption(ms || 150, '--keys duration') };
    }),
  };
}
