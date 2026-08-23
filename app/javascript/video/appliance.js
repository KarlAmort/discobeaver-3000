// just: "the single video-player appliance — Vidstack (web components) wrapped behind a small,
//        stable API used everywhere we stream video (the show page + the labeller). Gives an
//        interactive playlist, JS-controlled fullscreen and captions/surtitles, and works in
//        Safari on iPad. Replaces the hand-rolled player.js."
//
// API (mirrors the old mountPlayer surface so callers barely change):
//   const a = mountAppliance(root, { title, src, autoplay, fullscreenElement, fitToParent,
//                                    tracks, onNext, onPrevious, onEnded });
//   a.load(src, { title, tracks, startFraction });   // swap source (playlist advance)
//   a.play(); a.pause();
//   a.enterFullscreen(); a.exitFullscreen();
//   a.toggleCaptions(on?);                            // show/hide surtitles
//   a.showFlash("★ 7 saved");
// vendored same-origin (public/vidstack) — the deploy environment denies cross-origin module
// scripts, so the whole Vidstack bundle is mirrored locally (see scripts/vendor-vidstack.rb).
// ?v=2 busts browsers that pinned the earlier entry, whose relative ./providers + ./chunks lazy
// imports 404'd (it was served `immutable`); the entry now revalidates, so no future bumps needed.
import { VidstackPlayer, VidstackPlayerLayout } from "/vidstack/player.js?v=2";
import { seekDelta, seekRepeatCount } from "video/seek";

const VIEW_AFTER_S = 5;   // register a view after this much playback (or the whole clip if shorter)

export function mountAppliance(root, options = {}) {
   return new VideoAppliance(root, options);
}

// Vidstack picks its provider from the source type. Our stream URLs are extension-less redirects,
// so hint the type explicitly (HLS/DASH by extension, else progressive mp4). Returns {src, type}.
function source(url) {
   if (!url) return url;
   if (/\.m3u8(\?|$)/i.test(url)) return { src: url, type: "application/x-mpegurl" };
   if (/\.mpd(\?|$)/i.test(url))  return { src: url, type: "application/dash+xml" };
   return { src: url, type: "video/mp4" };
}

class VideoAppliance {
   constructor(root, options = {}) {
      this.root = root;
      this.options = options;
      this.onNext = typeof options.onNext === "function" ? options.onNext : null;
      this.onPrevious = typeof options.onPrevious === "function" ? options.onPrevious : null;
      this.onEnded = typeof options.onEnded === "function" ? options.onEnded : null;
      this.onView = typeof options.onView === "function" ? options.onView : null;
      this.fsTarget = options.fullscreenElement || null;   // null => fullscreen the player itself
      this._view = { playedMs: 0, thresholdMs: VIEW_AFTER_S * 1000, fired: false, timer: null };
      this._seek = { key: null, at: null };
      this._startFraction = 0;
      this._flash = this._buildFlash();
      if (options.fitToParent) root.classList.add("appliance-fit");
      this.ready = this._create();
      this._bindKeys();
   }

   async _create() {
      const target = this.root.querySelector("[data-vidstack-target]") || this.root;
      const src = this.options.src || target.dataset.src || this.root.dataset.src || "";
      const player = await VidstackPlayer.create({
         target,
         src: source(src),   // {src, type} so Vidstack picks a provider for extension-less stream URLs
         title: this.options.title || this.root.dataset.title || "",
         viewType: "video",
         playsInline: true,
         autoPlay: this.options.autoplay !== false,
         // NB: no crossOrigin — these are cross-origin streams without CORS headers; a CORS
         // request would be blocked and stall on a spinner (the native <video> never did this).
         layout: new VidstackPlayerLayout()
      });
      this.player = player;
      // fetchpriority=high on the underlying <video> so the visible clip's media requests outrank the
      // SPA's warmed prefetch pool (set "low" in video/player.js). Best-effort: Vidstack owns element
      // creation, so we set it once the player resolves — still influences the ongoing/segment fetches.
      const mediaEl = target.querySelector("video") || this.root.querySelector("video");
      if (mediaEl) mediaEl.fetchPriority = "high";
      this._addTracks(this.options.tracks || this._tracksFromDataset());
      player.addEventListener("ended", () => { this._stopViewTimer(); this._handleEnded(); });
      player.addEventListener("can-play", () => {
         this._applyStartFraction();
         const d = player.duration;
         this._view.thresholdMs = (isFinite(d) && d > 0 && d < VIEW_AFTER_S ? d : VIEW_AFTER_S) * 1000;
      });
      player.addEventListener("play", () => this._startViewTimer());
      player.addEventListener("pause", () => this._stopViewTimer());
      return player;
   }

   // — playlist: swap to a new source (and optionally seek in, like the labeller's START_FRACTION) —
   async load(src, { title, tracks, startFraction = 0 } = {}) {
      const player = await this.ready;
      this._startFraction = startFraction;
      this._resetView();
      if (title != null) player.title = title;
      player.src = source(src);
      if (tracks) this._addTracks(tracks, { replace: true });
   }

   async play()  { const p = await this.ready; try { await p.play(); } catch {} }
   async pause() { const p = await this.ready; p.pause(); }

