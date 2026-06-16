// Rasterizes scripts/icon-source.svg into the PWA PNG icons the manifest needs.
// Run with: npm run icons
import sharp from "sharp";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(resolve(here, "icon-source.svg"));
const outDir = resolve(here, "../public/icons");
mkdirSync(outDir, { recursive: true });

const targets = [
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  { file: "icon-maskable-512.png", size: 512 },
  { file: "apple-touch-icon.png", size: 180 },
];

await Promise.all(
  targets.map(({ file, size }) =>
    sharp(svg, { density: 384 })
      .resize(size, size, { fit: "cover" })
      .png()
      .toFile(resolve(outDir, file))
      .then(() => console.log(`  ✓ icons/${file} (${size}px)`)),
  ),
);

console.log("Icons generated.");
