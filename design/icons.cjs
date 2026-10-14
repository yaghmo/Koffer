/**
 * Regenerates every platform's icon from the Koffer mark drawn below: a
 * locked case with a white body, a yellow handle and a red keyhole, on the
 * jacket's black (DESIGN.md). Not part of the build; run it when the mark
 * changes:
 *
 *   npm i --prefix <scratch dir> sharp
 *   NODE_PATH=<scratch dir>/node_modules node design/icons.cjs
 *   npx tauri icon src-tauri/icons/app-icon.png
 *   npx tauri icon design/out/app-icon-macos.png -o design/out/tauri
 *   cp design/out/tauri/icon.icns src-tauri/icons/icon.icns
 *
 * The same three paths are written out in src/components/Emblem.tsx,
 * extension/popup.html and extension/bar.js; change them together.
 *
 * `app-icon.png` is the mark on a rounded black tile, for Windows and Linux.
 * macOS wants the art inside a rounded square with transparent corners and
 * Apple's margin (824 of 1024). The browser's toolbar is light in one theme
 * and dark in the other, so its icons keep the tile too: the white body
 * would vanish on a light toolbar without it.
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "out");

const JACKET = "#121212";
const SHIRT = "#ffffff";
const TIE = "#c8102e";
const TAPE = "#ffd60a";

// The mark in a 256 grid, centred on 128,128.
const HANDLE = "M88 96V64a24 24 0 0 1 24-24h32a24 24 0 0 1 24 24V96ZM108 96V66a6 6 0 0 1 6-6h28a6 6 0 0 1 6 6V96Z";
const BODY =
  "M54 92H202a26 26 0 0 1 26 26V190a26 26 0 0 1-26 26H54a26 26 0 0 1-26-26V118a26 26 0 0 1 26-26ZM60 92h10v124h-10ZM186 92h10v124h-10Z";
// At 16 px the two straps are a third of a pixel wide and only smear the body.
const BODY_PLAIN = BODY.slice(0, BODY.indexOf("ZM") + 1);
const KEYHOLE = "M128 118a20 20 0 0 1 11.8 36.2L146 192H110l6.2-37.8A20 20 0 0 1 128 118Z";

/** The mark on the jacket. `radius` rounds the tile (0 is a full square);
 *  `scale` is how much of the tile the mark takes, about its centre;
 *  `plain` leaves the straps off. */
function tileSvg({ radius, scale, plain = false }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="${radius}" fill="${JACKET}"/>
  <g transform="translate(128 128) scale(${scale}) translate(-128 -128)">
    <path fill="${TAPE}" fill-rule="evenodd" d="${HANDLE}"/>
    <path fill="${SHIRT}" fill-rule="evenodd" d="${plain ? BODY_PLAIN : BODY}"/>
    <path fill="${TIE}" d="${KEYHOLE}"/>
  </g>
</svg>`;
}

async function png(svg, size, file, pad = 0) {
  const art = await sharp(Buffer.from(svg), { density: 600 }).resize(size - pad * 2, size - pad * 2).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: art, left: pad, top: pad }])
    .png()
    .toFile(file);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  // Windows and Linux: the mark on a rounded tile.
  const appIcon = path.join(ROOT, "src-tauri", "icons", "app-icon.png");
  await png(tileSvg({ radius: 46, scale: 0.7 }), 1024, appIcon);

  // Browser: the smaller the icon, the more of the tile the mark takes.
  // 128 keeps Chrome's 16 px pad.
  const ext = path.join(ROOT, "extension", "icons");
  await png(tileSvg({ radius: 56, scale: 0.9, plain: true }), 16, path.join(ext, "16.png"));
  await png(tileSvg({ radius: 56, scale: 0.9 }), 32, path.join(ext, "32.png"));
  await png(tileSvg({ radius: 52, scale: 0.84 }), 48, path.join(ext, "48.png"));
  await png(tileSvg({ radius: 48, scale: 0.78 }), 128, path.join(ext, "128.png"), 16);

  // macOS: the mark on a full square, cut to Apple's rounded square, 824 of 1024.
  const inner = 824;
  const radius = 185; // Big Sur's corner, near enough to the squircle
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${inner}" height="${inner}"><rect width="${inner}" height="${inner}" rx="${radius}" ry="${radius}"/></svg>`
  );
  const square = await sharp(Buffer.from(tileSvg({ radius: 0, scale: 0.66 })), { density: 600 }).resize(inner, inner).png().toBuffer();
  const art = await sharp(square)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
  const pad = (1024 - inner) / 2;
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: art, left: pad, top: pad }])
    .png()
    .toFile(path.join(OUT, "app-icon-macos.png"));
  console.log("icons written");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
