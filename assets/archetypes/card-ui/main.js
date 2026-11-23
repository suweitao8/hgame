// Universal Command-Driven Card/Tactical Archetype (tickHz: 0) wired to HGame's 5-Pillar Kit.
const hosted = location.pathname.startsWith('/local-games/');
const base = hosted ? '/runtime/hgame' : '../vendor/hgame';
const [
  gameConfig, engineConfig, designBlueprint,
  { createGameApplication }, { defineProject }, { Scene },
  { createDOMAdapter },
  { defineGameBlueprint, getArtTheme, createGameSession, mountGameShell },
] = await Promise.all([
  fetch('./game.config.json').then(r => r.json()),
  fetch('./engine.config.json').then(r => r.json()),
  fetch('./src/game.design.json').then(r => r.json()),
  import(base + '/core/application.js'),
  import(base + '/core/config.js'),
  import(base + '/core/scene.js'),
  import(base + '/integrations/dom.js'),
  import(base + '/kit/index.js'),
]);

const blueprint = defineGameBlueprint(designBlueprint);
const theme = getArtTheme(blueprint.art.theme);
const project = defineProject(engineConfig);

const boardEl = document.querySelector('#game');
const handEl = document.querySelector('#hand');
const foeHpEl = document.querySelector('#foe-hp');
boardEl.setAttribute('data-ui-theme', theme.uiTheme);

let shell = null;
const app = createGameApplication({
  project,
  gameId: gameConfig.id,
  gameVersion: gameConfig.version,
  renderer: createDOMAdapter({ render: () => shell?.sync() }),
});
await app.installFeatures();

const combat = {
  foeMaxHp: blueprint.design.balance.gruntHp,
  foeHp: blueprint.design.balance.gruntHp,
  atkBonus: 0,
  guard: 0,
  cards: [
    { id: 'strike', glyph: '⚔️', label: '斩击', stat: '+8 伤' },
    { id: 'shield', glyph: '🛡️', label: '格挡', stat: '+6 盾' },
    { id: 'spark', glyph: '✦', label: '秘术', stat: '+12 伤' },
  ],
};

const session = createGameSession({
  blueprint,
  app,
  onStartRun() {
    combat.atkBonus = 0;
    combat.guard = 0;
    combat.foeMaxHp = blueprint.design.balance.gruntHp;
    combat.foeHp = combat.foeMaxHp;
    renderBoard();
  },
  onPhaseChange() {
    renderBoard();
  },
  onChoice(picked) {
    if (picked.id === 'atk-up') combat.atkBonus += 4;
    else if (picked.id === 'hp-up') session.healPlayer(10);
    else combat.guard += 4;
    renderBoard();
  },
});

function renderBoard() {
  const playing = session.state.phase === 'playing';
  boardEl.hidden = !playing;
  foeHpEl.textContent = `♥ ${Math.max(0, combat.foeHp)}`;
  handEl.innerHTML = '';
  if (!playing) return;
  for (const card of combat.cards) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'card';
    btn.setAttribute('data-ui-tilt', '10');
    btn.innerHTML = `<span class="glyph" aria-hidden="true">${card.glyph}</span><span class="name">${card.label}</span><span class="pos">${card.stat}</span>`;
    btn.addEventListener('click', () => app.dispatch({ type: 'playCard', cardId: card.id }));
    handEl.appendChild(btn);
  }
}

const scene = app.scenes.add(new Scene('cards'));
scene.onCommand = (cmd) => {
  if (cmd.type !== 'playCard' || session.state.phase !== 'playing') return;
  if (cmd.cardId === 'strike') {
    const dmg = 8 + combat.atkBonus;
    combat.foeHp -= dmg;
    session.recordHit({ score: dmg });
  } else if (cmd.cardId === 'spark') {
    const dmg = 12 + combat.atkBonus;
    combat.foeHp -= dmg;
    session.recordHit({ crit: true, score: dmg });
  } else if (cmd.cardId === 'shield') {
    combat.guard += 6;
    session.audio.play('interact');
  }

  if (combat.foeHp <= 0) {
    const k = session.recordKill({ score: 30, xp: 5, currency: 3 });
    const nextWave = session.state.wave + 1;
    session.setWave(nextWave);
    combat.foeMaxHp = blueprint.design.balance.gruntHp + nextWave * 4;
    combat.foeHp = combat.foeMaxHp;
    if (k.leveledUp) session.presentChoices();
  } else {
    const incoming = Math.max(0, blueprint.design.balance.gruntDamage - combat.guard);
    combat.guard = Math.max(0, combat.guard - blueprint.design.balance.gruntDamage);
    if (incoming > 0) session.damagePlayer(incoming);
  }
  renderBoard();
};

shell = mountGameShell({ root: document.body, session });
renderBoard();
app.scenes.start('cards');
app.start(); // tickHz is 0: command-driven, zero idle RAF.
document.body.dataset.engineReady = 'true';
window.__hgameState = () => ({ ...session.snapshot(), foeHp: combat.foeHp, guard: combat.guard });

window.addEventListener('pagehide', function onPageHide(event) {
  if (event.persisted) return;
  window.removeEventListener('pagehide', onPageHide);
  shell.dispose();
  session.dispose();
  app.dispose();
});
