# Lobby splash art (ChatGPT, 1024x1536 on flat magenta) -> client/assets/hero/<class>.webp (transparent, 440x660)
# and the 1536x1024 background -> client/assets/hero/background.webp.
#   python3 tools/extract-heroes.py tools/art/hero
# Keeps sizes small: the single-file preview has to stay under 16 MB.
import sys, os, glob
import numpy as np
from PIL import Image
from scipy import ndimage
root = sys.argv[1] if len(sys.argv) > 1 else 'tools/art/hero'
here = os.path.dirname(os.path.abspath(__file__)); out = os.path.join(here, '..', 'client', 'assets', 'hero'); os.makedirs(out, exist_ok=True)
W, H = 440, 660

for f in sorted(glob.glob(os.path.join(root, '*.png'))):
    name = os.path.splitext(os.path.basename(f))[0]
    im = Image.open(f).convert('RGB')
    if name == 'background':
        im.resize((1280, 853), Image.LANCZOS).save(os.path.join(out, 'background.webp'), quality=72, method=6); continue
    a = np.array(im).astype(int); r, g, b = a[..., 0], a[..., 1], a[..., 2]
    bg = (r > 170) & (b > 170) & (g < 110) & (abs(r - b) < 70)
    lab, _ = ndimage.label(bg); edge = set(np.unique(np.concatenate([lab[0], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(edge))                                   # only magenta connected to the edges (keeps red cloth inside)
    bg |= (r > 205) & (b > 205) & (g < 85) & (abs(r - b) < 45)      # + enclosed pockets of pure magenta (gaps between arm and body, hair)
    soft = (r > 110) & (b > 110) & (g < 150) & (abs(r - b) < 90)
    for _ in range(3): bg |= ndimage.binary_dilation(bg) & soft     # pinkish anti-aliased fringe
    near = ndimage.binary_dilation(bg, iterations=3) & ~bg            # despill the outline: pull magenta out of edge pixels
    spill = np.clip(np.minimum(r, b) - g, 0, None)
    for c in (0, 2): a[..., c][near] -= (spill[near] * .85).astype(int)
    alpha = np.where(bg, 0, 255).astype(np.uint8)
    alpha = np.array(Image.fromarray(alpha).filter(__import__('PIL.ImageFilter', fromlist=['x']).GaussianBlur(.6)))
    rgba = np.dstack([np.clip(a, 0, 255).astype(np.uint8), alpha])
    Image.fromarray(rgba).resize((W, H), Image.LANCZOS).save(os.path.join(out, f'{name}.webp'), quality=82, method=6)
for f in sorted(glob.glob(os.path.join(out, '*.webp'))): print(os.path.basename(f), os.path.getsize(f) // 1024, 'KB')
