export class DemoArena {
  constructor(count = 1000) {
    this.player = { x: 0, y: 0, health: 100 }; this.kills = 0; this.time = 0;
    this.enemies = Array.from({ length: count }, (_, i) => {
      const a = i * 2.399963, r = 210 + Math.sqrt(i) * 24;
      return { id: i + 1, x: Math.cos(a) * r, y: Math.sin(a) * r, health: 3, elite: i % 40 === 0 };
    });
    this.bullets = []; this.cooldown = 0; this.events = [];
    this.grid = new Map();
  }
  addEnemies(count) {
    for (let i = 0; i < count; i++) {
      const id = this.enemies.length + 1;
      const angle = id * 2.399963;
      const radius = 30 + Math.sqrt((id * 7919 % 10000) / 10000) * 450;
      this.enemies.push({ id, x: this.player.x + Math.cos(angle) * radius, y: this.player.y + Math.sin(angle) * radius * 0.55, health: 3, elite: id % 40 === 0, flash: 0 });
    }
  }
  step(dt, input) {
    this.events.length = 0; this.time += dt;
    const p = this.player, speed = input.justDashed ? 700 : 210;
    p.x += input.moveX * speed * dt; p.y += input.moveY * speed * dt;
    if (input.justDashed) this.events.push({ type: 'dash', x: p.x, y: p.y });
    this.cooldown -= dt;
    if (input.isFiring && this.cooldown <= 0) {
      this.cooldown = 0.1; this.bullets.push({ x: p.x, y: p.y, vx: input.aimX * 700, vy: input.aimY * 700, life: 1.2 });
      this.events.push({ type: 'shoot' });
    }
    if (input.justShockwaved || input.justSlashed) {
      const radius = input.justShockwaved ? 700 : 130;
      for (const enemy of this.enemies) if (Math.hypot(enemy.x - p.x, enemy.y - p.y) < radius) {
        enemy.health--; enemy.flash = 0.065; this.events.push({ type: 'hit', id: enemy.id, x: enemy.x, y: enemy.y });
      }
      this.events.push({ type: input.justShockwaved ? 'shockwave' : 'slash', x: p.x, y: p.y, angle: Math.atan2(input.aimY, input.aimX) });
    }
    this.grid.clear();
    for (const enemy of this.enemies) {
      const cellX = Math.floor(enemy.x / 48), cellY = Math.floor(enemy.y / 48);
      const key = cellX + ',' + cellY;
      const neighbors = this.grid.get(key);
      if (neighbors) {
        for (const other of this.enemies.length > 3000 ? [] : neighbors) {
          const dx = enemy.x - other.x, dy = enemy.y - other.y;
          const distance = Math.hypot(dx, dy);
          if (distance > 0 && distance < 24) {
            enemy.x += dx / distance * (24 - distance) * 0.25;
            enemy.y += dy / distance * (24 - distance) * 0.25;
          }
        }
        neighbors.push(enemy);
      } else this.grid.set(key, [enemy]);
      const dx = p.x - enemy.x, dy = p.y - enemy.y, d = Math.hypot(dx, dy) || 1;
      enemy.flash = Math.max(0, (enemy.flash || 0) - dt);
      if (d > 24) { enemy.x += dx / d * 44 * dt; enemy.y += dy / d * 44 * dt; }
      if (enemy.health <= 0) { this.kills++; enemy.health = 3; const a = enemy.id * 2.399963 + this.time; enemy.x = p.x + Math.cos(a) * 900; enemy.y = p.y + Math.sin(a) * 900; }
    }
    for (const bullet of this.bullets) {
      bullet.x += bullet.vx * dt; bullet.y += bullet.vy * dt; bullet.life -= dt;
      const cellX = Math.floor(bullet.x / 48), cellY = Math.floor(bullet.y / 48);
      for (let y = cellY - 1; y <= cellY + 1 && bullet.life > 0; y++) {
        for (let x = cellX - 1; x <= cellX + 1 && bullet.life > 0; x++) {
          for (const enemy of this.grid.get(x + ',' + y) ?? []) {
            if (Math.abs(enemy.x - bullet.x) >= 20 || Math.abs(enemy.y - bullet.y) >= 20) continue;
            enemy.health--; enemy.flash = 0.065; bullet.life = 0; this.events.push({ type: 'hit', id: enemy.id, x: enemy.x, y: enemy.y }); break;
          }
        }
      }
    }
    this.bullets = this.bullets.filter(bullet => bullet.life > 0);
    return this.events;
  }
}
