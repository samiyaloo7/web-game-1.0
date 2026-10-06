import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Generates the PWA icon set for Neon Courier.
 *
 *   node scripts/generate-icons.mjs
 *
 * The SVG is the source of truth (drawn below, mirroring the in-game courier
 * sprite: cyan delta, white outline, pink core). This script rasterises it with
 * `sharp` at the sizes an installable PWA asks for:
 *
 *   icon-192.png           manifest, 192x192        (installability minimum)
 *   icon-512.png           manifest, 512x512        (installability minimum)
 *   icon-maskable-512.png  manifest, purpose maskable (full-bleed, safe zone)
 *   icon-180.png           apple-touch-icon         (opaque square)
 *   icon.svg               manifest, purpose any + browser tab
 *
 * The PNGs are committed to `public/icons/` so a build never depends on this
 * script running; re-run it only when the artwork changes. `sharp` is a
 * transitive dependency of Next.js — if it is ever missing, the script says so
 * instead of failing halfway through writing files.
 */

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public', 'icons');

/** Palette — must stay in step with `globals.css`'s `@theme` tokens. */
const COLORS = {
  bg: '#0a0c14',
  cyan: '#00f0ff',
  pink: '#ff007f',
  white: '#ffffff',
  border: '#00f0ff',
};

/**
 * The courier delta, in 512-unit space, plus its core dot.
 *
 * `scale`/`cx`/`cy` let the same drawing serve the plain icon (large, centred)
 * and the maskable one (smaller, so Android's circular mask can never clip it:
 * the safe zone is a centred circle at 40% of the width).
 */
function artwork({ scale, cx, cy }) {
  // Vertex set of the in-game courier sprite, lifted from `createProgrammaticTextures`.
  const points = [
    [16, 2],
    [30, 36],
    [16, 28],
    [2, 36],
  ];
  const delta = points
    .map(([x, y], i) => {
      const px = cx + (x - 16) * scale;
      const py = cy + (y - 20) * scale;
      return `${i === 0 ? 'M' : 'L'}${px.toFixed(1)} ${py.toFixed(1)}`;
    })
    .join(' ');

  return `
    <path d="${delta}" fill="${COLORS.cyan}" stroke="${COLORS.white}" stroke-width="${(3 / 16) * scale}" stroke-linejoin="round"/>
    <circle cx="${cx}" cy="${cy - 2 * scale}" r="${4.5 * scale}" fill="${COLORS.pink}"/>
    <circle cx="${cx}" cy="${cy - 2 * scale}" r="${7.5 * scale}" fill="${COLORS.pink}" opacity="0.35"/>
  `;
}

function buildSvg({ size, maskable }) {
  // Maskable artwork must bleed to every edge and keep the glyph inside the
  // safe zone; the plain icon can use a rounded plate like an app tile.
  const scale = maskable ? 7.5 : 10.5;
  const glyph = artwork({ scale, cx: size / 2, cy: size / 2 });
  const plate = maskable
    ? `<rect width="${size}" height="${size}" fill="${COLORS.bg}"/>`
    : `<rect width="${size}" height="${size}" rx="${size * 0.19}" fill="${COLORS.bg}"/>
       <rect x="${size * 0.035}" y="${size * 0.035}" width="${size * 0.93}" height="${size * 0.93}" rx="${size * 0.16}"
             fill="none" stroke="${COLORS.border}" stroke-opacity="0.55" stroke-width="${size * 0.014}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${plate}
  ${glyph}
</svg>`;
}

let sharp;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  console.error(
    '[generate-icons] sharp is not available (it ships with Next.js as an optional dependency).\n' +
      'Run `npm install` first, then re-run this script.'
  );
  process.exit(1);
}

await mkdir(OUT_DIR, { recursive: true });

const targets = [
  { file: path.join(OUT_DIR, 'icon.svg'), svg: buildSvg({ size: 512, maskable: false }) },
  { file: path.join(ROOT, 'src', 'app', 'icon.svg'), svg: buildSvg({ size: 64, maskable: false }) },
  { file: path.join(OUT_DIR, 'icon-192.png'), svg: buildSvg({ size: 192, maskable: false }), size: 192 },
  { file: path.join(OUT_DIR, 'icon-512.png'), svg: buildSvg({ size: 512, maskable: false }), size: 512 },
  { file: path.join(OUT_DIR, 'icon-maskable-512.png'), svg: buildSvg({ size: 512, maskable: true }), size: 512 },
  { file: path.join(OUT_DIR, 'icon-180.png'), svg: buildSvg({ size: 180, maskable: false }), size: 180 },
];

for (const target of targets) {
  if (target.file.endsWith('.svg')) {
    await writeFile(target.file, target.svg, 'utf8');
  } else {
    await sharp(Buffer.from(target.svg)).png().toFile(target.file);
  }
  console.log(`  → ${path.relative(ROOT, target.file)}`);
}

console.log('[generate-icons] done');
