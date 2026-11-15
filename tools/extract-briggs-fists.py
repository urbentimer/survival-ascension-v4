# Briggs's R "BARE KNUCKLE" (Nov 13): the skill card (the punch cone moved to tools/extract-briggs-punch.py on Nov 15).
#   python3 tools/extract-briggs-fists.py
# Source: tools/art/briggs/fists/card.png -> client/assets/icons/card-bareKnuckle.png (152x152). (gauntlets.png / power.png are cut into the
# juggernaut atlas by tools/cut-briggs.sh.)
import os
from PIL import Image, ImageFilter
here = os.path.dirname(os.path.abspath(__file__)); F = os.path.join(here, 'art', 'briggs', 'fists'); A = os.path.join(here, '..', 'client', 'assets')
# (Nov 15) the punch cone is now cut by tools/extract-briggs-punch.py (the user's white punch-through sheets); the old cone.gif cutter is in git history.
card = Image.open(os.path.join(F, 'card.png')).convert('RGB').resize((152, 152), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=1.0, percent=70, threshold=2))
card.save(os.path.join(A, 'icons', 'card-bareKnuckle.png')); print('card 152x152')
