# VEX (Nov 17, the user's chibi toxicologist, class id "toxicologist"; prompts tools/art/vex/PROMPTS.md, kit project doc claude/vex-kit.md)
#   python3 tools/prep-vex.py   (first step of tools/cut-vex.sh)
# The 4 skill cards (already on black) -> client/assets/icons/card-*.png (152 x 152); the lobby art + face -> tools/art/hero / faces
# (tools/extract-heroes.py / extract-faces.py key them); the TOXIN DART RIFLE cut off the design sheet -> client/assets/icons/dartrifle.png
# (the hotbar icon, 64 x 64 like the other gun icons).
import os, shutil
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__)); R = os.path.join(here, 'art', 'vex'); A = os.path.join(here, '..', 'client', 'assets')
for src, dst in (('card-vial.png', 'card-toxicVial'), ('card-mist.png', 'card-antidoteMist'), ('card-pandemic.png', 'card-pandemic'), ('card-passive.png', 'card-chainReaction')):
    Image.open(os.path.join(R, src)).convert('RGB').resize((152, 152), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=1.0, percent=70, threshold=2)).save(os.path.join(A, 'icons', dst + '.png'))
for src, dst in (('9-hero.png', os.path.join('hero', 'toxicologist.png')), ('10-face.png', os.path.join('faces', 'toxicologist.png'))):
    shutil.copy(os.path.join(R, src), os.path.join(here, 'art', dst))
# the dart rifle: the top-right object on the design sheet
a = np.array(Image.open(os.path.join(R, 'design.png')).convert('RGB')).astype(int)[60:300, 1440:1884]; r, g, b = a[..., 0], a[..., 1], a[..., 2]
bg = (r > 170) & (b > 170) & (g < 110); fg = ndimage.binary_opening(~bg, iterations=1); lab, n = ndimage.label(fg)
big = 1 + int(np.argmax(ndimage.sum(fg, lab, range(1, n + 1)))); m = ndimage.binary_fill_holes(lab == big); ys, xs = np.where(m)
y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1; sub = m[y0:y1, x0:x1]; rgb = a[y0:y1, x0:x1].copy()
edge = sub & ndimage.binary_dilation(~sub, iterations=2); pink = edge & (rgb[..., 0] > rgb[..., 1] + 40) & (rgb[..., 2] > rgb[..., 1] + 40); rgb[pink] = (rgb[pink] * .3).astype(int)
mag = sub & (rgb[..., 0] > 140) & (rgb[..., 2] > 140) & (rgb[..., 1] < 120); rgb[mag] = (34, 34, 38)   # magenta showing through gaps inside the gun
im = Image.fromarray(np.dstack([np.clip(rgb, 0, 255), sub * 255]).astype(np.uint8), 'RGBA'); k = 60 / max(im.size)
im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS); c = Image.new('RGBA', (64, 64)); c.alpha_composite(im, ((64 - im.width) // 2, (64 - im.height) // 2))
c.save(os.path.join(A, 'icons', 'dartrifle.png')); print('cards, hero + face sources, icons/dartrifle.png', im.size)
