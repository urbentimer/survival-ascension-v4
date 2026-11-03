# Cuts the zombie sheet (5 rows: walker, runner, brute, spitter, mutant x 6 frames:
# WALK 1-3, ATTACK 1-2, DEAD) out of its magenta background, cleans the pink fringe,
# redraws a dark outline, scales it to match the survivors, and packs one sheet per zombie.
import numpy as np, json, os
from PIL import Image
from collections import deque
here = os.path.dirname(os.path.abspath(__file__))
src = np.array(Image.open(os.path.join(here, 'art', 'zombies-source.jpg')).convert('RGB')).astype(int)
H, W, _ = src.shape
KINDS = ['walker', 'runner', 'brute', 'spitter', 'mutant']
ROWS, COLS = 5, 6
SCALE = 0.36                    # walker ends up about as tall as a survivor (~55px)
CELL_W, CELL_H = 104, 80        # output frame cell (after scaling)
ANCHOR_X = 46                   # body centre lands here in every frame; feet sit on the bottom edge
out_dir = os.path.join(here, '..', 'client', 'assets', 'sprites', 'zombies'); os.makedirs(out_dir, exist_ok=True)

from scipy import ndimage

def bg_mask(strip):
    r, g, b = strip[..., 0], strip[..., 1], strip[..., 2]
    core = (r > 215) & (b > 215) & (g < 70)                      # pure magenta: background, including holes between limbs
    soft = (r > 150) & (b > 150) & (g < 120) & (abs(r - b) < 110)  # blurred magenta edges
    # soft pixels count as background only where they touch the background
    grown = core.copy()
    for _ in range(3): grown = ndimage.binary_dilation(grown) & (core | soft)
    return grown

def frames_in_row(strip):
    """Find each frame as a whole shape (so wide frames aren't chopped), left to right."""
    fg = ~bg_mask(strip)
    lab, n = ndimage.label(fg, structure=np.ones((3, 3)))
    if n == 0: return []
    sizes = ndimage.sum(fg, lab, range(1, n + 1)); boxes = ndimage.find_objects(lab)
    big = [i for i in range(n) if sizes[i] > 1500]
    big.sort(key=lambda i: boxes[i][1].start)
    groups = {i: [i] for i in big}
    for i in range(n):            # small bits (acid glob, drips) join the nearest frame, specks are dropped
        if i in groups or sizes[i] < 25: continue
        bx = boxes[i]; cx = (bx[1].start + bx[1].stop) / 2; cy = (bx[0].start + bx[0].stop) / 2
        best, bd = None, 1e9
        for j in big:
            bj = boxes[j]; dx = max(bj[1].start - cx, 0, cx - bj[1].stop); dy = max(bj[0].start - cy, 0, cy - bj[0].stop)
            if dx + dy < bd: best, bd = j, dx + dy
        if best is not None and bd < 60: groups[best].append(i)
    out = []
    for j in big:
        m = np.isin(lab, [k + 1 for k in groups[j]])
        ys, xs = np.where(m)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        sub = m[y0:y1, x0:x1]
        rgb = strip[y0:y1, x0:x1].copy()
        bgm = ~sub
        edge = sub & (np.roll(bgm, 1, 0) | np.roll(bgm, -1, 0) | np.roll(bgm, 1, 1) | np.roll(bgm, -1, 1))
        pink = edge & (rgb[..., 0] > rgb[..., 1] + 40) & (rgb[..., 2] > rgb[..., 1] + 40)
        rgb[pink] = (rgb[pink] * 0.35).astype(int)               # de-fringe pink edges toward the dark outline
        rgba = np.zeros(sub.shape + (4,), np.uint8); rgba[..., :3] = np.clip(rgb, 0, 255); rgba[..., 3] = sub * 255
        colh = sub.sum(0); body = np.where(colh >= colh.max() * 0.5)[0]
        out.append((Image.fromarray(rgba), (body.min() + body.max()) / 2))
    return out

meta = {}
for r, kind in enumerate(KINDS):
    y0, y1 = int(r * H / ROWS), int((r + 1) * H / ROWS)
    frames = frames_in_row(src[y0:y1])
    print(kind, 'frames found:', len(frames))
    sheet = Image.new('RGBA', (CELL_W * COLS, CELL_H), (0, 0, 0, 0))
    for c, f in enumerate(frames):
        if not f: continue
        fig, bc = f
        sw, sh = max(1, round(fig.width * SCALE)), max(1, round(fig.height * SCALE))
        small = fig.resize((sw, sh), Image.LANCZOS)
        # crisp alpha after resizing + 1px dark outline so it reads like the survivors
        arr = np.array(small); al = arr[..., 3] > 110; arr[..., 3] = al * 255
        ring = np.zeros_like(al); ring[1:] |= al[:-1]; ring[:-1] |= al[1:]; ring[:, 1:] |= al[:, :-1]; ring[:, :-1] |= al[:, 1:]; ring &= ~al
        arr[ring] = (14, 10, 12, 255)
        small = Image.fromarray(arr)
        px_ = c * CELL_W + ANCHOR_X - round(bc * SCALE); py_ = CELL_H - small.height
        sheet.alpha_composite(small, (max(c * CELL_W, min(px_, c * CELL_W + CELL_W - small.width)), max(0, py_)))
    sheet.save(os.path.join(out_dir, kind + '.png'))
    meta[kind] = {'cellW': CELL_W, 'cellH': CELL_H, 'anchorX': ANCHOR_X, 'frames': ['walk1', 'walk2', 'walk3', 'attack1', 'attack2', 'dead']}
json.dump(meta, open(os.path.join(out_dir, 'zombies.json'), 'w'), indent=1)
print('wrote', sorted(os.listdir(out_dir)))
