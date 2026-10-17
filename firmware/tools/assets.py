"""Draws the flower parts the device rotates and places itself.

petal.svg: one outlined petal pointing up; the flower centre is at the bottom
middle of the image (PIVOT). face.svg: Fo's face in the pink-ringed centre.
Sizes are for a flower about 230 px across on the 466 px round screen.
"""
import sys
sys.path.insert(0, "../../design/device-screen/pet")
from make_sheet import PETAL, EYE_L, EYE_R, SMILE, INK, PINK, PLUM, FO_PINK

K = 4.15            # logo units -> screen pixels
PW, PH = 92, 140    # petal image size
PIVOT = (PW // 2, 136)
FACE = 112

def petal():
    # logo petal spans x 23.2..40.8, y 5.5..32 with its base (flower centre) at (32, 32)
    tx, ty = PIVOT[0] - 32 * K, PIVOT[1] - 32 * K
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{PW}" height="{PH}">'
            f'<g transform="translate({tx} {ty}) scale({K})" fill="none" stroke-linecap="round" stroke-linejoin="round">'
            f'<path d="{PETAL}" stroke="{INK}" stroke-width="2.0"/><path d="{PETAL}" stroke="#fff" stroke-width="1.25"/></g></svg>')

def face():
    r = FACE / 2
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{FACE}" height="{FACE}">'
            f'<circle cx="{r}" cy="{r}" r="{r - 6}" fill="{PLUM}" stroke="{PINK}" stroke-width="9"/>'
            f'<g transform="translate({r} {r}) scale(2.15) translate(-17.3 -15)" fill="{FO_PINK}">'
            f'<path d="{EYE_L}"/><path d="{EYE_R}"/><path d="{SMILE}"/></g></svg>')

if __name__ == "__main__":
    open("petal.svg", "w").write(petal())
    open("face.svg", "w").write(face())
    print(f"PIVOT {PIVOT[0]} {PIVOT[1]}")
