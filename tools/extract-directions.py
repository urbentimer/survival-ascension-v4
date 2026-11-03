# Cuts a survivor's direction sheets (one sheet per weapon) out of their magenta
# background and packs them into one in-game atlas: client/assets/sprites/dir8/<class>.png
#
# Each sheet: 6 columns (IDLE, WALK 1-3, ATTACK/SHOOT 1, ATTACK/SHOOT 2) and either
#   8 rows: DOWN, DOWN-RIGHT, RIGHT, UP-RIGHT, UP, UP-LEFT, LEFT, DOWN-LEFT
#   5 rows: DOWN, DOWN-RIGHT, RIGHT, UP-RIGHT, UP   (the left rows are made by mirroring)
# The row count is detected from the empty gaps between rows.
#
# Usage:  python3 tools/extract-directions.py <class> gun=<sheet> [knife=<sheet>] [bat=<sheet>] [axe=<sheet>] [katana=<sheet>]
#   e.g.  python3 tools/extract-directions.py assault gun=tools/art/marcus-v3-gun.png knife=tools/art/marcus-v3-knife.png \
#             bat=tools/art/marcus-v3-bat.png axe=tools/art/marcus-v3-axe.png
#   Optional crop if a sheet has labels/panels:  gun=<sheet>#x0,y0,x1,y1
# Atlas layout: one block of 8 rows per weapon, in the order given. Missing melee weapons use the knife in game.
import sys, os, json
import numpy as np
from PIL import Image
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__))
COLS = 6
TARGET_H = 54                       # body height in game pixels
CELL_W, CELL_H, ANCHOR_X, FEET_Y = 112, 88, 56, 80   # FEET_Y: feet line inside a cell (room below for slash arcs)
ROW_NAMES = ['down', 'downRight', 'right', 'upRight', 'up', 'upLeft', 'left', 'downLeft']
MIRROR_OF = {5: 3, 6: 2, 7: 1}      # up-left <- up-right, left <- right, down-left <- down-right
out_dir = os.path.join(here, '..', 'client', 'assets', 'sprites', 'dir8'); os.makedirs(out_dir, exist_ok=True)

def runs_of(occ, min_gap, min_len):
    runs, x, n = [], 0, len(occ)
    while x < n:
        if occ[x]:
            a = x
            while x < n and occ[x]: x += 1
            runs.append([a, x])
        x += 1
    merged = []
    for r in runs:
        if merged and r[0] - merged[-1][1] < min_gap: merged[-1][1] = r[1]
        else: merged.append(r)
    return [r for r in merged if r[1] - r[0] > min_len]

def squeeze(runs, n):               # join the closest neighbours until there are n
    runs = [list(r) for r in runs]
    while len(runs) > n:
        gaps = [runs[i + 1][0] - runs[i][1] for i in range(len(runs) - 1)]
        i = int(np.argmin(gaps)); runs[i][1] = runs[i + 1][1]; del runs[i + 1]
    return runs

def foreground(src):
    r, g, b = src[..., 0], src[..., 1], src[..., 2]
    core = (r > 200) & (b > 200) & (g < 90)
    soft = (r > 140) & (b > 140) & (g < 130) & (abs(r - b) < 110)
    shadow = (r > 80) & (b > 80) & (g < 55) & (abs(r - b) < 50)       # darker magenta drop shadow: the game draws its own
    bgm = core.copy()
    for _ in range(3): bgm = ndimage.binary_dilation(bgm) & (core | soft | shadow)
    return ~(bgm | core | shadow)

