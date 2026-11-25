import { createSaveStore } from '@hgame/platform/storage.js';

export async function start(host) {
  const [level, target] = await Promise.all([
    host.assets.readJson('assets/level.json'),
    host.assets.loadImage('assets/target.png'),
  ]);
  const context = host.canvas.getContext('2d');
  const save = createSaveStore({ gameId: host.game.id, storage: host.storage });
  const cue = host.assets.createAudio('assets/chime.wav');
  let hits = 0;
  let best = save.get('best', 0);
  let frame = null;

  function measure() {
    const { width, height, pixelRatio } = host.viewport;
    return { x: width * 0.5, y: height * 0.7, radius: Math.min(width, height) * 0.16, pixelRatio };
  }

  function draw() {
    const { x, y, radius, pixelRatio } = measure();
    context.fillStyle = '#10202b';
    context.fillRect(0, 0, host.canvas.width, host.canvas.height);
    if (hits < level.hits) {
      const diameter = radius * pixelRatio * 2;
      context.drawImage(target, (x - radius) * pixelRatio, (y - radius) * pixelRatio, diameter, diameter);
    }
    context.fillStyle = '#eaeff4';
    context.font = (18 * pixelRatio) + 'px sans-serif';
    context.textAlign = 'center';
    if (best) context.fillText('纪录 ' + best, x * pixelRatio, 112 * pixelRatio);
    if (hits < level.hits) context.fillText(hits + '/' + level.hits, x * pixelRatio, 76 * pixelRatio);
  }

  function tick() {
    frame = null;
    if (!host.visible || hits >= level.hits) return;
    draw();
    frame = host.requestFrame(tick);
  }

  function stop() {
    if (frame !== null) host.cancelFrame(frame);
    frame = null;
  }

  host.onResize(draw);
  host.onVisibility(isVisible => { if (isVisible) tick(); else stop(); });
  host.onTouch('start', ({ changedTouches }) => {
    if (!host.visible || hits >= level.hits) return;
    const touch = changedTouches[0];
    const { x, y, radius } = measure();
    if (!touch || Math.hypot(touch.x - x, touch.y - y) > radius) return;
    hits += 1;
    cue.play();
    if (hits === level.hits) {
      stop();
      best = save.set('best', Math.max(best, hits));
    }
    draw();
  });
  draw();
  if (host.sdk.supports('launchSuccess')) host.sdk.launchSuccess();
  if (host.visible) frame = host.requestFrame(tick);
}
