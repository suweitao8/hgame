export class HudController {
  constructor() {
    this.health = document.querySelector('#health');
    this.kills = document.querySelector('#kills');
    this.debug = document.querySelector('#debug');
    this.stats = document.querySelector('#stats');
    this.dash = document.querySelector('#dash');
    this.shockwave = document.querySelector('#shockwave');
    this.burstButtons = document.querySelectorAll('[data-count]');
    this.addEnemies = document.querySelector('#add-enemies');
    if (this.debug && new URLSearchParams(location.search).get('debug') === '1') {
      this.debug.hidden = false;
    }
  }
  toggleDebug() {
    if (this.debug) this.debug.hidden = !this.debug.hidden;
  }
  update(arena, juice, fps) {
    this.health.style.width = Math.max(0, arena.player.health) + '%';
    this.kills.textContent = String(arena.kills);
    if (!this.debug || !this.debug.hidden) {
      this.stats.textContent = `${Math.round(fps)} FPS · 敌人 ${arena.enemies.length} · 特效 ${juice.effects.length} · 屏内粒子 ${juice.visibleParticles}`;
    }
  }
}
