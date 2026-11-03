# Cuts Arshan the Slasher's effects, skill cards, portrait and chain-axe icon (his body sheets go through extract-directions.py).
#   python3 tools/extract-arshan.py tools/art/arshan
# Writes sprites/fx/arshan-fx.png: 4 columns x 3 rows of 96x48 cells (row 0 hook axe flying RIGHT, pivot = cell centre;
# row 1 chain segment, tile it along the chain; row 2 metal hit spark), icons/card-reapersReach.png, card-crimsonCyclone.png,
# icons/chainaxe.png and portraits/slasher.webp.
import sys, os
import numpy as np
from PIL import Image
from scipy import ndimage
root = sys.argv[1] if len(sys.argv) > 1 else 'tools/art/arshan'
here = os.path.dirname(os.path.abspath(__file__)); A = os.path.join(here, '..', 'client', 'assets')
CW, CH = 96, 48

def keyed(path):
    rgb = np.array(Image.open(os.path.join(root, path)).convert('RGB')).astype(int)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    bg = (r > 200) & (b > 200) & (g < 90)
    soft = (r > 120) & (b > 120) & (g < 140) & (abs(r - b) < 60)
    for _ in range(2): bg = bg | (ndimage.binary_dilation(bg) & soft)
    return np.dstack([np.clip(rgb, 0, 255).astype(np.uint8), (~bg).astype(np.uint8) * 255])

def frames(path, n=4):
    a = keyed(path); W = a.shape[1]; out = []
    lab, k = ndimage.label(a[..., 3] > 0, np.ones((3, 3))); groups = [[] for _ in range(n)]
    for i, sl in enumerate(ndimage.find_objects(lab)):
        if (lab[sl] == i + 1).sum() < 15: continue
        groups[min(n - 1, int(((sl[1].start + sl[1].stop) / 2) // (W / n)))].append(i + 1)
    for g in groups:
        m = np.isin(lab, g); ys, xs = np.where(m); part = a.copy(); part[~m, 3] = 0
        out.append(Image.fromarray(part).crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)))
    return out

atlas = Image.new('RGBA', (CW * 4, CH * 3))
for row, (name, width) in enumerate([('effects/hook-axe.png', 46), ('effects/chain-link.png', 40), ('effects/hook-impact.png', 34)]):
    fr = frames(name); sc = width / max(f.width for f in fr)
    for c, f in enumerate(fr):
        f = f.resize((max(1, round(f.width * sc)), max(1, round(f.height * sc))), Image.LANCZOS)
        atlas.alpha_composite(f, (c * CW + (CW - f.width) // 2, row * CH + (CH - f.height) // 2))
p = os.path.join(A, 'sprites', 'fx', 'arshan-fx.png'); atlas.save(p)
Image.open(p).quantize(256, method=Image.FASTOCTREE, dither=Image.NONE).save(p, optimize=True)

hook = frames('effects/hook-axe.png')[0]   # hotbar icon: the axe head on its chain
hook.thumbnail((120, 120), Image.LANCZOS); ic = Image.new('RGBA', (128, 128)); ic.alpha_composite(hook, ((128 - hook.width) // 2, (128 - hook.height) // 2))
ic.save(os.path.join(A, 'icons', 'chainaxe.png'))

for src, name in [('card-E.png', 'reapersReach'), ('card-Q.png', 'crimsonCyclone')]:
    Image.open(os.path.join(root, 'skill-cards', src)).convert('RGBA').resize((152, 152), Image.LANCZOS).save(os.path.join(A, 'icons', f'card-{name}.png'))

src = Image.open(os.path.join(root, 'reference', 'portrait.png')).convert('RGB'); arr = np.array(src).astype(int)
dark = arr.max(2) < 28; lab, _ = ndimage.label(dark); edge_ids = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
bgm = np.isin(lab, list(edge_ids)); H, W = bgm.shape; yy, xx = np.mgrid[0:H, 0:W]
glow = np.clip(1 - np.hypot((xx - W * .5) / (W * .7), (yy - H * .12) / (H * .35)), 0, 1)
rng = np.random.default_rng(5); streak = ndimage.gaussian_filter(rng.random((H // 8, W // 8)), 2); streak = np.kron(streak, np.ones((8, 8)))[:H, :W]
back = np.dstack([18 + 110 * glow * (.6 + .8 * streak), 8 + 12 * glow, 10 + 12 * glow]); arr[bgm] = back[bgm].astype(int)
Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).crop((150, 20, 150 + 720, 20 + 485)).resize((264, 178), Image.LANCZOS).save(os.path.join(A, 'portraits', 'slasher.webp'), quality=92)
print('arshan fx, cards, icon, portrait done')
