# Face cards (ChatGPT 1254x1254 head-and-shoulders on flat magenta) -> client/assets/portraits/<class>.webp
# Every face goes on the SAME painted backdrop, centred on the head, so all the cards match.
#   python3 tools/extract-faces.py tools/art/faces
import sys, os, glob
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage
root = sys.argv[1] if len(sys.argv) > 1 else 'tools/art/faces'
here = os.path.dirname(os.path.abspath(__file__)); out = os.path.join(here, '..', 'client', 'assets', 'portraits')
S = 360   # output size (square)

def backdrop(n):   # dark charcoal with a red-orange glow behind the head and a few soft streaks
    yy, xx = np.mgrid[0:n, 0:n] / n
    glow = np.clip(1 - np.hypot((xx - .55) / .62, (yy - .32) / .55), 0, 1) ** 1.4
    rng = np.random.default_rng(11); streak = ndimage.gaussian_filter(rng.random((n // 6 + 1, n // 6 + 1)), 1.6); streak = np.kron(streak, np.ones((6, 6)))[:n, :n]
    r = 22 + 150 * glow * (.75 + .5 * streak); g = 12 + 34 * glow * (.7 + .6 * streak); b = 12 + 14 * glow
    vign = np.clip(1.15 - np.hypot(xx - .5, yy - .45) * 1.1, .35, 1)
    return np.dstack([r * vign, g * vign, b * vign, np.full((n, n), 255.)]).clip(0, 255).astype(np.uint8)

for f in sorted(glob.glob(os.path.join(root, '*.png'))):
    name = os.path.splitext(os.path.basename(f))[0]
    a = np.array(Image.open(f).convert('RGB')).astype(int); r, g, b = a[..., 0], a[..., 1], a[..., 2]; H, W = r.shape
    pink = name == 'operator'   # pink hair: key only near-exact magenta so the hair edges survive
    bg = (r > 200) & (b > 200) & (g < 70) & (abs(r - b) < 40) if pink else (r > 170) & (b > 170) & (g < 110) & (abs(r - b) < 70)
    lab, _ = ndimage.label(bg); edge = set(np.unique(np.concatenate([lab[0], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(edge)) | ((r > 205) & (b > 205) & (g < 85) & (abs(r - b) < 45))
    soft = (r > 150) & (b > 150) & (g < 95) & (abs(r - b) < 45) if pink else (r > 110) & (b > 110) & (g < 150) & (abs(r - b) < 90)
    for _ in range(3): bg |= ndimage.binary_dilation(bg) & soft
    near = ndimage.binary_dilation(bg, iterations=3) & ~bg; spill = np.clip(np.minimum(r, b) - g, 0, None)
    for c in (0, 2): a[..., c][near] -= (spill[near] * .85).astype(int)
    alpha = np.array(Image.fromarray(np.where(bg, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(.7)))
    fig = Image.fromarray(np.dstack([np.clip(a, 0, 255).astype(np.uint8), alpha]))
    # centre on the head: middle of the silhouette in its top 40%
    fg = alpha > 128; rows = np.where(fg.any(1))[0]; top = rows[0]
    band = fg[top:top + int(H * .4)]; xs = np.where(band)[1]; hx = int(xs.mean())
    side = int(H * .9); x0 = hx - side // 2; y0 = max(0, top - int(side * .07))
    canvas = Image.new('RGBA', (side, side)); canvas.alpha_composite(fig.crop((max(0, x0), y0, min(W, x0 + side), min(H, y0 + side))), (max(0, -x0), 0))
    card = Image.fromarray(backdrop(side)); card.alpha_composite(canvas)
    card.convert('RGB').resize((S, S), Image.LANCZOS).save(os.path.join(out, f'{name}.webp'), quality=86, method=6)
    print(name, 'head x', hx, '->', os.path.getsize(os.path.join(out, f'{name}.webp')) // 1024, 'KB')
