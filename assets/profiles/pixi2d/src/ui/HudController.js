export class HudController {
  constructor({ director = null, uiUx = null, translate = label => label } = {}) {
    this.director = director;
    this.uiUx = uiUx;
    this.kills = document.querySelector('#kills');
    this.debug = document.querySelector('#debug');
    this.stats = document.querySelector('#stats');
    this.translate = translate;
    this.resume = document.querySelector('#resume');
    this.resume.textContent = translate('继续');
    this.hint = document.querySelector('[data-ui-hint]');
    this.hintDevice = null;
    this.burstButtons = document.querySelectorAll('[data-count]');
    this.addEnemies = document.querySelector('#add-enemies');
    this.addEnemies.textContent = translate('敌人') + '+10000';
    for (const button of this.burstButtons) button.textContent = translate('爆炸') + button.dataset.count;
    if (this.debug && new URLSearchParams(location.search).get('debug') === '1') {
      this.debug.hidden = false;
    }
  }
  toggleDebug() {
    if (this.debug) this.debug.hidden = !this.debug.hidden;
  }
  notifyMoved() {
    this.director?.notifyMoved();
  }
  setInputHint(controls) {
    if (this.hintDevice === controls.device) return;
    this.hintDevice = controls.device;
    const movement = controls.device === 'keyboard' ? 'WASD' : '◉';
    this.hint.textContent = [movement, ...controls.touchPlayer.bindings.map(({ name }) => controls.getGlyph(name))].filter(Boolean).join(' · ');
  }
  step(dt) {
    this.uiUx?.step(dt);
  }
  update(arena, juice, fps) {
    if (this.director) {
      this.director.setBar('hp', Math.max(0, arena.player.health) / 100);
      this.director.setMetric('kills', arena.kills);
    } else if (this.kills) {
      this.kills.textContent = String(arena.kills);
    }
    if (!this.debug || !this.debug.hidden) {
      const t = this.translate;
      this.stats.textContent = `${Math.round(fps)} FPS · ${t('敌人')} ${arena.enemies.length} · ${t('特效')} ${juice.effects.length} · ${t('粒子')} ${juice.visibleParticles}`;
    }
  }
  dispose() {
    this.uiUx?.dispose();
    this.director?.dispose();
  }
}
