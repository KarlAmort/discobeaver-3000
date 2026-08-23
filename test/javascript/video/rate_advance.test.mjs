import test from "node:test";
import assert from "node:assert/strict";
import { nextClipId } from "../../../app/javascript/video/rate_advance.js";

// The 1–9 rapid-rate flow (keys.js "1".."9" -> ctx.rateAndAdvance) must rate the CURRENT clip and
// advance to the genuine NEXT clip in the results list. The subtle part is capturing that next id
// BEFORE rate() mutates the list — nextClipId is that pre-mutation lookup.

test("advances to the next clip in the list", () => {
   const list = [ { id: 10 }, { id: 20 }, { id: 30 } ];
   assert.equal(nextClipId(list, 10), 20);
   assert.equal(nextClipId(list, 20), 30);
});

test("returns null at the end of the list (stay on the last clip)", () => {
   const list = [ { id: 10 }, { id: 20 } ];
   assert.equal(nextClipId(list, 20), null);
});

test("the captured next id is stable even though rating removes the rated card", () => {
   // simulate the active-learning feed: rating clip 10 removes it, shifting indices. The advance must
   // still land on 20 (captured pre-mutation), not on 30 (what index 1 becomes post-removal).
   const before = [ { id: 10 }, { id: 20 }, { id: 30 } ];
   const nextId = nextClipId(before, 10);
   const after  = before.filter(v => v.id !== 10);   // rate(10) removed the card
   assert.equal(nextId, 20);
   assert.notEqual(nextId, after[1]?.id);            // index 1 now points at 30 — would be wrong
});

test("null when the current clip isn't in the list, or on bad input", () => {
   assert.equal(nextClipId([ { id: 1 } ], 999), null);
   assert.equal(nextClipId(null, 1), null);
   assert.equal(nextClipId([ { id: 1 } ], null), null);
});
