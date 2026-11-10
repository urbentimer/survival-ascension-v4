# THE ABOMINATION (boss, wave 16) + THE FIVE (his spawn), from the user's ChatGPT art in tools/art/abomination/ (Nov 10):
#   slam / spew .png              5 rows (D, DR, R, UR, U) x 4 columns on magenta          (walk.png: same layout, optional - not sent yet)
#   roll (6) / dazed (4) / morph1 (6) / morph2 (6) .png   one row, front view
#   spawn-run / spawn-lunge .png  5 rows x 4 (with dark-magenta drop shadows, keyed out), spawn-dead.png one row of 5
#   fx-<lava|slam|ember><1|2|3>.png   8 frames in a row on black: start / loop / end sets
#   portrait.png                  on magenta (his body is black)
# Writes (python3 tools/extract-abomination.py):
#   client/assets/sprites/zombies/dir8/abom-<slam|spew|walk>.webp   4 x 5 cells BW x BH, feet (BAX, BFY)
#   .../abom-<roll|dazed>.webp (one row, same cells), abom-morph.webp (12 frames, cells MW x BH, centred)
#   .../abomspawn-<run|lunge>.webp 4 x 5 cells SW x SH, feet (SAX, SFY); abomspawn-dead.webp one row
#   client/assets/sprites/fx/abom-<lava|slam|ember>.webp   24 frames in a row (3 sets of 8), black background
#   client/assets/portraits/abomination.webp
import os
import numpy as np
from PIL import Image
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__)); ART = os.path.join(here, 'art', 'abomination')
C = os.path.join(here, '..', 'client', 'assets'); D8 = os.path.join(C, 'sprites', 'zombies', 'dir8'); FX = os.path.join(C, 'sprites', 'fx')
BW, BH, BAX, BFY = 340, 260, 170, 236     # boss cells
MW = 460                                   # morph cells (five bodies side by side)
SW, SH, SAX, SFY = 240, 210, 120, 182     # spawn cells
BOSS_H, SPAWN_H = 172, 118                # standing heights in game (px): Screamer ~170

def load(n): return np.array(Image.open(os.path.join(ART, n + '.png')).convert('RGB')).astype(int)

def keyed(a):   # magenta of ANY brightness (the drop shadows are dark magenta) -> transparent; specks dropped
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    fg = ~((r - g > 34) & (b - g > 34))
    fg = ndimage.binary_opening(fg, iterations=1)
    lab, n = ndimage.label(fg); sz = ndimage.sum(fg, lab, range(1, n + 1)); fg = np.isin(lab, [i + 1 for i in range(n) if sz[i] >= 40])
    rgb = a.copy(); edge = fg & ~ndimage.binary_erosion(fg, iterations=2)   # despill the outline: pull pinkish edge pixels to neutral
    pink = edge & (r > g + 14) & (b > g + 14); rgb[..., 0] = np.where(pink, g + 10, r); rgb[..., 2] = np.where(pink, g, b)
    return fg, np.dstack([np.clip(rgb, 0, 255).astype(np.uint8), (fg * 255).astype(np.uint8)])

def bands(occ, n):
    runs, x = [], 0
    while x < len(occ):
        if occ[x]:
            s0 = x
            while x < len(occ) and occ[x]: x += 1
            runs.append([s0, x])
        x += 1
    runs = [r for r in runs if r[1] - r[0] > 3]
    while len(runs) > n:
        gaps = [runs[i + 1][0] - runs[i][1] for i in range(len(runs) - 1)]; i = int(np.argmin(gaps)); runs[i][1] = runs[i + 1][1]; del runs[i + 1]
    assert len(runs) == n, (n, runs)
    return runs

def torso_x(m):
    ys, xs = np.where(m); top, bot = ys.min(), ys.max(); h = bot - top; band = (ys > top + h * .4) & (ys < top + h * .8)
    return float(np.median(xs[band])) if band.any() else float(np.median(xs))

