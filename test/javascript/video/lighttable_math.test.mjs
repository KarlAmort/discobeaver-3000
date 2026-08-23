import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreTransitions, timelineLayout, uniformStages } from "../../../app/javascript/video/lighttable_math.js";

test("uniform stages grow from 2×2 through 16×16 over one 256-frame timeline", () => {
   const stages = uniformStages(256);
   assert.equal(stages.length, 15);
   assert.equal(stages[0].dimension, 2);
   assert.equal(stages[0].frames.length, 4);
   assert.deepEqual(stages[0].frames.map(frame => frame.time), [ 32.5, 96.5, 160.5, 224.5 ]);
   assert.equal(stages.at(-1).dimension, 16);
   assert.equal(stages.at(-1).frames.length, 256);
   assert.deepEqual(stages.at(-1).frames.map(frame => frame.index), Array.from({ length: 256 }, (_, i) => i));
});

test("transition significance combines the boundary jump with distance from prior perspectives", () => {
   const sig = value => Float32Array.from([ value, value, value ]);
   const scenes = [
      { start: 0, end: 4, shots: [ 0, 1 ] },
      { start: 4, end: 8, shots: [ 2, 3 ] },
      { start: 8, end: 12, shots: [ 4, 5 ] }
   ];
   const scored = scoreTransitions(scenes, [ sig(0.2), sig(0.22), sig(0.24), sig(0.21), sig(0.9), sig(0.88) ], new Float32Array(12), 12);
   assert.equal(scored[0].significance, 0);
   assert.ok(scored[1].significance < 0.15);
   assert.ok(scored[2].significance > 0.8);
});

test("timeline layout stays chronological in a 16×9 field and scales significance", () => {
   const scenes = [
      { start: 0, significance: 0 },
      { start: 10, significance: 0.1 },
      { start: 50, significance: 0.5 },
      { start: 90, significance: 1 }
   ];
   const layout = timelineLayout(scenes, 100);
   const slots = layout.map(item => (item.row - 1) * 16 + item.column - 1);
   assert.deepEqual(slots, [ 14, 72, 129 ]);
   assert.ok(layout[0].scale < layout[1].scale && layout[1].scale < layout[2].scale);
});

test("timeline layout keeps the 144 most significant transitions", () => {
   const scenes = [ { start: 0, significance: 0 } ];
   for (let i = 1; i <= 160; i++) scenes.push({ start: i, significance: i / 160 });
   const layout = timelineLayout(scenes, 160);
   assert.equal(layout.length, 144);
   assert.ok(layout.every((scene, index) => !index || scene.start > layout[index - 1].start));
   assert.equal(layout[0].start, 17);
});