def cut_sheet(src, want_rows=None, col_pitch=None, row_pitch=None):
    H, W, _ = src.shape
    fg = foreground(src)
    cols = [[i * col_pitch, min(W, (i + 1) * col_pitch)] for i in range(COLS)] if col_pitch else squeeze(runs_of(fg.sum(0) > 2, 14, 12), COLS)
    rows = [[round(i * row_pitch), min(H, round((i + 1) * row_pitch))] for i in range(round(H / row_pitch))] if row_pitch else runs_of(fg.sum(1) > 2, 10, 20)
    nrows = want_rows or (8 if len(rows) >= 7 else 5)
    if len(rows) > nrows: rows = squeeze(rows, nrows)
    prof = fg.sum(1)
    while len(rows) < nrows:          # two rows bridged by an effect (e.g. a muzzle flash): split the tallest at its thinnest point
        i = int(np.argmax([b - a for a, b in rows])); a, b = rows[i]; q = (b - a) // 4
        cut = a + q + int(np.argmin(prof[a + q:b - q]))
        rows[i:i + 1] = [[a, cut], [cut + 1, b]]
    if len(rows) != nrows or len(cols) != COLS:
        print(f'  warning: found {len(rows)} rows / {len(cols)} columns');
    # cell bounds: halfway into the gaps
    def bounds(rs, limit):
        out = []
        for i, (a, b) in enumerate(rs):
            lo = 0 if i == 0 else (rs[i - 1][1] + a) // 2
            hi = limit if i == len(rs) - 1 else (b + rs[i + 1][0]) // 2
            out.append((lo, hi))
        return out
    rb, cb = bounds(rows, H), bounds(cols, W)
    frames = {}
    for ri, (ya, yb) in enumerate(rb):
        for ci, (xa, xb) in enumerate(cb):
            # fixed-pitch sheets: look a bit into the neighbours (effects like slash arcs spill over),
            # but only keep pieces whose centre is inside this column
            pad = int(col_pitch * .3) if col_pitch else 0
            core0, core1 = xa, xb; xa, xb = max(0, xa - pad), min(W, xb + pad)
            cell = fg[ya:yb, xa:xb]
            lab, n = ndimage.label(cell, structure=np.ones((3, 3)))
            if n == 0: continue
            sizes = ndimage.sum(cell, lab, range(1, n + 1)); boxes = ndimage.find_objects(lab)
            inside = [core0 <= xa + (bx[1].start + bx[1].stop) / 2 < core1 and (not row_pitch or bx[0].stop - bx[0].start > 6 and (bx[0].start + bx[0].stop) / 2 > 4) for bx in boxes]
            if pad or row_pitch: sizes = np.where(inside, sizes, 0)
            main = int(np.argmax(sizes)); mb = boxes[main]; keep = [main + 1]
            for i in range(n):
                if i == main or sizes[i] < 12: continue
                bx = boxes[i]
                if row_pitch and (bx[0].start == 0 or bx[0].stop >= cell.shape[0]): continue   # a blade poking in from the row above/below
                d = max(mb[1].start - bx[1].stop, 0, bx[1].start - mb[1].stop) + max(mb[0].start - bx[0].stop, 0, bx[0].start - mb[0].stop)
                if d < 45: keep.append(i + 1)
            m = np.isin(lab, keep); ys, xs = np.where(m)
            y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
            sub = m[y0:y1, x0:x1]; rgb = src[ya + y0:ya + y1, xa + x0:xa + x1].copy()
            bg_ = ~sub
            edge = sub & (np.roll(bg_, 1, 0) | np.roll(bg_, -1, 0) | np.roll(bg_, 1, 1) | np.roll(bg_, -1, 1))
            pink = edge & (rgb[..., 0] > rgb[..., 1] + 40) & (rgb[..., 2] > rgb[..., 1] + 40)
            rgb[pink] = (rgb[pink] * 0.35).astype(int)
            rgba = np.zeros(sub.shape + (4,), np.uint8); rgba[..., :3] = np.clip(rgb, 0, 255); rgba[..., 3] = sub * 255
            mainmask = lab[y0:y1, x0:x1] == main + 1
            colh = mainmask.sum(0); body = np.where(colh >= colh.max() * 0.5)[0]
            bc = (body.min() + body.max()) / 2
            feet = np.where(mainmask[:, body.min():body.max() + 1].any(1))[0].max() + 1   # bottom of the body columns
            top = np.where(mainmask[:, body.min():body.max() + 1].any(1))[0].min()
            frames[(ri, ci)] = (Image.fromarray(rgba), bc, feet, feet - top)
    return frames, nrows

