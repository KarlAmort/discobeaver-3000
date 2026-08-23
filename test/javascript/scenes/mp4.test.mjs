import { test } from "node:test";
import assert from "node:assert/strict";
import { indexMp4 } from "../../../app/javascript/video/scenes/mp4.js";
import { ensureFixture, fileRange, DURATION } from "./fixture.mjs";

test("indexMp4 recovers the video sample tables via range reads", async () => {
   const idx = await indexMp4(fileRange(ensureFixture()));
   assert.ok(idx, "fixture should index");
   assert.equal(idx.sizes.length, idx.times.length);
   assert.equal(idx.sync.length, idx.times.length);
   assert.ok(Math.abs(idx.times.length - DURATION * 15) <= 2, `~${DURATION * 15} frames, got ${idx.times.length}`);
   assert.ok(Math.abs(idx.duration - DURATION) < 0.2, `duration ~${DURATION}, got ${idx.duration}`);

   const keys = Array.from(idx.sync).reduce((a, b) => a + b, 0);
   assert.ok(keys >= 2 && keys < idx.sync.length, `some but not all frames sync (got ${keys})`);
   assert.equal(idx.sync[0], 1, "first sample is a keyframe");
   assert.ok(idx.times[1] > idx.times[0], "times ascend");
   assert.ok(Array.from(idx.sizes).every(s => s > 0), "every sample has a size");
});

test("indexMp4 returns null for non-MP4 bytes", async () => {
   const junk = async (offset, length) => new Uint8Array(length).fill(7);
   assert.equal(await indexMp4(junk), null);
});

test("indexMp4 returns null at EOF-without-moov", async () => {
   const empty = async () => new Uint8Array(0);
   assert.equal(await indexMp4(empty), null);
});
