# Cuts the 72 animation frames (8 survivors x idle/walk/shoot x 3) out of the ChatGPT sheet,
# removes the dark background, redraws a clean outline, and packs one sprite sheet per survivor.
import numpy as np, json, os
from PIL import Image
from collections import deque
src = np.array(Image.open(__import__('os').path.join(__import__('os').path.dirname(__file__),'art','character-sheet-source.jpg')).convert('RGB')).astype(int)
BG_LUM = 27
ORDER = ['assault','juggernaut','medic','engineer','scout','demolitionist','sniper','commander']
ROWS = [(0,70),(70,136),(136,212)]          # idle, walk, shoot  (relative to the frame strip)
COLS = [(0,90),(92,186),(188,316)]
CELL_W, CELL_H, ANCHOR_X = 128, 72, 44      # every frame placed so the body centre sits at ANCHOR_X, feet at the bottom
out_dir = '/home/claude/sa/client/assets/sprites'; os.makedirs(out_dir, exist_ok=True)
meta = {}

def is_bg(px):
    r,g,b = px; mx, mn = max(r,g,b), min(r,g,b)
    return (r*0.3+g*0.59+b*0.11) < BG_LUM and (mx-mn) < 16

def cut(cell):
    h, w, _ = cell.shape
    bg = np.zeros((h,w), bool); q = deque()
    for x in range(w):
        for y in (0, h-1): q.append((y,x))
    for y in range(h):
        for x in (0, w-1): q.append((y,x))
    while q:
        y,x = q.popleft()
        if bg[y,x] or not is_bg(cell[y,x]): continue
        bg[y,x] = True
        for dy,dx in ((1,0),(-1,0),(0,1),(0,-1)):
            ny,nx = y+dy, x+dx
            if 0<=ny<h and 0<=nx<w and not bg[ny,nx]: q.append((ny,nx))
    alpha = ~bg
    # keep only real figure parts: drop thin lines (sheet separators) and tiny specks
    seen = np.zeros_like(alpha); keep = np.zeros_like(alpha)
    for sy in range(h):
        for sx in range(w):
            if alpha[sy,sx] and not seen[sy,sx]:
                comp=[]; q2=deque([(sy,sx)]); seen[sy,sx]=True
                while q2:
                    y,x=q2.popleft(); comp.append((y,x))
                    for dy,dx in ((1,0),(-1,0),(0,1),(0,-1),(1,1),(-1,-1),(1,-1),(-1,1)):
                        ny,nx=y+dy,x+dx
                        if 0<=ny<h and 0<=nx<w and alpha[ny,nx] and not seen[ny,nx]: seen[ny,nx]=True; q2.append((ny,nx))
                ys=[p[0] for p in comp]; xs=[p[1] for p in comp]
                ch=max(ys)-min(ys)+1; cw=max(xs)-min(xs)+1
                if len(comp) >= 25 and ch > 5 and cw > 5:
                    for y,x in comp: keep[y,x]=True
    alpha = keep
    # drop specks smaller than a few pixels (JPEG noise)
    # restore near-black clothing (e.g. Briggs's trousers): in the lower half of the figure,
    # fill short vertical gaps between opaque pixels using the original art underneath
    ys_, xs_ = np.where(alpha)
    if len(ys_):
        top_, bot_ = ys_.min(), ys_.max(); mid = top_ + (bot_ - top_) * 0.45
        for x in range(w):
            col = np.where(alpha[:, x])[0]
            for a_, b_ in zip(col[:-1], col[1:]):
                if b_ - a_ > 1 and b_ - a_ <= 16 and a_ >= mid: alpha[a_:b_, x] = True
    rgba = np.zeros((h,w,4), np.uint8); rgba[...,:3] = cell; rgba[...,3] = alpha*255
    # clean outline: 1px dark ring around the figure
    ring = np.zeros_like(alpha)
    ring[1:,:] |= alpha[:-1,:]; ring[:-1,:] |= alpha[1:,:]; ring[:,1:] |= alpha[:,:-1]; ring[:,:-1] |= alpha[:,1:]
    ring &= ~alpha
    rgba[ring] = (12,10,12,255)
    return rgba, alpha | ring

for i, cls in enumerate(ORDER):
    cx, cy = (i%4)*418 + 90, (0 if i < 4 else 470) + 248
    strip = src[cy:cy+212, cx:cx+322]
    sheet = Image.new('RGBA', (CELL_W*3, CELL_H*3), (0,0,0,0))
    for r,(y0,y1) in enumerate(ROWS):
        for c,(x0,x1) in enumerate(COLS):
            rgba, a = cut(strip[y0+3:y1-3, x0:x1])
            ys, xs = np.where(a)
            if not len(ys): continue
            top, bot, left, right = ys.min(), ys.max(), xs.min(), xs.max()
            fig = rgba[top:bot+1, left:right+1]; fa = a[top:bot+1, left:right+1]
            # body centre = middle of the columns that are at least half the figure's height (ignores gun/muzzle flash)
            colh = fa.sum(0); body = np.where(colh >= colh.max()*0.5)[0]
            bc = int((body.min()+body.max())/2)
            img = Image.fromarray(fig)
            px = c*CELL_W + ANCHOR_X - bc; py = r*CELL_H + CELL_H - img.height
            sheet.alpha_composite(img, (max(c*CELL_W, px), max(r*CELL_H, py)))
    sheet.save(f'{out_dir}/{cls}.png')
    meta[cls] = {'cellW': CELL_W, 'cellH': CELL_H, 'anchorX': ANCHOR_X, 'rows': ['idle','walk','shoot'], 'frames': 3}
json.dump(meta, open(f'{out_dir}/sprites.json','w'), indent=1)
# contact sheet for review (on grey so the cut edges are visible)
prev = Image.new('RGBA', (CELL_W*3*4+30, CELL_H*3*2+10), (70,74,78,255))
for i, cls in enumerate(ORDER):
    s = Image.open(f'{out_dir}/{cls}.png'); prev.alpha_composite(s, ((i%4)*(CELL_W*3+10), (i//4)*(CELL_H*3+10)))
prev.resize((prev.width*2//1, prev.height*2//1), Image.NEAREST).crop((0,0,1600,900)).save('sprites-check.png')
print('done', os.listdir(out_dir))
