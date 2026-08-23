import { test } from "node:test";
import assert from "node:assert/strict";
import { sceneTarget } from "../../../app/javascript/video/scenes/seek.js";

const index = { scenes: [ { start: 0 }, { start: 10 }, { start: 25 }, { start: 40 } ] };

test("→ jumps to the next scene start", () => {
   assert.equal(sceneTarget(index, 0, 1), 10);
   assert.equal(sceneTarget(index, 12, 1), 25);
   assert.equal(sceneTarget(index, 39.9, 1), 40);
});

test("→ in the last scene returns null", () => {
   assert.equal(sceneTarget(index, 41, 1), null);
});

test("← deep in a scene restarts it, near its start crosses to the previous", () => {
   assert.equal(sceneTarget(index, 30, -1), 25);   // 5s into scene 3 -> its start
   assert.equal(sceneTarget(index, 26, -1), 10);   // 1s in -> previous scene
   assert.equal(sceneTarget(index, 11, -1), 0);
   assert.equal(sceneTarget(index, 1, -1), 0);     // start of clip stays at 0
});

test("boundary slop: sitting exactly on a start still moves on", () => {
   assert.equal(sceneTarget(index, 10, 1), 25);
});
