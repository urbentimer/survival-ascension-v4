# THE MINE BEAST (wave 20 mission boss) from the user's ChatGPT art in tools/art/minebeast:
#   walk / run / strike / throw .png   5 rows x 4 columns on magenta. The side rows were drawn facing LEFT: rows = D, DL, L, UL, U (the game mirrors the right)
#   charge.png (6, side view facing RIGHT) · dive.png (6) · emerge.png (6) · stagger.png (4) · roar.png (6) · kneel.png (8)   one row each on magenta · portrait.png (square, black)
#   fx-<rubble|erupt|rock|shock>-<1|2|3>.png   8 frames in a row on black: start / loop / end (shock has no end yet)
#   python3 tools/extract-minebeast.py
# Writes client/assets/sprites/zombies/dir8/mb-*.webp, client/assets/sprites/fx/mb-*.webp and client/mineBeastArt.js (cell sizes, anchors, the draw scale).
import os, json
import numpy as np
from PIL import Image
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__)); ART = os.path.join(here, 'art', 'minebeast')
C = os.path.join(here, '..', 'client', 'assets'); D8 = os.path.join(C, 'sprites', 'zombies', 'dir8'); FX = os.path.join(C, 'sprites', 'fx')
GAME_H = 300   # his standing height in the game (px)
SC = 1.128     # (Nov 12) the sheets are cut at the size he is drawn (was: the art's own size, stretched 1.128x by the browser = soft); META.k is now 1
meta = {}

def load(n): return np.array(Image.open(os.path.join(ART, n + '.png')).convert('RGB')).astype(int)
def keyed(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    fg = ~((r - g > 60) & (b - g > 60) & (np.abs(r - b) < 90))
    fg = ndimage.binary_opening(fg, iterations=1)
    lab, n = ndimage.label(fg); sz = ndimage.sum(fg, lab, range(1, n + 1)); fg = np.isin(lab, [i + 1 for i in range(n) if sz[i] >= 30])
    rgb = a.copy(); edge = fg & ~ndimage.binary_erosion(fg, iterations=2)
    pink = edge & (r > g + 30) & (b > g + 30) & (np.abs(r - b) < 80); rgb[..., 0] = np.where(pink, g + 10, r); rgb[..., 2] = np.where(pink, g + 6, b)
    return fg, np.dstack([np.clip(rgb, 0, 255).astype(np.uint8), (fg * 255).astype(np.uint8)])
def torso_x(m):
    ys, xs = np.where(m); top, bot = ys.min(), ys.max(); h = bot - top; band = (ys > top + h * .35) & (ys < top + h * .75)
    return float(np.median(xs[band])) if band.any() else float(np.median(xs))
def resize_sharp(rgba, sc):   # (Nov 12) premultiplied Lanczos (no magenta fringe), soft antialiased edge, unsharp mask on the colour
    from PIL import ImageFilter
    a = rgba[..., 3:4].astype(np.float32) / 255; pm = np.clip(rgba[..., :3].astype(np.float32) * a, 0, 255).astype(np.uint8)
    w, h = max(1, round(rgba.shape[1] * sc)), max(1, round(rgba.shape[0] * sc))
    up = lambda x: np.array(Image.fromarray(np.ascontiguousarray(x)).resize((w, h), Image.LANCZOS)).astype(np.float32)
    A = np.clip(np.dstack([up(pm[..., i]) for i in range(3)]), 0, 255); al = np.clip(up(rgba[..., 3]), 0, 255) / 255
    rgb = np.where(al[..., None] > .02, A / np.maximum(al[..., None], .02), 0)
    img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).filter(ImageFilter.UnsharpMask(radius=1.3 * max(1, sc), percent=65, threshold=2))
    return Image.fromarray(np.dstack([np.array(img), (np.clip((al - .18) / .64, 0, 1) * 255).astype(np.uint8)]))
def place(rgba, cw, ch, ax, fy, hx, base, flip=False, s=SC):   # hx / base in source pixels; the frame is scaled by s into a cell of the drawn size
    q = rgba.copy(); q[..., 3] = np.where(q[..., 3] > 110, 255, 0); im = resize_sharp(q, s); hx, base = hx * s, base * s
    if flip: im = im.transpose(Image.FLIP_LEFT_RIGHT); hx = im.width - 1 - hx
    cell = Image.new('RGBA', (cw, ch)); ox, oy = round(ax - hx), round(fy - base)
    if ox < 0 or oy < 0 or ox + im.width > cw or oy + im.height > ch: print('   clipped', ox, oy, im.size, 'in', cw, ch)
    cell.paste(im, (ox, oy), im); return cell
