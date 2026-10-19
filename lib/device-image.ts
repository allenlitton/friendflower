import "server-only";
import sharp, { type OverlayOptions, type Sharp } from "sharp";
import { gradientFor } from "@/lib/format";

/**
 * Pictures for the round device, drawn here because the device can't decode
 * web images or draw maps. They go out as raw pixels in LVGL's own formats:
 * RGB565 (2 bytes a pixel, little-endian) and, with transparency, RGB565A8
 * (that, then one alpha byte a pixel). No text is drawn here: server fonts
 * aren't reliable, so the device writes initials and pin numbers itself.
 */

export function toLvgl(rgba: Buffer, w: number, h: number, alpha: boolean) {
  const n = w * h;
  const out = Buffer.alloc(n * (alpha ? 3 : 2));
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    out.writeUInt16LE(((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3), i * 2);
    if (alpha) out[n * 2 + i] = rgba[i * 4 + 3];
  }
  return out;
}

async function raw(img: Sharp, w: number, h: number, alpha: boolean) {
  const { data } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return toLvgl(data, w, h, alpha);
}

// The site's PetalHalo petal (components/ui.tsx), in its 64-unit box.
const HALO_PETAL = "M32 15.5 C26.2 11.8 25.6 5.6 32 1.6 C38.4 5.6 37.8 11.8 32 15.5 Z";
const PETAL_ANGLES = [0, 72, 144, 216, 288];

/**
 * A round photo `size` px across (RGB565A8). With `halo`, the photo is about
 * two thirds of that, with soft pink petals behind it, as on the site. With no
 * photo it's the member's gradient (lib/format.ts gradientFor), for initials.
 */
export async function avatarImage(opts: { id: string; src: string | null; size: number; halo: boolean }) {
  const { id, src, size, halo } = opts;
  const d = halo ? Math.round(size * 0.64) : size;
  const off = Math.round((size - d) / 2);
  const circle = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}"><circle cx="${d / 2}" cy="${d / 2}" r="${d / 2}" fill="#fff"/></svg>`);

  let face: Buffer | null = null;
  if (src) {
    try {
      const res = await fetch(src);
      if (res.ok) {
        face = await sharp(Buffer.from(await res.arrayBuffer()))
          .resize(d, d, { fit: "cover", position: "attention" })
          .composite([{ input: circle, blend: "dest-in" }])
          .png().toBuffer();
      }
    } catch (e) {
      console.error("Avatar fetch failed", e);
    }
  }
  if (!face) {
    const [a, b] = gradientFor(id).match(/#[0-9a-f]{6}/gi) ?? ["#c98da3", "#8c5f7d"];
    face = await sharp(Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>` +
      `<circle cx="${d / 2}" cy="${d / 2}" r="${d / 2}" fill="url(#g)"/></svg>`)).png().toBuffer();
  }

  const layers: OverlayOptions[] = [];
  if (halo) {
    layers.push({ input: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">` +
      PETAL_ANGLES.map((a) => `<path transform="rotate(${a} 32 32)" d="${HALO_PETAL}" fill="rgba(230,168,189,.55)"/>`).join("") +
      `</svg>`), left: 0, top: 0 });
  }
  layers.push({ input: face, left: off, top: off });
  const img = sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(layers);
  return raw(img, size, size, true);
}

// ---- map ---------------------------------------------------------------------

const TILE = 256;
// OpenStreetMap's own tiles (no key; light, cached use is within its tile
// policy: we send a real user agent and cache each map). They're light, so we
// flip them dark to suit the AMOLED.
const tileUrl = (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
const PIN_R = 11;

function project(lat: number, lng: number, z: number) {
  const scale = TILE * 2 ** z;
  const s = Math.sin((lat * Math.PI) / 180);
  return { x: ((lng + 180) / 360) * scale, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale };
}

function unproject(x: number, y: number, z: number) {
  const scale = TILE * 2 ** z;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lng: (x / scale) * 360 - 180 };
}

export type MapView = { z: number; lat: number; lng: number };
type MapOut = { pixels: Buffer; pins: { x: number; y: number }[]; view: MapView };
const cache = new Map<string, MapOut>();

/**
 * A dark street map `w`×`h` (RGB565) with a pink pin for each place. Also
 * returns where each pin is, in order, so the device can number them to match
 * its list, and the zoom and centre it was drawn at. The image is bigger than
 * the device's window (`vw`×`vh`) so it can be dragged around. With no `view`
 * the window is framed to fit the places; with one, it's drawn at that zoom
 * and centre (zooming and panning). Tiles: © OpenStreetMap contributors.
 */
