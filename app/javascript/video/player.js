// just: "the fullscreen video overlay for the video SPA. A thin Preact shell that drives the Vidstack
//        appliance. The shell owns everything shared: the 12px progress bar, the auto-hiding info
//        overlay, view registration, next-clips preloading, JS-fullscreen on the wrap, and the
//        imperative controller the key router (v/keys) drives through S.refs.player. The appliance
//        ultimately renders a native <video>, so all of the shared logic reads host.querySelector
//        ('video') uniformly. Only *mount* and *source-swap* live in the adapter below."
import { html } from "htm/preact";
import { useRef, useEffect, useState } from "preact/hooks";
import * as S from "video/store";
import { mountAppliance } from "video/appliance";
import { thumbError } from "video/thumbs";
import { buildSceneIndex, sceneTarget } from "video/scenes";
import { SceneStrip } from "video/scenes/strip";
import { Lighttable } from "video/lighttable";
import { mediaErrorDetail } from "video/media_error";
import { pickNext, rankPreloads, readPreloadStats, recordPreload } from "video/preload";
import { watch as watchTelemetry } from "video/telemetry";
import { Commander } from "video/commander";

const VIEW_AFTER_S = 5;           // register a view after this much playback (or the whole clip if shorter)
const PRELOAD_AHEAD = 2;          // keep a small lookahead without competing with the visible clip
const INFO_SHRINK_MS = 5000;      // info overlay: time the full-size title plays before shrinking

const META_CHIPS = 4;             // info overlay: how many tag/term chips to show inline

// — playback-start watchdog thresholds (seconds since a clip was shown, until it actually plays) —
const STALL_WARN_S  = 5;          // a clip that hasn't started by here is slow — warn
const STALL_ERROR_S = 30;         // …still not playing by here — error (the load has effectively failed)
const ABANDON_S     = 15;         // moving on from a clip that never started after >= this long is itself an error

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function mmss(secs) {
   if (!isFinite(secs) || secs < 0) secs = 0;
   const m = Math.floor(secs / 60), s = Math.floor(secs % 60);
   return `${m}:${String(s).padStart(2, "0")}`;
}

// uploader/channel · resolution · fps · duration · ★rating — only the parts we actually have
function metaLine(v) {
   const bits = [];
   if (v.resolution) bits.push(String(v.resolution));
   else if (v.width && v.height) bits.push(`${v.width}×${v.height}`);
   if (v.fps) bits.push(`${v.fps} fps`);
   if (v.duration != null) bits.push(mmss(v.duration));
   return bits.join(" · ");
}

// wrap a value in double quotes if it contains whitespace (mirrors maybeQuote in video/query.js) so the
// command-bar grammar treats a multi-word label as one value, e.g. tag:"big ass".
function maybeQuote(v) { v = String(v); return /\s/.test(v) ? `"${v}"` : v; }

// just: "visually zoom the rendered <video> so only the detected crop region shows. With the host
//        clipping overflow, scaling the full raw frame to *cover* the crop sub-rect (anchored at the
//        crop's center) leaves only the crop region visible. Clears the transform when there's no crop."
function applyCrop(videoEl, v) {
   if (!videoEl) return;                              // <video> not bound yet (async) — no-op safely
   if (!v || !v.crop || !v.width || !v.height) {
      videoEl.style.transform = "";
      videoEl.style.transformOrigin = "";
      return;
   }
   const W = v.width, H = v.height;
   const { x, y, w, h } = v.crop;
   const s = Math.max(W / w, H / h);                  // cover: crop fully fills
   // NB: no CSS rotation — browsers already honor the container's rotation metadata; double-rotating
   //     here would be wrong.
   videoEl.style.transformOrigin = ((x + w / 2) / W * 100) + "% " + ((y + h / 2) / H * 100) + "%";
   videoEl.style.transform = "scale(" + s + ")";
}

// — the Vidstack appliance adapter: the only media player. The shell varies only mount + source-swap.
//   shape: { async mount(host, opts) -> handle, async load(handle, src, {title}), destroy(handle),
//            video(handle, host) -> <video> }.  opts: { src, title, fullscreenElement, autoplay, onEnded } —
const adapter = {
   async mount(host, { src, title, fullscreenElement, autoplay, onEnded }) {
      const app = mountAppliance(host, {
         title: title || "", src, autoplay: autoplay !== false,
         fullscreenElement, onEnded
         // NB: no onView — the shell tracks views itself off the underlying <video>.
      });
      await app.ready;
      return { app };
   },
   async load(handle, src, { title } = {}) { await handle.app.load(src, { title: title || "" }); },
   destroy(handle) { try { handle.app.destroy(); } catch {} },
   video(handle, host) { return host.querySelector("video"); }
};

