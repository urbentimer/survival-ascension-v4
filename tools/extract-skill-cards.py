# Cuts Viktor's skill cards (tools/art/viktor-skill-cards.png, two framed cards on black) -> icons/card-heavyTurret.png, icons/card-robotSquad.png (152x152)
import os
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__)); out = os.path.join(here, '..', 'client', 'assets', 'icons')
im = Image.open(os.path.join(here, 'art', 'viktor-skill-cards.png')).convert('RGB')
for name, box in [('heavyTurret', (26, 16, 866, 857)), ('robotSquad', (909, 16, 1750, 857))]:
    im.crop(box).resize((152, 152), Image.LANCZOS).save(os.path.join(out, f'card-{name}.png')); print('card', name)
