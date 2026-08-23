// just: "shared signal store for the video SPA. Components read these signals; orchestration (data
//        loading, rating, opening the player) lives in app.js and is exposed via `api` so the grid,
//        player and key-router can trigger it without importing app.js (avoids a cycle)."
import { signal } from "@preact/signals";
import { remember } from "video/telemetry";

// — view state —
export const videos    = signal([]);                       // loaded summary objects (current view)
export const total     = signal(0);                        // total count in browse mode
// `query` is the RAW command-bar string — the single place search text, filters, sort and embedding
// mode are expressed (see v/query). `sort` is the DERIVED primary column sort, kept only so the grid
// cell overlay can show that field's value. mode/strategy are derived by the parse too.
export const sort      = signal({ field: "created_at", dir: "desc" });
export const query     = signal("");                       // raw command-bar string (the DSL)
export const mode      = signal("browse");                 // "browse" | "search" | "rate" (derived)
export const strategy  = signal("off");                    // "off" | "best" | "informative" (derived)
export const loading   = signal(false);
export const selection = signal(-1);                       // index into videos.value; -1 = none

// — UI overlays driven by the key router —
export const searchOpen = signal(false);                   // the "/"-toggled search panel (shown + focused)
export const helpOpen   = signal(false);                   // the "?"-toggled keyboard-shortcuts cheat sheet

// player state is a single signal so components re-render on any change.
// overlayPinned (the `i` info toggle) persists across reloads via localStorage ("v.info").
export const player = signal({ open: false, index: -1, id: null, fullscreen: false,
   overlayPinned: (typeof localStorage !== "undefined" && localStorage.getItem("v.info") === "1") });

export const telemetry = signal({ current: null, recent: [] });

export function setTelemetry(snapshot, final = false) {
   telemetry.value = remember(telemetry.value, snapshot, final);
}

// — player details overlay (similar videos + linked book passages) —
// details: last `details` payload from the server ({ video_id, video, similar, chunks }) or null.
// detailsOpen: whether the semi-transparent overlay is shown (auto on video end; toggle top-right).
// detailsSelection: index into the overlay's "similar" strip (keyboard nav); -1 = none.
export const details          = signal(null);
export const detailsOpen      = signal(false);
export const detailsSelection = signal(-1);
// which embedding neighbourhood the details panel ranks "similar" in: "image" | "text" | "joint".
// "joint" is the sensible default — the server blends image+text and gracefully falls back to
// whichever single space a clip actually has (see VideosChannel#neighbors).
export const detailsSpace     = signal("joint");
export const commander        = signal(null);

// — filters / facets —
// just: filters is what we SEND to the server, now DERIVED from the command-bar string by v/query (no
//   panel, no localStorage). facetList is what we RECEIVE (cross-facet counts) — it powers the
//   command-bar autocomplete (value suggestions), not a visible panel.
//   filters shape: { enums:{ <field>:{include,exclude,invert} }, ranges:{ <field>:{from,to} },
//                    flags:{ ... }, tags:{ include:[], exclude:[] } }
export function emptyFilters() { return { enums: {}, ranges: {}, flags: {}, tags: {} }; }
export const filters   = signal(emptyFilters());         // current filter selection (sent to server)
export const facetList = signal([]);                     // facet descriptors (received from server)
export const facetStatus = signal({});                   // field → stale | pending | fresh
export const facetReady = signal(true);                  // current result scope is available for stats

export function staleFacets() {
   facetReady.value = false;
   facetStatus.value = Object.fromEntries(Object.keys(facetStatus.value).map((field) => [ field, "stale" ]));
}

export function pendingFacets(fields) {
   facetStatus.value = { ...facetStatus.value, ...Object.fromEntries(fields.map((field) => [ field, "pending" ])) };
}

export function freshFacets(fields) {
   facetStatus.value = { ...facetStatus.value, ...Object.fromEntries(fields.map((field) => [ field, "fresh" ])) };
}

function storedSource() {
   try {
      const source = JSON.parse(localStorage.getItem("v.source") || "null");
      if (!source || typeof source !== "object") return null;
      const include = Array.isArray(source.include) ? source.include.filter((value) => typeof value === "string" && value) : [];
      const exclude = Array.isArray(source.exclude) ? source.exclude.filter((value) => typeof value === "string" && value) : [];
      return include.length || exclude.length ? { include, exclude } : null;
   } catch { return null; }
}

