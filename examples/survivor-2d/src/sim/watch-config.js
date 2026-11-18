import { CONFIG } from './config.js';

export const WATCH_CONFIG = Object.freeze({
  ...CONFIG,
  maxEnemies: 320,
  spawn: { ...CONFIG.spawn, base: 16, perSecond: 4, ringMin: 250, ringMax: 390, runnerAfter: 8, bruteAfter: 19 },
  extraction: Object.freeze({
    unlockSeconds: 24, holdSeconds: 5, radius: 98, relayRadius: 60,
    relays: Object.freeze([{ x: -460, y: -100 }, { x: 460, y: 100 }]),
  }),
});

export const STORM_CONFIG = Object.freeze({
  ...WATCH_CONFIG,
  spawn: { ...WATCH_CONFIG.spawn, base: 28, perSecond: 7, bruteAfter: 10 },
  extraction: Object.freeze({
    ...WATCH_CONFIG.extraction, requiredRelays: 2, unlockSeconds: 0, holdSeconds: 7, radius: 72, deadlineSeconds: 17,
  }),
});
