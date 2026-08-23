import test from "node:test";
import assert from "node:assert/strict";
import { client, fields, record } from "../../../addon/fireservice.js";

test("fireservice fields stay flat, finite, and canonically named", () => {
   assert.deepEqual(fields({ ok: true, "actual.ms": 12.5, Bad: 1, nested: { secret: 1 }, infinite: Infinity }), {
      ok: true,
      "actual.ms": 12.5,
      nested: "[object Object]",
      infinite: "Infinity"
   });
});

test("fireservice records preserve the stable message and stated time", () => {
   const at = new Date("2026-08-23T10:00:00Z");
   assert.deepEqual(record(4, "scene", "[tripwire][scene] analysis exceeded 30000ms", { "actual.ms": 31000 }, at), {
      at: "2026-08-23T10:00:00.000Z",
      prio: 4,
      subsystem: "scene",
      message: "[tripwire][scene] analysis exceeded 30000ms",
      fields: { "actual.ms": 31000 }
   });
});

test("fireservice client submits bounded batches", async () => {
   const batches = [];
   const fire = client(async (records) => batches.push(records), { delay: 10000, limit: 2 });
   fire.report(6, "scene", "one");
   fire.report(6, "scene", "two");
   fire.report(6, "scene", "three");
   await fire.flush();
   assert.deepEqual(batches.map((batch) => batch.length), [ 2, 1 ]);
   assert.equal(fire.pending(), 0);
});
