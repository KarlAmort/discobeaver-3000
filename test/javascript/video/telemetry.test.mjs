import test from "node:test";
import assert from "node:assert/strict";
import { remember, report, watch } from "../../../app/javascript/video/telemetry.js";

class Target {
   constructor() { this.listeners = new Map(); }
   addEventListener(name, fn) { this.listeners.set(name, [...(this.listeners.get(name) || []), fn]); }
   removeEventListener(name, fn) { this.listeners.set(name, (this.listeners.get(name) || []).filter((item) => item !== fn)); }
   emit(name) { for (const fn of this.listeners.get(name) || []) fn(); }
}

function ranges(...pairs) {
   return { length: pairs.length, start: (index) => pairs[index][0], end: (index) => pairs[index][1] };
}

function media() {
   return Object.assign(new Target(), {
      readyState: 0, networkState: 2, duration: 100, currentTime: 0,
      videoWidth: 1920, videoHeight: 1080, paused: true, ended: false, seeking: false,
      playbackRate: 1, volume: 0.75, muted: false, buffered: ranges([0, 20]), played: ranges(),
      audioTracks: [{ language: "de" }, { language: "en" }], textTracks: [{ language: "en" }],
      querySelector: () => ({ type: "video/mp4; codecs=\"avc1.640028,mp4a.40.2\"" }),
      getVideoPlaybackQuality: () => ({ totalVideoFrames: 1000, droppedVideoFrames: 5, corruptedVideoFrames: 1 })
   });
}

test("collects intrinsic media, track, buffer, quality, engagement, seek, and stall data", () => {
   let clock = 0;
   const video = media();
   const page = Object.assign(new Target(), { visibilityState: "visible", fullscreenElement: null, pictureInPictureElement: null });
   const sent = [];
   const stored = [];
   const observer = watch(video, {
      videoId: 42, sessionId: "session-1", page,
      now: () => clock, wall: () => 1_750_000_000_000,
      publish: (fields, immediate) => sent.push({ fields, immediate }),
      update: (fields, final) => stored.push({ fields, final }), reportMs: 15_000, storeMs: 1_000
   });

   video.readyState = 1;
   video.emit("loadedmetadata");
   video.paused = false;
   video.emit("play");
   video.emit("playing");
   clock = 5_000;
   video.currentTime = 5;
   video.played = ranges([0, 5]);
   video.emit("timeupdate");
   video.emit("waiting");
   clock = 7_000;
   video.emit("playing");
   video.seeking = true;
   video.currentTime = 40;
   video.emit("seeking");
   clock = 7_500;
   video.seeking = false;
   video.currentTime = 55;
   video.emit("seeked");
   clock = 20_000;
   video.currentTime = 70;
   video.buffered = ranges([0, 100]);
   const final = observer.finish("close");

   assert.equal(final["video.id"], 42);
   assert.equal(final["session.id"], "session-1");
   assert.equal(final["media.width.px"], 1920);
   assert.equal(final["media.orientation"], "landscape");
   assert.match(final["media.type"], /avc1/);
   assert.equal(final["audio.languages"], "de,en");
   assert.equal(final["buffered.ahead.s"], 30);
   assert.equal(final["quality.dropped.rate"], 0.005);
   assert.equal(final["event.waiting"], 1);
   assert.equal(final["session.waiting.ms"], 2000);
   assert.equal(final["event.seek"], 1);
   assert.equal(final["event.seek.distance.s"], 15);
   assert.equal(final["session.played.ms"], 17500);
   assert.equal(sent.length, 3);
   assert.equal(sent.at(-1).immediate, true);
   assert.equal(stored.at(-1).final, true);
});

test("coalesces ordinary samples to the report interval", () => {
   let clock = 0;
   const sent = [];
   const video = media();
   const observer = watch(video, { videoId: 7, sessionId: "bounded", now: () => clock,
      publish: (fields) => sent.push(fields), update: () => {}, page: new Target() });
   assert.equal(sent.length, 1);
   for (clock = 1_000; clock < 15_000; clock += 1_000) observer.sample("time");
   assert.equal(sent.length, 1);
   clock = 15_000;
   observer.sample("time");
   assert.equal(sent.length, 2);
   observer.finish();
   assert.equal(sent.length, 3);
});

test("reports through the installed fireservice sender", () => {
   const calls = [];
   globalThis.FireserviceCanary = {
      record: (...args) => calls.push(args),
      flush: () => calls.push(["flush"])
   };
   try {
      assert.equal(report({ "video.id": 9 }, true), true);
      assert.deepEqual(calls, [[6, "player", "video session", { "video.id": 9 }], ["flush"]]);
   } finally {
      delete globalThis.FireserviceCanary;
   }
});

test("keeps the current browser-store session and twenty recent finals", () => {
   let state = { current: null, recent: [] };
   state = remember(state, { "session.id": "live", "video.id": 1 });
   assert.equal(state.current["video.id"], 1);
   for (let index = 0; index < 22; index += 1) {
      state = remember(state, { "session.id": `session-${index}`, "video.id": index }, true);
   }
   assert.equal(state.current, null);
   assert.equal(state.recent.length, 20);
   assert.equal(state.recent[0]["video.id"], 21);
   assert.equal(state.recent.at(-1)["video.id"], 2);
});
