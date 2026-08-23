import test from "node:test";
import assert from "node:assert/strict";
import { seekDelta, seekRepeatCount } from "../../../app/javascript/video/seek.js";

test("left and right arrows seek by 15 seconds", () => {
   assert.equal(seekDelta({ key: "ArrowLeft" }), -15);
   assert.equal(seekDelta({ key: "ArrowRight" }), 15);
});

test("control arrows seek by 1 minute", () => {
   assert.equal(seekDelta({ key: "ArrowLeft", ctrlKey: true }), -60);
   assert.equal(seekDelta({ key: "ArrowRight", ctrlKey: true }), 60);
});

test("seek repeats turn one key event into as many seek events as the budget allows", () => {
   assert.equal(seekRepeatCount({ repeat: false, timeStamp: 100 }, 50), 1);
   assert.equal(seekRepeatCount({ repeat: true, timeStamp: 100 }, null), 1);
   assert.equal(seekRepeatCount({ repeat: true, timeStamp: 100 }, 75), 1);
   assert.equal(seekRepeatCount({ repeat: true, timeStamp: 125 }, 75), 1);
   assert.equal(seekRepeatCount({ repeat: true, timeStamp: 175 }, 75), 2);
   assert.equal(seekRepeatCount({ repeat: true, timeStamp: 1000 }, 0), 4);
});
