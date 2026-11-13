#!/bin/sh
# Briggs (juggernaut) sprite atlas. Nov 13: cut 62px tall (SPRITE_H; everyone else is 54: the user found him small next to the others,
# a stocky build reads small at the same height), sharpened hard (SHARPEN). Blocks: his 4 weapons, the Q "slam" pose, the E "throw" pose,
# the R "fists" moveset (gauntlets: guard, walk x3, jab, haymaker) and the R "power" pose. (The old E / Q cast poses, bastion / warcry, are gone.)
# "^3" = size that block by its column 3 (a standing frame; those sheets start crouched).
# (Manhole Frisbee: python3 tools/clean-briggs-throw.py first: takes the flying cover out of the art's fling frame.)
B=tools/art/briggs
SPRITE_H=${SPRITE_H:-62} SHARPEN=${SHARPEN:-140} python3 tools/extract-directions.py juggernaut shotgun=$B/shotgun.png%218x149.875 knife=$B/knife.png%218x149.875 \
  bat=$B/bat.png%199.83x164 axe=$B/axe.png%199.83x164 slam=$B/slam-pose.png!4^3%443.5x110.875 throw=$B/throw-pose-clean.png!4^3%271.5x181 \
  fists=$B/fists/gauntlets.png%181x181 power=$B/fists/power.png!4%221.75x221.75
python3 tools/fix-briggs-slam.py
python3 tools/extract-briggs-wall.py
