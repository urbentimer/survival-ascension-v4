# Briggs's DEFLECT shockwave (Nov 13, v2): the user's fiery ring GIF -> client/assets/sprites/fx/briggs-shock.webp
#   python3 tools/extract-briggs-shock.py
# Source: tools/art/briggs/shock/shockwave-fire.gif (8 frames x 110ms, 439 x 439, realistic fire on BLACK: the ring blazes, burns down to glowing
# cracks, smoke drifts off). (The earlier cartoon ring sheet, shockwave-sheet.png, was replaced by this one; its cutter is in git history.)
# Black background -> the game draws it ADDITIVELY ("lighter"): black adds nothing, the fire glows over the ground. So no alpha here:
# - black lifted to exactly 0 (the GIF's near-black noise would show as a faint square), the frame's edges faded out (flames and smoke touch them)
# - every frame kept where it is (one animation in place: the ring itself grows a little, 168 -> 191px), at the GIF's own size (UP 1)
# Atlas: 4 x 2 frames, RGB.
import os
import numpy as np
from PIL import Image, ImageSequence, ImageFilter
here = os.path.dirname(os.path.abspath(__file__)); SRC = os.path.join(here, 'art', 'briggs', 'shock', 'shockwave-fire.gif'); A = os.path.join(here, '..', 'client', 'assets')
UP = 1.0   # (Nov 13, user: "use the gif as it is": 1:1, drawn at its own size round Briggs)
g = Image.open(SRC); frames = [np.array(f.convert('RGB')).astype(np.float32) for f in ImageSequence.Iterator(g)]
H, W = frames[0].shape[:2]; CX, CY = 222, 218   # the ring's centre (from its hot pixels, frames 0-2)
yy, xx = np.mgrid[0:H, 0:W]; d = np.maximum(np.abs(xx - CX) / (W / 2), np.abs(yy - CY) / (H / 2)); dr = np.hypot((xx - CX) / (W / 2), (yy - CY) / (H / 2))
fade = np.clip((1 - np.maximum(d, dr * .8)) / .1, 0, 1)   # out to 0 right at the frame's edge (no hard square edge where flames touch it)
cw, ch = round(W * UP), round(H * UP); atlas = Image.new('RGB', (cw * 4, ch * 2))
for i, f in enumerate(frames):
    f = np.clip((f - 7) * 255 / 248, 0, 255) * fade[..., None]
    im = Image.fromarray(f.astype(np.uint8)); im = im if UP == 1 else im.resize((cw, ch), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=2.0, percent=85, threshold=3))
    atlas.paste(im, ((i % 4) * cw, (i // 4) * ch))
atlas.save(os.path.join(A, 'sprites', 'fx', 'briggs-shock.webp'), quality=95, method=6)
print('shock atlas', atlas.size, 'cell', cw, ch, 'ring centre in the cell', CX * UP, CY * UP, 'ring middle x radius', 168 * UP, '->', 191 * UP, '(frame 0 -> 4)')
