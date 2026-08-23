import test from "node:test";
import assert from "node:assert/strict";
import { replay } from "../../../addon/replay.js";

function watch(model, from, to, wall = from * 1000) {
   model.observe(from, wall);
   for (let time = from + 1; time <= to; time += 1) model.observe(time, wall + (time - from) * 1000);
}

test("a first pass has no replay excess", () => {
   const model = replay(10);
   watch(model, 0, 9);
   assert.equal(model.peak().score, 0);
});

test("repeated viewing produces a smoothed local peak", () => {
   const model = replay(12);
   watch(model, 0, 11);
   watch(model, 3, 7, 20000);
   watch(model, 3, 7, 30000);
   const peak = model.peak();
   assert.ok(peak.at >= 3 && peak.at <= 6);
   assert.ok(peak.score > 0);
});

test("a backward seek followed by dwell strengthens its target", () => {
   const model = replay(30);
   watch(model, 0, 20);
   model.observe(5, 22000);
   watch(model, 5, 12, 22000);
   assert.ok(model.scores()[5] > model.scores()[15]);
   assert.equal(model.snapshot().duration, 30);
});
