const colors = { a: '#66e5f4', b: '#ffc473' };

function frame(name, draw) {
  const image = document.createElement('canvas');
  image.width = image.height = 64;
  draw(image.getContext('2d'));
  return { name, image, makeWhite: false };
}

function shape(ctx, points, color) {
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  for (const point of points.slice(1)) ctx.lineTo(...point);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

export function vaultFrames() {
  const frames = [
    frame('floor', ctx => {
      ctx.fillStyle = '#172939'; ctx.fillRect(0, 0, 64, 64);
      ctx.strokeStyle = '#294452'; ctx.strokeRect(0.5, 0.5, 63, 63);
      ctx.fillStyle = '#355361'; ctx.fillRect(5, 5, 3, 3);
    }),
    frame('wall', ctx => {
      ctx.fillStyle = '#0b111b'; ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = '#253c4c'; ctx.fillRect(1, 1, 62, 55);
      ctx.fillStyle = '#365565'; ctx.fillRect(1, 1, 62, 5);
      ctx.fillStyle = '#172632'; ctx.fillRect(4, 48, 56, 14);
      ctx.fillStyle = '#587184'; ctx.fillRect(10, 15, 4, 4); ctx.fillRect(50, 15, 4, 4);
    }),
    frame('operator', ctx => {
      shape(ctx, [[32, 6], [53, 20], [47, 49], [32, 58], [17, 49], [11, 20]], '#0a1420');
      shape(ctx, [[32, 10], [50, 23], [43, 46], [32, 54], [21, 46], [14, 23]], '#d9ebf0');
      shape(ctx, [[20, 26], [44, 26], [40, 37], [24, 37]], '#147287');
      ctx.fillStyle = '#a0faff'; ctx.fillRect(26, 28, 12, 4);
    }),
    ...[false, true].map(open => frame(open ? 'gate-open' : 'gate-closed', ctx => {
      ctx.strokeStyle = open ? '#61fdad' : '#70848b'; ctx.lineWidth = 5; ctx.strokeRect(10, 8, 44, 48);
      ctx.fillStyle = open ? '#245849' : '#233039'; ctx.fillRect(14, 12, 36, 40);
      shape(ctx, [[32, 18], [43, 31], [36, 31], [36, 45], [28, 45], [28, 31], [21, 31]], open ? '#61fdad' : '#70848b');
    })),
  ];
  for (const [color, tint] of Object.entries(colors)) {
    const path = color === 'a' ? [[32, 12], [52, 32], [32, 52], [12, 32]] : [[13, 15], [51, 15], [51, 49], [13, 49]];
    frames.push(frame('socket-' + color, ctx => {
      shape(ctx, path, '#0c1724');
      ctx.strokeStyle = tint; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = tint; ctx.fillRect(28, 28, 8, 8);
    }), frame('cell-' + color, ctx => {
      shape(ctx, path, tint);
      shape(ctx, [[32, 22], [41, 32], [32, 42], [23, 32]], '#213e48');
    }));
  }
  return frames;
}
