# SIENNA (Nov 16, the user's new chibi military sniper: silver-blue hair, cyan goggles, black tactical gear, ice-cyan sniper; prompts
# tools/art/sienna/PROMPTS.md, kit project doc claude/sienna-kit.md) -> ready-to-cut art.
#   python3 tools/prep-sienna.py   (first step of tools/cut-sienna.sh)
# Sources (tools/art/sienna, one new ChatGPT chat each, design.png = the locked design):
#   1-sniper 2-knife: 5 rows x 6 cols (229px cells); 3-throw (E grenade) 4-dash (R): 5 x 4 (280.5 x 280.4); 5-perch (Q, on the tower): 5 x 3 (512 x 204.8);
#   6-grenade-burst 7-tower 8-shatter: effects (tools/extract-sienna-fx.py); 9-hero (lobby), 10-face; card-grenade / card-decoy / card-perch /
#   card-passive (simple object cards, already on black).
# Fixes: ChatGPT drew the gun smoke as PINK (white smoke half see-through over the magenta). Unmixed: a light pinkish pixel (r, b high, g = how
# much white is in it) is solid frosty white when it is more than half white, else pure background (the cutter keys it out). The pure-magenta
# pockets inside the art (between arm and body) -> exact #FF00FF.
# Writes tools/art/sienna/prep/*.png, tools/art/hero/sniper.png, tools/art/faces/sniper.png, client/assets/icons/card-*.png (152 x 152).
import os, shutil
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__)); R = os.path.join(here, 'art', 'sienna'); P = os.path.join(R, 'prep'); os.makedirs(P, exist_ok=True)
A = os.path.join(here, '..', 'client', 'assets')
load = lambda n: np.array(Image.open(os.path.join(R, n)).convert('RGB')).astype(int)
save = lambda a, path: Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(path)
FROST = (234, 244, 255)

def fix(a):
    a = a.copy(); r, g, b = a[..., 0], a[..., 1], a[..., 2]
    m = ((r > 200) & (b > 200) & (g < 90)) | ((r > 140) & (b > 140) & (g < 130) & (np.abs(r - b) < 110))
    lab, _ = ndimage.label(m); edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(edge)); inner = m & ~bg; lab2, _ = ndimage.label(inner); gaps = np.zeros_like(inner)
    for i, sl in enumerate(ndimage.find_objects(lab2)):
        reg = lab2[sl] == i + 1; mr, mg, mb = a[sl][reg].mean(0)
        if abs(mr - mb) < 22 and mg < 28: gaps[sl] |= reg
    a[gaps] = (255, 0, 255)
    smoke = (r > 200) & (b > 200) & (np.abs(r - b) < 45) & (g >= 90) & (r - g > 30) & (b - g > 30) & ~gaps   # white over magenta: g = 255 x its share of white
    white = smoke & (g > 128); a[white] = FROST; a[smoke & ~white] = (255, 0, 255)
    return a, int(white.sum()), int(gaps.sum())

if __name__ == '__main__':
    for name in ('1-sniper', '2-knife', '3-throw', '4-dash', '5-perch'):
        a, n1, n2 = fix(load(name + '.png')); save(a, os.path.join(P, name + '.png')); print(f'{name}: {n1} smoke px -> frost white, {n2} gap px -> background')
    for src, dst in (('9-hero.png', os.path.join('hero', 'sniper.png')), ('10-face.png', os.path.join('faces', 'sniper.png'))):
        shutil.copy(os.path.join(R, src), os.path.join(here, 'art', dst)); print(f'{src} -> tools/art/{dst}')
    # cards: already on black (no magenta corners) -> 152 x 152, light sharpen
    for src, dst in (('card-grenade.png', 'card-cryoGrenade'), ('card-decoy.png', 'card-iceDecoy'), ('card-perch.png', 'card-glacierPerch'), ('card-passive.png', 'card-coldPrecision')):
        Image.open(os.path.join(R, src)).convert('RGB').resize((152, 152), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=1.0, percent=70, threshold=2)).save(os.path.join(A, 'icons', dst + '.png'))
    print('cards: card-cryoGrenade, card-iceDecoy, card-glacierPerch, card-coldPrecision')