def save(atlas, out, q=90):
    path = os.path.join(D8, out + '.webp'); atlas.save(path, quality=q, alpha_quality=92, method=6); print(out, atlas.size, '->', os.path.getsize(path) // 1024, 'KB')

def grid(name, cw, ch, main_only=False, flips=()):   # 5 rows x 4: every frame sits on its ROW's ground line, anchored on its torso
    fg, rgba = keyed(load(name)); H, W = fg.shape; cw, ch = round(cw * SC), round(ch * SC); ax, fy = cw // 2, ch - round(8 * SC)
    lab, n = ndimage.label(ndimage.binary_dilation(fg, iterations=2)); lab = np.where(fg, lab, 0); sizes = ndimage.sum(fg, lab, range(1, n + 1)); cen = ndimage.center_of_mass(fg, lab, range(1, n + 1)); owner = np.zeros(n + 1, int)
    for i, (cy, cx) in enumerate(cen): owner[i + 1] = 1 + min(4, int(cy / (H / 5))) * 4 + min(3, int(cx / (W / 4)))
    if main_only:   # only each frame's body (the art's own flying crystals / chips are dropped: the game draws those)
        for slot in range(1, 21):
            ids = [i + 1 for i in range(n) if owner[i + 1] == slot]; big = max(sizes[i - 1] for i in ids)
            for i in ids:
                if sizes[i - 1] < big * .2: owner[i] = 0
    cellmap = owner[lab]; atlas = Image.new('RGBA', (cw * 4, ch * 5)); hs = []
    def cell(r, c):
        m = cellmap == 1 + r * 4 + c; ys, xs = np.where(m); y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        q = rgba[y0:y1, x0:x1].copy(); q[..., 3] = np.where(m[y0:y1, x0:x1], 255, 0); return m[y0:y1, x0:x1], q, y1
    for r in range(5):
        got = [cell(r, c) for c in range(4)]; ground = max(g[2] for g in got)
        for c, (m, q, y1) in enumerate(got):
            atlas.alpha_composite(place(q, cw, ch, ax, fy, torso_x(m), m.shape[0] - 1 + (ground - y1), (r, c) in flips), (c * cw, r * ch))
            if r == 0: hs.append(m.shape[0])
    save(atlas, 'mb-' + name); meta[name] = {'url': f'assets/sprites/zombies/dir8/mb-{name}.webp', 'w': cw, 'h': ch, 'ax': ax, 'fy': fy}; return float(np.median(hs))
def strip(name, n, cw, ch, sc=1.0, centre=True):
    fg, rgba = keyed(load(name)); ys = np.where(fg.any(1))[0]; y0, y1 = ys.min(), ys.max() + 1; occ = fg[y0:y1].any(0); runs, x = [], 0
    while x < len(occ):
        if occ[x]:
            s0 = x
            while x < len(occ) and occ[x]: x += 1
            runs.append([s0, x])
        x += 1
    runs = [r for r in runs if r[1] - r[0] > 6]
    while len(runs) > n: gaps = [runs[i + 1][0] - runs[i][1] for i in range(len(runs) - 1)]; i = int(np.argmin(gaps)); runs[i][1] = runs[i + 1][1]; del runs[i + 1]
    assert len(runs) == n, (name, runs); cw, ch = round(cw * SC), round(ch * SC); ax, fy = cw // 2, ch - round(8 * SC); atlas = Image.new('RGBA', (cw * n, ch))
    base = max(np.where(fg[y0:y1, a:b].any(1))[0].max() for a, b in runs)
    for i, (a, b) in enumerate(runs):
        m = fg[y0:y1, a:b]; q = rgba[y0:y1, a:b]
        xs = np.where(m.any(0))[0]; hx = (xs.min() + xs.max()) / 2 if centre else torso_x(m)
        atlas.alpha_composite(place(q, cw, ch, ax, fy, hx, base, s=sc * SC), (i * cw, 0))   # (Nov 12) one resize, straight from the source
    save(atlas, 'mb-' + name); meta[name] = {'url': f'assets/sprites/zombies/dir8/mb-{name}.webp', 'w': cw, 'h': ch, 'ax': ax, 'fy': fy, 'n': n}

h0 = grid('walk', 260, 300); grid('run', 290, 300); grid('strike', 300, 300); grid('throw', 290, 320, main_only=True, flips=((2, 2),))
print('standing height in the art', h0); K = GAME_H / h0
strip('charge', 6, 300, 250); strip('dive', 6, 270, 380); strip('emerge', 6, 270, 310)
strip('stagger', 4, 320, 340, sc=h0 / 505)   # (drawn much bigger: brought down to the walk sheet's scale; frame 4 stands 505px tall)
strip('roar', 6, 330, 310, sc=h0 / 307)   # Nov 12: the roar (front view): plant, chest swells, roar at the roof (3-4 loop), lanterns out, head lowered
strip('kneel', 8, 270, 300, sc=h0 / 283)   # Nov 12: beaten (front): staggers, crystals break, drops to a knee, kneels (5-6 loop), eyes flare, back up roaring

def fx(name, sets, size, solid=False):   # sets of 8 on black -> one row of 8 * sets cells; black becomes see-through (so the rocks stay solid, not ghostly)
    frames = []
    for i in range(1, sets + 1):
        a = load(f'fx-{name}-{i}').astype(float); H, W = a.shape[:2]; fw = W / 8
        for j in range(8): frames.append(a[:, round(j * fw):round((j + 1) * fw)])
    w = min(f.shape[1] for f in frames); occ = np.concatenate([f[:, :w].max(2) > 24 for f in frames], 1); ys = np.where(occ.any(1))[0]; y0, y1 = max(0, ys.min() - 4), ys.max() + 4
    out = []
    for f in frames:
        f = f[y0:y1, :w]; lum = f.max(2); al = np.clip((lum - 9) / 46, 0, 1); rgb = np.clip(f / np.maximum(al, .35)[..., None], 0, 255)
        if solid:   # rocks: their dark outlines and cracks were coming out see-through (a faint, ghostly rock). Everything enclosed by the rock is made solid, and the stone gets more contrast
            core = ndimage.binary_opening(al > .55, iterations=1); filled = ndimage.binary_fill_holes(ndimage.binary_closing(core, iterations=3)); soft = ndimage.gaussian_filter(filled.astype(float), 1.2)
            al = np.maximum(al, np.clip(soft * 1.6, 0, 1)); rgb = np.where(filled[..., None], np.clip((f - 60) * 1.28 + 72, 0, 255), rgb)
        edge = np.minimum(np.arange(w), np.arange(w)[::-1]) / (w * .06); al = al * np.clip(edge, 0, 1)[None, :]
        out.append(np.dstack([rgb, al * 255]).astype(np.uint8))
    img = Image.fromarray(np.concatenate(out, 1)); k = size / w; img = img.resize((size * len(out), round(img.height * k)), Image.LANCZOS)
    path = os.path.join(FX, f'mb-{name}.webp'); img.save(path, quality=74, alpha_quality=80, method=6); print('fx', name, img.size, '->', os.path.getsize(path) // 1024, 'KB')
    meta['fx_' + name] = {'url': f'assets/sprites/fx/mb-{name}.webp', 'w': size, 'h': img.height, 'n': len(out)}
fx('rubble', 3, 220, solid=True); fx('erupt', 3, 240); fx('rock', 3, 230, solid=True); fx('shock', 2, 250)
im = Image.open(os.path.join(ART, 'portrait.png')).convert('RGB').resize((256, 256), Image.LANCZOS); pp = os.path.join(C, 'portraits', 'minebeast.webp'); im.save(pp, quality=82, method=6); print('portrait', os.path.getsize(pp) // 1024, 'KB')   # Nov 12: for the boss bar
meta['k'] = 1; print('draw scale baked in: SC', SC, 'vs measured', round(K, 3))   # (Nov 12) the sheets are cut at the drawn size
open(os.path.join(here, '..', 'client', 'mineBeastArt.js'), 'w').write('// GENERATED by tools/extract-minebeast.py: the Mine Beast sheets (cell w / h, anchor ax / fy, n frames) and effects; k = draw scale\nexport const MB = ' + json.dumps(meta, separators=(',', ':')) + ';\n')
