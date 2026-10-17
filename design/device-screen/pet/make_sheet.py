"""Builds the Friend Flower × Fo pet sheet for the Harness device.

Sheet: 1536×1872, 8 columns × 9 rows of 192×208 cells. Rows (in order):
idle, runningRight, runningLeft, waving, jumping, failed, waiting, running, review.
A row ends at its first fully transparent cell.

The "jumping" row is never used by the dial, so it holds the standby screen:
the logo with "Looking for friends of friends?" under it. Send the sheet with
ROWS_MAPPING below, so every state shows it.
"""
import math

CW, CH = 192, 208
# One petal per person on the Nearby page (set from the command line; see device-bridge.mjs).
PETALS, MAX_PETALS = 5, 12
# every state shows the standby screen: just the logo and the question
ROWS_MAPPING = {state: "jumping" for state in ["rest", "working", "listening", "sending", "asking", "relaxing"]}
ROWS = ["idle", "runningRight", "runningLeft", "waving", "jumping", "failed", "waiting", "running", "review"]

PETAL = "M32 32 C27.8 26.5 23.2 18.6 23.2 10.3 A5 4.8 0 0 1 32 5.5 A5 4.8 0 0 1 40.8 10.3 C40.8 18.6 36.2 26.5 32 32 Z"
EYE_L = "M5.8813 4.8971C4.6112 4.9172 3.6032 5.4615 2.7767 6.4695C1.9904 7.4775 1.5066 8.7879 1.184 10.4814C0.9219 12.0942 0.9421 14.0296 1.2647 15.8037C1.5267 17.4568 2.1517 19.3115 3.0387 20.7832C3.7645 22.0129 4.8531 22.7185 6.1434 22.8193C7.4336 22.9 8.5626 22.4565 9.4295 21.4686C10.3568 20.3397 10.8608 18.6865 11.2439 16.8117C11.5866 14.9569 11.6471 13.0216 11.3447 11.2475C11.0624 9.4129 10.5584 7.7799 9.6311 6.651C8.7642 5.5623 7.4538 4.7963 5.8813 4.8971Z"
EYE_R = "M27.8216 3.3626C26.3499 3.4231 25.1807 3.9674 24.4146 5.1367C23.709 6.2254 23.3663 7.7172 23.2251 9.4913C23.0639 11.225 23.1445 13.2612 23.3864 14.9748C23.6485 16.8295 24.1727 18.4222 25.1 19.5108C25.9871 20.5591 27.2168 20.9623 28.6885 20.9623C30.1803 21.0026 31.3093 20.3777 32.0754 19.1681C32.8616 17.898 33.2447 16.0836 33.4866 14.2894C33.6882 12.4951 33.5672 10.7009 33.1842 9.0881C32.781 7.3543 32.1963 5.8625 31.1682 4.7335C30.3416 3.786 29.2731 3.282 27.8216 3.3626Z"
SMILE = "M13.0067 22.522C13.5347 22.258 14.0627 22.786 14.5427 23.266C15.3347 24.082 16.3667 24.442 17.4947 24.514C18.8387 24.562 20.3027 24.034 20.9987 22.954C21.3587 22.426 21.8867 22.114 22.1987 22.57C22.4867 23.05 22.1747 24.13 21.7907 24.73C20.9747 26.026 19.4627 26.842 17.6627 27.082C16.1027 27.178 14.5187 26.554 13.5587 25.546C12.8627 24.778 12.2867 23.242 13.0067 22.522Z"

INK, PETAL_FILL, PINK, PLUM, FO_PINK, GREY = "#0d0c0b", "#ffffff", "#e6a8bd", "#231020", "#FFE1EE", "#b9b2ae"


def character(spin=0, tilt=0, dx=0, dy=0, sx=1, sy=1, eye_dx=0, eye_dy=0, blink=1, frown=False, petals=PETAL_FILL, size=1):
    """One frame of the pet, centred in a 192×208 cell."""
    cx, cy = CW / 2 + dx, CH / 2 + 4 + dy
    petals_svg = "".join(
        f'<use href="#petal" transform="rotate({spin + i * 360 / PETALS} 32 32)"/>' for i in range(PETALS)
    )
    # Fo's face, 34.6×27 units, scaled to fit the flower centre.
    eyes = (f'<g transform="translate({eye_dx} {eye_dy})">'
            f'<g transform="translate(0 23) scale(1 {blink}) translate(0 -23)">'
            f'<path d="{EYE_L}"/><path d="{EYE_R}"/></g></g>')
    smile = (f'<g transform="rotate(180 17.6 24.8) translate(0 1.5)"><path d="{SMILE}"/></g>' if frown
             else f'<path d="{SMILE}"/>')
    face = f'<g transform="translate(-17.3 -15) " fill="{FO_PINK}">{eyes}{smile}</g>'
    return (
        f'<g transform="translate({cx} {cy}) rotate({tilt}) scale({sx * size} {sy * size})">'
        # flower: 64-unit logo space, scaled ×2.7 around its centre
        # outlined petals like the logo; a dark under-stroke keeps the edges clean on the dial
        f'<g transform="scale(2.7) translate(-32 -32)" fill="none" stroke-linecap="round" stroke-linejoin="round">'
        f'<g stroke="{INK}" stroke-width="4.6">{petals_svg}</g><g stroke="{petals}" stroke-width="2.6">{petals_svg}</g></g>'
        f'<circle r="31" fill="{PLUM}" stroke="{PINK}" stroke-width="5"/>'
        f'<g transform="scale(1.25)">{face}</g>'
        f'</g>'
    )


