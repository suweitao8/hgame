// Universal Game Design Blueprint (策划蓝图) schema, archetype defaults & golden-ratio balance validator.
import { getArtTheme, listArtThemes } from './art-themes.js';

/** Canonical genre archetypes supported out of the box by HGame templates. */
export const GENRE_ARCHETYPES = Object.freeze({
  'action-2d': Object.freeze({
    id: 'action-2d',
    perspective: '2d',
    preset: '2d',
    renderer: 'webgl2d',
    tickHz: 60,
    defaultTheme: 'scifi',
    audioProfile: 'action',
    feel: Object.freeze({ playerSpeed: 6.5, playerRadius: 0.45, dashSpeed: 16, dashCooldownSec: 1.4, hitStopMs: 36, traumaMax: 0.55 }),
    balance: Object.freeze({ playerHp: 100, gruntHp: 30, gruntDamage: 12, weaponDps: 28, arenaSpan: 48, waveDurationSec: 60, maxUpgrades: 5 }),
    ui: Object.freeze({ hudMetrics: ['hp', 'score', 'wave'], hudBars: ['hp', 'xp'], maxTitleButtons: 1, maxInGameButtons: 1, maxResultButtons: 2, cardChoices: 3, hudMaxAreaRatio: 0.1 }),
  }),
  'horde-2d': Object.freeze({
    id: 'horde-2d',
    perspective: '2d',
    preset: 'horde',
    renderer: 'webgl2d',
    tickHz: 60,
    defaultTheme: 'cyber',
    audioProfile: 'arcade',
    feel: Object.freeze({ playerSpeed: 7.2, playerRadius: 0.45, dashSpeed: 18, dashCooldownSec: 1.2, hitStopMs: 24, traumaMax: 0.5 }),
    balance: Object.freeze({ playerHp: 120, gruntHp: 20, gruntDamage: 10, weaponDps: 36, arenaSpan: 64, waveDurationSec: 60, maxUpgrades: 5 }),
    ui: Object.freeze({ hudMetrics: ['hp', 'kills', 'level', 'timer'], hudBars: ['hp', 'xp'], maxTitleButtons: 1, maxInGameButtons: 1, maxResultButtons: 2, cardChoices: 3, hudMaxAreaRatio: 0.1 }),
  }),
  'arena-3d': Object.freeze({
    id: 'arena-3d',
    perspective: '3d',
    preset: '3d',
    renderer: 'threejs',
    tickHz: 60,
    defaultTheme: 'arcane',
    audioProfile: 'action',
    feel: Object.freeze({ playerSpeed: 7.0, playerRadius: 0.5, dashSpeed: 16, dashCooldownSec: 1.5, hitStopMs: 42, traumaMax: 0.6 }),
    balance: Object.freeze({ playerHp: 100, gruntHp: 40, gruntDamage: 15, weaponDps: 32, arenaSpan: 52, waveDurationSec: 60, maxUpgrades: 5 }),
    ui: Object.freeze({ hudMetrics: ['hp', 'score', 'wave'], hudBars: ['hp', 'xp'], maxTitleButtons: 1, maxInGameButtons: 1, maxResultButtons: 2, cardChoices: 3, hudMaxAreaRatio: 0.1 }),
  }),
  'card-ui': Object.freeze({
    id: 'card-ui',
    perspective: 'ui',
    preset: 'ui',
    renderer: 'dom',
    tickHz: 0,
    defaultTheme: 'arcane',
    audioProfile: 'tactical',
    feel: Object.freeze({ playerSpeed: 0, playerRadius: 0.5, dashSpeed: 0, dashCooldownSec: 0, hitStopMs: 0, traumaMax: 0.2 }),
    balance: Object.freeze({ playerHp: 40, gruntHp: 18, gruntDamage: 5, weaponDps: 10, arenaSpan: 0, waveDurationSec: 120, maxUpgrades: 5 }),
    ui: Object.freeze({ hudMetrics: ['hp', 'currency', 'wave'], hudBars: ['hp'], maxTitleButtons: 1, maxInGameButtons: 1, maxResultButtons: 2, cardChoices: 3, hudMaxAreaRatio: 0.1 }),
  }),
});

/**
 * List available genre archetype IDs.
 * @returns {string[]}
 */
export function listGenreArchetypes() {
  return Object.keys(GENRE_ARCHETYPES);
}

function finiteOr(val, fallback) {
  return Number.isFinite(val) ? val : fallback;
}

function mergeShallow(base, patch) {
  return patch && typeof patch === 'object' ? { ...base, ...patch } : { ...base };
}

/**
 * Normalize and validate a 5-pillar Game Design Blueprint (`game.design.json`).
 * @param {object} [input]
 */
