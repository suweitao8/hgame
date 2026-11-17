const cuePresets = Object.freeze({ shoot: 'shoot', slash: 'slash', hit: 'hit', kill: 'powerup', dash: 'jump', shockwave: 'explosion' });

export class InputAndAudio {
  constructor(renderer, ui, audio = null, input = null) {
    if (!input || typeof input.isDown !== 'function' || typeof input.on !== 'function') throw new TypeError('HGame input manager is required');
    this.renderer = renderer; this.ui = ui; this.input = input; this.pointer = { x: renderer.app.screen.width / 2, y: renderer.app.screen.height / 2, down: false };
    this.audio = audio; this.touches = new Map(); this.dash = false; this.shockwave = false; this.slash = false; this.voices = []; this.lastCue = new Map();
    this.abort = new AbortController(); const options = { signal: this.abort.signal };
    input.preventKeys(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Space']);
    this.offKeyDown = input.on('keydown', ({ code, repeat }) => {
      if (!repeat && code === 'Space') this.dash = true;
      if (!repeat && code === 'KeyQ') this.shockwave = true;
      if (!repeat && code === 'KeyE') this.slash = true;
      this.unlock();
    });
    window.addEventListener('blur', () => this.reset(), options);
    const canvas = renderer.app.canvas;
    canvas.addEventListener('pointerdown', event => { this.unlock(); canvas.setPointerCapture(event.pointerId); if (event.pointerType !== 'touch') this.pointer.down = true; this.movePointer(event, true); }, options);
    canvas.addEventListener('pointermove', event => this.movePointer(event), options);
    canvas.addEventListener('pointerup', event => this.endPointer(event), options);
    canvas.addEventListener('pointercancel', event => this.endPointer(event), options);
    canvas.addEventListener('lostpointercapture', event => this.endPointer(event), options);
    ui.dash.addEventListener('pointerdown', event => { event.stopPropagation(); this.dash = true; this.unlock(); }, options);
    ui.shockwave.addEventListener('pointerdown', event => { event.stopPropagation(); this.shockwave = true; this.unlock(); }, options);
  }
  movePointer(event, begin = false) {
    const rect = this.renderer.app.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    if (event.pointerType === 'touch') {
      let touch = this.touches.get(event.pointerId);
      if (!touch) {
        if (!begin) return;
        const left = x < rect.width / 2;
        if ([...this.touches.values()].some(item => item.left === left)) return;
        const visual = document.createElement('div'); visual.className = 'virtual-stick'; visual.innerHTML = '<span></span>';
        visual.style.left = `${event.clientX}px`; visual.style.top = `${event.clientY}px`;
        document.querySelector('#ui-layer').appendChild(visual);
        touch = { startX: x, startY: y, x, y, left, visual }; this.touches.set(event.pointerId, touch);
      }
      touch.x = x; touch.y = y;
      const dx = x - touch.startX, dy = y - touch.startY, scale = Math.min(1, 42 / (Math.hypot(dx, dy) || 1));
      touch.visual.firstChild.style.transform = `translate(${dx * scale}px, ${dy * scale}px)`;
    } else { this.pointer.x = x; this.pointer.y = y; }
  }
  endPointer(event) {
    if (event.pointerType !== 'touch') this.pointer.down = false;
    const touch = this.touches.get(event.pointerId); touch?.visual.remove(); this.touches.delete(event.pointerId);
  }
  clearTouches() { for (const touch of this.touches.values()) touch.visual.remove(); this.touches.clear(); }
  reset() {
    this.pointer.down = false; this.dash = this.shockwave = this.slash = false; this.clearTouches();
    for (const item of this.voices) item.voice.stop();
    this.voices.length = 0; this.lastCue.clear();
  }
  getState(player) {
    let moveX = Number(this.input.isDown('KeyD') || this.input.isDown('ArrowRight')) - Number(this.input.isDown('KeyA') || this.input.isDown('ArrowLeft'));
    let moveY = Number(this.input.isDown('KeyS') || this.input.isDown('ArrowDown')) - Number(this.input.isDown('KeyW') || this.input.isDown('ArrowUp'));
    let aim = this.renderer.screenToWorld(this.pointer.x, this.pointer.y), aimX = aim.x - player.x, aimY = aim.y - player.y;
    let firing = this.pointer.down;
    for (const touch of this.touches.values()) {
      const dx = touch.x - touch.startX, dy = touch.y - touch.startY;
      if (touch.left) { moveX = dx; moveY = dy; } else { aimX = dx; aimY = dy; firing = true; }
    }
    let length = Math.max(1, Math.hypot(moveX, moveY)); moveX /= length; moveY /= length;
    length = Math.hypot(aimX, aimY) || 1; aimX /= length; aimY /= length;
    const state = { moveX, moveY, aimX, aimY, isFiring: firing, justDashed: this.dash, justShockwaved: this.shockwave, justSlashed: this.slash };
    this.dash = this.shockwave = this.slash = false; return state;
  }
  unlock() { if (this.audio?.available) void this.audio.unlock().catch(() => {}); }
  play(name) {
    if (!this.audio?.available) return;
    const now = performance.now();
    let write = 0;
    for (const item of this.voices) if (item.until > now) this.voices[write++] = item;
    this.voices.length = write;
    if (write >= 12 || now - (this.lastCue.get(name) ?? -Infinity) < 40) return;
    const voice = this.audio.playSynth(cuePresets[name] ?? 'hit', { bus: 'sfx', volume: 0.2 });
    if (!voice.played) return;
    this.lastCue.set(name, now); this.voices.push({ voice, until: now + voice.duration * 1000 + 20 });
  }
  dispose() { this.abort.abort(); this.offKeyDown(); this.reset(); this.audio = null; }
}
