#!/bin/sh
# Briggs (juggernaut) sprite atlas, sharpened (Nov 13). Reproduces the Nov 3 cut exactly with SHARPEN=0; adds the Q "slam" pose block.
B=tools/art/briggs
SHARPEN=${SHARPEN:-90} python3 tools/extract-directions.py juggernaut shotgun=$B/shotgun.png%218x149.875 knife=$B/knife.png%218x149.875 \
  bat=$B/bat.png%199.83x164 axe=$B/axe.png%199.83x164 bastion=$B/bastion-cast.png!4%299x164 warcry=$B/warcry-body.png!4%299x164 \
  slam=$B/slam-pose.png!4%443.5x110.875
python3 tools/fix-briggs-slam.py
python3 tools/extract-briggs-wall.py
