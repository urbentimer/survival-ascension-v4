# Turns light pinkish pixels (magenta reflected into white hair / highlights) back to neutral grey-white.
#   python3 tools/depink.py <atlas.png> [y0 y1]
import sys
import numpy as np
from PIL import Image
p = sys.argv[1]; a = np.array(Image.open(p).convert('RGBA')).astype(int)
y0, y1 = (int(sys.argv[2]), int(sys.argv[3])) if len(sys.argv) > 3 else (0, a.shape[0])
r, g, b = a[y0:y1, :, 0], a[y0:y1, :, 1], a[y0:y1, :, 2]
lum = (r + g + b) / 3; m = (a[y0:y1, :, 3] > 0) & (np.minimum(r, b) > g + 8) & (lum > 110) & (abs(r - b) < 45)
v = ((r + g + b) / 3 + 6)
for c in range(3): a[y0:y1, :, c][m] = np.clip(v[m] + (4 if c == 2 else 0), 0, 255)   # tiny cool tint, like the gun sheet's hair
Image.fromarray(a.astype(np.uint8)).save(p, optimize=True); print('depinked', int(m.sum()), 'px')
