export class InputAndAudio {
  constructor(renderer, ui) {
    this.renderer = renderer; this.ui = ui; this.keys = new Set(); this.pointer = { x: renderer.app.screen.width / 2, y: renderer.app.screen.height / 2, down: false };
    this.touches = new Map(); this.dash = false; this.shockwave = false; this.slash = false; this.voices = 0; this.lastCue = new Map();
    this.abort = new AbortController(); const options = { signal: this.abort.signal };
    window.addEventListener('keydown', event => {
      this.keys.add(event.code); if (!event.repeat && event.code === 'Space') this.dash = true;
      if (!event.repeat && event.code === 'KeyQ') this.shockwave = true;
      if (!event.repeat && event.code === 'KeyE') this.slash = true;
      this.unlock();
    }, options);
    window.addEventListener('keyup', event => this.keys.delete(event.code), options);
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
  reset() { this.keys.clear(); this.pointer.down = false; this.dash = this.shockwave = this.slash = false; this.clearTouches(); }
  getState(player) {
    let moveX = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
    let moveY = Number(this.keys.has('KeyS') || this.keys.has('ArrowDown')) - Number(this.keys.has('KeyW') || this.keys.has('ArrowUp'));
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
  unlock() { if (!this.audio) this.audio = new AudioContext(); if (this.audio.state === 'suspended') void this.audio.resume(); }
  play(name) {
    const ctx = this.audio; if (!ctx || this.voices >= 12 || ctx.currentTime - (this.lastCue.get(name) ?? -1) < 0.04) return;
    this.lastCue.set(name, ctx.currentTime); this.voices++;
    const oscillator = ctx.createOscillator(), gain = ctx.createGain();
    oscillator.type = name === 'kill' ? 'sawtooth' : 'triangle';
    oscillator.frequency.setValueAtTime(({ shoot: 620, slash: 240, hit: 340, kill: 180, dash: 420, shockwave: 110 })[name] ?? 220, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.05, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.13);
    oscillator.connect(gain).connect(ctx.destination); oscillator.onended = () => { this.voices--; oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(); oscillator.stop(ctx.currentTime + 0.14);
  }
  dispose() { this.abort.abort(); this.reset(); void this.audio?.close(); }
}
