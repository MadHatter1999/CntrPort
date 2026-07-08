// Generate a dark-surface variant of the brand icon: near-black fills become
// white, every other colour (all the reds) is left byte-for-byte identical.
// The source SVG is never modified. Runs in the build so it always tracks
// whatever favicon.svg currently is (placeholder locally, real icon on the VM).
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const inPath = process.argv[2] || "public/favicon.svg";
const outPath = process.argv[3] || "public/favicon-dark.svg";

if (!existsSync(inPath)) {
  console.warn(`gen-dark-icon: ${inPath} not found, skipping`);
  process.exit(0);
}

const NEAR_BLACK = 24; // max channel <= this counts as "black"
function isNearBlack(hex) {
  let h = hex.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return Math.max(r, g, b) <= NEAR_BLACK;
}

const svg = readFileSync(inPath, "utf8");
const out = svg
  .replace(/#[0-9a-fA-F]{6}\b/g, (m) => (isNearBlack(m) ? "#ffffff" : m))
  .replace(/#[0-9a-fA-F]{3}\b/g, (m) => (isNearBlack(m) ? "#ffffff" : m))
  .replace(/(fill|stroke)="black"/g, '$1="#ffffff"')
  .replace(/(fill|stroke):\s*black/g, "$1:#ffffff");

writeFileSync(outPath, out);
console.log(`gen-dark-icon: ${inPath} -> ${outPath}`);
