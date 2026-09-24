/**
 * Regenerates every platform's icon from `src-tauri/icons/app-icon.png` and
 * the shield drawn below. Not part of the build; run it when the logo
 * changes:
 *
 *   npm i --prefix <scratch dir> sharp
 *   NODE_PATH=<scratch dir>/node_modules node design/icons.cjs
 *   npx tauri icon design/out/app-icon-macos.png -o design/out/tauri
 *   cp design/out/tauri/icon.icns src-tauri/icons/icon.icns
 *
 * Windows and Linux use `app-icon.png` as it is: a full square suits both.
 * macOS wants the art inside a rounded square with transparent corners and
 * Apple's margin (824 of 1024). The browser needs something else again: a
 * transparent background, and a shield that still reads at 16 px, which
 * the glow and the ring of dots do not -- so small sizes are redrawn.
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "out");

// The shield and keyhole of app-icon.png, traced in its 1024 grid.
const SHIELD = "M512 215 L745 327 L745 540 C745 680 640 760 512 805 C384 760 279 680 279 540 L279 327 Z";
const KEYHOLE = "M512 410 a58 58 0 0 1 31 107 L556 606 L468 606 L481 517 A58 58 0 0 1 512 410 Z";

/** One drawing, three levels of detail. */
function shieldSvg({ stroke, solidKeyhole, dots, glow, keyScale = 1 }) {
  const ring = [];
  if (dots) {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      ring.push(
        `<circle cx="${(512 + Math.sin(a) * 188).toFixed(1)}" cy="${(512 - Math.cos(a) * 188).toFixed(1)}" r="10" fill="url(#gs)"/>`
      );
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="177 175 670 670">
  <defs>
    <linearGradient id="gs" x1="512" y1="215" x2="512" y2="805" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#a06cf8"/>
      <stop offset="1" stop-color="#5fe8ef"/>
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="14" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <g ${glow ? 'filter="url(#glow)"' : ""}>
    <path d="${SHIELD}" fill="#1c1a2e" stroke="url(#gs)" stroke-width="${stroke}" stroke-linejoin="round"/>
    ${ring.join("\n    ")}
    <path transform="translate(512 510) scale(${keyScale}) translate(-512 -510)" d="${KEYHOLE}" ${solidKeyhole ? 'fill="url(#gs)"' : `fill="none" stroke="url(#gs)" stroke-width="${stroke * 0.8}" stroke-linejoin="round"`}/>
  </g>
</svg>`;
}

const SMALL = { stroke: 56, solidKeyhole: true, dots: false, glow: false, keyScale: 1.45 };
const LARGE = { stroke: 26, solidKeyhole: false, dots: true, glow: true };

async function png(svg, size, file, pad = 0) {
  const art = await sharp(Buffer.from(svg), { density: 600 }).resize(size - pad * 2, size - pad * 2).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: art, left: pad, top: pad }])
    .png()
    .toFile(file);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  // Browser: 16/32 simplified, 48 in between, 128 with Chrome's 16 px pad.
  const ext = path.join(ROOT, "extension", "icons");
  await png(shieldSvg(SMALL), 16, path.join(ext, "16.png"));
  await png(shieldSvg(SMALL), 32, path.join(ext, "32.png"));
  await png(shieldSvg({ ...SMALL, stroke: 40 }), 48, path.join(ext, "48.png"), 2);
  await png(shieldSvg(LARGE), 128, path.join(ext, "128.png"), 16);

  // macOS: the full art in Apple's rounded square, 824 of 1024.
  const inner = 824;
  const radius = 185; // Big Sur's corner, near enough to the squircle
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${inner}" height="${inner}"><rect width="${inner}" height="${inner}" rx="${radius}" ry="${radius}"/></svg>`
  );
  const art = await sharp(path.join(ROOT, "src-tauri", "icons", "app-icon.png"))
    .resize(inner, inner)
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
