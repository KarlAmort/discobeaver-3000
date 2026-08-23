import test from "node:test";
import assert from "node:assert/strict";
import { GRID_SCALE, ROW_HEIGHT, MIN_CELL_WIDTH, CELL_GAP, labelsAt, metric, cardMetrics } from "../../../app/javascript/video/grid_metrics.js";

const video = {
   id: 7,
   title: "Seven",
   provider: "archive",
   predicted: 6.75,
   embedding_distance: 0.1875,
   our_rating: 8,
   duration: 125,
   filesize: 104857600
};

test("the result grid uses the 125 percent preview scale", () => {
   assert.equal(GRID_SCALE, 1.25);
   assert.equal(ROW_HEIGHT, 250);
   assert.equal(MIN_CELL_WIDTH, 300);
   assert.equal(CELL_GAP, 12.5);
});

test("the first card and the first card of every fourth row carry labels", () => {
   assert.equal(labelsAt(0, 4), true);
   assert.equal(labelsAt(4, 4), false);
   assert.equal(labelsAt(12, 4), true);
   assert.equal(labelsAt(28, 4), true);
   assert.equal(labelsAt(29, 4), false);
});

test("an active score or rating is highlighted in place instead of repeated", () => {
   assert.deepEqual(cardMetrics(video, "predicted").map((m) => m.field), [ "predicted", "embedding", "our_rating" ]);
   assert.deepEqual(cardMetrics(video, "embedding").map((m) => m.field), [ "predicted", "embedding", "our_rating" ]);
   assert.deepEqual(cardMetrics(video, "our_rating").map((m) => m.field), [ "predicted", "embedding", "our_rating" ]);
   assert.deepEqual(cardMetrics(video, "title").map((m) => m.field), [ "predicted", "embedding", "our_rating" ]);
   assert.deepEqual(cardMetrics(video, "provider").map((m) => m.field), [ "predicted", "embedding", "our_rating" ]);
   assert.deepEqual(cardMetrics(video, "duration").map((m) => m.field), [ "predicted", "embedding", "our_rating", "duration" ]);
   assert.equal(metric({ novelty: 0.42 }, "novelty").label, "uniqueness 0.42");
   assert.equal(metric({ uncertainty: 0.73 }, "uncertainty").label, "rating information 0.73");
});

test("landmark labels name metrics and units where they exist", () => {
   assert.deepEqual(metric(video, "predicted"), { field: "predicted", value: "6.75", label: "prediction 6.75 / 9", raw: 6.75 });
   assert.deepEqual(metric(video, "embedding"), { field: "embedding", value: "0.19", label: "cosine distance 0.19", raw: 0.1875 });
   assert.equal(metric(video, "duration").label, "duration 2 min 5 s");
   assert.equal(metric(video, "filesize").label, "file size 100 MB");
   assert.equal(metric(video, "our_rating").label, "rating 8 / 9");
   assert.equal(metric({ predicted: null }, "predicted"), null);
   assert.equal(metric({ predicted: 0 }, "predicted"), null);
});
