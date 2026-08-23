const REPORT_MS = 15_000;
const STORE_MS = 1_000;

const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const round = (value) => Math.round(value * 1000) / 1000;

function span(value, position = 0) {
   let seconds = 0;
   let ahead = 0;
   let count = 0;
   try {
      count = value?.length || 0;
      for (let index = 0; index < count; index += 1) {
         const start = value.start(index);
         const end = value.end(index);
         seconds += Math.max(0, end - start);
         if (end > position) ahead += Math.max(0, end - Math.max(start, position));
      }
   } catch {}
   return { count, seconds: round(seconds), ahead: round(ahead) };
}

function languages(value) {
   try {
      return Array.from(value || []).map((track) => track.language || track.srclang || "")
         .filter(Boolean).filter((item, index, all) => all.indexOf(item) === index).join(",");
   } catch { return ""; }
}

function identity() {
   try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

export function report(fields, immediate = false) {
   const canary = globalThis.FireserviceCanary;
   if (!canary || typeof canary.record !== "function") return false;
   canary.record(6, "player", "video session", fields);
   if (immediate && typeof canary.flush === "function") canary.flush();
   return true;
}

export function remember(state, snapshot, final = false) {
   if (!final) return { ...state, current: snapshot };
   const session = snapshot?.["session.id"];
   return {
      current: null,
      recent: [ snapshot, ...state.recent.filter((item) => item?.["session.id"] !== session) ].filter(Boolean).slice(0, 20)
   };
}

export function watch(media, {
   videoId,
   sessionId = identity(),
   publish = report,
   update = () => {},
   now = () => performance.now(),
   wall = () => Date.now(),
   page = typeof document === "undefined" ? null : document,
   reportMs = REPORT_MS,
   storeMs = STORE_MS
} = {}) {
   const began = now();
   const beganAt = new Date(wall()).toISOString();
   const state = {
      play: 0, pause: 0, waiting: 0, waitingMs: 0, seek: 0, seekSeconds: 0,
      ended: 0, errors: 0, playedMs: 0, visibleMs: 0, fullscreenMs: 0, pipMs: 0,
      playedAt: null, waitingAt: null, seekAt: null,
      visibleAt: page?.visibilityState === "hidden" ? null : began,
      fullscreenAt: page?.fullscreenElement ? began : null,
      pipAt: page?.pictureInPictureElement === media ? began : null,
      lastStore: -Infinity, lastReport: -Infinity, error: "", finished: false
   };
   const listeners = [];

   function listen(target, name, fn) {
      if (!target?.addEventListener) return;
      target.addEventListener(name, fn);
      listeners.push(() => target.removeEventListener(name, fn));
   }

   function accrue(time = now()) {
      if (state.playedAt != null) { state.playedMs += Math.max(0, time - state.playedAt); state.playedAt = time; }
      if (state.waitingAt != null) { state.waitingMs += Math.max(0, time - state.waitingAt); state.waitingAt = time; }
      if (state.visibleAt != null) { state.visibleMs += Math.max(0, time - state.visibleAt); state.visibleAt = time; }
      if (state.fullscreenAt != null) { state.fullscreenMs += Math.max(0, time - state.fullscreenAt); state.fullscreenAt = time; }
      if (state.pipAt != null) { state.pipMs += Math.max(0, time - state.pipAt); state.pipAt = time; }
   }

   function quality() {
      try { return media.getVideoPlaybackQuality?.() || {}; } catch { return {}; }
   }

   function snapshot(reason = "sample") {
      const time = now();
      accrue(time);
      const duration = finite(media.duration);
      const position = finite(media.currentTime) || 0;
      const buffered = span(media.buffered, position);
      const played = span(media.played, position);
      const q = quality();
      const total = finite(q.totalVideoFrames);
      const dropped = finite(q.droppedVideoFrames);
      const width = finite(media.videoWidth);
      const height = finite(media.videoHeight);
      const source = media.querySelector?.("source[type]");
      const audio = media.audioTracks;
      const text = media.textTracks;
      const fields = {
         "schema.version": 1,
         "video.id": finite(videoId),
         "session.id": sessionId,
         "session.started.at": beganAt,
         "session.reason": reason,
         "session.elapsed.ms": Math.round(Math.max(0, time - began)),
         "session.played.ms": Math.round(state.playedMs),
         "session.visible.ms": Math.round(state.visibleMs),
         "session.waiting.ms": Math.round(state.waitingMs),
         "session.fullscreen.ms": Math.round(state.fullscreenMs),
         "session.pip.ms": Math.round(state.pipMs),
         "media.duration.s": duration,
         "media.position.s": round(position),
         "media.completion": duration && duration > 0 ? round(Math.min(1, position / duration)) : null,
         "media.width.px": width,
         "media.height.px": height,
         "media.orientation": width && height ? (width > height ? "landscape" : width < height ? "portrait" : "square") : null,
         "media.type": media.currentType || source?.type || source?.getAttribute?.("type") || "",
         "media.ready.state": finite(media.readyState),
         "media.network.state": finite(media.networkState),
         "media.paused": !!media.paused,
         "media.ended": !!media.ended,
         "media.seeking": !!media.seeking,
         "media.rate": finite(media.playbackRate),
         "media.volume": finite(media.volume),
         "media.muted": !!media.muted,
         "audio.tracks": finite(audio?.length) || 0,
         "audio.languages": languages(audio),
         "text.tracks": finite(text?.length) || 0,
         "text.languages": languages(text),
         "buffered.ranges": buffered.count,
         "buffered.s": buffered.seconds,
         "buffered.ahead.s": buffered.ahead,
         "played.ranges": played.count,
         "played.s": played.seconds,
         "event.play": state.play,
         "event.pause": state.pause,
         "event.waiting": state.waiting,
         "event.seek": state.seek,
         "event.seek.distance.s": round(state.seekSeconds),
         "event.ended": state.ended,
         "event.error": state.errors,
         "error.code": finite(media.error?.code),
         "error.message": state.error,
         "quality.frames": total,
         "quality.dropped.frames": dropped,
         "quality.corrupted.frames": finite(q.corruptedVideoFrames),
         "quality.dropped.rate": total && dropped != null ? round(dropped / total) : null,
         "quality.video.bytes": finite(media.webkitVideoDecodedByteCount),
         "quality.audio.bytes": finite(media.webkitAudioDecodedByteCount),
         "mode.fullscreen": !!page?.fullscreenElement,
         "mode.pip": page?.pictureInPictureElement === media
      };
      return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null && value !== ""));
   }

   function emit(reason, immediate = false, final = false) {
      if (state.finished) return null;
      const time = now();
      const fields = snapshot(reason);
      if (immediate || time - state.lastStore >= storeMs) {
         update(fields, final);
         state.lastStore = time;
      }
      if (immediate || time - state.lastReport >= reportMs) {
         publish(fields, immediate);
         state.lastReport = time;
      }
      return fields;
   }

   listen(media, "loadedmetadata", () => emit("metadata", true));
   listen(media, "durationchange", () => emit("duration"));
   listen(media, "resize", () => emit("resize"));
   listen(media, "progress", () => emit("progress"));
   listen(media, "timeupdate", () => emit("time"));
   listen(media, "play", () => { state.play += 1; emit("play"); });
   listen(media, "playing", () => {
      const time = now();
      if (state.waitingAt != null) { state.waitingMs += Math.max(0, time - state.waitingAt); state.waitingAt = null; }
      if (state.playedAt == null) state.playedAt = time;
      emit("playing");
   });
   listen(media, "pause", () => {
      accrue();
      state.playedAt = null;
      state.pause += 1;
      emit("pause");
   });
   const wait = () => {
      accrue();
      state.playedAt = null;
      if (state.waitingAt == null) { state.waitingAt = now(); state.waiting += 1; }
      emit("waiting");
   };
   listen(media, "waiting", wait);
   listen(media, "stalled", wait);
   listen(media, "seeking", () => {
      accrue();
      state.playedAt = null;
      state.seekAt = finite(media.currentTime) || 0;
      state.seek += 1;
      emit("seeking");
   });
   listen(media, "seeked", () => {
      if (state.seekAt != null) state.seekSeconds += Math.abs((finite(media.currentTime) || 0) - state.seekAt);
      state.seekAt = null;
      if (!media.paused && !media.ended) state.playedAt = now();
      emit("seeked");
   });
   listen(media, "ratechange", () => emit("rate"));
   listen(media, "volumechange", () => emit("volume"));
   listen(media, "ended", () => {
      accrue();
      state.playedAt = null;
      state.ended += 1;
      emit("ended", true);
   });
   listen(media, "error", () => {
      state.errors += 1;
      state.error = String(media.error?.message || "media error").slice(0, 300);
      emit("error", true);
   });
   listen(page, "visibilitychange", () => {
      accrue();
      state.visibleAt = page.visibilityState === "hidden" ? null : now();
      emit("visibility", page.visibilityState === "hidden");
   });
   listen(page, "fullscreenchange", () => {
      accrue();
      state.fullscreenAt = page.fullscreenElement ? now() : null;
      emit("fullscreen");
   });
   listen(media, "enterpictureinpicture", () => { accrue(); state.pipAt = now(); emit("pip"); });
   listen(media, "leavepictureinpicture", () => { accrue(); state.pipAt = null; emit("pip"); });

   if (media.readyState > 0) emit("metadata", true);
   else emit("open");

   return {
      snapshot,
      sample: emit,
      finish(reason = "close") {
         const fields = emit(reason, true, true);
         state.finished = true;
         listeners.splice(0).forEach((remove) => remove());
         return fields;
      }
   };
}
