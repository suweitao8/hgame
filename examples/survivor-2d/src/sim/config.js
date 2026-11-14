// Pure data: tuning for the survivor simulation. No engine or DOM imports.
export const CONFIG = Object.freeze({
  tickHz: 60,
  hashCell: 48,
  player: { speed: 230, radius: 14, hp: 100, magnet: 80, regen: 0.8 },
  enemyKinds: [
    { name: 'grunt',  hp: 2,  speed: 62,  radius: 8,  dps: 5,  xp: 1, color: '#e0566b', size: 18 },
    { name: 'runner', hp: 1,  speed: 108, radius: 6,  dps: 4,  xp: 1, color: '#f2b84b', size: 13 },
    { name: 'brute',  hp: 14, speed: 44,  radius: 14, dps: 14, xp: 6, color: '#9a6bff', size: 30 },
  ],
  maxEnemies: 6000,
  maxBullets: 768,
  maxGems: 2048,
  spawn: { ringMin: 540, ringMax: 680, base: 60, perSecond: 55, perTick: 24, runnerAfter: 12, bruteAfter: 25 },
  bolt: { cooldown: 0.45, speed: 540, damage: 2, pierce: 2, life: 1.3, radius: 5, count: 1, range: 640 },
  nova: { cooldown: 1.7, radius: 90, damage: 3, knock: 26 },
  xp: { base: 5, mult: 1.3 },
  upgrades: ['damage', 'rate', 'multishot', 'pierce', 'speed', 'magnet', 'nova', 'heal'],
});
