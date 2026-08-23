// just: "the URL router for the video SPA (served at the ROOT) — the single owner of window.location.
//        It keeps the full UI
//        state mirrored in the URI (so any view is shareable/bookmarkable) and, given a URI, rebuilds
//        that view. Components stay unaware of the URL: this module READS the store signals to
//        serialize, and WRITES the store signals to hydrate. Nothing else touches history/location.
//
//   URL scheme (IDs, never array indices — the grid is rebuilt from server queries so indices drift):
//     /                          browse, defaults
//     /sunset+beach               search mode (the unmatched path is the command-bar query)
//     /?sort=duration:asc         non-default sort
//     /?panel=1                   facet panel open
//     /?sel=123                   grid selection = video 123
//     /123                       player open on video 123 (path segment)
//     /sunset+beach?video=123     player open while retaining its search
//     /123?details=1              …with the details overlay open
//     /123?info=1                 …with the info box pinned
//     /?...&f=<base64url>          the whole filters object, only when non-default
//   playerKind stays a device preference (sessionStorage), deliberately NOT in the URL.
//
//   History: navigation-level changes (mode/query/strategy, player open/close/clip, details) push a
//   history entry; incidental ones (selection, sort, panel, info, filter edits) replace. pushState/
//   replaceState don't fire popstate, so there's no write→read loop; `applying` guards hydration."
import { effect, batch } from "@preact/signals";
import * as S from "video/store";
import * as bus from "console/bus";

const RESOLVE_TIMEOUT = 8000;   // give up waiting for a deep-linked id's data after this (ms)
let BASE = "/";
let INITIAL_PATH = null;
let INITIAL_QUERY = null;

function normalizeBase(base) {
   base = String(base || "/").replace(/\/+$/, "");
   return base === "" ? "/" : base;
}

function withBase(path) {
   if (BASE === "/") return path;
   return path === "/" ? BASE : BASE + path;
}

function encodeQuery(query) {
   return new URLSearchParams({ q: query }).toString().slice(2);
}

function decodeQuery(path) {
   const encoded = path.replace(/^\/+/, "");
   try { return decodeURIComponent(encoded.replace(/\+/g, "%20")); }
   catch { return encoded.replace(/\+/g, " "); }
}

// — serialize: store signals -> URL string (path + query). Canonical param order so equal state
//   always yields the byte-identical string (the write guard compares strings). —
function currentUrl() {
   const p    = S.player.value;
   const vids = S.videos.value;
   const playerId = p.open ? (vids[p.index]?.id ?? null) : null;
   const query = S.query.value.trim();
   const path = query === INITIAL_QUERY && INITIAL_PATH
      ? INITIAL_PATH
      : withBase(query ? `/${encodeQuery(query)}` : (playerId != null ? `/${playerId}` : "/"));

   const qs = new URLSearchParams();
   if (query && playerId != null) qs.set("video", String(playerId));
   if (S.selection.value >= 0) {
      const selId = vids[S.selection.value]?.id;
      if (selId != null) qs.set("sel", String(selId));
   }
   if (p.open && S.detailsOpen.value) qs.set("details", "1");
   if (p.open && p.overlayPinned)     qs.set("info", "1");

   const str = qs.toString();
   return path + (str ? `?${str}` : "");
}

// the subset of state whose change counts as "navigation" (push); everything else replaces.
function navKey() {
   const p = S.player.value;
   const playerId = p.open ? (S.videos.value[p.index]?.id ?? "open") : null;
   return [S.query.value, playerId, !!(p.open && S.detailsOpen.value)].join("|");
}

// — deserialize: URL -> a plain parsed object —
function parseUrl() {
   let path = location.pathname;
   if (BASE !== "/" && path.startsWith(BASE)) path = path.slice(BASE.length) || "/";
   const m = path.match(/^\/(\d+)\/?$/);
   const qs = new URLSearchParams(location.search);
   return {
      playerId: m ? Number(m[1]) : (qs.has("video") ? Number(qs.get("video")) : null),
      q:        m ? "" : (location.pathname === INITIAL_PATH ? INITIAL_QUERY : decodeQuery(path)),
      sel:      qs.has("sel") ? Number(qs.get("sel")) : null,
      details:  qs.get("details") === "1",
      info:     qs.get("info") === "1"
   };
}

let _lastUrl = null, lastNavKey = null, applying = false;
let pending = null, resolveTimer = 0;

// write the URL iff it differs from what's already shown; push for navigation, replace otherwise.
function writeUrl() {
   const url = currentUrl();
   const key = navKey();
   const here = location.pathname + location.search;
   if (url === here) { _lastUrl = url; lastNavKey = key; return; }   // already reflects reality
   const method = (lastNavKey != null && key !== lastNavKey) ? "pushState" : "replaceState";
   try { history[method]({ v: 1 }, "", url); } catch {}
   if (method === "pushState") bus.noteNavigation();   // real navigation → every 2nd resets client issues
   _lastUrl = url; lastNavKey = key;
}

