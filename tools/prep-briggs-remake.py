# Briggs REMAKE (Nov 16): the user's new Briggs (riot visor, black armour with orange panels, riot shield on his back) -> ready-to-cut art.
#   python3 tools/prep-briggs-remake.py   (first step of tools/cut-briggs.sh)
# Sources: tools/art/briggs/remake/ (design.png = the look the user picked; the rest made from it with tools/art/briggs/REMAKE-PROMPTS.md):
#   D-shotgun E-knife F-bat J-gauntlets: 5 rows x 6 cols; I-throw K-power: 5 x 4; X-slam-sequence: ONE direction, 4 x 8 frames (asked for
#   5 x 4, got a sequence: the Q cast uses 4 of its frames for every direction); B-hero (lobby), C-face; L/M/N/O cards (E / Q / R / passive).
#   5 rows = DOWN, DOWN-RIGHT, RIGHT, UP-RIGHT, UP: extract-directions.py mirrors them for the left side.
# Fixes (user: "chatgpt changed his design bit by bit"):
#  1. PINK VISOR: his visor's shine is pink / magenta, which the magenta keying would punch holes in. Pink pixels inside the art -> orange
#     (same lightness); magenta pockets that are pure background colour (gaps between legs / arms) -> exact #FF00FF so they're cut out.
#  2. COLOUR CREEP: each sheet came back a bit warmer / browner than the shotgun sheet (the darkest, closest to the design). Every other
#     sheet is matched to D in Lab: skin (mean / spread), clothes / gear (each channel's distribution); bright accents (visor, hazard
#     stripes, glowing knuckles, flashes) and the dark outline are left alone. (Same method as the Nov 16 top-right fix.)
# Writes tools/art/briggs/remake/prep/*.png, tools/art/hero/juggernaut.png, tools/art/faces/juggernaut.png, client/assets/icons/card-*.png.
import os
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__)); R = os.path.join(here, 'art', 'briggs', 'remake'); P = os.path.join(R, 'prep'); os.makedirs(P, exist_ok=True)
ICON = os.path.join(here, '..', 'client', 'assets', 'icons')
load = lambda n: np.array(Image.open(os.path.join(R, n)).convert('RGB')).astype(int)

def background(a):   # magenta-ish connected to the image's edge (the gaps between frames are too)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    m = ((r > 200) & (b > 200) & (g < 90)) | ((r > 140) & (b > 140) & (g < 130) & (np.abs(r - b) < 110))
    lab, _ = ndimage.label(m); edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    return np.isin(lab, list(edge)), m

def depink(a):
    a = a.copy(); r, g, b = a[..., 0], a[..., 1], a[..., 2]; bg, m = background(a)
    inner = m & ~bg; lab, n = ndimage.label(inner); gaps = np.zeros_like(inner); fixed = 0
    for i, sl in enumerate(ndimage.find_objects(lab)):
        reg = lab[sl] == i + 1; px = a[sl][reg]; mr, mg, mb = px.mean(0)
        if abs(mr - mb) < 22 and mg < 28: gaps[sl] |= reg   # pure background colour: a real gap
    a[gaps] = (255, 0, 255)
    near = ndimage.binary_dilation(bg | gaps, iterations=2)
    pink = ~bg & ~gaps & ~near & (r - g > 60) & (b - g > 25) & (b > 80)   # the visor's pink / magenta shine (and any pink fringe inside the art)
    rr = r[pink]; a[pink] = np.stack([rr, np.maximum(g[pink], (rr * .48).astype(int)), np.minimum(b[pink], (rr * .28).astype(int))], -1)
    return a, int(pink.sum()), int(gaps.sum())

# Lab colour matching (as in fix-briggs-upright.py, Nov 16)
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
ACC = 62; Q = np.linspace(0, 100, 101)
def groups(lab):   # 0 outline, 1 skin, 2 clothes / gear, 3 bright accent
    L, A, B = lab[..., 0], lab[..., 1], lab[..., 2]; ch = np.hypot(A, B); hue = np.degrees(np.arctan2(B, A)); g = np.full(L.shape, 2)
    g[(L > 45) & (ch > 24) & (ch <= ACC) & (hue > 25) & (hue < 70)] = 1; g[ch > ACC] = 3; g[L < 12] = 0; return g
