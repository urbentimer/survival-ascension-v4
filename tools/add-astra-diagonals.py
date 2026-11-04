# Puts Astra's proper up-right / up-left RIFLE frames (ChatGPT, Nov 4) into his 8-direction atlas:
#   python3 tools/add-astra-diagonals.py            (after extract-directions.py dispatcher ..., which writes the atlas)
# Sources: tools/art/astra2/rifle-up-right.png and rifle-up-left.png, each 4 rows x 6 frames on magenta
# (idle, walk 1-3, aim, fire); row 1 of each is used. They replace rows 3 (up-right) and 5 (up-left) of the gun block (block 0).
# Each frame is scaled like his other frames (same height), feet on the same line, head at the same x as his "up" frame.
import os
import numpy as np
from PIL import Image
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__)); ART = os.path.join(here, 'art', 'astra2')
ATLAS = os.path.join(here, '..', 'client', 'assets', 'sprites', 'dir8', 'dispatcher.png')
W, H, FEET = 112, 88, 79

def keyed(path):   # magenta (and its darker drop shadow) -> transparent
    a = np.array(Image.open(path).convert('RGB')).astype(int); r, g, b = a[..., 0], a[..., 1], a[..., 2]
    bg = (r - g > 70) & (b - g > 70) & (abs(r - b) < 70)
    soft = (r - g > 35) & (b - g > 35) & (abs(r - b) < 80)
    for _ in range(2): bg |= ndimage.binary_dilation(bg) & soft
    lab, n = ndimage.label(~bg); sizes = ndimage.sum(~bg, lab, range(1, n + 1))
    keep = np.isin(lab, [i + 1 for i in range(n) if sizes[i] > 40])   # drop specks
    return np.dstack([np.clip(a, 0, 255).astype(np.uint8), (keep * 255).astype(np.uint8)])

def head_cx(rgba, top, h):   # x centre of the top 22% (hair / head): stable while he walks and aims
    m = rgba[top:top + max(1, int(h * .22)), :, 3] > 0; xs = np.where(m.any(0))[0]
    return (xs.min() + xs.max()) / 2

atlas = np.array(Image.open(ATLAS).convert('RGBA'))
ref = atlas[4 * H:5 * H, 0:W]; rys = np.where(ref[..., 3].any(1))[0]   # his "up" idle frame
ref_h = rys.max() - rys.min() + 1; ref_cx = head_cx(ref, rys.min(), ref_h)

for src, row in [('rifle-up-right.png', 3), ('rifle-up-left.png', 5)]:
    sheet = keyed(os.path.join(ART, src)); SH, SW = sheet.shape[:2]; ph, pw = SH / 4, SW / 6
    cells = [sheet[0:round(ph), round(c * pw):round((c + 1) * pw)] for c in range(6)]
    ih = np.where(cells[0][..., 3].any(1))[0]; sc = ref_h / (ih.max() - ih.min() + 1)   # same height as his other frames
    for c, cell in enumerate(cells):
        ys, xs = np.where(cell[..., 3] > 0); crop = cell[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        im = Image.fromarray(crop).resize((max(1, round(crop.shape[1] * sc)), max(1, round(crop.shape[0] * sc))), Image.LANCZOS)
        a = np.array(im); a[..., 3] = (a[..., 3] > 110) * 255
        hx = head_cx(a, 0, a.shape[0]); x = round(ref_cx - hx); y = FEET + 1 - a.shape[0]
        out = np.zeros((H, W, 4), np.uint8); x0, y0 = max(0, x), max(0, y); x1, y1 = min(W, x + a.shape[1]), min(H, y + a.shape[0])
        out[y0:y1, x0:x1] = a[y0 - y:y1 - y, x0 - x:x1 - x]
        atlas[row * H:(row + 1) * H, c * W:(c + 1) * W] = out
    print(f'{src} -> gun block row {row}, scale {sc:.3f}')
Image.fromarray(atlas).quantize(256, method=Image.FASTOCTREE, dither=Image.NONE).save(ATLAS, optimize=True)   # 256 colours (preview size)
print('->', ATLAS, os.path.getsize(ATLAS) // 1024, 'KB')
