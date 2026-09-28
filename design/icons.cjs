/**
 * Regenerates every platform's icon from `design/logo.png` (the Koffer
 * logo, 1024 square) and the tracing of it drawn below. Not part of the
 * build; run it when the logo changes:
 *
 *   npm i --prefix <scratch dir> sharp
 *   NODE_PATH=<scratch dir>/node_modules node design/icons.cjs
 *   npx tauri icon src-tauri/icons/app-icon.png
 *   npx tauri icon design/out/app-icon-macos.png -o design/out/tauri
 *   cp design/out/tauri/icon.icns src-tauri/icons/icon.icns
 *
 * `app-icon.png` is the logo cropped to its art, on its own background:
 * a full square suits Windows and Linux. macOS wants the art inside a
 * rounded square with transparent corners and Apple's margin (824 of 1024).
 * The browser needs something else again: a transparent background, and a
 * mark that still reads at 16 px, which the double lines and the glow do
 * not -- so small sizes are redrawn from the tracing.
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "out");

// Where the art sits in logo.png's 1024 grid.
const CROP = { left: 233, top: 195, width: 560, height: 560 };

const CASE = "#a5eef9";
const KEY = "#3ee39e";
const HANDLE = "M428 262 V252 Q428 234 446 234 H582 Q600 234 600 252 V296";
const KEYHOLE = "M437 309 a24 24 0 0 1 15 43 l9 37 h-48 l9 -37 a24 24 0 0 1 15 -43 z";

/** The suitcase, key and K of logo.png, traced in its 1024 grid. */
function logoSvg({ stroke, detail }) {
  const inner = detail
    ? `<rect x="268" y="330" width="490" height="364" rx="30"/>
    <path d="M338 330 V694 M352 330 V694 M673 330 V694 M687 330 V694"/>
    <path d="M268 380 A50 50 0 0 0 318 330 M268 644 A50 50 0 0 1 318 694 M758 380 A50 50 0 0 1 708 330 M758 644 A50 50 0 0 0 708 694"/>`
    : `<path d="M352 313 V711 M673 313 V711"/>`;
  const shaft = detail
    ? `<path d="M422 414 V640 L437 660 L452 640 V632 H470 V614 H452 V600 H486 V584 H466 V572 H486 V556 H452 V414"/>`
    : `<path d="M437 416 V650 M437 574 H482 M437 622 H472"/>`;
  const keyhole = detail ? `<path d="${KEYHOLE}"/>` : `<path d="${KEYHOLE}" fill="${KEY}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${CROP.left} ${CROP.top} ${CROP.width} ${CROP.height}" fill="none" stroke-linejoin="round" stroke-linecap="round">
  <defs>
    <mask id="cut" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
      <rect width="1024" height="1024" fill="#fff"/>
      <circle cx="437" cy="350" r="${66 + stroke * 2}" fill="#000"/>
    </mask>
  </defs>
  <g stroke="${CASE}" stroke-width="${stroke}" mask="url(#cut)">
    <rect x="251" y="313" width="524" height="398" rx="44"/>
    ${inner}
  </g>
  <path stroke="${CASE}" stroke-width="${stroke}" d="${detail ? "M455 494 L597 384 L622 384 L512 487 L638 634 L582 634 L492 510 L455 536" : "M445 520 L610 384 M500 474 L630 634"}"/>
  <g stroke="${KEY}" stroke-width="${stroke}">
    <path d="${HANDLE}"/>
    ${detail ? `<path d="M446 275 V266 Q446 250 462 250 H574 Q584 250 584 262 V296"/>` : ""}
    <circle cx="437" cy="350" r="66"/>
    ${keyhole}
    ${shaft}
  </g>
</svg>`;
}

const SMALL = { stroke: 36, detail: false };
const LARGE = { stroke: 11, detail: true };

async function png(svg, size, file, pad = 0) {
  const art = await sharp(Buffer.from(svg), { density: 600 }).resize(size - pad * 2, size - pad * 2).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: art, left: pad, top: pad }])
    .png()
    .toFile(file);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  // Windows and Linux: the logo itself, cropped to its art.
  const appIcon = path.join(ROOT, "src-tauri", "icons", "app-icon.png");
  await sharp(path.join(__dirname, "logo.png")).extract(CROP).resize(1024, 1024).png().toFile(appIcon);

  // Browser: 16/32 simplified, 48 in between, 128 with Chrome's 16 px pad.
  const ext = path.join(ROOT, "extension", "icons");
  await png(logoSvg(SMALL), 16, path.join(ext, "16.png"));
  await png(logoSvg(SMALL), 32, path.join(ext, "32.png"));
  await png(logoSvg({ ...SMALL, stroke: 26 }), 48, path.join(ext, "48.png"), 2);
  await png(logoSvg(LARGE), 128, path.join(ext, "128.png"), 16);

  // macOS: the full art in Apple's rounded square, 824 of 1024.
  const inner = 824;
  const radius = 185; // Big Sur's corner, near enough to the squircle
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${inner}" height="${inner}"><rect width="${inner}" height="${inner}" rx="${radius}" ry="${radius}"/></svg>`
  );
  const art = await sharp(appIcon)
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
