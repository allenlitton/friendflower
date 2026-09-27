import { ImageResponse } from "next/og";

// The link preview for every page (invite links included): the flower and the wordmark,
// as on the sign-in screen. Without it, chat apps grab whatever photo is on the page.

export const alt = "friend flower";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const WORDMARK = "friend flower.";
const PETAL = "M32 32 C27.8 26.5 23.2 18.6 23.2 10.3 A5 4.8 0 0 1 32 5.5 A5 4.8 0 0 1 40.8 10.3 C40.8 18.6 36.2 26.5 32 32 Z";

const flowerSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="240" height="240">
  <g stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" fill="none">
    ${[0, 72, 144, 216, 288].map((a) => `<path transform="rotate(${a} 32 32)" d="${PETAL}"/>`).join("")}
  </g>
  <circle cx="32" cy="32" r="4" fill="#e6a8bd"/>
</svg>`;

/** The Doto logo font from Google Fonts (as TTF, which the image renderer needs). */
async function dotoFont() {
  try {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Doto:wght@800&text=${encodeURIComponent(WORDMARK)}`)).text();
    const url = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)?.[1];
    return url ? await (await fetch(url)).arrayBuffer() : null;
  } catch {
    return null;
  }
}

export default async function Image() {
  const doto = await dotoFont();
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 36, background: "#0d0c0b" }}>
        <img src={`data:image/svg+xml;utf8,${encodeURIComponent(flowerSvg)}`} width={240} height={240} alt="" />
        <div style={{ fontFamily: doto ? "Doto" : "sans-serif", fontSize: 104, fontWeight: 800, color: "#ffffff", letterSpacing: 2 }}>
          {WORDMARK}
        </div>
      </div>
    ),
    { ...size, fonts: doto ? [{ name: "Doto", data: doto, weight: 800, style: "normal" }] : [] },
  );
}
