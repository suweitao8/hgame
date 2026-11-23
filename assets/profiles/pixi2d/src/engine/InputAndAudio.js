const cuePresets = Object.freeze({ shoot: 'shoot', slash: 'slash', hit: 'hit', kill: 'powerup', dash: 'jump', shockwave: 'explosion' });

export class InputAndAudio {
  constructor(renderer, audio, input, controls, touch) {
    this.renderer = renderer;
    this.input = input;
    this.controls = controls;
    this.pointer = { x: renderer.app.screen.width / 2, y: renderer.app.screen.height / 2, down: false };
    this.aim = { x: 1, y: 0 };
    this.audio = audio;
    this.dash = false;
    this.shockwave = false;
    this.slash = false;
    this.voices = [];
    this.lastCue = new Map();
    this.abort = new AbortController(); const options = { signal: this.abort.signal };
    input.preventKeys(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Space']);
    this.offKeyDown = input.on('keydown', ({ code, repeat }) => {
      if (!repeat && code === 'Space') this.dash = true;
      if (!repeat && code === 'KeyQ') this.shockwave = true;
      if (!repeat && code === 'KeyE') this.slash = true;
      this.unlock();
    });
    window.addEventListener('pointerdown', () => this.unlock(), { ...options, capture: true });
    const canvas = renderer.app.canvas;
    const beginPointer = event => {
      if (event.pointerType === 'touch') return;
      canvas.setPointerCapture(event.pointerId);
      this.pointer.down = true;
      this.movePointer(event);
    };
    canvas.addEventListener('pointerdown', beginPointer, options);
    touch.root.addEventListener('pointerdown', event => {
      if (touch.mode !== 'touch-only' || event.pointerType === 'touch') return;
      // A mouse on a touch-capable PC still aims through the touch overlay.
      event.preventDefault();
      beginPointer(event);
    }, { ...options, capture: true });
    canvas.addEventListener('pointermove', event => this.movePointer(event), options);
    canvas.addEventListener('pointerup', event => this.endPointer(event), options);
    canvas.addEventListener('pointercancel', event => this.endPointer(event), options);
    canvas.addEventListener('lostpointercapture', event => this.endPointer(event), options);
  }
  movePointer(event) {
    if (event.pointerType === 'touch') return;
    const rect = this.renderer.app.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    const screen = this.renderer.app.screen;
    this.pointer.x = rect.width > 0 ? x * screen.width / rect.width : 0;
    this.pointer.y = rect.height > 0 ? y * screen.height / rect.height : 0;
  }
  endPointer(event) {
    if (event.pointerType !== 'touch') this.pointer.down = false;
  }
  reset() {
    this.pointer.down = false;
    this.dash = this.shockwave = this.slash = false;
    for (const item of this.voices) item.voice.stop();
    this.voices.length = 0; this.lastCue.clear();
  }
  getState(player) {
    const { controls, input, pointer } = this;
    const { x: moveX, y: moveY } = controls.move;
    const usingMouse = pointer.down && input.focused;
    let aimX = moveX, aimY = moveY;
    if (usingMouse || this.shockwave || this.slash) {
      const target = this.renderer.screenToWorld(pointer.x, pointer.y);
      aimX = target.x - player.x;
      aimY = target.y - player.y;
    }
    const aimLength = Math.hypot(aimX, aimY);
    if (aimLength > 0.001) {
      this.aim.x = aimX / aimLength;
      this.aim.y = aimY / aimLength;
    }
    const state = {
      moveX, moveY, aimX: this.aim.x, aimY: this.aim.y,
      isFiring: usingMouse || controls.isDown('attack') || controls.wasPressed('attack'),
      justDashed: this.dash || controls.wasPressed('dash'),
      justShockwaved: this.shockwave || controls.wasPressed('skill1'),
      justSlashed: this.slash || controls.wasPressed('skill2'),
    };
    this.dash = this.shockwave = this.slash = false;
    return state;
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
