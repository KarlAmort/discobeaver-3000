import { test } from "node:test";
import assert from "node:assert/strict";
import { indexMp4 } from "../../../app/javascript/video/scenes/mp4.js";
import { detectShots, novelty } from "../../../app/javascript/video/scenes/detect.js";
import { ensureFixture, fileRange, CUTS, DURATION } from "./fixture.mjs";

test("detectShots finds the fixture's hard cuts from the bitstream alone", async () => {
   const idx = await indexMp4(fileRange(ensureFixture()));
   const shots = detectShots(idx);

   assert.ok(shots.length >= CUTS.length + 1, `>= ${CUTS.length + 1} shots, got ${shots.length}`);
   assert.equal(shots[0].start, 0);
   assert.ok(Math.abs(shots[shots.length - 1].end - DURATION) < 0.2, "shots cover the whole clip");
   for (let i = 1; i < shots.length; i++) {
      assert.equal(shots[i].start, shots[i - 1].end, "shots are contiguous");
   }
   // every known cut has a detected boundary within ~2 frames
   const starts = shots.map(s => s.start);
   for (const cut of CUTS) {
      const nearest = Math.min(...starts.map(s => Math.abs(s - cut)));
      assert.ok(nearest <= 2 / 15 + 1e-6, `cut at ${cut}s detected (nearest boundary ${nearest.toFixed(3)}s away)`);
   }
});

test("novelty peaks at the cuts", async () => {
   const idx = await indexMp4(fileRange(ensureFixture()));
   const bins = 130;                                       // 10 bins per second
   const curve = novelty(idx, bins);
   assert.equal(curve.length, bins);
   assert.ok(Math.max(...curve) <= 1 && Math.min(...curve) >= 0);
   for (const cut of CUTS) {
      const b = Math.floor(cut / DURATION * bins);
      const around = Math.max(...curve.slice(Math.max(0, b - 2), b + 3));
      assert.ok(around > 0.35, `novelty near ${cut}s should peak (got ${around.toFixed(2)})`);
   }
});
