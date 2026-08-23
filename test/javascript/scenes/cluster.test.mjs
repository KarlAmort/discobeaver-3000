import { test } from "node:test";
import assert from "node:assert/strict";
import { clusterScenes, scenesByDuration, sigDistance } from "../../../app/javascript/video/scenes/cluster.js";

// synthetic perspectives: distinct constant signatures with a little noise
function sig(level, jitter = 0.01) {
   const s = new Float32Array(48);
   for (let i = 0; i < s.length; i++) s[i] = Math.min(1, Math.max(0, level + ((i * 7919) % 13 - 6) / 6 * jitter));
   return s;
}
const A = () => sig(0.2), B = () => sig(0.7), C = () => sig(0.45), D = () => sig(0.95);
const shotsFor = (sigs, len = 2) => sigs.map((_, i) => ({ start: i * len, end: (i + 1) * len }));

test("A/B/A/B dialogue cutting stays ONE scene", () => {
   const sigs = [ A(), B(), A(), B(), A() ];
   const scenes = clusterScenes(shotsFor(sigs), sigs);
   assert.equal(scenes.length, 1);
   assert.equal(scenes[0].shots.length, 5);
   assert.equal(scenes[0].start, 0);
   assert.equal(scenes[0].end, 10);
});

test("a genuinely new perspective that STAYS opens a new scene", () => {
   const sigs = [ A(), B(), A(), B(), C(), D(), C(), D() ];
   const scenes = clusterScenes(shotsFor(sigs), sigs);
   assert.equal(scenes.length, 2);
   assert.deepEqual(scenes[0].shots, [ 0, 1, 2, 3 ]);
   assert.deepEqual(scenes[1].shots, [ 4, 5, 6, 7 ]);
   assert.equal(scenes[1].start, 8);
});

test("a single insert shot (cutaway) does NOT split the scene", () => {
   const sigs = [ A(), B(), C(), A(), B() ];               // C is a one-shot cutaway, then back to A/B
   const scenes = clusterScenes(shotsFor(sigs), sigs);
   assert.equal(scenes.length, 1);
});

test("missing signatures never split", () => {
   const sigs = [ A(), null, A(), null, A() ];
   const scenes = clusterScenes(shotsFor(sigs), sigs);
   assert.equal(scenes.length, 1);
});

test("three scenes chain correctly", () => {
   const sigs = [ A(), A(), C(), C(), D(), D() ];
   const scenes = clusterScenes(shotsFor(sigs), sigs);
   assert.equal(scenes.length, 3);
});

test("sigDistance: same perspective near zero, different far", () => {
   assert.ok(sigDistance(A(), A()) < 0.03);
   assert.ok(sigDistance(A(), B()) > 0.3);
   assert.equal(sigDistance(A(), null), Infinity);
});

test("scenesByDuration merges shots up to a minimum scene length", () => {
   const shots = shotsFor(Array(10).fill(0), 3);       // 10 × 3s shots
   const scenes = scenesByDuration(shots, 8);
   assert.ok(scenes.length < 10 && scenes.length >= 3);
   assert.equal(scenes[0].start, 0);
   assert.equal(scenes[scenes.length - 1].end, 30);
});
