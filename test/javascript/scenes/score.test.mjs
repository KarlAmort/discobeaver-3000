import test from "node:test";
import assert from "node:assert/strict";
import { hierarchy, match, score } from "../../../app/javascript/video/scenes/score.js";

const references = {
   acts: [ { startMs: 4000, endMs: 6000 } ],
   scenes: [ { startMs: 2000, endMs: 3000 }, { startMs: 4000, endMs: 6000 } ]
};

test("one prediction cannot satisfy two reference boundaries", () => {
   const result = match([ 2500 ], [
      { startMs: 2000, endMs: 3000 },
      { startMs: 2400, endMs: 3200 }
   ], 500);
   assert.equal(result.matches, 1);
   assert.equal(result.pairs.length, 1);
});

test("source-aligned fixture scores act and scene boundaries independently", () => {
   const result = hierarchy({ acts: [ 5000 ], scenes: [ 2500, 5000 ] }, references);
   assert.equal(result.acts["500"].f1, 1);
   assert.equal(result.scenes["500"].f1, 1);
   assert.equal(result.scenes["500"].medianDeviationMs, 0);
});

test("a false scene split lowers precision without lowering recall", () => {
   const result = score([ 2500, 5000, 7000 ], references.scenes, 500);
   assert.equal(result.precision, 2 / 3);
   assert.equal(result.recall, 1);
   assert.equal(result.f1, 0.8);
   assert.equal(result.falseSplits, 1);
   assert.equal(result.missedBoundaries, 0);
});

test("tolerance edges are inclusive and source time zero is absent", () => {
   assert.equal(score([ 1500 ], references.scenes.slice(0, 1), 500).matches, 1);
   assert.equal(score([ 1499 ], references.scenes.slice(0, 1), 500).matches, 0);
   assert.equal(references.scenes.some((window) => window.startMs === 0), false);
});

test("empty and every-shot negative controls remain honest", () => {
   const empty = score([], references.scenes, 500);
   const dense = score([ 500, 1000, 1500, 2500, 3500, 5000, 6500, 7000 ], references.scenes, 500);
   assert.equal(empty.recall, 0);
   assert.equal(dense.recall, 1);
   assert.equal(dense.falseSplits, 6);
});
