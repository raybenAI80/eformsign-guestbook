#!/usr/bin/env node
// Copy the CTA scene assets from the Remotion project (promo/public) into promo-hf/assets.
// Usage: node tools/sync-assets.mjs   (run from anywhere)
// assets/ is not committed (copies of promo/public) — run this after a fresh clone.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const src = resolve(root, "..", "promo", "public");
const FILES = [
  "brand/eformsign-logo-white.png",
  "brand/slogan-h-white.png",
  "fonts/Paperlogy-8ExtraBold.ttf",
  "fonts/Pretendard-Regular.ttf",
  "voice/cta.mp3",
  "sfx/cta-reveal.wav",
  "bgm/track.mp3",
];
for (const f of FILES) {
  const to = join(root, "assets", f);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(join(src, f), to);
  console.log("copied", f);
}
