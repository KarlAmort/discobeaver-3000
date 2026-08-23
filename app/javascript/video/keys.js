// just: "the single keyboard router for the video SPA. Catches keys at the document (capture phase) and
//        delegates to the intended recipient, then stops propagation so nothing double-handles
//        (e.g. Vidstack's own space/f, or the page scrolling on space). This is the ONE place
//        keyboard routing lives — replaces the per-file isTextInput copies."
//
// Rules (current):
//   • typing in a text field pauses ALL shortcuts (Esc blurs it / closes the search panel)
//   • /                -> show + focus the search panel (Esc or submit hides it)
//   • ?                -> toggle the keyboard-shortcuts cheat sheet (Esc closes it)
//   • space            -> player play/pause (never scroll, never fullscreen), whenever a player exists
//   • f                -> player fullscreen if a player is OPEN; else toggle the facet panel
//   • i                -> toggle the info overlay permanently
//   • d                -> toggle the details overlay (similar videos + passages) while the player is open
//   • 1-9              -> rate the playing video, then jump to the next clip (rapid-rate flow)
//   • ←/→              -> details-strip nav if details are open; else move grid selection; else seek the player
//   • ctrl + ←/→       -> seek the player by 1 minute
//   • ⌘/meta + ←/→     -> seek the player by SCENE (video/scenes; ±60s until the index is built)
//   • s                -> toggle the scene strip (filmstrip + novelty profile) while the player is open
//   • e                -> equidistant lighttable → scene-transition lighttable → close
//   • ↑/↓              -> details-strip nav if details are open; else playlist prev/next if open; else move grid selection
//   • Enter            -> play the selected similar video (details open); else open the selected thumbnail
//   • Esc              -> ALWAYS un-toggles the topmost overlay, one layer per press: blur a text
//                         field → help overlay → swipe deck → lighttable → details → status/account cards → player
//   • option/alt + 0-9 -> rate the current (playing, else selected) video (0 clears)
//
// Every dispatched action is recorded on the observability bus with the UI state before and after
// (and any errors it triggers within a short window), so the deck's "copy last 10 actions" yields a
// replayable trail for debugging.
import { recordAction } from "console/bus";
import { snapshotUI } from "video/snapshot";
import { seekDelta, seekRepeatCount } from "video/seek";

// run a well-defined user action, stamping before/after UI state onto the bus. Error linkage (a
// failure landing right after the action) is the bus's job via its time window — here we only
// snapshot `prev` and let recordAction capture `next`.
function act(name, args, fn) {
   const prev = snapshotUI();
   try { fn(); }
   finally { recordAction({ name, args, prev }); }
}

export function isTextInput(el) {
   if (!el) return false;
   const t = el.tagName;
   return t === "INPUT" || t === "TEXTAREA" || t === "SELECT" || el.isContentEditable;
}

