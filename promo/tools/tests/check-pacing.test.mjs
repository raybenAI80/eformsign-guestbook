import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "..", "check-pacing.mjs");

const durations = () => ({
  fps: 30, leadSec: 0.3,
  scenes: {
    a: { seconds: 10, narrationSec: 8, startFrame: 0, frames: 300 },
    b: { seconds: 10, narrationSec: 8, startFrame: 300, frames: 300 },
  },
});
const manifest = () => ({
  scenes: ["a", "b"].map((id) => ({ id, cuts: [0], transitionIn: "crossfade", transitionSec: 0.5, textBlocks: 1, captionLines: 2, narrationEndSec: 8.5 })),
});

function run(d, m, extra = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pacing-"));
  const dp = path.join(dir, "d.json"), mp = path.join(dir, "m.json"), op = path.join(dir, "o.json");
  fs.writeFileSync(dp, JSON.stringify(d));
  fs.writeFileSync(mp, JSON.stringify(m));
  const r = spawnSync(process.execPath, [cli, "--durations", dp, "--manifest", mp, "--json", op, ...extra], { encoding: "utf8" });
  const json = fs.existsSync(op) ? JSON.parse(fs.readFileSync(op, "utf8")) : null;
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: r.status, json };
}
const codes = (r) => [...new Set(r.json.violations.map((x) => x.code))].sort();

test("전부 통과", () => {
  const r = run(durations(), manifest());
  assert.equal(r.status, 0);
  assert.deepEqual(r.json.violations, []);
  assert.equal(r.json.totalSec, 20);
});

test("P1 장면 5.9초", () => {
  const d = durations();
  d.scenes.a.seconds = 5.9;
  d.scenes.b.seconds = 14; // 평균 9.95 로 P2 분리
  const m = manifest();
  m.scenes[0].narrationEndSec = 4;
  m.scenes[1].cuts = [0, 7];
  m.scenes[1].narrationEndSec = 12;
  const r = run(d, m);
  assert.equal(r.status, 1);
  assert.deepEqual(codes(r), ["P1"]);
});

test("P2 평균 7.5초(각 장면은 6초 이상)", () => {
  const d = durations();
  d.scenes.a.seconds = 7.5;
  d.scenes.b.seconds = 7.5;
  const m = manifest();
  m.scenes.forEach((s) => (s.narrationEndSec = 6));
  assert.deepEqual(codes(run(d, m)), ["P2"]);
});

test("P3 컷 3개", () => {
  const m = manifest();
  m.scenes[0].cuts = [0, 3.5, 7]; // 각 컷 3.5/3.5/3.0 으로 P4 분리
  assert.deepEqual(codes(run(durations(), m)), ["P3"]);
});

test("P4 컷 2.0초", () => {
  const m = manifest();
  m.scenes[0].cuts = [0, 2];
  assert.deepEqual(codes(run(durations(), m)), ["P4"]);
});

test("P5 hard 전환 / 짧은 크로스페이드, 첫 장면은 면제", () => {
  const m = manifest();
  m.scenes[0].transitionIn = "hard";
  m.scenes[1].transitionIn = "hard";
  const r = run(durations(), m);
  assert.deepEqual(codes(r), ["P5"]);
  assert.equal(r.json.violations.length, 1);
  const m2 = manifest();
  m2.scenes[1].transitionSec = 0.3;
  assert.deepEqual(codes(run(durations(), m2)), ["P5"]);
});

test("P6 숨 0.2초 + narrationEndSec 생략 시 narrationSec+leadSec 로 계산", () => {
  const m = manifest();
  m.scenes[0].narrationEndSec = 9.8;
  assert.deepEqual(codes(run(durations(), m)), ["P6"]);
  const d = durations();
  d.scenes.b.narrationSec = 9.5; // 9.5+0.3=9.8 → 숨 0.2
  const m2 = manifest();
  delete m2.scenes[1].narrationEndSec;
  const r = run(d, m2);
  assert.deepEqual(codes(r), ["P6"]);
  assert.equal(r.json.violations[0].scene, "b");
});

test("P7 textBlocks 2 / captionLines 3", () => {
  const m = manifest();
  m.scenes[0].textBlocks = 2;
  m.scenes[1].captionLines = 3;
  const r = run(durations(), m);
  assert.deepEqual(codes(r), ["P7"]);
  assert.equal(r.json.violations.length, 2);
});

test("P8 누락·초과", () => {
  const m = manifest();
  m.scenes[1].id = "zzz";
  const r = run(durations(), m);
  assert.deepEqual(codes(r), ["P8"]);
  assert.equal(r.json.violations.length, 2);
});

test("--warn-only 는 exit 0, 입력 오류는 exit 2", () => {
  const m = manifest();
  m.scenes[0].textBlocks = 2;
  assert.equal(run(durations(), m, ["--warn-only"]).status, 0);
  const r = spawnSync(process.execPath, [cli, "--durations", "/nonexistent.json", "--manifest", "/x.json"], { encoding: "utf8" });
  assert.equal(r.status, 2);
});
