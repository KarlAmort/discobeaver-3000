import test from "node:test";
import assert from "node:assert/strict";
import { acknowledge, enqueue, pending } from "../../../app/javascript/video/rating_outbox.js";

function storage() {
   const values = new Map();
   return {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value)
   };
}

test("ratings survive reload until the matching write is acknowledged", () => {
   const store = storage();
   const first = enqueue(12, 4, store);
   const latest = enqueue(12, 9, store);

   assert.deepEqual(pending(store).map(({ video_id, rating }) => [ video_id, rating ]), [ [ 12, 9 ] ]);
   assert.equal(acknowledge(first, store), false);
   assert.equal(pending(store).length, 1);
   assert.equal(acknowledge(latest, store), true);
   assert.equal(pending(store).length, 0);
});