def place(rgba, m, sc, cw, ch, ax, fy, hx, base):
    im = Image.fromarray(np.ascontiguousarray(rgba)); im = im.resize((max(1, round(im.width * sc)), max(1, round(im.height * sc))), Image.LANCZOS)
    q = np.array(im); q[..., 3] = np.where(q[..., 3] > 110, 255, 0); im = Image.fromarray(q)
    cell = Image.new('RGBA', (cw, ch)); ox, oy = round(ax - hx * sc), round(fy - base * sc)
    if ox < 0 or oy < 0 or ox + im.width > cw or oy + im.height > ch: print('   clipped', ox, oy, im.size, 'in', cw, ch)
    cell.paste(im, (ox, oy), im); return cell

def height(m): ys = np.where(m.any(1))[0]; return ys.max() - ys.min() + 1

def grid(name, out, cw, ch, ax, fy, target_h, ref=(0, 0), sc0=None):   # 5 rows x 4: every frame sits on its ROW's ground line (keeps the jump height of the lunge)
    p = os.path.join(ART, name + '.png')
    if not os.path.exists(p): print('  (no', name + '.png yet)'); return None
    a = load(name); fg, rgba = keyed(a); atlas = Image.new('RGBA', (cw * 4, ch * 5)); H, W = fg.shape
    # frames can poke into the next row (a raised arm): every connected blob goes to the grid slot its centre is in
    lab, n = ndimage.label(fg); cen = ndimage.center_of_mass(fg, lab, range(1, n + 1)); owner = np.zeros(n + 1, int)
    for i, (cy, cx) in enumerate(cen): owner[i + 1] = 1 + min(4, int(cy / (H / 5))) * 4 + min(3, int(cx / (W / 4)))
    cellmap = owner[lab]
    def cell(r, c):
        m = cellmap == 1 + r * 4 + c; ys, xs = np.where(m); y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        q = rgba[y0:y1, x0:x1].copy(); q[..., 3] = np.where(m[y0:y1, x0:x1], 255, 0); return m[y0:y1, x0:x1], q, y1
    rr, rc = ref; sc = sc0 or target_h / height(cell(rr, rc)[0])
    for r in range(5):
        got = [cell(r, c) for c in range(4)]; ground = max(got[0][2], got[3][2])   # the row's ground line = the feet of its grounded frames
        for c, (m, q, y1) in enumerate(got):
            atlas.alpha_composite(place(q, m, sc, cw, ch, ax, fy, torso_x(m), m.shape[0] - 1 + (ground - y1)), (c * cw, r * ch))
    path = os.path.join(D8, out + '.webp'); atlas.save(path, quality=80, alpha_quality=88, method=6)
    print(out, atlas.size, 'scale', round(sc, 3), '->', os.path.getsize(path) // 1024, 'KB'); return sc

def strip(name, n, cw, ch, ax, fy, sc=None, target_h=None, ref=0, centre=False, frames_out=None):
    a = load(name); fg, rgba = keyed(a); ys = np.where(fg.any(1))[0]; y0, y1 = ys.min(), ys.max() + 1
    runs = bands(fg[y0:y1].any(0), n)
    if sc is None: x0, x1 = runs[ref]; sc = target_h / height(fg[y0:y1, x0:x1])
    base = max(np.where(fg[y0:y1, x0:x1].any(1))[0].max() for x0, x1 in runs)   # one ground line for the whole strip
    out = []
    for x0, x1 in runs:
        m = fg[y0:y1, x0:x1]; hx = (np.where(m.any(0))[0].min() + np.where(m.any(0))[0].max()) / 2 if centre else torso_x(m)
        out.append(place(rgba[y0:y1, x0:x1], m, sc, cw, ch, ax, fy, hx, base))
    if frames_out is not None: frames_out.extend(out)
    return out, sc

def save_strip(cells, out):
    atlas = Image.new('RGBA', (cells[0].width * len(cells), cells[0].height))
    for i, c in enumerate(cells): atlas.alpha_composite(c, (i * c.width, 0))
    path = os.path.join(D8, out + '.webp'); atlas.save(path, quality=80, alpha_quality=88, method=6); print(out, atlas.size, '->', os.path.getsize(path) // 1024, 'KB')

grid('slam', 'abom-slam', BW, BH, BAX, BFY, BOSS_H); grid('spew', 'abom-spew', BW, BH, BAX, BFY, BOSS_H); grid('walk', 'abom-walk', BW, BH, BAX, BFY, BOSS_H)
c, _ = strip('roll', 6, BW, BH, BAX, BFY, target_h=BOSS_H, ref=5); save_strip(c, 'abom-roll')
c, _ = strip('dazed', 4, BW, BH, BAX, BFY, target_h=BOSS_H * .98, ref=3); save_strip(c, 'abom-dazed')
m1, sc = strip('morph1', 6, MW, BH, MW // 2, BFY, target_h=BOSS_H * .98, ref=0, centre=True); m2, _ = strip('morph2', 6, MW, BH, MW // 2, BFY, sc=sc, centre=True)
save_strip(m1 + m2, 'abom-morph')
ssc = grid('spawn-run', 'abomspawn-run', SW, SH, SAX, SFY, SPAWN_H); grid('spawn-lunge', 'abomspawn-lunge', SW, SH, SAX, SFY, 0, sc0=ssc)   # same sheet size as the run: same scale
c, _ = strip('spawn-dead', 5, SW + 40, SH, (SW + 40) // 2, SFY, target_h=SPAWN_H, ref=0, centre=True); save_strip(c, 'abomspawn-dead')

def fx(names, out, size, cone=False):   # 3 sets of 8 on black -> 24 equal cells in one row
    frames = []
    for name in names:
        a = load(name); H, W = a.shape[:2]; lum = a.max(2); occ = lum > 26; fw = W / 8
        for i in range(8):
            s0, s1 = round(i * fw), round((i + 1) * fw); f = a[:, s0:s1].copy(); f[f.max(2) < 12] = 0; frames.append(f)
    soft = lambda n, k: np.clip(np.minimum(np.arange(n), np.arange(n)[::-1]) / max(1, n * k), 0, 1)   # fade to black at the frame's edges (additive: black = nothing), so no hard cut shows
    ys = np.where(np.concatenate([f.max(2) > 26 for f in frames], 1).any(1))[0]; y0, y1 = max(0, ys.min() - 6), ys.max() + 6
    w = min(f.shape[1] for f in frames); h = y1 - y0; mask = np.outer(soft(h, .16), soft(w, .1))
    if cone:   # the lava stream: narrow at his mouth (left), wide at the far end
        yy = np.abs(np.arange(h) - h / 2)[:, None] / (h / 2); half = .3 + .7 * (np.arange(w) / w)[None, :] ** .8; mask = mask * np.clip((half - yy) / .22, 0, 1)
    img = Image.fromarray(np.concatenate([f[y0:y1, :w] * mask[..., None] for f in frames], 1).astype(np.uint8)); k = size / w
    if k < 1: img = img.resize((round(w * k) * 24, round(img.height * k)), Image.LANCZOS)
    path = os.path.join(FX, out + '.webp'); img.save(path, quality=80, method=6); print(out, img.size, 'frame', img.width // 24, 'x', img.height, '->', os.path.getsize(path) // 1024, 'KB')
for n in ('lava', 'slam', 'ember'): fx([f'fx-{n}{i}' for i in (1, 2, 3)], 'abom-' + n, 200, cone=n == 'lava')

fg, rgba = keyed(load('portrait')); im = Image.fromarray(rgba); im = im.crop(im.getbbox()); im.thumbnail((560, 560), Image.LANCZOS)
im.save(os.path.join(C, 'portraits', 'abomination.webp'), quality=84, alpha_quality=90, method=6); print('portrait', im.size)