export function Player() {
   // touching the signal here subscribes the component: it re-renders on open/index/pin changes
   const state = S.player.value;
   const videos = S.videos.value;
   const open = state.open;
   // Resolve the shown clip by ID first (state.id), falling back to the index. The grid list mutates
   // under the player (rate-mode removes rated cards, refetches replace the page), which shifts every
   // index — anchoring on the id keeps the title bound to the clip actually loaded in the <video>.
   const video = videos.find(v => v && v.id === state.id) || videos[state.index] || null;
   const detailsOpen = S.detailsOpen.value;   // subscribe: overlay shows/hides reactively
   const details = S.details.value;           // subscribe: re-render when a details payload arrives
   const detailsSpace = S.detailsSpace.value; // subscribe: re-render the space selector on change

   const wrapRef = useRef(null);     // .v-player-wrap — also the fullscreen target (so `f` fills it)
   const hostRef = useRef(null);     // .v-player-host — the active adapter mounts here
   const progRef = useRef(null);     // .v-progress
   const infoRef = useRef(null);     // .v-info
   const preRef  = useRef(null);     // hidden pool host: <video preload="auto"> per warmed upcoming clip
   const preloadRef = useRef({ queue: [], entries: new Map(), stats: readPreloadStats() });

   const adRef    = useRef(adapter); // the media adapter (Vidstack)
   const handleRef = useRef(null);   // the adapter's mount handle (null => not mounted)
   const mountingRef = useRef(false); // guard: a mount() is in flight (async)
   const vidRef   = useRef(null);    // underlying <video> of the current clip
   const idxRef   = useRef(state.index);  // latest index for closures
   const detachRef = useRef(null);   // listener-cleanup fn for the current <video>
   const telemetryRef = useRef(null);
   const viewRef  = useRef({ playedMs: 0, thresholdMs: VIEW_AFTER_S * 1000, fired: false, timer: null });
   // playback-start watchdog state for the currently-shown clip (see armLoadWatch below)
   const loadRef  = useRef({ t5: null, t30: null, startedAt: 0, started: false, failed: false, armedId: null, armedV: null });

   idxRef.current = state.index;

   // — info overlay: title + a tidy metadata block (category / tags / terms) at the bottom. Shows BIG
   //   (serif, ~h1) on each new clip and whenever `i` is toggled; after 5s it smoothly shrinks via a
   //   CSS font-size/opacity transition — either fading out (i off) or settling to a small off-white pinned
   //   label (i on). `i` (overlayPinned) is persisted across reloads (see toggleOverlay). —
   // BIG (title + key metadata) on each new clip, then at INFO_SHRINK_MS it shrinks (animated) to a
   // small persistent label — the FULL, readable metadata lives in the `d` details panel. `i` hides
   // the label entirely for a clean screen (overlayPinned ⇒ hidden); persisted across reloads.
   const [ infoStage, setInfoStage ] = useState(state.overlayPinned ? "hidden" : "small");

   // — buffering overlay stage, driven by the playback-start watchdog (armLoadWatch + its t5/t30
   //   timers). "loading" the moment a clip is shown → "warn" at STALL_WARN_S → "error" at
   //   STALL_ERROR_S → "hidden" once playback starts (markPlaybackStarted) or the player closes.
   //   The setter is held in a ref so the watchdog's plain callbacks always reach the live one. —
   const [ loadStage, setLoadStage ] = useState("hidden");   // "hidden" | "loading" | "warn" | "error"
   const loadStageRef = useRef(setLoadStage);
   loadStageRef.current = setLoadStage;
   const [ loadError, setLoadError ] = useState("");
   const loadErrorRef = useRef(setLoadError);
   loadErrorRef.current = setLoadError;

   // — scene seek (`⌘←/→` + the `s` strip): per-clip SceneIndex built lazily by video/scenes.
   //   State drives the strip; the ref mirrors it for the imperative controller (registered once)
   //   and owns the AbortController so a clip change/close cancels the analysis mid-build. —
   const [ sceneUI, setSceneUI ] = useState({ open: false, status: "idle", index: null, progress: null });
   const sceneUIRef = useRef(sceneUI);
   sceneUIRef.current = sceneUI;
   const sceneRef = useRef({ abort: null, forId: null, open: false });
   const [ lighttableMode, setLighttableMode ] = useState("closed");
   const lighttableModeRef = useRef(lighttableMode);
   lighttableModeRef.current = lighttableMode;

   function buildScenes(v) {
      if (!v || v.id == null) return;
      if (sceneRef.current.forId === v.id && sceneUIRef.current.status !== "idle") return;
      sceneRef.current.abort?.abort();
      const ac = new AbortController();
      sceneRef.current.abort = ac;
      sceneRef.current.forId = v.id;
      sceneUIRef.current = { ...sceneUIRef.current, status: "building", index: null, progress: { stage: "index", frac: 0 } };
      setSceneUI(u => ({ ...u, status: "building", index: null, progress: { stage: "index", frac: 0 } }));
      buildSceneIndex(v, {
         signal: ac.signal,
         onProgress: (stage, frac) => {
            if (!ac.signal.aborted) setSceneUI(u => (u.status === "building" ? { ...u, progress: { stage, frac } } : u));
         }
      }).then(index => {
         if (ac.signal.aborted) return;
         setSceneUI(u => ({ ...u, status: index ? "ready" : "none", index }));
      }).catch(() => {
         if (!ac.signal.aborted) setSceneUI(u => ({ ...u, status: "none", index: null }));
      });
   }

   // clip changed: drop the old index/build; if the strip is open, analyze the new clip right away
   function resetScenesFor(v) {
      sceneRef.current.abort?.abort();
      sceneRef.current.forId = null;
      setSceneUI(u => ({ ...u, status: "idle", index: null, progress: null }));
      if ((sceneRef.current.open || lighttableModeRef.current !== "closed") && v) buildScenes(v);
   }
   useEffect(() => {
      if (!video) { setInfoStage("hidden"); return; }
      if (S.player.value.overlayPinned) { setInfoStage("hidden"); return; }   // `i` = hide the label
      setInfoStage("big");
      const t = setTimeout(() => setInfoStage("small"), INFO_SHRINK_MS);      // shrink + retain (small)
      return () => clearTimeout(t);
   }, [ video && video.id, state.overlayPinned ]);

   // — fetch the closest similar videos + metadata for a clip, and hide any stale overlay —
   function loadDetails(v) {
      S.detailsOpen.value = false;
      if (v?.id != null) {
         S.api.fetchDetails(v.id, S.detailsSpace.value);
         S.api.fetchCommander(v.id, [], "");
      }
   }

   // — end-of-video: reveal the details overlay over the paused clip (and ensure details are fresh) —
   function revealDetails() {
      const v = S.videos.value[idxRef.current];
      const d = S.details.value;
      if (v && (!d || d.video_id !== v.id)) S.api.fetchDetails(v.id, S.detailsSpace.value);   // (re)fetch if stale/missing
      S.detailsOpen.value = true;
   }

   // — switch the embedding neighbourhood ("image" | "text" | "joint") and re-request neighbours —
   function selectSpace(sp) {
      if (S.detailsSpace.value === sp) return;
      S.detailsSpace.value = sp;
      const v = S.videos.value[idxRef.current];
      if (v?.id != null) S.api.fetchDetails(v.id, sp);
   }

   // — play one of the "similar" videos from the overlay: jump to it in the playlist if already
   //   loaded, else append it and open the new tail. Either way the overlay closes. —
   function playSimilar(v) {
      if (!v || v.id == null) return;
      const list = S.videos.value;
      let i = list.findIndex(x => x && x.id === v.id);
      if (i < 0) { S.videos.value = [ ...list, v ]; i = S.videos.value.length - 1; }
      openIndex(i);
      S.detailsOpen.value = false;
   }

   // — a metadata chip ran: search for it and tear the player overlay down so the grid shows results.
   //   kind "tag"/"category" become a key:value filter (label quoted if it has spaces); "term" is a
   //   bare semantic-search word (quoted only when it would otherwise tokenize as several words). —
   function searchChip(kind, label) {
      const text = String(label || "").trim();
      if (!text) return;
      const q = kind === "term" ? maybeQuote(text) : `${kind}:${maybeQuote(text)}`;
      S.api.runQuery(q);
      S.detailsOpen.value = false;
      S.player.value = { ...S.player.value, open: false };
   }

   // — render one clickable metadata chip. `item` is { label, en } from details.meta. The chip always
   //   shows the original label; when an English translation is present it's shown alongside in a muted
   //   span. The search always uses the ORIGINAL label (that's what the DB rows carry). —
   function chip(kind, item) {
      const label = String(item?.label ?? item ?? "");
      const en = item && item.en ? String(item.en) : "";
      return html`
         <button class=${"v-chip v-chip--" + kind} title=${(kind === "term" ? "search " : kind + ": ") + label}
                 onClick=${() => searchChip(kind, label)}>
            <span class="v-chip-label">${label}</span>
            ${en && en !== label ? html`<span class="v-chip-en">${en}</span>` : null}
         </button>`;
   }

   // — progress bar driven by the live <video> —
   function onTime() {
      const v = vidRef.current, bar = progRef.current;
      if (!v) return;
      if (v.currentTime > 0) markPlaybackStarted();   // frames are advancing — the load demonstrably succeeded
      if (!bar) return;
      const pct = v.duration ? (v.currentTime / v.duration) * 100 : 0;
      bar.style.width = `${pct}%`;
   }

   // — view tracking: count real playback; fire S.api.registerView once —
   function resetView() {
      const vw = viewRef.current;
      if (vw.timer) clearInterval(vw.timer);
      vw.timer = null; vw.playedMs = 0; vw.fired = false;
   }
   function startViewTimer() {
      const vw = viewRef.current;
      if (vw.fired || vw.timer) return;
      vw.timer = setInterval(() => {
         vw.playedMs += 250;
         if (vw.playedMs >= vw.thresholdMs) {
            vw.fired = true; clearInterval(vw.timer); vw.timer = null;
            const st = S.player.value;
            const cur = S.videos.value.find(v => v && v.id === st.id) || S.videos.value[idxRef.current];
            S.api.registerView(cur?.id);
         }
      }, 250);
   }
   function stopViewTimer() {
      const vw = viewRef.current;
      if (vw.timer) { clearInterval(vw.timer); vw.timer = null; }
   }

   // — playback-start watchdog: a clip that's been shown but never actually plays is a stall. Warn at
   //   STALL_WARN_S, error at STALL_ERROR_S, and if the user moves on (next/prev/jump/close) from a
   //   clip that's been failing to start for >= ABANDON_S, that abandonment is itself an error. "Started"
   //   = the native <video> fires `playing` (or currentTime advances), which stands the watchdog down.
   //   All three go through console.warn/console.error so they ship to the observability console. —
   function clipLabel(v) {
      if (!v) return "(no clip)";
      return `#${v.id ?? "?"} ${JSON.stringify(v.title || "Untitled")}`;
   }
   function clearLoadWatch() {
      const w = loadRef.current;
      if (w.t5)  { clearTimeout(w.t5);  w.t5 = null; }
      if (w.t30) { clearTimeout(w.t30); w.t30 = null; }
   }
   function failPlayback(v, detail) {
      const w = loadRef.current;
      if (w.failed) return false;
      w.failed = true;
      clearLoadWatch();
      loadErrorRef.current(detail || "media load failed");
      loadStageRef.current("error");
      return true;
   }
   // the current clip actually began playing — the load succeeded, so cancel the pending warn/error
   function markPlaybackStarted() {
      const w = loadRef.current;
      if (w.started) return;
      w.started = true;
      if (w.armedV && w.startedAt) {
         preloadRef.current.stats = recordPreload(preloadRef.current.stats, w.armedV, performance.now() - w.startedAt);
      }
      clearLoadWatch();
      loadErrorRef.current("");
      loadStageRef.current("hidden");   // frames are rolling — drop the buffering overlay
   }
   // judge the clip we're leaving: if it never started after >= ABANDON_S of trying, that's an error.
   // Skipped once the STALL_ERROR_S timer already fired (`failed`) so we don't double-log the same clip.
   function checkAbandonedLoad() {
      const w = loadRef.current;
      if (w.armedId == null || w.started || w.failed || !w.startedAt) return;
      const waited = (performance.now() - w.startedAt) / 1000;
      if (waited >= ABANDON_S) {
         console.error(`[v] player: moved on from ${clipLabel(w.armedV)} after ${waited.toFixed(1)}s of unsuccessful loading`);
      }
   }
   // (re)arm the watchdog for a freshly-shown clip: judge the outgoing clip first, then reset + schedule
   function armLoadWatch(v) {
      checkAbandonedLoad();        // the clip we're leaving may have been stuck — log before we reset state
      clearLoadWatch();
      const w = loadRef.current;
      w.started = false; w.failed = false;
      w.startedAt = performance.now();
      w.armedId = v?.id ?? null;
      w.armedV = v || null;
      loadErrorRef.current("");
      loadStageRef.current("loading");   // show the subtle buffering overlay until `playing` fires
      w.t5 = setTimeout(() => {
         if (loadRef.current.started) return;
         // only warn if this clip is still the currently-selected clip; transient/preload clips silently timeout
         if (S.player.value.id !== v?.id) return;
         loadStageRef.current("warn");    // STALL_WARN_S passed — escalate to "still loading…"
         console.warn(`[v] player: ${clipLabel(v)} has not started playing after ${STALL_WARN_S}s`);
      }, STALL_WARN_S * 1000);
      w.t30 = setTimeout(() => {
         if (loadRef.current.started) return;
         // only error if this clip is still the currently-selected clip; transient/preload clips fail silently
         if (S.player.value.id !== v?.id) return;
         if (failPlayback(v, `no playback after ${STALL_ERROR_S}s`))
            console.error(`[v] player: ${clipLabel(v)} still not playing after ${STALL_ERROR_S}s`);
      }, STALL_ERROR_S * 1000);
   }

   // attach listeners to the freshly-mounted/loaded <video>; detach the previous one first
   function bindVideo() {
      detachRef.current?.();
      const v = adRef.current?.video(handleRef.current, hostRef.current) || hostRef.current?.querySelector("video");
      vidRef.current = v || null;
      if (!v) return;
      const onPlay = () => { startViewTimer(); };
      const onPause = () => { stopViewTimer(); };
      const onPlaying = () => { markPlaybackStarted(); };   // real frames are rolling — stand the watchdog down
      const onError = () => { failPlayback(S.videos.value.find(x => x?.id === S.player.value.id), mediaErrorDetail(v)); };
      const onMeta = () => {
         const d = v.duration;
         viewRef.current.thresholdMs = (isFinite(d) && d > 0 && d < VIEW_AFTER_S ? d : VIEW_AFTER_S) * 1000;
      };
      v.addEventListener("timeupdate", onTime);
      v.addEventListener("play", onPlay);
      v.addEventListener("playing", onPlaying);
      v.addEventListener("pause", onPause);
      v.addEventListener("loadedmetadata", onMeta);
      v.addEventListener("error", onError);
      detachRef.current = () => {
         v.removeEventListener("timeupdate", onTime);
         v.removeEventListener("play", onPlay);
         v.removeEventListener("playing", onPlaying);
         v.removeEventListener("pause", onPause);
         v.removeEventListener("loadedmetadata", onMeta);
         v.removeEventListener("error", onError);
      };
      onMeta();
      onTime();
      // apply (or clear) the crop zoom for the now-current clip — re-runs on every clip change
      applyCrop(v, S.videos.value[idxRef.current]);
      const current = S.videos.value.find((item) => item?.id === S.player.value.id) || S.videos.value[idxRef.current];
      telemetryRef.current = watchTelemetry(v, { videoId: current?.id, update: S.setTelemetry });
   }

   function stopTelemetry(reason) {
      telemetryRef.current?.finish(reason);
      telemetryRef.current = null;
   }

   function disposePreload(id) {
      const p = preloadRef.current;
      const entry = p.entries.get(id);
      if (!entry) return;
      p.entries.delete(id);
      try { entry.el.removeAttribute("src"); entry.el.load(); } catch {}
      entry.el.remove();
   }

   function syncPreloadQueue(i, reset = false) {
      const p = preloadRef.current;
      const list = S.videos.value;
      const currentId = S.player.value.id;
      const valid = new Set(list.map(v => v?.id).filter(id => id != null));
      const queue = reset ? [] : p.queue.filter(id => valid.has(id) && id !== currentId);
      const present = new Set(queue);
      for (const v of list.slice(Math.max(0, i + 1))) {
         if (v?.id == null || v.id === currentId || present.has(v.id)) continue;
         queue.push(v.id);
         present.add(v.id);
      }
      p.queue = queue;
      return queue;
   }

   function preloadNext(i, reset = false) {
      const host = preRef.current;
      if (!host) return;
      const p = preloadRef.current;
      const list = S.videos.value;
      const queue = syncPreloadQueue(i, reset);
      const byId = new Map(list.map(v => [v?.id, v]));
      const ranked = rankPreloads(queue.map(id => byId.get(id)).filter(v => v?.play_url), p.stats);
      const immediate = byId.get(queue[0]);
      const candidates = ranked.slice(0, PRELOAD_AHEAD);
      if (immediate?.play_url && !candidates.some(v => v.id === immediate.id)) {
         candidates.splice(PRELOAD_AHEAD - 1, 1, immediate);
      }
      const wanted = new Set(candidates.map(v => v.id));

      for (const id of Array.from(p.entries.keys())) if (!wanted.has(id)) disposePreload(id);
      for (const v of candidates) {
         const existing = p.entries.get(v.id);
         if (existing?.src === v.play_url) continue;
         if (existing) disposePreload(v.id);
         const el = document.createElement("video");
         const entry = { id: v.id, src: v.play_url, el, state: "loading", startedAt: performance.now() };
         p.entries.set(v.id, entry);
         const ready = () => {
            if (entry.state === "ready") return;
            entry.state = "ready";
            p.stats = recordPreload(p.stats, v, performance.now() - entry.startedAt);
         };
         el.addEventListener("canplay", ready, { once: true });
         el.addEventListener("error", () => { entry.state = "error"; }, { once: true });
         el.preload = "auto";
         el.muted = true;
         el.playsInline = true;
         el.fetchPriority = "low";
         el.style.display = "none";
         el.dataset.id = String(v.id);
         el.src = v.play_url;
         host.appendChild(el);
      }
   }

   // tear down every warmed clip so closing the player stops all background downloads
   function clearPreload() {
      const p = preloadRef.current;
      for (const id of Array.from(p.entries.keys())) disposePreload(id);
      p.queue = [];
   }

   function playQueued(preferredId = null) {
      const list = S.videos.value;
      syncPreloadQueue(idxRef.current);
      const p = preloadRef.current;
      if (preferredId != null && list.some(v => v?.id === preferredId)) {
         p.queue = [preferredId, ...p.queue.filter(id => id !== preferredId)];
      }
      const ready = new Set(Array.from(p.entries.values()).filter(entry => entry.state === "ready").map(entry => entry.id));
      const id = pickNext(p.queue, ready);
      if (id == null) return;
      const i = list.findIndex(v => v?.id === id);
      if (i < 0) return;
      p.queue = p.queue.filter(queuedId => queuedId !== id);
      disposePreload(id);
      const next = list[i];
      S.player.value = { ...S.player.value, index: i, id: next.id };
      idxRef.current = i;
      loadDetails(next);
      showVideo(next);
      preloadNext(i);
   }

   // mount the adapter onto `host`, optionally seeking to `startTime` once ready
   async function mountAdapter(v, startTime) {
      const ad = adRef.current;
      mountingRef.current = true;
      let handle;
      try {
         handle = await ad.mount(hostRef.current, {
            src: v.play_url,
            title: v.title || "",
            autoplay: true,
            fullscreenElement: wrapRef.current,      // `f` fills our overlay, not the bare player
            // end of clip: reveal the details overlay over the paused video instead of auto-advancing
            onEnded: () => { revealDetails(); }
         });
      } catch (error) {
         // mount failed (e.g. an unplayable clip) — clear the in-flight flag and leave handleRef
         // null so the next step()/openIndex() can retry a fresh mount instead of wedging here.
         mountingRef.current = false;
         if (failPlayback(v, error?.message || "player mount failed"))
            console.error(`[v] player: mount failed for ${clipLabel(v)}: ${error?.message || error}`);
         return;
      }
      mountingRef.current = false;
      handleRef.current = handle;
      resetView();
      bindVideo();
      if (startTime) { try { vidRef.current.currentTime = startTime; } catch {} }
   }

   // destroy whatever adapter is mounted and clear the host DOM
   function destroyAdapter() {
      stopTelemetry("destroy");
      detachRef.current?.(); detachRef.current = null;
      stopViewTimer();
      clearLoadWatch();
      if (adRef.current && handleRef.current) {
         try { adRef.current.destroy(handleRef.current, hostRef.current); } catch {}
      }
      handleRef.current = null;
      vidRef.current = null;
      if (hostRef.current) hostRef.current.innerHTML = "";
   }

   // swap-or-mount body shared by openIndex + step: reuse the mounted handle via its load()
   // (reset view, swap source, re-bind, show overlay), or mount the adapter the first time.
   // Returns the load/mount promise; callers own open-state, index, preload and trailing overlay.
   function showVideo(v) {
      stopTelemetry("source");
      resetScenesFor(v);   // scene index is per-clip: abort any running analysis, rebuild if open
      // No inline playback at all — no server stream (a CF-walled provider whose
      // stream never resolves). Don't mount a <video> that can only fail; hand the clip to its own
      // focused browser tab instead.
      if (v && !v.play_url) {
         armLoadWatch(v);
         if (handleRef.current) destroyAdapter();
         if (failPlayback(v, "source disabled"))
            console.error(`[v] player: source disabled for ${clipLabel(v)}`);
         return Promise.resolve();
      }
      armLoadWatch(v);   // start (or restart) the playback-start watchdog for this clip
      if (handleRef.current) {
         resetView();
         // a failed source swap (unplayable clip) must not break navigation: re-bind either way so
         // the next step() still loads the following clip.
         return adRef.current.load(handleRef.current, v.play_url, { title: v.title || "" })
            .then(() => { bindVideo(); })
            .catch((error) => {
               bindVideo();
               if (failPlayback(v, error?.message || "source load failed"))
                  console.error(`[v] player: source load failed for ${clipLabel(v)}: ${error?.message || error}`);
            });
      }
      if (!mountingRef.current) return mountAdapter(v);
      return Promise.resolve();
   }

   // open / swap to videos[i]: mount the adapter the first time, reuse via its load() thereafter
   async function openIndex(i) {
      const list = S.videos.value;
      i = clamp(i, 0, list.length - 1);
      const v = list[i];
      if (!v) return;
      S.player.value = { ...S.player.value, open: true, index: i, id: v.id };
      idxRef.current = i;
      // A still-focused command-bar <input> swallows every key (video/keys yields to text inputs),
      // so the player ignores ←/→/space/etc. until you click it. Drop focus off any text input NOW
      // (→ document.body, which the key router governs) so keys work during the async mount below…
      try {
         const ae = document.activeElement;
         if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT" || ae.isContentEditable)) ae.blur();
      } catch { /* ignore */ }
      loadDetails(v);                                    // prefetch details; hide any stale overlay
      await showVideo(v);
      preloadNext(i, true);
      // …then give the overlay a stable focus home. Done AFTER the adapter mounts: Vidstack grabs
      // focus while it initializes, so focusing the wrap earlier wouldn't stick. (preventScroll: no
      // page jump; the wrap carries tabindex=-1 so it holds focus without being tab-reachable.)
      try { wrapRef.current?.focus?.({ preventScroll: true }); } catch { /* ignore */ }
   }

   // — register the imperative controller for the key router (v/keys) —
   useEffect(() => {
      S.refs.player = {
         isOpen() { return S.player.value.open; },
         // The clip actually loaded in the <video>, resolved by id (the index can be shifted by a
         // list mutation). This is the rating target, so a rate always lands on the playing clip.
         currentVideo() {
            const list = S.videos.value, st = S.player.value;
            return list.find(v => v && v.id === st.id) || list[st.index] || null;
         },
         detailsActive() { return S.detailsOpen.value; },
         commanderActive() { return S.detailsOpen.value; },
         openIndex(i) { openIndex(i); },

         togglePlay() {
            const v = vidRef.current;
            if (!v) return;
            if (v.paused) v.play?.().catch(() => {}); else v.pause?.();
         },

         toggleFullscreen() {
            if (document.fullscreenElement) document.exitFullscreen?.();
            else wrapRef.current?.requestFullscreen?.();
         },

         seek(secs, count = 1) {
            const v = vidRef.current;
            if (!v) return;
            const n = Math.max(1, Math.floor(Number(count) || 1));
            const hi = isFinite(v.duration) && v.duration > 0 ? v.duration : 1e9;
            let t = isFinite(v.currentTime) ? v.currentTime : 0;
            for (let i = 0; i < n; i++) {
               t = clamp(t + secs, 0, hi);
               try {
                  if (typeof v.fastSeek === "function") v.fastSeek(t);
                  else v.currentTime = t;
               } catch {
                  try { v.currentTime = t; } catch {}
               }
               if (t === 0 || t === hi) break;
            }
            onTime();
         },

         // ⌘←/→ — jump between SCENES. With a ready index it's chapter-style boundary seek;
         // before/without one it falls back to ±60s (and kicks the analysis off so the next
         // press lands on real boundaries).
         seekScene(dir) {
            const v = vidRef.current;
            if (!v) return;
            const ui = sceneUIRef.current;
            const cur = this.currentVideo();
            if (ui.status === "ready" && ui.index && sceneRef.current.forId === cur?.id) {
               const t = sceneTarget(ui.index, v.currentTime || 0, dir);
               if (t == null) return;                         // already in the last scene
               try {
                  if (typeof v.fastSeek === "function") v.fastSeek(t);
                  else v.currentTime = t;
               } catch { try { v.currentTime = t; } catch {} }
               onTime();
               return;
            }
            if (ui.status === "idle") buildScenes(cur);
            this.seek(dir * 60);
         },

         // `s` — the scene strip; opening it starts (or resumes) the analysis for this clip
         toggleScenes() {
            const on = !sceneRef.current.open;
            sceneRef.current.open = on;
            setSceneUI(u => ({ ...u, open: on }));
            if (on && sceneUIRef.current.status === "idle") buildScenes(this.currentVideo());
         },

         lighttableActive() { return lighttableModeRef.current !== "closed"; },

         toggleLighttable() {
            const current = lighttableModeRef.current;
            const next = current === "closed" ? "uniform" : current === "uniform" ? "scenes" : "closed";
            lighttableModeRef.current = next;
            setLighttableMode(next);
            if (next !== "closed" && sceneUIRef.current.status === "idle") buildScenes(this.currentVideo());
            if (next === "closed" && !sceneRef.current.open) sceneRef.current.abort?.abort();
         },

         closeLighttable() {
            lighttableModeRef.current = "closed";
            setLighttableMode("closed");
            if (!sceneRef.current.open) sceneRef.current.abort?.abort();
         },

         step(dir) {
            if (dir > 0) { playQueued(); return; }
            const list = S.videos.value;
            const i = clamp(idxRef.current + dir, 0, list.length - 1);
            if (i === idxRef.current) return;                   // already at an end
            const next = list[i];
            if (!next) return;
            S.player.value = { ...S.player.value, index: i, id: next.id };
            idxRef.current = i;
            loadDetails(next);                                  // prefetch details; hide any stale overlay
            showVideo(next);                                    // swap source (fullscreen persists) or mount
            preloadNext(i, true);
         },

         advance(id) { playQueued(id); },

         // Show a specific clip BY ID, re-resolving its current index against the live list. Used by
         // the rapid-rate flow to advance to the genuine next clip even after the rated card was
         // removed from S.videos (which shifts indices) — keeps the <video>, title and rate target
         // all pointing at the same clip.
         showById(id) {
            const list = S.videos.value;
            const i = list.findIndex(v => v && v.id === id);
            if (i < 0) return;
            S.player.value = { ...S.player.value, index: i, id };
            idxRef.current = i;
            loadDetails(list[i]);
            showVideo(list[i]);
            preloadNext(i, true);
         },

         toggleOverlay() {   // `i`: hide/show the small info label (full metadata is in `d`); persisted
            const on = !S.player.value.overlayPinned;
            S.player.value = { ...S.player.value, overlayPinned: on };
            try { localStorage.setItem("v.info", on ? "1" : "0"); } catch { /* ignore */ }
         },

         // details overlay (metadata chips + similar videos) — flipped by the on-screen switch
         // (keybindable later). Ensures details are fresh for the current clip when opening.
         toggleDetails() {
            const willOpen = !S.detailsOpen.value;
            if (willOpen) {
               const v = S.videos.value[idxRef.current];
               const d = S.details.value;
               if (v && (!d || d.video_id !== v.id)) S.api.fetchDetails(v.id, S.detailsSpace.value);
            }
            S.detailsOpen.value = willOpen;
         },

         close() {
            if (document.fullscreenElement) document.exitFullscreen?.();
            lighttableModeRef.current = "closed";
            setLighttableMode("closed");
            sceneRef.current.abort?.abort();                 // stop any scene analysis with the player
            checkAbandonedLoad();                            // closing on a stuck clip counts as moving on
            clearLoadWatch();
            loadStageRef.current("hidden");                  // drop any buffering overlay on close
            loadRef.current.armedId = null;                  // disarm so a later reopen judges cleanly
            stopTelemetry("close");
            try { vidRef.current?.pause?.(); } catch {}
            clearPreload();                                  // stop warming clips we won't skip to now
            S.player.value = { ...S.player.value, open: false };
         }
      };

      return () => {
         S.refs.player = null;
         destroyAdapter();
      };
   }, []);

   const wrapClass = open ? "v-player-wrap is-open" : "v-player-wrap";

   // — touch: swipe left/right on the media area steps next/previous (the keyboard-free ↑/↓).
   //   The gesture starts anywhere that isn't a control or the details overlay; on release a
   //   dominantly-horizontal move of ≥70px steps. Handled in CAPTURE on pointerup so a committed
   //   swipe can stop the event before Vidstack's own pointerup gesture toggles pause under it. —
   const gestRef = useRef(null);
   const SWIPE_PX = 70;
   // The 1–9 rating BUTTON row was removed (2026-07-30) — it sat on top of the clip, covering the
   // thing being judged. Rating itself is unchanged: the 1–9 keys still rate and advance (video/keys
   // → S.api.rateAndAdvance), ⌥/Alt + 0–9 rates without advancing, and the swipe deck rates by
   // gesture. `.v-rate` stays in the gesture guard below so an older cached bundle, or any future
   // rating control reusing the class, still suppresses the swipe.
   const gestGuard = ".v-details, .v-swipe, .v-rate, button, a, input, select, textarea, media-control-bar, media-time-slider, media-time-range, [role=slider]";
   const onWrapDown = (e) => {
      if (e.target?.closest?.(gestGuard)) { gestRef.current = null; return; }
      gestRef.current = { x: e.clientX, y: e.clientY };
   };
   const onWrapUp = (e) => {
      const g = gestRef.current;
      gestRef.current = null;
      if (!g) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < 2 * Math.abs(dy)) return;
      e.stopPropagation(); e.preventDefault();          // keep Vidstack's tap gesture from also firing
      S.refs.player?.step(dx < 0 ? 1 : -1);             // swipe left → next clip, right → previous
   };

   // details ready only when the payload matches the current clip; else the overlay shows "loading…"
   const detailsReady = !!(video && details && details.video_id === video.id);
   const similar = detailsReady ? (details.similar || []) : [];
   const meta    = detailsReady ? (details.meta || null) : null;

   // — info overlay metadata: category + first few tags + first few terms. Prefer the translated
   //   English from details.meta when it's already loaded for this clip; else fall back to the raw
   //   strings on the video object so something shows the instant the clip opens. —
   function infoBits() {
      if (!video) return [];
      const bits = [];
      if (meta) {
         if (meta.category) bits.push(meta.category.en || meta.category.label);
         (meta.tags || []).slice(0, META_CHIPS).forEach(t => bits.push(t.en || t.label));
         (meta.terms || []).slice(0, META_CHIPS).forEach(t => bits.push(t.en || t.label));
      } else {
         if (video.category) bits.push(video.category);
         (video.tags || []).slice(0, META_CHIPS).forEach(t => bits.push(t));
         (video.terms || []).slice(0, META_CHIPS).forEach(t => bits.push(t));
      }
      // tags and terms often overlap — dedupe (case-insensitively) so the overlay stays tidy.
      const seen = new Set();
      return bits.filter(Boolean).filter(b => { const k = String(b).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
   }

   return html`
      <div class=${wrapClass} ref=${wrapRef} tabindex="-1"
           onPointerDown=${onWrapDown} onPointerUpCapture=${onWrapUp}
           onPointerCancel=${() => { gestRef.current = null; }}>
         <div class="v-progress" ref=${progRef}></div>
         <div class="v-player-host" ref=${hostRef}></div>

         ${loadStage !== "hidden" && html`
            <div class=${"v-loading v-loading--" + loadStage}>
               <span class="v-loading-spinner"></span>
               <span class="v-loading-text">
                  ${loadStage === "error"
                     ? loadError || "couldn’t load this clip"
                     : loadStage === "warn" ? "still loading…" : "loading…"}
               </span>
               ${loadStage === "error" && video?.source_url && html`
                  <a class="v-loading-source" href=${video.source_url} target="_blank" rel="noopener">open source</a>`}
            </div>
         `}
         <div class=${"v-info v-info--" + infoStage} ref=${infoRef}>
            ${video && html`
               <span class="v-info-time">${mmss(video.duration || 0)}</span>
               ${video.provider && html`<span class="v-info-source">${video.provider}</span>`}
               <div class="v-info-titles">
                  <button class="v-info-title-trigger" type="button" title="details"
                          aria-expanded=${detailsOpen}
                          onClick=${() => S.refs.player?.toggleDetails()}>
                     <span class="v-info-title">${video.title_main || video.title || "Untitled"}</span>
                     ${video.title_orig && html`<span class="v-info-orig">${video.title_orig}</span>`}
                  </button>
                  ${(() => { const bits = infoBits(); return bits.length
                     ? html`<span class="v-info-tags">${bits.map(b => html`<span class="v-info-tag">${b}</span>`)}</span>`
                     : null; })()}
               </div>
            `}
         </div>

         ${sceneUI.open && html`
            <${SceneStrip} ui=${sceneUI} getEl=${() => vidRef.current}
                           onSeek=${(t) => {
                              const v = vidRef.current;
                              if (!v) return;
                              try {
                                 if (typeof v.fastSeek === "function") v.fastSeek(t);
                                 else v.currentTime = t;
                              } catch { try { v.currentTime = t; } catch {} }
                           }} />
         `}

         ${lighttableMode !== "closed" && video && html`
            <${Lighttable} mode=${lighttableMode} video=${video} sceneUI=${sceneUI}
                           onClose=${() => S.refs.player?.closeLighttable()} />
         `}

         <button class="v-player-close" type="button" aria-label="close video" title="close video"
                 onClick=${() => S.refs.player?.close()}></button>

         ${detailsOpen && html`
            <div class="v-details">
               <div class="v-details-head">
                  <div class="v-details-head-text">
                     <b>${video ? (video.title || "Untitled") : "—"}</b>
                     ${video && html`<span class="v-details-meta">${metaLine(video)}</span>`}
                     ${meta && meta.source_url && html`
                        <a class="v-details-source" href=${meta.source_url}
                           target="_blank" rel="noopener noreferrer"
                           title=${"open the original on " + (meta.provider || "source")}>
                           ↗ ${meta.provider || "source"}
                        </a>`}
                  </div>
                  <button class="v-details-x" title="close details"
                          onClick=${() => S.refs.player?.toggleDetails()}>✕</button>
               </div>

               ${video ? html`<${Commander} video=${video} />` : null}

               <div class="v-details-section v-details-neighbors">
                  <div class="v-details-neighbors-head">
                     <div class="v-details-label">neighborhood · nearest in embedding space</div>
                     <div class="v-details-spaces" role="tablist" aria-label="embedding space">
                        ${[ "image", "text", "joint" ].map(sp => html`
                           <button class=${"v-details-space" + (detailsSpace === sp ? " is-on" : "")}
                                   role="tab" aria-selected=${detailsSpace === sp}
                                   title=${"nearest in the " + sp + " embedding space"}
                                   onClick=${() => selectSpace(sp)}>${sp}</button>`)}
                     </div>
                  </div>
                  ${!detailsReady
                     ? html`<div class="v-details-loading">loading…</div>`
                     : similar.length
                        ? html`
                           <div class="v-details-similar">
                              ${similar.map(v => html`
                                 <div class="v-details-vid" onClick=${() => playSimilar(v)} title=${v.title || ""}>
                                    ${v.thumbnail_url
                                       ? html`<img src=${v.thumbnail_url} loading="lazy" alt=${v.title || ""}
                                                   referrerpolicy="no-referrer" onError=${thumbError(v.id)} />`
                                       : html`<div class="v-details-vid-blank"></div>`}
                                    <div class="v-details-vid-title">${v.title || "Untitled"}</div>
                                 </div>
                              `)}
                           </div>`
                        : html`<div class="v-details-empty">no similar videos</div>`}
               </div>

               ${!detailsReady
                  ? null
                  : html`
                     ${meta && (meta.category || (meta.tags || []).length || (meta.terms || []).length || meta.faces) && html`
                        <div class="v-details-section v-details-meta-block">
                           ${meta.faces && html`
                              <div class="v-details-group">
                                 <div class="v-details-label">faces · buffalo_l</div>
                                 <div class="v-details-chips"><span class="v-details-chip is-static">${meta.faces}</span></div>
                              </div>`}
                           ${meta.category && html`
                              <div class="v-details-group">
                                 <div class="v-details-label">category</div>
                                 <div class="v-details-chips">
                                    ${chip("category", meta.category)}
                                 </div>
                              </div>`}
                           ${(meta.tags || []).length > 0 && html`
                              <div class="v-details-group">
                                 <div class="v-details-label">tags</div>
                                 <div class="v-details-chips">
                                    ${meta.tags.map(t => chip("tag", t))}
                                 </div>
                              </div>`}
                           ${(meta.terms || []).length > 0 && html`
                              <div class="v-details-group">
                                 <div class="v-details-label">terms</div>
                                 <div class="v-details-chips">
                                    ${meta.terms.map(t => chip("term", t))}
                                 </div>
                              </div>`}
                        </div>`}
                  `}
            </div>
         `}

         <div ref=${preRef} class="v-preload" style="display:none"></div>
      </div>
   `;
}
