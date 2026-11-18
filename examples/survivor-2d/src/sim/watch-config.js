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