export function defineGameBlueprint(input = {}) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('Blueprint input must be an object');
  }
  const metaIn = input.meta ?? input;
  const genre = String(metaIn.genre ?? input.genre ?? 'action-2d');
  if (!Object.prototype.hasOwnProperty.call(GENRE_ARCHETYPES, genre)) {
    throw new Error(`Unknown genre archetype "${genre}". Use: ${listGenreArchetypes().join(', ')}`);
  }
  const archetype = GENRE_ARCHETYPES[genre];
  const themeId = String(input.art?.theme ?? input.ui?.theme ?? input.theme ?? archetype.defaultTheme);
  const artTheme = getArtTheme(themeId);

  const id = String(metaIn.id ?? input.id ?? 'new-game').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id)) {
    throw new Error(`Blueprint meta.id must be an ASCII slug: "${id}"`);
  }
  const title = String(metaIn.title ?? metaIn.name ?? input.title ?? input.name ?? id).trim();
  if (!title || title.length > 80) {
    throw new Error('Blueprint meta.title must contain 1-80 characters');
  }

  const designIn = input.design ?? {};
  const feel = {
    playerSpeed: finiteOr(designIn.feel?.playerSpeed, archetype.feel.playerSpeed),
    playerRadius: finiteOr(designIn.feel?.playerRadius, archetype.feel.playerRadius),
    dashSpeed: finiteOr(designIn.feel?.dashSpeed, archetype.feel.dashSpeed),
    dashCooldownSec: finiteOr(designIn.feel?.dashCooldownSec, archetype.feel.dashCooldownSec),
    hitStopMs: finiteOr(designIn.feel?.hitStopMs, artTheme.camera.hitStopMs),
    traumaMax: finiteOr(designIn.feel?.traumaMax, artTheme.camera.traumaMax),
  };
  const balance = {
    playerHp: finiteOr(designIn.balance?.playerHp, archetype.balance.playerHp),
    gruntHp: finiteOr(designIn.balance?.gruntHp, archetype.balance.gruntHp),
    gruntDamage: finiteOr(designIn.balance?.gruntDamage, archetype.balance.gruntDamage),
    weaponDps: finiteOr(designIn.balance?.weaponDps, archetype.balance.weaponDps),
    arenaSpan: finiteOr(designIn.balance?.arenaSpan, archetype.balance.arenaSpan),
    waveDurationSec: finiteOr(designIn.balance?.waveDurationSec, archetype.balance.waveDurationSec),
    maxUpgrades: finiteOr(designIn.balance?.maxUpgrades, archetype.balance.maxUpgrades),
  };

  const progression = {
    waves: Array.isArray(designIn.progression?.waves) && designIn.progression.waves.length > 0
      ? designIn.progression.waves.map(w => ({ ...w }))
      : [{ id: 'wave-1', durationSec: balance.waveDurationSec, spawnRate: 1.5, enemyTypes: ['grunt', 'runner'] }],
    upgrades: Array.isArray(designIn.progression?.upgrades) && designIn.progression.upgrades.length > 0
      ? designIn.progression.upgrades.map(u => ({ ...u }))
      : [
          { id: 'atk-up', label: '⚔️ 锐刃', pos: '+25% 伤害', neg: '-5% 移速' },
          { id: 'spd-up', label: '⚡ 迅捷', pos: '+20% 攻速', neg: '-10% 护甲' },
          { id: 'hp-up', label: '♥ 生机', pos: '+30 生命', neg: '-5% 暴击' },
        ],
    economy: mergeShallow({ currency: 'gold', startingAmount: 0 }, designIn.progression?.economy),
  };

  const uiIn = input.ui ?? {};
  const ui = {
    theme: artTheme.uiTheme,
    hudMetrics: Array.isArray(uiIn.hudMetrics) ? [...uiIn.hudMetrics] : [...archetype.ui.hudMetrics],
    hudBars: Array.isArray(uiIn.hudBars) ? [...uiIn.hudBars] : [...archetype.ui.hudBars],
    maxTitleButtons: finiteOr(uiIn.maxTitleButtons, archetype.ui.maxTitleButtons),
    maxInGameButtons: finiteOr(uiIn.maxInGameButtons, archetype.ui.maxInGameButtons),
    maxResultButtons: finiteOr(uiIn.maxResultButtons, archetype.ui.maxResultButtons),
    cardChoices: finiteOr(uiIn.cardChoices, archetype.ui.cardChoices),
    hudMaxAreaRatio: finiteOr(uiIn.hudMaxAreaRatio, archetype.ui.hudMaxAreaRatio),
  };

  const art = {
    theme: artTheme.id,
    palette: mergeShallow(artTheme.palette, input.art?.palette),
    vfxStyle: String(input.art?.vfxStyle ?? artTheme.id),
    damagePreset: String(input.art?.damagePreset ?? artTheme.vfx.damagePreset),
  };

  const audio = {
    mood: String(input.audio?.mood ?? artTheme.audioMood),
    profile: String(input.audio?.profile ?? archetype.audioProfile),
    overrides: mergeShallow({}, input.audio?.overrides),
  };

  return {
    schemaVersion: 1,
    meta: {
      id,
      title,
      genre,
      perspective: archetype.perspective,
      preset: archetype.preset,
      renderer: String(metaIn.renderer ?? archetype.renderer),
      tickHz: finiteOr(metaIn.tickHz, archetype.tickHz),
      coreLoop: String(metaIn.coreLoop ?? input.coreLoop ?? 'move-fight-upgrade-survive'),
      sessionTargetSec: finiteOr(metaIn.sessionTargetSec, 180),
    },
    design: { feel, balance, progression },
    ui,
    art,
    audio,
  };
}