// installKeyRouter(ctx) -> uninstall fn.
// ctx: { player(), grid(), openSearch(), focusSearch(), rate(n), openSelected(), closeOverlay() }
export function installKeyRouter(ctx) {
   let lastSeekKey = null;
   let lastSeekAt = null;

   const handler = (e) => {
      const target = e.target;
      const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
      const seekCount = () => {
         const key = `${e.ctrlKey ? "ctrl:" : ""}${e.key}`;
         const count = seekRepeatCount(e, key === lastSeekKey ? lastSeekAt : null);
         lastSeekKey = key;
         lastSeekAt = e.timeStamp;
         return count;
      };

      // "?" (the keyboard-shortcuts overlay) is owned globally by app/javascript/shortcuts.js, which
      // sees the key first (capture phase, imported earlier) and stops it — it never reaches here.

      // "/" reveals + focuses the search panel (unless already typing or a modifier is held)
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !isTextInput(target)) {
         e.preventDefault(); act("open-search", null, () => ctx.openSearch()); return;
      }
      // typing suppresses everything else; Esc leaves the field (and closes the search panel)
      if (isTextInput(target)) {
         if (e.key === "Escape") target.blur();
         return;
      }

      const player = ctx.player();
      const grid   = ctx.grid();
      const open   = !!player?.isOpen?.();
      const exists = !!player;                       // a player instance exists (maybe off-screen)
      const details = open && !!player?.detailsActive?.();   // details overlay shown over the player
      const lighttable = open && !!player?.lighttableActive?.();
      const selActive = !open && !!grid?.hasSelection?.();

      // 1–9 -> rate the playing video, then advance to the next clip. Works even when the current
      // clip failed to load (the player is still "open"), so a broken video can be rated + skipped.
      if (open && /^[1-9]$/.test(e.key) && !e.altKey && !e.metaKey && !e.ctrlKey) {
         const n = Number(e.key);
         // rate + advance is ONE id-anchored op: rating removes the card from the list (rate mode),
         // shifting indices, so a separate player.step(+1) here would advance against a mutated list
         // and land on the wrong clip. ctx.rateAndAdvance captures the next clip by id first.
         stop(); act("rate", { n, next: "clip" }, () => ctx.rateAndAdvance(n)); return;
      }
      // option/alt + digit -> rate (0 clears)
      if (e.altKey && /^[0-9]$/.test(e.key)) {
         const n = Number(e.key);
         stop(); act("rate", { n, clear: n === 0 }, () => ctx.rate(n)); return;
      }
      const ctrlSeek = e.ctrlKey && !e.altKey && !e.metaKey ? seekDelta(e) : 0;
      if (ctrlSeek && open) {
         const count = seekCount();
         stop(); act("seek", { secs: ctrlSeek, count }, () => player.seek(ctrlSeek, count)); return;
      }
      // ⌘/meta + ←/→ -> scene seek, only while the player is open (the grid keeps the browser's
      // native cmd+arrow history navigation)
      if (e.metaKey && !e.altKey && !e.ctrlKey && open && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
         const dir = e.key === "ArrowLeft" ? -1 : 1;
         stop(); act("seek-scene", { dir }, () => player.seekScene(dir)); return;
      }
      if (e.altKey || e.metaKey || e.ctrlKey) return; // leave other modified combos to the browser

      switch (e.key) {
         case " ": case "Spacebar":
            if (exists) { stop(); act("toggle-play", null, () => player.togglePlay()); }
            return;
         case "f": case "F":
            // open player -> fullscreen; otherwise leave `f` for the browser/command bar (no panel now)
            if (open) { stop(); act("fullscreen", null, () => player.toggleFullscreen()); }
            return;
         case "i": case "I":
            if (exists) { stop(); act("toggle-info", null, () => player.toggleOverlay()); }
            return;
         case "d": case "D":
            if (open) { stop(); act("toggle-details", null, () => player.toggleDetails()); }
            return;
         case "s": case "S":
            if (open) { stop(); act("toggle-scenes", null, () => player.toggleScenes()); }
            return;
         case "e": case "E":
            if (open) { stop(); act("toggle-lighttable", null, () => player.toggleLighttable()); }
            return;
         case "b": case "B":
            stop(); act("browser-status", null, () => ctx.toggleBrowserStatus?.());
            return;
         case "ArrowLeft":
            if (details) { stop(); act("details-prev", null, () => player.detailsMove(-1)); }
            else if (selActive) { stop(); act("grid-left", null, () => grid.move(-1, 0)); }
            else if (open) { const secs = seekDelta(e), count = seekCount(); stop(); act("seek", { secs, count }, () => player.seek(secs, count)); }
            return;
         case "ArrowRight":
            if (details) { stop(); act("details-next", null, () => player.detailsMove(1)); }
            else if (selActive) { stop(); act("grid-right", null, () => grid.move(1, 0)); }
            else if (open) { const secs = seekDelta(e), count = seekCount(); stop(); act("seek", { secs, count }, () => player.seek(secs, count)); }
            return;
         case "ArrowUp":
            if (details) { stop(); act("details-prev", null, () => player.detailsMove(-1)); }
            else if (open) { stop(); act("playlist-prev", null, () => player.step(-1)); }
            else if (grid) { stop(); act("grid-up", null, () => grid.move(0, -1)); }
            return;
         case "ArrowDown":
            if (details) { stop(); act("details-next", null, () => player.detailsMove(1)); }
            else if (open) { stop(); act("playlist-next", null, () => player.step(1)); }
            else if (grid) { stop(); act("grid-down", null, () => grid.move(0, 1)); }
            return;
         case "Enter":
            if (details) { stop(); act("play-similar", null, () => player.playSelectedSimilar()); }
            else if (selActive) { stop(); act("open-video", null, () => ctx.openSelected()); }
            return;
         case "Escape": {
            // Esc ALWAYS un-toggles the topmost overlay, one layer per press:
            //   text field blurs (handled above) → help overlay (shortcuts.js, sees Esc first) →
            //   swipe deck (self-handled, capture) → lighttable → details → status cards → the player.
            if (lighttable) { stop(); act("close-lighttable", null, () => player.closeLighttable()); return; }
            if (details) { stop(); act("close-details", null, () => player.toggleDetails()); return; }
            const card = ctx.closeOverlay?.();                    // browser-status / model-status
            if (card) { stop(); act("close-overlay", { card }, () => {}); return; }
            if (open) { stop(); act("close-player", null, () => player.close()); }
            return;
         }
      }
   };
   document.addEventListener("keydown", handler, true);   // capture: see keys before any element
   return () => document.removeEventListener("keydown", handler, true);
}
