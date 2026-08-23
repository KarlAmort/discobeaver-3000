import test from "node:test";
import assert from "node:assert/strict";
import {
   centroid, decodeVector, dot, encodeVector, furthestPair, normalize, poles, projection
} from "../../../app/javascript/video/commander/math.js";

const token = (id, vector) => ({ id, vector: normalize(vector) });

test("signed byte transport keeps cosine geometry", () => {
   const source = normalize([ 0.1, -0.3, 0.8, 0.5 ]);
   const decoded = decodeVector(encodeVector(source));
   assert.ok(dot(source, decoded) > 0.9999);
});

test("centroid is normalized", () => {
   const center = centroid([ normalize([ 1, 0, 0 ]), normalize([ 0, 1, 0 ]) ]);
   assert.ok(Math.abs(dot(center, center) - 1) < 1e-6);
   assert.ok(Math.abs(center[0] - center[1]) < 1e-6);
});

test("furthest selected pair becomes the first projection axis", () => {
   const left = token("left", [ -1, 0, 0, 0 ]);
   const right = token("right", [ 1, 0, 0, 0 ]);
   const near = token("near", [ 0.8, 0.2, 0, 0 ]);
   const [ negative, positive ] = furthestPair([ left, right, near ]);
   assert.equal(negative.id, "left");
   assert.equal(positive.id, "right");

   const view = projection([ left, right, near ], [ left, right, near, token("depth", [ 0, 0, 1, 0 ]) ]);
   const positions = Object.fromEntries(view.points.map(point => [ point.id, point.position ]));
   assert.ok(positions.left[0] < 0);
   assert.ok(positions.right[0] > 0);
   assert.ok(Math.abs(dot(view.axes[0], view.axes[1])) < 1e-6);
   assert.ok(Math.abs(dot(view.axes[1], view.axes[2])) < 1e-6);
});

test("pole terms name opposite ends of the selected axis", () => {
   const axis = normalize([ 1, 0, 0 ]);
   const result = poles([
      token("night", [ -1, 0, 0 ]), token("middle", [ 0.1, 1, 0 ]), token("day", [ 1, 0, 0 ])
   ], axis);
   assert.equal(result.negative.id, "night");
   assert.equal(result.positive.id, "day");
});
