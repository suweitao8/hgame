const VICTORY = Object.freeze({
  preset: 'powerup',
  steps: Object.freeze([523.25, 659.25, 783.99, 1046.5]),
  duration: 0.55,
  noiseMix: 0,
});
const PULSE_WARNING = Object.freeze({
  preset: 'laser', freqStart: 410, freqEnd: 790, duration: 0.32, noiseMix: 0.03,
});

export function arenaCue({ type, details }, totalBeacons) {
  switch (type) {
    case 'player.spin': return details.hits > 0 ? 'hit' : 'slash';
    case 'player.damaged': return 'hurt';
    case 'beacon.charged': return details.chargedCount < totalBeacons ? 'pickup' : null;
    case 'exit.opened': return 'powerup';
    case 'pulse.warned': return PULSE_WARNING;
    case 'pulse.resolved': return details.hit ? null : 'explosion';
    case 'run.finished': return details.outcome === 'victory' ? VICTORY : null;
    default: return null;
  }
}