export const sourceSelection = signal(storedSource());

export function setSourceSelection(source) {
   const include = [ ...(source?.include || []) ];
   const exclude = [ ...(source?.exclude || []) ];
   const next = include.length || exclude.length ? { include, exclude } : null;
   sourceSelection.value = next;
   try {
      if (next) localStorage.setItem("v.source", JSON.stringify(next));
      else localStorage.removeItem("v.source");
   } catch {}
}

// — unified rating wizard (folded-in /rate): training-progress stats for the current rate domain —
export const rateStats = signal(null);

// Client-side prequential learning stats for the CURRENT rating session (sort:top / sort:learn):
// each rated card carried a `predicted` (and `uncertainty`) from the recommender BEFORE we saw the
// user's rating, so |predicted − actual| accumulated over the session is an honest online "am I
// learning" curve — no server round-trip. Reset via the header pill. `_`-prefixed keys are running
// accumulators; n/mae/meanU/within1/last are the display fields.
export const learn = signal({ n: 0, mae: null, meanU: null, within1: 0, last: null });

// — recommendation-algorithm status (VideosChannel#model_status): freshness (pending ratings, last
//   run, errors), latest leave-one-out MAE, and the MAE-over-time history. Drives the status panel. —
export const modelStatus = signal(null);
// — the last search's embedding outcome: model, query, runtime, and ranking after a vector search;
//   failure metadata when the embed path fell back to keywords; null when no embedding was used. —
export const embedStatus = signal(null);
export const queryStatus = signal(null);
export const ratingFeedback = signal(null);
// — the swipe-to-rate deck and compact status overlays. —
export const swipeOpen = signal(false);
export const browserStatusOpen = signal(false);   // on-device (WebGPU) model status overlay (bottom-left)
export const modelStatusOpen = signal(false);      // recommendation-model status card (expanded pill) — a signal, not component state, so Esc can un-toggle it
export const captionCompare = signal(null);        // in-SPA on-device caption vs existing Colab caption

// imperative controllers, registered by their components on mount; read by the key router.
//   grid:   { move(dx,dy), hasSelection(), selectedVideo(), columns() }
//   player: { isOpen(), togglePlay(), toggleFullscreen(), seek(secs,count), step(±1), toggleOverlay(),
//             toggleDetails(), close(), openIndex(i), currentVideo(),
//             detailsActive(), detailsMove(±1), playSelectedSimilar() }
export const refs = { grid: null, player: null, commander: null };

// orchestration hooks, populated by app.js (object-property mutation works across ES modules):
//   loadMore()         — fetch the next browse page (no-op in search mode / when exhausted)
//   rate(n)            — rate the player's current video, else the selected cell (0–9)
//   openIndex(i)       — open the player on videos.value[i]
//   openSearch()       — reveal + focus the command bar
//   runQuery(raw)      — set `query` to the raw command-bar string, parse it, and fetch the matching
//                        view (browse | search | fulltext | recommend) — the one entry point
//   reload()           — re-run runQuery() for the current `query` (the URL router calls this after
//                        hydrating `query` from window.location)
//   rateVideo(v,n)     — rate a SPECIFIC summary object (used by the swipe deck, which holds a card
//                        rather than the player's/selection's current video)
//   rateAndAdvance(n)  — rate the playing clip, then advance to the genuine next clip by id (the
//                        1–9 rapid-rate flow; also driven by the player's on-screen rate buttons)
//   reconnect()        — rebuild the ActionCable subscription with the current session + token (called
//                        after login/logout so votes re-attribute to the account)
export const api = { loadMore() {}, rate() {}, rateVideo() {}, rateAndAdvance() {}, openIndex() {},
                     openSearch() {}, registerView() {}, runQuery() {}, loadFacets() {}, fetchDetails() {}, fetchCommander() {}, reload() {},
                     reconnect() {} };

// — helpers —
export function selectedVideo() {
   const i = selection.value;
   return i >= 0 && i < videos.value.length ? videos.value[i] : null;
}
