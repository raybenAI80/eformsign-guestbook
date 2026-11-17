#!/usr/bin/env node
// Copy the CTA / hook-t03 / compare-t09 scene assets from the Remotion project (promo/public) into promo-hf/assets.
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
  // hook-t03 / compare-t09 (motion dictionary T03·T09·B15 pilot)
  "voice/hook.mp3",
  "voice/repeat.mp3",
  "gen/gen-01.png",
  "shots/demo/tablet/V3-step1-filled-x25.png",
  "shots/demo/tablet/V3-step3-filled-x25.png",
  "shots/demo/tablet/V3-step4-filled-x25.png",
  "shots/demo/tablet/V3-step5-filled-x25.png",
  "shots/demo/tablet/V2-step2-signed.png",
];
for (const f of FILES) {
  const to = join(root, "assets", f);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(join(src, f), to);
  console.log("copied", f);
}