FONT = "-apple-system, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif"


CONDENSED = "'Avenir Next Condensed', 'Helvetica Neue', Arial Narrow, sans-serif"


def standby(i):
    """Standby frame: logo up top, the question below in big condensed type. Blinks once per loop."""
    logo = character(dy=-58 - 1.5 * math.sin(2 * math.pi * i / 8), size=0.6, blink=0.12 if i == 6 else 1)
    lines = [("Looking for", "#ffffff"), ("friends of", "#ffffff"), ("friends?", PINK)]
    text = "".join(f'<text x="{CW / 2}" y="{126 + 36 * n}" fill="{c}" textLength="{186 if n < 2 else 150}" lengthAdjust="spacingAndGlyphs">{t}</text>'
                   for n, (t, c) in enumerate(lines))
    return (logo + f'<g font-family="{CONDENSED}" font-weight="700" font-size="40" text-anchor="middle" '
            f'stroke="{INK}" stroke-width="5" stroke-linejoin="round" paint-order="stroke">{text}</g>')


RING_R = 78


def ring(angle):
    """'FRIEND FLOWER × FO' twice around the logo, turned by angle degrees."""
    half = math.pi * RING_R
    cx, cy = CW / 2, CH / 2 + 4
    words = "".join(
        f'<text><textPath href="#ring" startOffset="{off}" textLength="{half - 18:.1f}" lengthAdjust="spacing">FRIEND FLOWER × FO</textPath></text>'
        for off in (9, half + 9))
    return (f'<g transform="rotate({angle} {cx} {cy})" font-family="{FONT}" font-weight="800" font-size="14" '
            f'fill="{PINK}" stroke="{INK}" stroke-width="4" stroke-linejoin="round" paint-order="stroke" dominant-baseline="middle">{words}</g>')


def frames(row):
    t = [i / 8 for i in range(8)]
    if row == "idle":
        return [character(dy=-4 * math.sin(2 * math.pi * k), blink=0.12 if i == 6 else 1) for i, k in enumerate(t)]
    if row == "running":
        # processing: petals spin one way, the name ring the other; 8 × 22.5° = one half turn, so it loops
        return [character(spin=9 * i, size=0.74) + ring(22.5 * i) for i in range(8)]
    if row == "runningRight":
        return [character(spin=9 * i, tilt=8, eye_dx=3, dy=-4 * abs(math.sin(2 * math.pi * k))) for i, k in enumerate(t)]
    if row == "runningLeft":
        return [character(spin=-9 * i, tilt=-8, eye_dx=-3, dy=-4 * abs(math.sin(2 * math.pi * k))) for i, k in enumerate(t)]
    if row == "waving":
        return [character(tilt=14 * math.sin(2 * math.pi * k), spin=6 * math.sin(2 * math.pi * k)) for k in t]
    if row == "jumping":
        return [standby(i) for i in range(8)]
    if row == "failed":
        return []  # left empty so failures show the standby screen too
        out = []
        for i in range(6):
            k = min(i, 3) / 3
            out.append(character(tilt=-18 * k, dy=10 * k, blink=1 - 0.55 * k, frown=True, petals=GREY if i >= 2 else PETAL_FILL))
        return out
    if row == "waiting":
        return [character(sx=1 + 0.04 * math.sin(2 * math.pi * k), sy=1 + 0.04 * math.sin(2 * math.pi * k),
                          eye_dy=-2.5, eye_dx=1.5, tilt=6, blink=0.12 if i == 5 else 1) for i, k in enumerate(t)]
    if row == "review":
        return [character(eye_dx=3.5 * math.sin(2 * math.pi * k), tilt=3 * math.sin(2 * math.pi * k)) for k in t]
    return []


def sheet():
    body = []
    for r, row in enumerate(ROWS):
        for c, f in enumerate(frames(row)):
            body.append(f'<g transform="translate({c * CW} {r * CH})">{f}</g>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{8 * CW}" height="{9 * CH}" viewBox="0 0 {8 * CW} {9 * CH}">'
            f'<defs><path id="petal" d="{PETAL}"/>'
            f'<path id="ring" d="M{CW / 2 - RING_R} {CH / 2 + 4} a{RING_R} {RING_R} 0 1 1 {2 * RING_R} 0 a{RING_R} {RING_R} 0 1 1 {-2 * RING_R} 0"/></defs>{"".join(body)}</svg>')


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 2:
        PETALS = max(0, min(MAX_PETALS, int(sys.argv[2])))
    open(sys.argv[1], "w").write(sheet())
