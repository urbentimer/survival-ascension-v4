# Raven's katana slash (user's sheet tools/art/raven-slash/slash.png: 6 rows x 8 frames of a violet energy crescent on BLACK,
# magenta grid lines). Every 2nd frame is kept (24), each cell's inside (no grid line) scaled to 128px, packed 8 x 3 on black.
# Black = nothing when drawn additively ("lighter"), so no alpha is needed.
#   python3 tools/extract-raven-slash.py   ->  client/assets/sprites/fx/raven-slash.webp
# In the cell the crescent bulges to the RIGHT (= the swing direction); its centre (Raven) is at about (0.36, 0.56) of the cell.
import os
import numpy as np
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__))
a = np.array(Image.open(os.path.join(here, 'art', 'raven-slash', 'slash.png')).convert('RGB'))
H, W = a.shape[:2]; ph, pw = H / 6, W / 8; C = 128
out = Image.new('RGB', (C * 8, C * 3))
for i, f in enumerate(range(0, 48, 2)):
    r, c = divmod(f, 8)
    cell = a[round(r * ph) + 6:round((r + 1) * ph) - 4, round(c * pw) + 6:round((c + 1) * pw) - 4].astype(int)
    mag = (cell[..., 0] > 150) & (cell[..., 2] > 150) & (cell[..., 1] < 80) & (np.abs(cell[..., 0] - cell[..., 2]) < 40)
    cell[mag] = 0                                                                   # any grid line left
    im = Image.fromarray(cell.astype(np.uint8)).resize((C, C), Image.LANCZOS)
    out.paste(im, ((i % 8) * C, (i // 8) * C))
p = os.path.join(here, '..', 'client', 'assets', 'sprites', 'fx', 'raven-slash.webp'); out.save(p, quality=80, method=6)
print('->', os.path.relpath(p), out.size, os.path.getsize(p) // 1024, 'KB')
