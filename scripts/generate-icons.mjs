// Generates every brand icon (PWA, favicon, Electron, mobile) from a single
// inline SVG mark: a rounded orange square with a bold white "C", matching the
// sidebar logo (components/sidebar.tsx — rounded-lg bg-brand-600 white "C").
//
// Run with: npm run icons
// sharp + png-to-ico are devDependencies — never import them from app code.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const BRAND = "#ea580c"; // tailwind brand-600 (see tailwind.config.ts)

// The mark is designed in a 512x512 space centered on (256, 256). The "C" is a
// thick circular arc (font-independent — SVG text rasterization varies by
// machine): radius 130, stroke 84, opening on the right. Its visual extent is
// 2 * (130 + 84 / 2) = 344px, i.e. ~67% of the canvas.
const DESIGN = 512;
const GLYPH_EXTENT = 344;

function glyphPath() {
  const c = DESIGN / 2;
  const r = 130;
  const gapDeg = 50; // half-angle of the opening, centered on the right
  const rad = (deg) => (deg * Math.PI) / 180;
  const x = (deg) => (c + r * Math.cos(rad(deg))).toFixed(2);
  const y = (deg) => (c - r * Math.sin(rad(deg))).toFixed(2);
  // Arc from +gap to -gap the long way around (through the left side).
  return `M ${x(gapDeg)} ${y(gapDeg)} A ${r} ${r} 0 1 0 ${x(-gapDeg)} ${y(-gapDeg)}`;
}

/**
 * Build the SVG for one icon variant.
 * @param {object} opts
 * @param {"rounded"|"full"|"none"} opts.background rounded square, full-bleed
 *   square, or transparent.
 * @param {number} opts.glyphScale fraction of the canvas the "C" should span.
 * @param {string} [opts.glyphColor]
 */
function markSvg({ background, glyphScale, glyphColor = "#ffffff" }) {
  const scale = (glyphScale * DESIGN) / GLYPH_EXTENT;
  const offset = ((1 - scale) * DESIGN) / 2;
  const corner = Math.round(DESIGN * 0.22);
  let bg = "";
  if (background === "rounded") {
    bg = `<rect width="${DESIGN}" height="${DESIGN}" rx="${corner}" ry="${corner}" fill="${BRAND}"/>`;
  } else if (background === "full") {
    bg = `<rect width="${DESIGN}" height="${DESIGN}" fill="${BRAND}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${DESIGN} ${DESIGN}">
  ${bg}
  <g transform="translate(${offset.toFixed(2)} ${offset.toFixed(2)}) scale(${scale.toFixed(4)})">
    <path d="${glyphPath()}" fill="none" stroke="${glyphColor}" stroke-width="84" stroke-linecap="round"/>
  </g>
</svg>`;
}

async function renderPng(svg, size) {
  return sharp(Buffer.from(svg), { density: 300 })
    .resize(size, size)
    .png()
    .toBuffer();
}

async function writePng(relPath, svg, size) {
  const abs = path.join(ROOT, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, await renderPng(svg, size));
  console.log(`wrote ${relPath} (${size}x${size})`);
}

async function main() {
  // Standard mark: rounded orange square, "C" spanning ~67% of the canvas.
  const standard = markSvg({ background: "rounded", glyphScale: 0.67 });
  // Apple touch icon: iOS applies its own corner mask, so ship full-bleed.
  const fullBleed = markSvg({ background: "full", glyphScale: 0.67 });
  // Maskable: full-bleed background, glyph inset to the ~60% safe zone.
  const maskable = markSvg({ background: "full", glyphScale: 0.6 });
  // Android adaptive foreground: glyph only, generous padding, transparent bg.
  const foreground = markSvg({ background: "none", glyphScale: 0.45 });
  // Android adaptive background: solid brand orange.
  const solid = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${DESIGN} ${DESIGN}"><rect width="${DESIGN}" height="${DESIGN}" fill="${BRAND}"/></svg>`;

  await writePng("app/icon.png", standard, 192);
  await writePng("app/apple-icon.png", fullBleed, 180);
  await writePng("public/icons/icon-192.png", standard, 192);
  await writePng("public/icons/icon-512.png", standard, 512);
  await writePng("public/icons/icon-512-maskable.png", maskable, 512);
  await writePng("electron/build/icon.png", standard, 512);
  await writePng("mobile/assets/icon-only.png", standard, 1024);
  await writePng("mobile/assets/icon-foreground.png", foreground, 1024);
  await writePng("mobile/assets/icon-background.png", solid, 1024);

  // Multi-size Windows .ico for the Electron installer/taskbar.
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const icoPngs = await Promise.all(icoSizes.map((s) => renderPng(standard, s)));
  const ico = await pngToIco(icoPngs);
  const icoPath = path.join(ROOT, "electron", "build", "icon.ico");
  await mkdir(path.dirname(icoPath), { recursive: true });
  await writeFile(icoPath, ico);
  console.log(`wrote electron/build/icon.ico (${icoSizes.join(", ")})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