def place(sheet, img, bc, feet, scale, row, col, flip=False):
    if flip: img = img.transpose(Image.FLIP_LEFT_RIGHT); bc = img.width - bc
    sw, sh = max(1, round(img.width * scale)), max(1, round(img.height * scale))
    small = img.resize((sw, sh), Image.LANCZOS)
    arr = np.array(small); al = arr[..., 3] > 110; arr[..., 3] = al * 255
    ring = np.zeros_like(al); ring[1:] |= al[:-1]; ring[:-1] |= al[1:]; ring[:, 1:] |= al[:, :-1]; ring[:, :-1] |= al[:, 1:]; ring &= ~al
    arr[ring] = (14, 10, 12, 255)
    small = Image.fromarray(arr)
    x = col * CELL_W + ANCHOR_X - round(bc * scale); y = row * CELL_H + FEET_Y - round(feet * scale)
    cx, cy = col * CELL_W, row * CELL_H
    x2, y2 = max(cx, min(x, cx + CELL_W - sw)), max(cy, min(y, cy + CELL_H - sh))
    if (x2, y2) != (x, y) and (sw > CELL_W or sh > CELL_H or abs(x2 - x) > 2 or abs(y2 - y) > 2):
        print(f'    note: frame row {row % 8} col {col} nudged {x2 - x},{y2 - y} to fit ({sw}x{sh})')
    sheet.alpha_composite(small.crop((0, 0, min(sw, CELL_W), min(sh, CELL_H))), (x2, y2))

if __name__ == '__main__':
    cls = sys.argv[1]
    specs = [a.split('=', 1) for a in sys.argv[2:]]
    sheet = Image.new('RGBA', (CELL_W * COLS, CELL_H * 8 * len(specs)), (0, 0, 0, 0))
    names = []
    for bi, (name, spec) in enumerate(specs):
        spec, _, pitch = spec.partition('%')   # "%175": columns are evenly spaced every 175px (effects bridge the gaps); "%219x150": rows too
        pitch, _, rpitch = pitch.partition('x')
        spec, _, order = spec.partition('@')   # "@U": rows on the sheet go U,UR,R,DR,D,DL,L,UL (instead of D,DR,R,UR,U,UL,L,DL)
        path, _, box = spec.partition('#')
        full = np.array(Image.open(path).convert('RGB')).astype(int)
        if box: x0, y0, x1, y1 = map(int, box.split(',')); full = full[y0:y1, x0:x1]
        frames, nrows = cut_sheet(full, None, int(pitch) if pitch else None, float(rpitch) if rpitch else None)
        idle_h = np.median([frames[(r, 0)][3] for r in range(nrows) if (r, 0) in frames])
        scale = TARGET_H / idle_h
        remap = [4, 3, 2, 1, 0, 7, 6, 5] if order == 'U' else list(range(8))
        for (r, c), (img, bc, feet, _) in frames.items():
            place(sheet, img, bc, feet, scale, bi * 8 + remap[r], c)
        if nrows == 5:
            for r, src_r in MIRROR_OF.items():
                for c in range(COLS):
                    if (src_r, c) in frames:
                        img, bc, feet, _ = frames[(src_r, c)]
                        place(sheet, img, bc, feet, scale, bi * 8 + r, c, flip=True)
        names.append(name)
        print(f'  {name}: {nrows} rows{" (left side mirrored)" if nrows == 5 else ""}, scale {scale:.3f}')
    sheet.save(os.path.join(out_dir, cls + '.png'))
    meta_path = os.path.join(out_dir, 'dir8.json')
    meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
    meta[cls] = {'cellW': CELL_W, 'cellH': CELL_H, 'anchorX': ANCHOR_X, 'feetY': FEET_Y, 'blocks': names, 'rows': ROW_NAMES,
                 'cols': ['idle', 'walk1', 'walk2', 'walk3', 'attack1/windup', 'attack2/hit']}
    json.dump(meta, open(meta_path, 'w'), indent=1)
    print(f'{cls}: blocks {names} -> client/assets/sprites/dir8/{cls}.png')