   // small imperative controls so callers can drive the player from their own key handling
   // (e.g. the /rate wizard forwards keys at document-capture so they work regardless of focus)
   async togglePlay() {
      const p = await this.ready;
      try {
         if (p.paused) await p.play();
         else p.pause();
      } catch {}
   }
   async seekBy(sec, count = 1)  { const p = await this.ready; const d = isFinite(p.duration) && p.duration > 0 ? p.duration : 1e9;
      const n = Math.max(1, Math.floor(Number(count) || 1));
      let t = isFinite(p.currentTime) ? p.currentTime : 0;
      for (let i = 0; i < n; i++) {
         t = Math.min(d, Math.max(0, t + sec));
         p.currentTime = t;
         if (t === 0 || t === d) break;
      }
   }
   async nudgeVolume(delta) { const p = await this.ready;
      if (delta > 0 && p.muted) p.muted = false;
      p.volume = Math.min(1, Math.max(0, (p.volume ?? 1) + delta)); }
   async toggleFullscreen() {
      if (document.fullscreenElement) return this.exitFullscreen();
      return this.enterFullscreen();
   }

   // — JS-controlled fullscreen. A custom fsTarget (labeller shell) uses the native API so the
   //   surrounding chrome stays up; otherwise we fullscreen the player element itself. —
   async enterFullscreen() {
      const p = await this.ready;
      if (this.fsTarget) { try { await this.fsTarget.requestFullscreen?.(); } catch {} }
      else { try { await p.enterFullscreen(); } catch {} }
   }
   async exitFullscreen() {
      const p = await this.ready;
      if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch {} }
      else { try { await p.exitFullscreen(); } catch {} }
   }

   // — captions / surtitles —
   async toggleCaptions(on) {
      const p = await this.ready;
      const tracks = Array.from(p.textTracks ?? []);
      const caption = tracks.find(t => t.kind === "captions" || t.kind === "subtitles");
      if (!caption) return;
      const want = on == null ? caption.mode !== "showing" : !!on;
      caption.mode = want ? "showing" : "disabled";
   }

   showFlash(text) {
      if (!this._flash) return;
      this._flash.textContent = text;
      this._flash.classList.add("is-on");
      clearTimeout(this._flashTimer);
      this._flashTimer = setTimeout(() => this._flash.classList.remove("is-on"), 1200);
   }

   async destroy() { try { (await this.ready)?.destroy?.(); } catch {} }

   // — internals —
   _handleEnded() {
      if (this.onEnded) return this.onEnded();
      if (this.onNext) return this.onNext();
   }

   // count actual playback time; once it crosses the threshold, register a view once
   _startViewTimer() {
      if (this._view.fired || this._view.timer) return;
      this._view.timer = setInterval(() => {
         this._view.playedMs += 250;
         if (this._view.playedMs >= this._view.thresholdMs) {
            this._view.fired = true;
            this._stopViewTimer();
            this.onView?.();
         }
      }, 250);
   }
   _stopViewTimer() { if (this._view.timer) { clearInterval(this._view.timer); this._view.timer = null; } }
   _resetView() { this._stopViewTimer(); this._view.playedMs = 0; this._view.fired = false; }

   _applyStartFraction() {
      const p = this.player;
      if (!p || !this._startFraction) return;
      const d = p.duration;
      if (isFinite(d) && d > 0) { try { p.currentTime = d * this._startFraction; } catch {} }
   }

   _addTracks(tracks, { replace = false } = {}) {
      const p = this.player;
      if (!p?.textTracks || !Array.isArray(tracks)) return;
      if (replace) Array.from(p.textTracks).forEach(t => { try { p.textTracks.remove(t); } catch {} });
      tracks.forEach((t, i) => {
         try {
            p.textTracks.add({
               kind: t.kind || "captions",
               src: t.src,
               language: t.language || t.srclang || "de",
               label: t.label || t.language || "Untertitel",
               default: t.default ?? i === 0
            });
         } catch {}
      });
   }

   _tracksFromDataset() {
      const raw = this.root.dataset.tracks;
      if (!raw) return [];
      try { return JSON.parse(raw); } catch { return []; }
   }

   _buildFlash() {
      const el = document.createElement("div");
      el.className = "appliance-flash";
      this.root.appendChild(el);
      return el;
   }

   _seekCount(e) {
      const key = `${e.ctrlKey ? "ctrl:" : ""}${e.key}`;
      const count = seekRepeatCount(e, key === this._seek.key ? this._seek.at : null);
      this._seek = { key, at: e.timeStamp };
      return count;
   }

   // ArrowLeft/Right seek + p/n for previous/next (Vidstack's layout already handles space, f, c)
   _bindKeys() {
      this.root.addEventListener("keydown", async (e) => {
         const p = this.player;
         if (!p) return;
         const delta = !e.altKey && !e.metaKey ? seekDelta(e) : 0;
         if (delta) { this.seekBy(delta, this._seekCount(e)); }
         else if (e.key === "n" && this.onNext) { this.onNext(); }
         else if (e.key === "p" && this.onPrevious) { this.onPrevious(); }
         else return;
         e.preventDefault();
      });
   }
}
