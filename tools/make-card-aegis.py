# R skill card for Sofea's mecha (no ChatGPT card yet): reuses the Sky Reign card's frame, new picture + title.
#   python3 tools/make-card-aegis.py   NOTE: written for the first, 3x-size mecha cut (224x192 cells); the card in the repo was made from that cut
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
here = os.path.dirname(os.path.abspath(__file__)); I = os.path.join(here, '..', 'client', 'assets')
S = 4; W = 152 * S
card = Image.open(os.path.join(I, 'icons', 'card-skyReign.png')).convert('RGBA').resize((W, W), Image.LANCZOS)
# picture: dark ember sky + the mecha firing her flame jet
pic = Image.new('RGBA', (W, W)); px = np.zeros((W, W, 4), np.uint8)
yy, xx = np.mgrid[0:W, 0:W]; g = np.clip(1 - np.hypot(xx - W * .45, yy - W * .55) / (W * .62), 0, 1)
px[..., 0] = (34 + 120 * g ** 1.6).astype(np.uint8); px[..., 1] = (18 + 40 * g ** 2).astype(np.uint8); px[..., 2] = (20 + 14 * g).astype(np.uint8); px[..., 3] = 255
pic = Image.fromarray(px)
rng = np.random.default_rng(7); d = ImageDraw.Draw(pic)
for _ in range(26):   # embers
    x, y, l = rng.uniform(40, W - 40), rng.uniform(60, W * .72), rng.uniform(14, 34)
    d.line([(x, y), (x + l, y - l * .45)], fill=(255, rng.integers(120, 190), 40, 255), width=4)
mech = Image.open(os.path.join(I, 'sprites', 'dir8', 'sofea-mecha.webp')).convert('RGBA')
fr = mech.crop((4 * 224, 1 * 192, 5 * 224, 2 * 192))   # down-right, flame pose
fl = Image.open(os.path.join(I, 'sprites', 'fx', 'sofea-flame.webp')).convert('RGBA').crop((10 * 208, 0, 11 * 208, 112))
k = 2.15; fr = fr.resize((round(224 * k), round(192 * k)), Image.LANCZOS)
ox, oy = round(W * .42 - 112 * k), round(W * .74 - 186 * k)
import json; nz = json.load(open(os.path.join(I, 'sprites', 'dir8', 'sofea-mecha.json')))['nozzle'][1]
nx, ny = ox + (112 + nz[0]) * k, oy + (186 + nz[1]) * k
fk = 1.7; fls = fl.resize((round(208 * fk), round(112 * fk)), Image.LANCZOS).rotate(-8, expand=True, resample=Image.BICUBIC)
glow = fls.filter(ImageFilter.GaussianBlur(14)); pic.alpha_composite(glow, (round(nx - 14), round(ny - fls.height / 2 + 6)))
pic.alpha_composite(fls, (round(nx - 14), round(ny - fls.height / 2 + 6)))
sh = Image.new('RGBA', fr.size, (0, 0, 0, 0)); sh.putalpha(fr.getchannel('A').filter(ImageFilter.GaussianBlur(10)).point(lambda v: v * .6))
pic.alpha_composite(sh, (ox + 8, oy + 10)); pic.alpha_composite(fr, (ox, oy))
# put it inside the frame window (the dark area inside the orange border, above the title band)
mask = Image.new('L', (W, W)); md = ImageDraw.Draw(mask)
md.polygon([(178, 34), (430, 34), (500, 70), (548, 140), (566, 180), (566, 448), (42, 448), (42, 180), (60, 140), (138, 62)], fill=255)
card.paste(pic, (0, 0), mask)
d = ImageDraw.Draw(card)
d.rectangle([80, 458, 532, 530], fill=(24, 20, 22, 255))   # title band
f = ImageFont.truetype('/usr/share/fonts/truetype/google-fonts/Poppins-BoldItalic.ttf', 50)
t1, t2 = '//', 'CRIMSON AEGIS'; w1 = d.textlength(t1, font=f); w2 = d.textlength(t2, font=f); x = (W - w1 - w2) / 2
d.text((x, 458), t1, font=f, fill=(255, 140, 30)); d.text((x + w1 + 4, 458), t2, font=f, fill=(255, 255, 255))
# key badge "R"
d.polygon([(92, 70), (150, 70), (150, 118), (92, 118)], fill=(20, 18, 20, 255))
fb = ImageFont.truetype('/usr/share/fonts/truetype/google-fonts/Poppins-BoldItalic.ttf', 52)
d.text((121, 96), 'R', font=fb, fill=(255, 255, 255), anchor='mm')
out = card.resize((152, 152), Image.LANCZOS).convert('RGB')
p = os.path.join(I, 'icons', 'card-crimsonAegis.png'); out.save(p, optimize=True); print('->', p, os.path.getsize(p) // 1024, 'KB')
out.resize((608, 608), Image.NEAREST).save('/tmp/claude-0/-home-claude/bf90eec0-08de-5616-bd11-000f5b7ebf25/scratchpad/card.png')
