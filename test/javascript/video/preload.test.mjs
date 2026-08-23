import test from "node:test";
import assert from "node:assert/strict";
import { estimatedLoadMs, pickNext, rankPreloads, readPreloadStats, recordPreload } from "../../../app/javascript/video/preload.js";

function storage() {
   const values = new Map();
   return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
}

test("persists source observations and adjusts estimates for duration", () => {
   const store = storage();
   let stats = readPreloadStats(store);
   stats = recordPreload(stats, { provider: "slow", duration: 300 }, 20_000, store);
   recordPreload(stats, { provider: "fast", duration: 300 }, 2_000, store);
   const restored = readPreloadStats(store);
   assert.ok(estimatedLoadMs(restored, { provider: "slow", duration: 300 }) > estimatedLoadMs(restored, { provider: "fast", duration: 300 }));
   assert.ok(estimatedLoadMs(restored, { provider: "slow", duration: 1_200 }) > estimatedLoadMs(restored, { provider: "slow", duration: 60 }));
});

test("ranks slow predicted sources first without disturbing ties", () => {
   const stats = {
      sources: { slow: { n: 1, meanUnitMs: 20_000 }, fast: { n: 1, meanUnitMs: 2_000 } },
      global: { n: 2, meanUnitMs: 11_000 }
   };
   assert.deepEqual(rankPreloads([
      { id: 1, provider: "fast", duration: 300 },
      { id: 2, provider: "slow", duration: 300 },
      { id: 3, provider: "fast", duration: 300 }
   ], stats).map(v => v.id), [2, 1, 3]);
});

test("uses a ready later clip while leaving the unready first clip queued", () => {
   const queue = [10, 20, 30];
   assert.equal(pickNext(queue, new Set([20])), 20);
   assert.deepEqual(queue, [10, 20, 30]);
   assert.equal(pickNext(queue, new Set()), 10);
});
