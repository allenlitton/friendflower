"use client";

// Photo helpers that run in the browser, so full-size photos never leave the phone.

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't process image"))), type, quality));
}

/** Square-crop and shrink a photo to a small JPEG. */
export async function squarePhoto(file: File, size = 640) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const side = Math.min(img.width, img.height);
    const c = document.createElement("canvas");
    c.width = c.height = size;
    c.getContext("2d")!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
    return toBlob(c, "image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * "Doodle of me": a simple ink drawing guessed from the photo's light and dark
 * areas (hair length, beard, smile). Ported from the Claude Design prototype.
 * Returns a PNG, so the original photo can stay private.
 */
export async function doodleFromPhoto(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const N = 64, c = document.createElement("canvas");
    c.width = N; c.height = N;
    const x = c.getContext("2d")!;
    const side = Math.min(img.width, img.height);
    x.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, N, N);
    const d = x.getImageData(0, 0, N, N).data;
    const lum = (px: number, py: number) => {
      const i = (Math.min(N - 1, py) * N + Math.min(N - 1, px)) * 4;
      return d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
    };
    const region = (x0: number, y0: number, x1: number, y1: number) => {
      let t = 0, n = 0;
      for (let yy = Math.floor(y0 * N); yy < y1 * N; yy++)
        for (let xx = Math.floor(x0 * N); xx < x1 * N; xx++) { t += lum(xx, yy); n++; }
      return t / Math.max(1, n);
    };
    const face = region(0.38, 0.38, 0.62, 0.58);
    const top = region(0.34, 0.06, 0.66, 0.2);
    const sidesLow = (region(0.12, 0.55, 0.26, 0.85) + region(0.74, 0.55, 0.88, 0.85)) / 2;
    const chin = region(0.42, 0.64, 0.58, 0.74);
    let seed = 0;
    for (let i = 0; i < d.length; i += 97) seed = (seed * 31 + d[i]) % 100003;
    const hairTop = top < face - 18;
    const longHair = sidesLow < face - 28;
    const beard = chin < face - 22;
    const curly = hairTop && !longHair && seed % 3 === 0;
    const smileOpen = seed % 2 === 0;
    const ink = "#1a1a1a";
    const P: string[] = [];
    P.push('<path d="M206 462 C196 352 250 270 328 270 C408 270 460 352 450 464 C442 558 396 620 328 620 C258 620 214 556 206 462 Z"/>');
    if (longHair) {
      P.push('<path d="M204 462 C160 334 210 212 328 210 C450 208 500 330 454 462"/>');
      P.push('<path d="M206 420 C176 500 168 582 182 650"/>', '<path d="M452 424 C486 500 492 584 478 652"/>');
    } else if (curly) {
      P.push('<path d="M198 392 C176 330 206 246 276 224 C300 178 380 176 408 214 C476 226 500 300 478 386"/>');
      P.push('<path d="M200 362 C184 330 214 306 240 318"/>', '<path d="M468 366 C490 332 462 302 436 314"/>', '<path d="M300 232 C312 206 348 206 358 232"/>');
    } else if (hairTop) {
      P.push('<path d="M200 372 C214 268 262 226 330 226 C400 226 452 272 460 376 C430 316 380 300 328 300 C272 300 228 318 200 372 Z"/>');
    } else {
      P.push('<path d="M232 318 C262 292 300 284 330 284 C362 284 398 292 424 316"/>');
    }
    P.push('<path d="M246 424 C266 408 298 410 312 424"/>', '<path d="M348 424 C364 408 396 408 410 422"/>');
    P.push(`<circle cx="278" cy="456" r="11" fill="${ink}" stroke="none"/>`, `<circle cx="380" cy="456" r="11" fill="${ink}" stroke="none"/>`);
    P.push('<path d="M330 472 C322 500 320 512 338 516"/>');
    if (beard) {
      P.push('<path d="M228 520 C244 600 290 640 330 640 C372 640 414 600 430 520"/>', '<path d="M290 552 C312 568 350 568 370 552"/>');
    } else if (smileOpen) {
      P.push('<path d="M276 542 C304 590 364 588 388 540 C352 552 310 552 276 542 Z"/>');
    } else {
      P.push('<path d="M274 540 C306 574 362 570 390 536"/>');
    }
    P.push('<path d="M204 470 C180 470 178 508 204 512"/>', '<path d="M452 470 C476 470 476 508 452 512"/>');
    P.push('<path d="M328 620 L328 688"/>', '<path d="M178 830 C188 728 252 688 328 688 C406 688 468 728 478 830"/>');
    P.push(seed % 2 ? '<path d="M290 692 C300 724 356 724 366 692"/>' : '<path d="M262 700 L328 758 L394 700"/>');
    // Square canvas around the head and shoulders.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="18 180 620 620" width="640" height="640"><rect x="0" y="0" width="700" height="1016" fill="#ffffff"/><g fill="none" stroke="${ink}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round">${P.join("")}</g></svg>`;
    const doodle = await loadImage("data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg));
    const out = document.createElement("canvas");
    out.width = out.height = 640;
    out.getContext("2d")!.drawImage(doodle, 0, 0, 640, 640);
    return toBlob(out, "image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}