// set the command-bar string from the URL and stash any id-based intents (player/selection/overlays)
// to apply once the data for that view arrives. mode/filters/sort are DERIVED from `q` by the reload
// (runQuery parses it), so the router only owns `query` here, not the individual filter/sort signals.
function applyParsed(p, _initial) {
   S.query.value = p.q || "";

   // reset view-derived state; the reload repopulates videos/total and pending re-opens overlays
   S.videos.value = [];
   S.total.value = 0;
   S.selection.value = -1;
   S.player.value = { open: false, index: -1, fullscreen: false, overlayPinned: false };
   S.detailsOpen.value = false;
   S.details.value = null;

   const details = p.playerId != null && p.details;
   const info    = p.playerId != null && p.info;
   const has = p.playerId != null || p.sel != null;
   pending = has ? { playerId: p.playerId, selId: p.sel, details, infoPinned: info, requested: false } : null;
}

// apply the stashed id-based intents against the now-loaded data. Returns true once fully resolved.
function resolvePending() {
   if (!pending) return true;
   const list = S.videos.value;

   if (pending.selId != null) {
      const i = list.findIndex(v => v && v.id === pending.selId);
      if (i >= 0) { S.selection.value = i; pending.selId = null; }
      else if (list.length) { pending.selId = null; }      // not in this view — give up (best-effort)
   }

   if (pending.playerId != null) {
      let i = list.findIndex(v => v && v.id === pending.playerId);
      if (i < 0) {
         // the deep-linked clip isn't in the loaded page: fetch its summary via `details` and append
         const d = S.details.value;
         if (d && d.video_id === pending.playerId && d.video) {
            S.videos.value = [...list, d.video];
            i = S.videos.value.length - 1;
         } else {
            // only latch `requested` once the fetch actually went out — fetchDetails returns false
            // when the cable isn't connected yet (e.g. this effect's first synchronous run during
            // init, before app.js assigns `cable`), so we retry on the next data arrival.
            if (!pending.requested && S.api.fetchDetails?.(pending.playerId)) pending.requested = true;
            return false;                                  // wait for the details payload
         }
      }
      if (i >= 0 && S.refs.player?.openIndex) {
         S.refs.player.openIndex(i);                       // sets player open + index, prefetches details
         if (pending.infoPinned) S.player.value = { ...S.player.value, overlayPinned: true };
         if (pending.details)    S.detailsOpen.value = true;
         pending.playerId = null;
      } else {
         return false;                                     // player controller not mounted yet
      }
   }

   if (pending.playerId == null && pending.selId == null) { pending = null; return true; }
   return false;
}

function finalize() {
   applying = false;
   clearTimeout(resolveTimer);
   writeUrl();
}
function onResolveTimeout() { pending = null; finalize(); }

// hydrate from a parsed URL: set signals under the `applying` guard (so the sync effect stays quiet),
// then either finalize immediately or wait for the data-driven pending resolution.
function beginApply(parsed, initial) {
   applying = true;
   clearTimeout(resolveTimer);
   batch(() => applyParsed(parsed, initial));
   if (!pending) finalize();
   else resolveTimer = setTimeout(onResolveTimeout, RESOLVE_TIMEOUT);
}

// init() -> teardown. Called once by app.js on mount, before the cable connects.
export function init({ base = "/", query = null } = {}) {
   BASE = normalizeBase(base);
   INITIAL_PATH = query == null ? null : location.pathname;
   INITIAL_QUERY = query;
   beginApply(parseUrl(), true);     // hydrate from the initial URL; the data fetch is the cable's job

   // resolve effect FIRST so it runs before the sync effect on a shared (videos) update.
   const stopResolve = effect(() => {
      void S.videos.value; void S.details.value;            // subscribe to data arrivals
      if (!pending || !applying) return;
      clearTimeout(resolveTimer);
      if (resolvePending()) finalize();
      else resolveTimer = setTimeout(onResolveTimeout, RESOLVE_TIMEOUT);
   });

   // sync effect: mirror every relevant signal change back into the URL (unless we're hydrating).
   const stopSync = effect(() => {
      void currentUrl(); void navKey();                     // subscribe to all serialized signals
      if (applying) return;
      writeUrl();
   });

   const onPop = () => {
      bus.noteNavigation();                                 // back/forward is a navigation too
      beginApply(parseUrl(), false);
      S.api.reload?.();                                      // cable is connected by now — refetch the view
   };
   window.addEventListener("popstate", onPop);

   return () => {
      stopResolve(); stopSync();
      window.removeEventListener("popstate", onPop);
      clearTimeout(resolveTimer);
   };
}
