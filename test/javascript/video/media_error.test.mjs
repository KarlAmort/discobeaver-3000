import test from "node:test";
import assert from "node:assert/strict";
import { mediaErrorDetail, mediaSource } from "../../../app/javascript/video/media_error.js";

test("reports the native media error", () => {
   assert.equal(mediaErrorDetail({ error: { code: 2, message: "network" } }), "MEDIA_ERR_NETWORK: network");
});

test("reports the loaded media source", () => {
   assert.equal(mediaSource({ tagName: "VIDEO", currentSrc: "/video/5473/stream" }), "/video/5473/stream");
});