/**
 * Evaluate golden dimensionless ratios, Anti-Bloat UI budgets, and optional 1-1-2-1 slice limits.
 * @param {ReturnType<typeof defineGameBlueprint>} blueprint
 * @param {{ strictSlice?: boolean }} [options]
 */
export function evaluateBlueprintBalance(blueprint, options = {}) {
  const bp = blueprint?.schemaVersion === 1 ? blueprint : defineGameBlueprint(blueprint);
  const errors = [];
  const warnings = [];
  const checks = [];

  const { feel, balance, progression } = bp.design;
  const ui = bp.ui;
  const isSpatial = bp.meta.perspective !== 'ui';

  function record(id, ok, value, range, severity = 'error', note = '') {
    checks.push({ id, ok, value: Number.isFinite(value) ? Number(value.toFixed(3)) : value, range, severity, note });
    if (!ok) {
      const msg = `${id}=${value} outside ${range}${note ? ` (${note})` : ''}`;
      if (severity === 'warning') warnings.push(msg);
      else errors.push(msg);
    }
  }

  if (isSpatial) {
    const diameter = feel.playerRadius * 2;
    const speedRatio = diameter > 0 ? feel.playerSpeed / diameter : Infinity;
    record('speedToBodyRatio', speedRatio >= 2.5 && speedRatio <= 15, speedRatio, '[2.5, 15]');

    const spanSeconds = feel.playerSpeed > 0 ? balance.arenaSpan / feel.playerSpeed : Infinity;
    record('arenaSpanSeconds', spanSeconds >= 6 && spanSeconds <= 40, spanSeconds, '[6, 40]');
  }

  const ttk = balance.weaponDps > 0 ? balance.gruntHp / balance.weaponDps : Infinity;
  record('gruntTtkSeconds', ttk >= 0.1 && ttk <= 5.0, ttk, '[0.1, 5.0]');

  const hitsToDie = balance.gruntDamage > 0 ? balance.playerHp / balance.gruntDamage : Infinity;
  record('playerHitsToDie', hitsToDie >= 3 && hitsToDie <= 25, hitsToDie, '[3, 25]');

  // UI Anti-Bloat compliance checks
  record('uiMaxTitleButtons', ui.maxTitleButtons <= 1, ui.maxTitleButtons, '<= 1');
  record('uiMaxInGameButtons', ui.maxInGameButtons <= 1, ui.maxInGameButtons, '<= 1');
  record('uiMaxResultButtons', ui.maxResultButtons <= 2, ui.maxResultButtons, '<= 2');
  record('uiHudMaxAreaRatio', ui.hudMaxAreaRatio <= 0.1, ui.hudMaxAreaRatio, '<= 0.10');
  record('uiCardChoices', ui.cardChoices <= 4, ui.cardChoices, '<= 4');
  record('uiHudMetricsCount', ui.hudMetrics.length <= 5, ui.hudMetrics.length, '<= 5');

  if (options.strictSlice) {
    record('sliceUpgradesLimit', progression.upgrades.length <= 5, progression.upgrades.length, '<= 5');
    record('sliceMaxUpgradesLimit', balance.maxUpgrades <= 5, balance.maxUpgrades, '<= 5');
  }

  if (progression.upgrades.length > balance.maxUpgrades) {
    warnings.push(`upgrades (${progression.upgrades.length}) exceeds balance.maxUpgrades (${balance.maxUpgrades})`);
  }

  const passed = checks.filter(c => c.ok).length;
  const score = checks.length > 0 ? Math.round((passed / checks.length) * 100) : 100;
  return {
    ok: errors.length === 0,
    score,
    checks,
    warnings,
    errors,
  };
}

/**
 * Turn a concise game idea into a validated 5-pillar GameBlueprint ready for scaffolding.
 * @param {{ id: string, title?: string, genre?: string, theme?: string, coreLoop?: string, design?: object, ui?: object, art?: object, audio?: object }} idea
 */
export function createBlueprintFromIdea(idea) {
  if (!idea || typeof idea !== 'object') {
    throw new TypeError('Idea payload must be an object');
  }
  const bp = defineGameBlueprint(idea);
  const evalResult = evaluateBlueprintBalance(bp);
  if (!evalResult.ok) {
    throw new Error(`Blueprint balance validation failed: ${evalResult.errors.join('; ')}`);
  }
  return bp;
}

export { listArtThemes };
