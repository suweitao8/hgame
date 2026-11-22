# -*- coding: utf-8 -*-
# Slice a character's turnaround sheet into Hunyuan multiview inputs (front + left).
# usage: python slice-views.py <characterId> [sourcePng]
# - source defaults to the newest .png/.jpg/.webp in the character's generated/ dir
# - rules (2026-11-21 verified on 15 sheets): merge runs with gaps <=6px; attach non-last
#   runs whose gap to the running front-end is <100px (floating-fist tiles, e.g. anuo/jiege)
#   into the front view; the last large run is the left (side) view; margins 30px x / 20px y.
import json
import os
import sys

ROOT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))),
    'webasset',
    'assets',
    'characters',
)


def main():
    if len(sys.argv) < 2:
        print('usage: python slice-views.py <characterId> [sourcePng]')
        sys.exit(1)
    char_id = sys.argv[1]
    gdir = os.path.join(ROOT, char_id, 'generated')
    vdir = os.path.join(gdir, 'views')
    if not os.path.isdir(gdir):
        print(f'no generated dir for {char_id}')
        sys.exit(1)
    os.makedirs(vdir, exist_ok=True)

    if len(sys.argv) >= 3:
        src = sys.argv[2]
    else:
        files = [(os.path.getmtime(os.path.join(gdir, f)), f) for f in os.listdir(gdir)
                 if os.path.isfile(os.path.join(gdir, f)) and f.lower().endswith(('.png', '.jpg', '.webp'))]
        if not files:
            print('no source image found')
            sys.exit(1)
        files.sort(reverse=True)
        src = os.path.join(gdir, files[0][1])
    print('source:', src)

    from PIL import Image  # noqa: E402
    im = Image.open(src).convert('RGB')
    W, H = im.size
    px = im.load()
    corners = [px[2, 2], px[W - 3, 2], px[2, H - 3], px[W - 3, H - 3]]
    bg = tuple(sum(c[i] for c in corners) // 4 for i in range(3))

    cols = [x for x in range(W) if any(
        abs(px[x, y][0] - bg[0]) + abs(px[x, y][1] - bg[1]) + abs(px[x, y][2] - bg[2]) > 60
        for y in range(0, H, 3))]
    runs, cur = [], [cols[0]]
    for x in cols[1:]:
        if x - cur[-1] > 6:
            runs.append([cur[0], cur[-1]])
            cur = [x]
        else:
            cur.append(x)
    runs.append([cur[0], cur[-1]])

    front_end = runs[0][1]
    left_start = None
    for i, (a, b) in enumerate(runs[1:], 1):
        if i != len(runs) - 1 and a - front_end < 100:
            front_end = b          # floating-fist / near tile fragment -> front view
        else:
            left_start = a
            break
    fx0, fx1 = runs[0][0], front_end
    lx0, lx1 = left_start, runs[-1][1]
    print('runs:', json.dumps(runs), '-> front', [fx0, fx1], 'left', [lx0, lx1])

    def crop(x0, x1, name):
        rows = []
        for y in range(0, H, 2):
            for x in range(x0, x1, 4):
                r, g, b = px[x, y]
                if abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) > 60:
                    rows.append(y)
                    break
        y0, y1 = min(rows), max(rows)
        mx, my = 30, 20
        box = (max(0, x0 - mx), max(0, y0 - my), min(W, x1 + mx), min(H, y1 + my))
        out = im.crop(box)
        out.save(os.path.join(vdir, name))
        print(name, out.size, 'box', box)

    crop(fx0, fx1, 'hunyuan-mv-front.png')
    crop(lx0, lx1, 'hunyuan-mv-left.png')


if __name__ == '__main__':
    main()