export async function mapImage(places: { lat: number; lng: number }[], w: number, h: number,
                               vw = w, vh = h, view?: MapView): Promise<MapOut> {
  const key = `${w}x${h}/${vw}x${vh}/${view ? `${view.z},${view.lat.toFixed(5)},${view.lng.toFixed(5)}` : "fit"}:` +
    places.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(";");
  const hit = cache.get(key);
  if (hit) return hit;

  // Frame the main cluster: one far-off place shouldn't zoom the map out so far
  // that every other pin lands on top of the others. Those go on the edge.
  const mid = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const mlat = mid(places.map((p) => p.lat)), mlng = mid(places.map((p) => p.lng));
  const far = (p: { lat: number; lng: number }) => Math.hypot(p.lat - mlat, (p.lng - mlng) * Math.cos((mlat * Math.PI) / 180)) > 0.03; // ~3 km
  const near = places.filter((p) => !far(p));
  const framed = near.length >= Math.ceil(places.length / 2) ? near : places;

  const pad = PIN_R * 2 + 2;
  let z = 16;
  for (; z > 10 && !view; z--) {
    const pts = framed.map((p) => project(p.lat, p.lng, z));
    const spanX = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
    const spanY = Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y));
    if (spanX <= vw - 2 * pad && spanY <= vh - 2 * pad) break;
  }
  let cx: number, cy: number;
  if (view) {
    z = Math.min(Math.max(Math.round(view.z), 10), 18);
    ({ x: cx, y: cy } = project(view.lat, view.lng, z));
  } else {
    const box = framed.map((p) => project(p.lat, p.lng, z));
    cx = (Math.max(...box.map((p) => p.x)) + Math.min(...box.map((p) => p.x))) / 2;
    cy = (Math.max(...box.map((p) => p.y)) + Math.min(...box.map((p) => p.y))) / 2;
  }
  const pts = places.map((p) => project(p.lat, p.lng, z));
  const left = Math.round(cx - w / 2), top = Math.round(cy - h / 2);

  const tx0 = Math.floor(left / TILE), ty0 = Math.floor(top / TILE);
  const tx1 = Math.floor((left + w - 1) / TILE), ty1 = Math.floor((top + h - 1) / TILE);
  const tiles: OverlayOptions[] = [];
  await Promise.all(
    Array.from({ length: (tx1 - tx0 + 1) * (ty1 - ty0 + 1) }, async (_, i) => {
      const tx = tx0 + (i % (tx1 - tx0 + 1)), ty = ty0 + Math.floor(i / (tx1 - tx0 + 1));
      const res = await fetch(tileUrl(z, tx, ty), { headers: { "user-agent": "FriendFlower/1.0 (friendflower.app)" } });
      if (!res.ok) throw new Error(`Map tile ${z}/${tx}/${ty}: ${res.status}`);
      tiles.push({ input: Buffer.from(await res.arrayBuffer()), left: (tx - tx0) * TILE, top: (ty - ty0) * TILE });
    }),
  );

  // Framed to fit, far-off places sit faintly on the window's edge. Once you
  // zoom or pan, every pin is where it really is (maybe off the image).
  const clamp = (v: number, lo: number, size: number) => view ? v : Math.min(Math.max(v, lo + PIN_R + 2), lo + size - PIN_R - 2);
  const vl = Math.round((w - vw) / 2), vt = Math.round((h - vh) / 2);
  const pins = pts.map((p) => {
    const x = Math.round(p.x - left), y = Math.round(p.y - top);
    const px = clamp(x, vl, vw), py = clamp(y, vt, vh);
    return { x: px, y: py, edge: x !== px || y !== py };
  });
  const pinSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    pins.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="${PIN_R}" fill="#e6a8bd" fill-opacity="${p.edge ? 0.55 : 1}" stroke="#0d0c0b" stroke-width="2.5"/>`).join("") +
    `</svg>`);

  const sheet = await sharp({ create: { width: (tx1 - tx0 + 1) * TILE, height: (ty1 - ty0 + 1) * TILE, channels: 4, background: "#0d0c0b" } })
    .composite(tiles).png().toBuffer();
  // Light map -> dark: invert, then pull it toward the app's warm near-black.
  const dark = await sharp(sheet)
    .extract({ left: left - tx0 * TILE, top: top - ty0 * TILE, width: w, height: h })
    .removeAlpha().negate().modulate({ saturation: 0.15, brightness: 0.62 }).linear(0.85, 6)
    .png().toBuffer();
  const img = sharp(dark).composite([{ input: pinSvg, left: 0, top: 0 }]);
  const centre = unproject(cx, cy, z);
  const out = { pixels: await raw(img, w, h, false), pins: pins.map(({ x, y }) => ({ x, y })), view: { z, lat: centre.lat, lng: centre.lng } };
  if (cache.size > 30) cache.delete(cache.keys().next().value!);
  cache.set(key, out);
  return out;
}
