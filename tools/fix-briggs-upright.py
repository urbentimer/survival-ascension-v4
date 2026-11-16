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
# (Nov 16, user: "why is it a different shade") ChatGPT's new frames came back warmer / redder (reddish-brown trousers and vest, a brown cap)
# than his original sheet (dark grey-brown trousers, near-black vest and cap). So the new frames are recoloured to his own palette: in Lab,
# each group is matched to the same group in the old sheet's back views (UP + UP-LEFT rows): SKIN (peach: mean / spread) and CLOTHES /
# gear (everything else: each channel's whole distribution, quantile matching, so the reddish trousers / brown cap land on his own tones); the bright accents (orange headphones, hazard stripes, glowing knuckles, muzzle flash: chroma > ACC) and the
# dark outline are left as they are.
ACC = 62   # (headphones / hazard stripes / glowing knuckles / muzzle flash are 65+)
def srgb2lab(rgb):
    c = rgb / 255.0; c = np.where(c > .04045, ((c + .055) / 1.055) ** 2.4, c / 12.92)
    M = np.array([[.4124, .3576, .1805], [.2126, .7152, .0722], [.0193, .1192, .9505]]); xyz = c @ M.T / np.array([.95047, 1., 1.08883])
    f = np.where(xyz > .008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)
def lab2srgb(lab):
    fy = (lab[..., 0] + 16) / 116; fx = fy + lab[..., 1] / 500; fz = fy - lab[..., 2] / 200; f = np.stack([fx, fy, fz], -1)
    xyz = np.where(f > .2069, f ** 3, (f - 16 / 116) / 7.787) * np.array([.95047, 1., 1.08883])
    M = np.array([[3.2406, -1.5372, -.4986], [-.9689, 1.8758, .0415], [.0557, -.2040, 1.0570]]); c = xyz @ M.T
    c = np.where(c > .0031308, 1.055 * np.clip(c, 0, None) ** (1 / 2.4) - .055, 12.92 * c); return np.clip(c * 255, 0, 255)
def groups(lab):   # 0 = outline (leave), 1 = skin, 2 = clothes / gear, 3 = bright accent (leave)
    L, A, B = lab[..., 0], lab[..., 1], lab[..., 2]; chroma = np.hypot(A, B); hue = np.degrees(np.arctan2(B, A)); g = np.full(L.shape, 2)
    g[(L > 45) & (chroma > 24) & (chroma <= ACC) & (hue > 25) & (hue < 70)] = 1   # skin: warm, light (ChatGPT's skin is more saturated: up to ~58)
    g[chroma > ACC] = 3; g[L < 12] = 0; return g
Q = np.linspace(0, 100, 101)
def palette_stats(imgs):   # per group: mean / spread (skin) and the full distribution, 101 percentiles per Lab channel (clothes)
    px = np.concatenate([np.array(i.convert('RGBA')).reshape(-1, 4) for i in imgs]); px = px[px[:, 3] > 200][:, :3].astype(float); lab = srgb2lab(px); g = groups(lab)
    return {k: (lab[g == k].mean(0), lab[g == k].std(0) + 1e-3, np.percentile(lab[g == k], Q, axis=0)) for k in (1, 2)}
def recolour(img, new_st, old_st):
    a = np.array(img.convert('RGBA')).astype(float); lab = srgb2lab(a[..., :3]); g = groups(lab); out = lab.copy()
    mn, sn, _ = new_st[1]; mo, so, _ = old_st[1]; m = g == 1; out[m] = (lab[m] - mn) * np.clip(so / sn, .6, 1.25) + mo   # skin: mean / spread
    m = g == 2; qn, qo = new_st[2][2], old_st[2][2]   # clothes / gear: each Lab channel's distribution mapped onto the old one (quantile matching)
    for ch in range(3): out[m, ch] = np.interp(lab[m, ch], qn[:, ch], qo[:, ch])
    a[..., :3] = lab2srgb(out); return Image.fromarray(a.astype(np.uint8), 'RGBA')
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
    old_st = palette_stats([of[(r, c)][0] for r in (4, 5) for c in range(4)]); new_st = palette_stats([nf[(k // 3, k % 3)][0] for k in range(4)])
    for k in range(6): img, bc, feet, hh = nf[(k // 3, k % 3)]; nf[(k // 3, k % 3)] = (recolour(img, new_st, old_st), bc, feet, hh)
    print(f'  {block} recolour: skin L/a/b {new_st[1][0].round(1)} -> {old_st[1][0].round(1)}; clothes {new_st[2][0].round(1)} -> {old_st[2][0].round(1)}')
    for r in (3, 5):   # clear both rows
        sheet.paste((0, 0, 0, 0), (0, (b * 8 + r) * ch, 6 * cw, (b * 8 + r + 1) * ch))
    for k in range(6):
        img, bc, feet, _ = nf[(k // 3, k % 3)]
        img = img.resize((round(img.width * WIDEN), img.height), Image.LANCZOS); bc *= WIDEN
        ed.place(sheet, img, bc, feet, scale, b * 8 + 3, k)
        ed.place(sheet, img, bc, feet, scale, b * 8 + 5, k, flip=True)
    print(f'{block}: UP-RIGHT = the new art, UP-LEFT = mirrored; widened x{WIDEN}, standing height {ref:.1f}px (scale {scale:.3f})')
sheet.save(path, lossless=True, quality=100, method=6)
