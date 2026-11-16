# Briggs's atlas, last step (Nov 16 remake): extract-directions.py writes juggernaut.png -> full-colour lossless WebP (the client loads the .webp).
#   python3 tools/finish-briggs.py   (run by tools/cut-briggs.sh)
# (Replaces fix-briggs-slam.py / fix-briggs-upright.py / clean-briggs-throw.py: their row mirrors, pink fixes and top-right fixes were for
# the OLD Briggs art. The remake's sheets have 5 directions, extract-directions mirrors the left side itself, and prep-briggs-remake.py
# does the pink / colour fixes before cutting. They're in git history.)
import os
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__)); path = os.path.join(here, '..', 'client', 'assets', 'sprites', 'dir8', 'juggernaut.png')
Image.open(path).convert('RGBA').save(path.replace('.png', '.webp'), lossless=True, quality=100, method=6); os.remove(path); print('juggernaut.webp (lossless)')
