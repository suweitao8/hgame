export class DemoArena {
  constructor(grid, count = 1000) {
    this.player = { x: 0, y: 0, health: 100 }; this.kills = 0; this.time = 0;
    this.enemies = Array.from({ length: count }, (_, i) => {
      const a = i * 2.399963, r = 210 + Math.sqrt(i) * 24;
      return { id: i + 1, x: Math.cos(a) * r, y: Math.sin(a) * r, health: 3, elite: i % 40 === 0 };
    });
    this.bullets = []; this.cooldown = 0; this.events = [];
    this.grid = grid;
    this.neighbors = [];
    this.hit = { item: null, x: 0, y: 0, t: 0 };
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
      const radiusSq = radius * radius;
      for (const enemy of this.enemies) {
        const dx = enemy.x - p.x, dy = enemy.y - p.y;
        if (dx * dx + dy * dy >= radiusSq) continue;
        enemy.health--; enemy.flash = 0.065; this.events.push({ type: 'hit', id: enemy.id, x: enemy.x, y: enemy.y });
      }
      this.events.push({ type: input.justShockwaved ? 'shockwave' : 'slash', x: p.x, y: p.y, angle: Math.atan2(input.aimY, input.aimX) });
    }
    const grid = this.grid, neighbors = this.neighbors;
    const separate = this.enemies.length <= 3000;
    const needsGrid = separate || this.bullets.length > 0;
    if (grid.count > 0) grid.clear();
    for (const enemy of this.enemies) {
      if (separate) {
        grid.queryRadius(enemy.x, enemy.y, 24, neighbors);
        for (const other of neighbors) {
          const dx = enemy.x - other.x, dy = enemy.y - other.y;
          const distanceSq = dx * dx + dy * dy;
          if (!(distanceSq > 0) || distanceSq >= 24 * 24) continue;
          const distance = Math.sqrt(distanceSq);
          const push = (24 - distance) * 0.25 / distance;
          enemy.x += dx * push;
          enemy.y += dy * push;
        }
      }
      const dx = p.x - enemy.x, dy = p.y - enemy.y;
      const distanceSq = dx * dx + dy * dy;
      enemy.flash = Math.max(0, (enemy.flash || 0) - dt);
      if (distanceSq > 24 * 24) {
        const travel = 44 * dt / Math.sqrt(distanceSq);
        enemy.x += dx * travel;
        enemy.y += dy * travel;
      }
      if (enemy.health <= 0) { this.kills++; enemy.health = 3; const a = enemy.id * 2.399963 + this.time; enemy.x = p.x + Math.cos(a) * 900; enemy.y = p.y + Math.sin(a) * 900; }
      if (needsGrid) grid.insert(enemy, enemy.x, enemy.y);
    }
    let bulletWrite = 0;
    for (const bullet of this.bullets) {
      const travel = Math.min(dt, bullet.life);
      const x = bullet.x + bullet.vx * travel, y = bullet.y + bullet.vy * travel;
      const enemy = grid.castSegment(bullet.x, bullet.y, x, y, 20, this.hit)?.item;
      if (enemy) {
        enemy.health--;
        enemy.flash = 0.065;
        this.events.push({ type: 'hit', id: enemy.id, x: enemy.x, y: enemy.y });
        continue;
      }
      bullet.x = x;
      bullet.y = y;
      bullet.life -= dt;
      if (bullet.life > 0) this.bullets[bulletWrite++] = bullet;
    }
    this.bullets.length = bulletWrite;
    return this.events;
  }
}
