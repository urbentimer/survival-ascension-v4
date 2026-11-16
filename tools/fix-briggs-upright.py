# Briggs's TOP-RIGHT / TOP-LEFT (Nov 16): the user's new UP-RIGHT art replaces those rows for the shotgun and the gauntlets.
#   python3 tools/fix-briggs-upright.py   (run by tools/cut-briggs.sh after fix-briggs-slam.py)
# Sources (tools/art/briggs/upright): shotgun-upright.png, gauntlets-upright.png: 2 x 3 = 6 frames (512px cells) of ONE direction, UP-RIGHT
# (a 3/4 back view walking away to the top-right): 1 idle, 2-4 run / guard-walk, 5 fire / jab, 6 pump / haymaker = the atlas's 6 columns.
# - UP-RIGHT (row 3) = these frames, UP-LEFT (row 5) = the same frames mirrored (both sides match). Knife / bat / axe keep the Nov 16
#   "UP-RIGHT = UP-LEFT mirrored" from fix-briggs-slam.py.
# - ChatGPT drew him slimmer than in his other back views (hips 8-13% narrower with the shotgun, shoulders ~8% with the gauntlets; user: "feels
#   like chatgpt made him thinner"): every frame is widened by WIDEN before it's placed.
# - Sized like the rest of the block: his standing height here = the old UP-LEFT standing height in the atlas (extract-directions sizes a
#   block by its median standing height, SPRITE_H 62). One resize from the big art (no double resampling), the same SHARPEN + dark edge ring.
import os, sys, json
import numpy as np
from PIL import Image
from scipy import ndimage
os.environ.setdefault('SPRITE_H', '62'); os.environ.setdefault('SHARPEN', '140')
here = os.path.dirname(os.path.abspath(__file__)); sys.argv = sys.argv[:1]
import importlib.util
spec = importlib.util.spec_from_file_location('ed', os.path.join(here, 'extract-directions.py')); ed = importlib.util.module_from_spec(spec); spec.loader.exec_module(ed)
d8 = os.path.join(here, '..', 'client', 'assets', 'sprites', 'dir8'); ART = os.path.join(here, 'art', 'briggs')
meta = json.load(open(os.path.join(d8, 'dir8.json')))['juggernaut']; cw, ch = meta['cellW'], meta['cellH']
WIDEN = 1.12
JOBS = [('shotgun', 'upright/shotgun-upright.png', 'shotgun.png', (218, 149.875)), ('fists', 'upright/gauntlets-upright.png', 'fists/gauntlets.png', (181, 181))]
path = os.path.join(d8, 'juggernaut.webp'); sheet = Image.open(path).convert('RGBA')
for block, new, old, pitch in JOBS:
    b = meta['blocks'].index(block)
    of, _ = ed.cut_sheet(np.array(Image.open(os.path.join(ART, old)).convert('RGB')).astype(int), None, pitch[0], pitch[1], False)
    old_h = [of[(r, 0)][3] for r in range(8)]; ref = ed.TARGET_H * old_h[5] / np.median(old_h)   # the old UP-LEFT standing height in the atlas
    src = np.array(Image.open(os.path.join(ART, new)).convert('RGB')).astype(int); H, W = src.shape[:2]
    nf = {}
    for k in range(6):   # each frame: its own cell (the 3 x 2 grid), the biggest piece + anything within 45px (muzzle flash, smoke)
        y0, y1, x0, x1 = (k // 3) * H // 2, (k // 3 + 1) * H // 2, (k % 3) * W // 3, (k % 3 + 1) * W // 3; c = src[y0:y1, x0:x1]
        r_, g_, b_ = c[..., 0], c[..., 1], c[..., 2]; fg = ~((r_ - g_ > 60) & (b_ - g_ > 60) & (np.abs(r_ - b_) < 90)); fg = ndimage.binary_opening(fg, iterations=1)
        lab, n = ndimage.label(fg); sz = ndimage.sum(fg, lab, range(1, n + 1)); main = int(np.argmax(sz)); boxes = ndimage.find_objects(lab); mb = boxes[main]; keep = [main + 1]
        for i in range(n):
            if i == main or sz[i] < 12: continue
            bx = boxes[i]; dd = max(mb[1].start - bx[1].stop, 0, bx[1].start - mb[1].stop) + max(mb[0].start - bx[0].stop, 0, bx[0].start - mb[0].stop)
            if dd < 45: keep.append(i + 1)
        m = np.isin(lab, keep); ys, xs = np.where(m); fy0, fy1, fx0, fx1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        sub = m[fy0:fy1, fx0:fx1]; rgb = c[fy0:fy1, fx0:fx1].copy(); bg_ = ~sub
        edge = sub & (np.roll(bg_, 1, 0) | np.roll(bg_, -1, 0) | np.roll(bg_, 1, 1) | np.roll(bg_, -1, 1))
        pink = edge & (rgb[..., 0] > rgb[..., 1] + 40) & (rgb[..., 2] > rgb[..., 1] + 40); rgb[pink] = (rgb[pink] * .35).astype(int)   # (like extract-directions)
        rgba = np.zeros(sub.shape + (4,), np.uint8); rgba[..., :3] = np.clip(rgb, 0, 255); rgba[..., 3] = sub * 255
        mm = lab[fy0:fy1, fx0:fx1] == main + 1; colh = mm.sum(0); body = np.where(colh >= colh.max() * .5)[0]; rows_ = np.where(mm[:, body.min():body.max() + 1].any(1))[0]
        nf[(k // 3, k % 3)] = (Image.fromarray(rgba), (body.min() + body.max()) / 2, rows_.max() + 1, rows_.max() + 1 - rows_.min())
    scale = ref / nf[(0, 0)][3]
    for r in (3, 5):   # clear both rows
        sheet.paste((0, 0, 0, 0), (0, (b * 8 + r) * ch, 6 * cw, (b * 8 + r + 1) * ch))
    for k in range(6):
        img, bc, feet, _ = nf[(k // 3, k % 3)]
        img = img.resize((round(img.width * WIDEN), img.height), Image.LANCZOS); bc *= WIDEN
        ed.place(sheet, img, bc, feet, scale, b * 8 + 3, k)
        ed.place(sheet, img, bc, feet, scale, b * 8 + 5, k, flip=True)
    print(f'{block}: UP-RIGHT = the new art, UP-LEFT = mirrored; widened x{WIDEN}, standing height {ref:.1f}px (scale {scale:.3f})')
sheet.save(path, lossless=True, quality=100, method=6)