def stats(a, fg):
    lab = srgb2lab(a[fg].astype(float)); g = groups(lab)
    return {k: (lab[g == k].mean(0), lab[g == k].std(0) + 1e-3, np.percentile(lab[g == k], Q, axis=0)) for k in (1, 2)}
def match(a, fg, ref):
    st = stats(a, fg); lab = srgb2lab(a[fg].astype(float)); g = groups(lab); out = lab.copy()
    mn, sn, _ = st[1]; mo, so, _ = ref[1]; m = g == 1; out[m] = (lab[m] - mn) * np.clip(so / sn, .6, 1.25) + mo
    m = g == 2
    for c in range(3): out[m, c] = np.interp(lab[m, c], st[2][2][:, c], ref[2][2][:, c])
    a = a.copy(); a[fg] = lab2srgb(out).astype(int); return a, st

def figure(a): bg, _ = background(a); r, g, b = a[..., 0], a[..., 1], a[..., 2]; return ~bg & ~((r == 255) & (g == 0) & (b == 255))
save = lambda a, path: Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(path)

D, n1, n2 = depink(load('D-shotgun.png')); ref = stats(D, figure(D)); save(D, os.path.join(P, 'D-shotgun.png'))
print(f'D-shotgun: {n1} pink px -> orange, {n2} gap px -> background (the colour reference)')
for name in ('E-knife', 'F-bat', 'I-throw', 'J-gauntlets', 'K-power'):
    a, n1, n2 = depink(load(name + '.png')); a, st = match(a, figure(a), ref); save(a, os.path.join(P, name + '.png'))
    print(f'{name}: {n1} pink px -> orange, {n2} gap px; clothes Lab {st[2][0].round(1)} -> {ref[2][0].round(1)}')

# the Q cast (slam block): 4 frames of the one-direction sequence (4 rows x 8 of 192 x 256), the same 4 in all 5 rows
# 0 fists raised high, 1 SLAM into the ground (cracks + sparks), 2 ROAR, 3 braced stance
seq, n1, n2 = depink(load('X-slam-sequence.png')); seq, _ = match(seq, figure(seq), ref)
pick = [(0, 7), (2, 3), (1, 1), (3, 6)]; cw, ch = 192, 256
sheet = np.zeros((5 * ch, 4 * cw, 3), int); sheet[...] = (255, 0, 255)
for row in range(5):
    for c, (sr, sc) in enumerate(pick): sheet[row * ch:(row + 1) * ch, c * cw:(c + 1) * cw] = seq[sr * ch:(sr + 1) * ch, sc * cw:(sc + 1) * cw]
save(sheet, os.path.join(P, 'H-slam.png')); print(f'H-slam: built from the sequence (frames {pick}), {n1} pink px -> orange')

# lobby art + face: the pink visor -> orange, then tools/extract-heroes.py / extract-faces.py key them as usual
for src, dst in (('B-hero.png', os.path.join('hero', 'juggernaut.png')), ('C-face.png', os.path.join('faces', 'juggernaut.png'))):
    a, n1, n2 = depink(load(src)); save(a, os.path.join(here, 'art', dst)); print(f'{src}: {n1} pink px -> orange, {n2} gap px -> tools/art/{dst}')

# skill cards (152 x 152, like every card)
for src, dst in (('L-card-boomerang.png', 'card-steelBoomerang'), ('M-card-unbreakable.png', 'card-unbreakable'), ('N-card-bareknuckle.png', 'card-bareKnuckle'), ('O-card-passive.png', 'card-forcefulBlast')):
    Image.open(os.path.join(R, src)).convert('RGB').resize((152, 152), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=1.0, percent=70, threshold=2)).save(os.path.join(ICON, dst + '.png'))
print('cards: card-steelBoomerang, card-unbreakable, card-bareKnuckle, card-forcefulBlast')
