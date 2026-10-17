#!/bin/bash
# Redraws the flower images and turns them into C for the firmware.
set -e
cd "$(dirname "$0")"
python3 assets.py
C="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for a in petal:92:140 face:112:112; do
  IFS=: read n w h <<<"$a"
  printf '<html><body style="margin:0;background:transparent"><img src="%s.svg" width="%s" height="%s" style="display:block"></body></html>' $n $w $h > $n.html
  "$C" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --default-background-color=00000000 \
    --window-size=$w,$h --screenshot="$PWD/$n.png" "file://$PWD/$n.html" 2>/dev/null
  python3 png2c.py $n.png img_$n ../main/img_$n.c
done
