# Cuts the hook-deflect effects (the Butcher's stagger uses extract-zombie-dirs.py):
#   fx/hook-break.png     6 frames: the meat hook snapping (drawn pointing right; the game rotates it)
#   fx/deflect-burst.png  6 frames: clash flash + shockwave ring
#   fx/deflected.png      2 frames: the "DEFLECTED!" word (normal, big/bright for the pop)
# Usage: python3 tools/extract-deflect.py
import os, importlib.util
import numpy as np
from PIL import Image
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('xd', os.path.join(here, 'extract-directions.py'))
xd = importlib.util.module_from_spec(spec); spec.loader.exec_module(xd)
FX = os.path.join(here, '..', 'client', 'assets', 'sprites', 'fx')

def load(n): return np.array(Image.open(os.path.join(here, 'art', n + '.png')).convert('RGB')).astype(int)

def cut(src, recolor):
    fg = xd.foreground(src)
    # glow blended with the magenta background: keep it, but recolour
    r, g, b = src[..., 0], src[..., 1], src[..., 2]
    glow = (r - g > 25) & (b - g > 25) & ~((r > 200) & (b > 200) & (g < 90))
    fg |= glow & (g > 60)
    lab, n = ndimage.label(fg, structure=np.ones((3, 3)))
    sizes = ndimage.sum(fg, lab, range(1, n + 1))
    m = np.isin(lab, [i + 1 for i in range(n) if sizes[i] >= 6])
    rgb = src.copy(); pink = m & (r - g > 25) & (b - g > 25)
    v = rgb[pink].max(1, keepdims=True).astype(float)
    rgb[pink] = np.clip(v * np.array(recolor), 0, 255).astype(int)
    rgba = np.zeros(src.shape[:2] + (4,), np.uint8); rgba[..., :3] = np.clip(rgb, 0, 255); rgba[..., 3] = m * 255
    # soft alpha for the recoloured glow so it blends
    rgba[..., 3][pink] = np.clip((src[pink][:, 1] - 40) * 2.2 + 90, 90, 255).astype(np.uint8)
    return rgba

def strip(name, cols, out, scale, cell, recolor, y0=0, y1=None):
    src = load(name)[y0:y1]
    full = cut(src, recolor)
    sheet = Image.new('RGBA', (cell[0] * len(cols), cell[1]))
    for i, (xa, xb) in enumerate(cols):
        part = full[:, xa:xb]; al = part[..., 3] > 0
        ys, xs = np.where(al); part = part[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        img = Image.fromarray(part)
        img = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.LANCZOS)
        sheet.alpha_composite(img, (i * cell[0] + (cell[0] - img.width) // 2, (cell[1] - img.height) // 2))
    sheet.save(os.path.join(FX, out)); print(out, sheet.size)

mid = lambda runs: [[0 if i == 0 else (runs[i - 1][1] + runs[i][0]) // 2, 99999 if i == len(runs) - 1 else (runs[i][1] + runs[i + 1][0]) // 2] for i in range(len(runs))]
strip('butcher-hookbreak', mid([[40, 345], [391, 693], [744, 1063], [1101, 1404], [1461, 1774], [1842, 2130]]), 'hook-break.png', .34, (120, 80), (1.0, .55, .45))
strip('deflect-burst', mid([[101, 210], [336, 578], [663, 942], [1003, 1399], [1445, 1775], [1832, 2113]]), 'deflect-burst.png', .42, (180, 160), (1.0, .88, .62))
strip('deflected-text', [[0, 975], [975, 2172]], 'deflected.png', .30, (370, 150), (1.0, .7, .35))
