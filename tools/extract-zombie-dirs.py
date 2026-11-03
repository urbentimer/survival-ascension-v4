# Cuts an 8-direction zombie sheet (8 rows x 6 run/walk frames, magenta background) into
#   client/assets/sprites/zombies/dir8/<kind>.png   (rows: down, downRight, right, upRight, up, upLeft, left, downLeft)
# Usage: python3 tools/extract-zombie-dirs.py <kind> <sheet>[#x0,y0,x1,y1] [rows=U,UR,R,DR,D,DL,L,UL] [height=57] [cellw=100 cellh=84]
#   brute (50% bigger): height=99 cellw=150 cellh=124
#   rows = the order of the rows on the sheet (top to bottom); the crop skips labels on the left.
#   e.g.  python3 tools/extract-zombie-dirs.py runner tools/art/zombie-runner-dir8.png#140,0,1536,1024
import sys, os, json, importlib.util
import numpy as np
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('xd', os.path.join(here, 'extract-directions.py'))
xd = importlib.util.module_from_spec(spec); spec.loader.exec_module(xd)

kind, sheet = sys.argv[1], sys.argv[2]
opts = dict(a.split('=', 1) for a in sys.argv[3:])
order = opts.get('rows', 'U,UR,R,DR,D,DL,L,UL').split(',')
STD = {'D': 0, 'DR': 1, 'R': 2, 'UR': 3, 'U': 4, 'UL': 5, 'L': 6, 'DL': 7}
TARGET_H = int(opts.get('height', 57))            # body height in game pixels (the old side-view runner is 57)
CELL_W, CELL_H = int(opts.get('cellw', 100)), int(opts.get('cellh', 84))   # bigger zombies need bigger cells
ANCHOR_X, FEET_Y = CELL_W // 2, CELL_H - 6
xd.CELL_W, xd.CELL_H, xd.ANCHOR_X, xd.FEET_Y = CELL_W, CELL_H, ANCHOR_X, FEET_Y
NCOLS = int(opts.get('cols', 6)); xd.COLS = NCOLS        # frames per row (spitter sheet has 8)

path, _, box = sheet.partition('#')
full = np.array(Image.open(path).convert('RGB')).astype(int)
if box: x0, y0, x1, y1 = map(int, box.split(',')); full = full[y0:y1, x0:x1]

frames, nrows = xd.cut_sheet(full, 8, int(opts['pitch']) if 'pitch' in opts else None)   # pitch: fixed column spacing for evenly spaced sheets
assert nrows == 8, f'expected 8 rows, found {nrows}'
ref = [int(opts['refcol'])] if 'refcol' in opts else range(NCOLS)    # which column(s) set the size (refcol=0: the standing frame)
scale = TARGET_H / np.median([frames[(r, c)][3] for r in range(8) for c in ref if (r, c) in frames])
out = Image.new('RGBA', (CELL_W * NCOLS, CELL_H * 8), (0, 0, 0, 0))
for (r, c), (img, bc, feet, _) in frames.items():
    xd.place(out, img, bc, feet, scale, STD[order[r]], c)
d = os.path.join(here, '..', 'client', 'assets', 'sprites', 'zombies', 'dir8'); os.makedirs(d, exist_ok=True)
kind = opts.get('name', kind)
if opts.get('dedust'):   # dust / sparks tinted pink by the magenta background -> dusty grey-tan and warm white sparks
    arr = np.array(out).astype(int); r, g, b, al = arr[..., 0], arr[..., 1], arr[..., 2], arr[..., 3]
    pink = (al > 0) & (r - g > 22) & (b - g > 22)
    v = arr[..., :3][pink].mean(1)
    bright = v > 190
    col = np.stack([v * 1.0, v * 0.9, v * 0.76], 1); col[bright] = np.stack([np.full(bright.sum(), 255), np.full(bright.sum(), 236), np.full(bright.sum(), 190)], 1)
    arr[..., :3][pink] = col.astype(int)
    out = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
out.save(os.path.join(d, kind + '.png'))
meta_p = os.path.join(d, 'dir8.json'); meta = json.load(open(meta_p)) if os.path.exists(meta_p) else {}
meta[kind] = {'cellW': CELL_W, 'cellH': CELL_H, 'anchorX': ANCHOR_X, 'feetY': FEET_Y, 'rows': ['down', 'downRight', 'right', 'upRight', 'up', 'upLeft', 'left', 'downLeft'], 'frames': NCOLS}
json.dump(meta, open(meta_p, 'w'), indent=1)
print(f'{kind}: 8 directions x {NCOLS} frames, scale {scale:.3f} -> client/assets/sprites/zombies/dir8/{kind}.png')
