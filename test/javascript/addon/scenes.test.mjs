import test from "node:test";
import assert from "node:assert/strict";
import { boundaries, distance, outline, target } from "../../../addon/scenes.js";

const signature = (value) => Float32Array.from([ value, value, value ]);

test("signature distance is the mean absolute channel difference", () => {
   assert.ok(Math.abs(distance(signature(0.2), signature(0.5)) - 0.3) < 1e-6);
   assert.equal(distance(null, signature(0.5)), Infinity);
});

test("visual cuts become bounded scenes without flash-sized fragments", () => {
   const samples = [
      { at: 2, signature: signature(0.1) },
      { at: 6, signature: signature(0.9) },
      { at: 10, signature: signature(0.1) },
      { at: 18, signature: signature(0.8) }
   ];
   const scenes = boundaries(samples, 30);
   assert.deepEqual(scenes.map(({ start, end }) => ({ start, end })), [
      { start: 0, end: 10 },
      { start: 10, end: 18 },
      { start: 18, end: 30 }
   ]);
   assert.ok(Math.abs(scenes[1].strength - 0.8) < 1e-6);
   assert.ok(Math.abs(scenes[2].strength - 0.7) < 1e-6);
});

test("strong scene transitions form chapters containing their subchapters", () => {
   const scenes = [
      { start: 0, end: 700, strength: 0 },
      { start: 700, end: 1600, strength: 0.2 },
      { start: 1600, end: 2300, strength: 0.9 },
      { start: 2300, end: 4000, strength: 0.3 }
   ];
   assert.deepEqual(outline(scenes, 4000), [
      { start: 0, end: 1600, scenes: scenes.slice(0, 2) },
      { start: 1600, end: 4000, scenes: scenes.slice(2) }
   ]);
});

test("scene seek restarts, crosses backward, and advances", () => {
   const scenes = [ { start: 0 }, { start: 10 }, { start: 25 } ];
   assert.equal(target(scenes, 13, -1), 10);
   assert.equal(target(scenes, 10.5, -1), 0);
   assert.equal(target(scenes, 12, 1), 25);
   assert.equal(target(scenes, 26, 1), null);
});
