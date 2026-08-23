// just: "root of the Preact SPA served at /. Owns data
//        orchestration over VideosChannel, driven entirely by the command bar's query string (see
//        video/query): one runQuery() parses the string and dispatches the matching request — browse
//        paging, embedding/fulltext search, or active-learning recommend.
//        Renders the header (brand + <CommandBar/> + count) and hosts <Grid/> and <Player/>. Components
//        talk through the signal store (video/store) and the imperative controllers they register there.
//
//        Every path from module load to first paint is guarded by video/failure: a throw at import
//        time, a mount that raises, a component that crashes mid-render, or a mount that simply never
//        happens all end in a painted error panel instead of a blank viewport."
import { render, Component } from "preact";
import { html } from "htm/preact";
import { useEffect, useState } from "preact/hooks";
import { paintFailure, armMountWatchdog, installFailureNet, isBlank } from "video/failure";
import * as S from "video/store";
import * as Q from "video/query";
import { connectV } from "video/cable";
import { installKeyRouter } from "video/keys";
import { Grid } from "video/grid";
import { Player } from "video/player";
import { CommandBar } from "video/commandbar";
import { Swipe } from "video/swipe";                   // swipe-to-rate deck
import * as Router from "video/router";              // URL ⇄ command-bar string (owns window.location)
import { nextClipId } from "video/rate_advance";     // pure: next clip to advance to in the 1–9 rate flow
import * as ratingOutbox from "video/rating_outbox";
import { registerAbout, registerShortcuts } from "shortcuts";   // global `?` help overlay + registry
import * as deckBus from "console/bus";          // observability console: stamp UI state onto actions
import { snapshotUI } from "video/snapshot";
import * as brstat from "webgpu/status";   // on-device (WebGPU) model status bus (embed + vision + drain)
import * as Trace from "video/query_status";
import { QueryStatus } from "video/query_status";

const PAGE_LIMIT = 300;

let cable;
// mount config, read from the #v-app dataset in mountVideoApp: scope ("owner"|"official"), URL base
// ("/" owner, the official prefix public), and whether this is the public/official instance.
let cfg = { scope: "owner", base: "/", isPublic: false };
// `current` holds the active query: its parsed model, the resolved request, and a monotonic token.
// Every response carries the token it was issued under; a mismatch means a newer query superseded it.
let token = 0;
let current = { model: Q.parse(""), req: Q.buildRequest(Q.parse("")), token: 0 };
let facetRequest = 0;
const facetContexts = new Map();

// — the one entry point: parse the raw command-bar string and fetch the matching view —————————————
function runQuery(raw) {
   raw = raw ?? S.query.value;
   S.staleFacets();
   const tk = ++token;
   Trace.begin({ token: tk, query: raw, action: "query", model: null });
   Trace.start("parse", "query grammar", { token: tk });
   S.query.value = raw;
   const parsed = Q.parse(raw);
   if (parsed.source) S.setSourceSelection(parsed.source);
   const model = Q.withSource(parsed, S.sourceSelection.value);
   const req   = Q.buildRequest(model);
   Trace.end("parse", `${req.action} · ${req.mode}`, {
      token: tk,
      detail: model.model || null,
   });

   // reflect the derived state into the store (grid overlay reads mode/sort; router reads mode/query)
   S.mode.value      = req.mode;
   S.strategy.value  = model.strategy || "off";
   S.sort.value      = Q.primarySort(model);
   S.filters.value   = model.filters;
   S.selection.value = -1;

   S.embedStatus.value = null;
   current = { model, req, token: tk, startedAt: performance.now() };
   if (!cable) {
      Trace.start("connection", "waiting for Action Cable", { token: tk, level: "notice" });
      return;
   }
   S.loading.value = true;
   dispatch(current);
}

function loadFacets(requested) {
   if (!cable || !S.facetReady.value) return;
   const fields = [ ...new Set(Array.isArray(requested) ? requested : [ requested ]) ].filter(Boolean).sort();
   if (!fields.length) return;
   const resultIds = [ "search", "rate" ].includes(S.mode.value)
      ? S.videos.value.map((video) => video.id).filter(Boolean)
      : [];
   const context = `${current.token}:${resultIds.length ? "results" : "catalog"}`;
   const pending = fields.filter((field) => facetContexts.get(field)?.context !== context);
   if (!pending.length) return;
   const request = ++facetRequest;
   pending.forEach((field) => facetContexts.set(field, { context, request }));
   S.pendingFacets(pending);
   Trace.start("facets", `${pending.join(",")} requested`, { token: current.token });
   cable.facets({ filters: current.model.filters, fields: pending, resultIds, request, token: current.token });
}

function dispatch(cur) {
   const { req, token: tk } = cur;
   Trace.start("request", `${req.action} started`, { token: tk });
   if (cur.token !== token || cur.sent) return;
   cur.sent = true;
   Trace.progress("request", "sending to server", { token: tk });
   if (req.action === "recommend") {
      cable.recommend({ ...req.params, token: tk });
   } else if (req.action === "search") {
      cable.search({ ...req.params, token: tk });
   } else {
      cable.page({ ...req.params, offset: 0, limit: PAGE_LIMIT, token: tk });
   }
}

// — the ActionCable subscription. The callbacks all live at module scope, so this can too. —
function buildCable() {
   cable = connectV({
      scope: cfg.scope,
      onPage, onResults, onRated, onFacets, onRecommend, onDetails,
      onCommander: (msg) => { S.commander.value = msg; },
      onQueryStatus: Trace.receive,
      onModelStatus: (msg) => { S.modelStatus.value = msg.status; },
      onConnected: () => { runQuery(S.query.value); cable.modelStatus(); },
      onError: (m) => {
         console.warn("[v] cable:", m);
         if (S.loading.value) {
            Trace.error("request", m, { token: current.token });
            Trace.finish(m, { token: current.token, error: true });
         }
      }
   });
   return cable;
}

// browse-only: append the next page, reusing the active query's sorts/filters and token.
function loadMore() {
   if (S.mode.value !== "browse" || S.loading.value) return;
   const offset = S.videos.value.length;
   if (S.total.value && offset >= S.total.value) return;
   S.loading.value = true;
   cable.page({ sorts: current.req.params.sorts, offset, limit: PAGE_LIMIT,
                filters: current.model.filters, token: current.token });
}

// — responses (all token-gated so a superseded query's late reply is dropped) ——————————————————
function onPage(msg) {
   if (msg.token !== current.token) return;
   S.loading.value = false;
   S.total.value = msg.total;
   S.videos.value = msg.offset === 0 ? msg.videos : S.videos.value.concat(msg.videos);
   if (msg.offset === 0) S.facetReady.value = true;
   if (msg.offset === 0) {
      Trace.end("request", `${msg.videos.length} of ${msg.total}`, { token: msg.token });
      Trace.finish(`${msg.videos.length} videos`, { token: msg.token });
   }
}
function onResults(msg) {
   if (msg.token !== current.token) return;
   S.loading.value = false;
   S.videos.value = msg.videos || [];
   S.total.value = S.videos.value.length;
   S.facetReady.value = true;
   // embed outcome: fallback:true = the embed path (sidecar + HF) was down and these are keyword
   // hits; column present = a real vector search ran (embed_ms only when the server embedded live)
   const runtimeMs = performance.now() - current.startedAt;
   S.embedStatus.value = msg.fallback ? { ok: false, message: msg.message, query: msg.query }
                       : msg.column   ? { ok: true, model: msg.model || current.model.model, query: msg.query,
                                          runtimeMs, rank: ranking(current.model) }
                       : null;
   Trace.end("request", `${S.videos.value.length} videos received`, { token: msg.token });
   if (msg.fallback) Trace.progress("fallback", msg.message, { token: msg.token, level: "warning" });
   Trace.finish(msg.fallback ? "keyword fallback complete" : "search complete", { token: msg.token });
}
function onRecommend(msg) {
   if (msg.token !== current.token) return;
   S.loading.value = false;
   S.videos.value = msg.videos || [];
   S.total.value = S.videos.value.length;
   S.facetReady.value = true;
   S.embedStatus.value = msg.column ? { ok: true, model: msg.model || current.model.model, query: msg.query,
                                        runtimeMs: performance.now() - current.startedAt,
                                        rank: ranking(current.model) }
                                    : null;
   Trace.end("request", `${S.videos.value.length} videos received`, { token: msg.token });
   Trace.finish("recommendation complete", { token: msg.token });
}

// facet counts power the command-bar autocomplete (value suggestions), not a visible panel.
function onFacets(msg) {
   const requested = msg.fields || [];
   if (msg.pending || requested.some((field) => facetContexts.get(field)?.request !== msg.request)) return;
   const fields = new Set(requested);
   S.facetList.value = S.facetList.value.filter((facet) => !fields.has(facet.field)).concat(msg.facets || []);
   S.freshFacets(requested);
   Trace.end("facets", `${requested.join(",")} ready`, { token: current.token });
}
function onDetails(msg) { S.details.value = msg; }

// — rating (1–9 / option+0-9): the playing video if any, else the selected cell —
let rateFlushRunning = false;
let ratingFeedbackTimer = 0;

function csrfToken() {
   return document.querySelector('meta[name="csrf-token"]')?.content || "";
}

async function flushRates() {
   if (rateFlushRunning || cfg.isPublic) return;
   rateFlushRunning = true;
   try {
      while (ratingOutbox.pending().length) {
         for (const item of ratingOutbox.pending()) {
            const response = await fetch(`/video/${item.video_id}/rating`, {
               method: "POST",
               credentials: "same-origin",
               headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken() },
               body: JSON.stringify({ rating: item.rating })
            });
            const body = await response.text();
            let message;
            try { message = JSON.parse(body); } catch (error) { throw new Error(`${response.status}: invalid server response`, { cause: error }); }
            if (!response.ok) throw new Error(message.error || `${response.status}`);
            if (ratingOutbox.acknowledge(item)) onRated(message);
         }
      }
   } catch (error) {
      paintFailure(error, "rating");
      throw error;
   } finally {
      rateFlushRunning = false;
   }
}
// rate a SPECIFIC summary object (the swipe deck holds a card that is neither the player's current
// clip nor the grid selection). Shared core of rate() below.
// Fold one rating into the session's prequential stats. The card's `predicted`/`uncertainty` were the
// recommender's guess BEFORE this rating, so accumulating |predicted − actual| is an honest online
// learning curve. Only counts real ratings (n≠0) in rate mode; cards without a prediction still bump
// the count but not the MAE denominator.
function recordLearn(v, n) {
   if (S.mode.value !== "rate" || n === 0) return;
   const c = S.learn.value;
   const st = { n: c.n + 1, _sumErr: c._sumErr || 0, _nErr: c._nErr || 0,
                _sumU: c._sumU || 0, _nU: c._nU || 0, within1: c.within1 || 0, last: c.last };
   const p = Number(v?.predicted);
   if (Number.isFinite(p)) {
      const err = Math.abs(p - n);
      st._sumErr += err; st._nErr += 1;
      if (err <= 1) st.within1 += 1;
      st.last = { predicted: p, actual: n };
   }
   const u = Number(v?.uncertainty);
   if (Number.isFinite(u)) { st._sumU += u; st._nU += 1; }
   st.mae   = st._nErr ? st._sumErr / st._nErr : null;
   st.meanU = st._nU ? st._sumU / st._nU : null;
   S.learn.value = st;
}

function rateVideo(v, n) {
   if (!v || cfg.isPublic) return;
   ratingOutbox.enqueue(v.id, n);
   void flushRates();
   recordLearn(v, n);
   // In the active-learning feed (sort:learn/top → mode "rate") a rated video carries zero
   // information, so the server never returns it — drop it from the grid immediately rather than
   // leaving a stale card until the debounced refetch. n===0 is an *un*-rate: keep it in place.
   if (S.mode.value === "rate" && n !== 0) S.videos.value = S.videos.value.filter(x => x.id !== v.id);
   else patchRating(v.id, n === 0 ? null : n);                  // browse/search: just show the new badge
}
function rate(n) {
   rateVideo(S.refs.player?.currentVideo?.() || S.selectedVideo(), n);
}

// 1–9 rapid-rate: rate the PLAYING clip, then advance to the genuine next clip BY ID. The next clip
// must be captured BEFORE rate() runs, because in the active-learning feed rate() removes the rated
// card from S.videos.value — which shifts every later index down by one. The old flow (rate, then a
// blind player.step(+1) on the mutated list) double-advanced and desynced the index, so the title and
// the next rate landed on the wrong, unrelated video. Anchoring on the id makes the advance exact.
function rateAndAdvance(n) {
   const p   = S.refs.player;
   const cur = p?.currentVideo?.() || S.selectedVideo();
   if (!cur) return;
   const nextId = nextClipId(S.videos.value, cur.id);          // genuine next, captured pre-mutation
   rate(n);                                                     // records cur.id; may remove cur from the list
   if (p && nextId != null) (p.advance || p.showById)?.call(p, nextId);
}
let recommendTimer = 0;
let statusPingTimer = 0;
function onRated(msg) {
   S.ratingFeedback.value = msg.message;
   clearTimeout(ratingFeedbackTimer);
   ratingFeedbackTimer = setTimeout(() => { S.ratingFeedback.value = null; }, 5_000);
   if (S.mode.value === "rate") {                               // model moved: prune + re-pick, debounced
      if (msg.our_rating != null) S.videos.value = S.videos.value.filter(v => v.id !== msg.video_id);
      else patchRating(msg.video_id, msg.our_rating);          // un-rated → stays in the pool
      clearTimeout(recommendTimer);
      recommendTimer = setTimeout(() => { if (S.mode.value === "rate") runQuery(S.query.value); }, 700);
   } else {
      patchRating(msg.video_id, msg.our_rating);
   }
   // a new label bumps "pending" (ratings not yet materialized) — refresh the status panel, debounced.
   clearTimeout(statusPingTimer);
   statusPingTimer = setTimeout(() => { if (cable) cable.modelStatus(); }, 800);
}
function patchRating(id, r) {
   S.videos.value = S.videos.value.map(v => (v.id === id ? { ...v, our_rating: r } : v));
}

// — recommender status pill (top-right of the grid chrome) ————————————————————————————————————————
// just: "read-only ticker for the active recommendation strategy. S.strategy is derived by the query
//        parse (video/query → SORT): sort:top ⇒ exploit, sort:unique ⇒ novelty, sort:learn ⇒ uncertainty, otherwise off.
//        Touching S.strategy.value subscribes the component, so the pill updates live as the query
//        changes. Pinned top-right, muted — status, not a control."
const REC_LABELS = {
   best:    "top predicted",
   diverse: "most informative",
   off:     "off · browse"
};
// — rating-session progress (top strip, only in rate mode) ————————————————————————————————————————
// just: "the live 'am I learning' read-out while rating one-after-another: how many rated this
//        session, the prequential MAE (predicted-before-seeing vs the rating you gave — should fall),
//        the ±1 hit-rate, the mean model uncertainty of what you're being shown (should fall as
//        sort:learn burns down the blind spots), and the last predicted→actual. Click to reset."
// eslint-disable-next-line no-unused-vars -- kept around: not mounted since the lv merge
function RateProgress() {
   const st = S.learn.value;
   if (S.mode.value !== "rate" || !st || st.n === 0) return null;
   const mae    = Number.isFinite(st.mae) ? st.mae.toFixed(2) : "—";
   const within = st._nErr ? Math.round((100 * st.within1) / st._nErr) : 0;
   const meanU  = Number.isFinite(st.meanU) ? st.meanU.toFixed(2) : "—";
   const last   = st.last;
   const reset  = () => { S.learn.value = { n: 0, mae: null, meanU: null, within1: 0, last: null }; };
   return html`
      <div class="v-rateprog" title="this rating session — prequential accuracy (click to reset)" onClick=${reset}>
         <span class="v-rateprog-tag">rated ${st.n}</span>
         <span class="v-rateprog-val">MAE ${mae}</span>
         <span class="v-rateprog-val">±1 ${within}%</span>
         <span class="v-rateprog-val" title="mean model uncertainty of shown clips">unc ${meanU}</span>
         ${last && html`<span class="v-rateprog-last">${last.predicted.toFixed(1)}→${last.actual}</span>`}
      </div>`;
}

// eslint-disable-next-line no-unused-vars -- kept around: not mounted since the lv merge
function RecLabel() {
   const strategy = S.strategy.value;                     // subscribe: re-renders on every query change
   const on    = strategy !== "off";
   const label = REC_LABELS[strategy] || strategy;
   return html`
      <div class=${"v-reclabel-pill" + (on ? " is-on" : "")} title="active recommendation strategy">
         <span class="v-reclabel-tag">recommend</span>
         <span class="v-reclabel-val">${label}</span>
      </div>`;
}

// — recommendation-algorithm status panel (bottom-right) ————————————————————————————————————————————
// just: "a read-out for the prediction model: how many ratings are not yet folded into the scores,
//        when the materialization last ran (and whether it errored/cleared), the latest leave-one-out
//        MAE vs the predict-the-mean baseline, and an MAE-over-time sparkline. Collapsed to a compact
//        pill; click to expand the full card. Fed by S.modelStatus (VideosChannel#model_status)."
function relAge(iso) {
   if (!iso) return "—";
   const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
   if (s < 60) return `${Math.round(s)}s ago`;
   if (s < 3600) return `${Math.round(s / 60)}m ago`;
   if (s < 86400) return `${Math.round(s / 3600)}h ago`;
   return `${Math.round(s / 86400)}d ago`;
}

// Build an SVG sparkline (mae series + baseline) from the history rows. Returns {mae, base, lo, hi} as
// "x,y x,y …" point strings over a w×h box, or null when there aren't enough points to draw a line.
function spark(history, w, h, pad = 3) {
   const rows = (history || []).filter(r => Number.isFinite(r.mae));
   if (rows.length < 2) return null;
   const maes  = rows.map(r => r.mae);
   const bases = rows.map(r => r.baseline_mae).filter(Number.isFinite);
   const lo = Math.min(...maes, ...bases);
   const hi = Math.max(...maes, ...bases);
   const span = hi - lo || 1;
   const x = i => pad + (i * (w - 2 * pad)) / (rows.length - 1);
   const y = v => h - pad - ((v - lo) / span) * (h - 2 * pad);
   const pts = arr => arr.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
   return {
      mae:  pts(maes),
      base: bases.length === rows.length ? pts(rows.map(r => r.baseline_mae)) : null,
      lo:   lo.toFixed(2),
      hi:   hi.toFixed(2)
   };
}

// — embedding-path read-out for the current search: a loud banner when the embed path is down
//   (results silently degraded to keyword matching — the user must know the semantics are gone),
//   a quiet one-liner when the vector search worked. Fed by S.embedStatus (onResults). —
function EmbedStatus() {
   const st = S.embedStatus.value;
   if (!st) return null;
   if (!st.ok) {
      return html`
         <div class="v-embedfail" role="alert">
            <strong>embedding: unavailable</strong>
            <span>${st.message} — «${st.query}» matched by keyword only</span>
         </div>`;
   }
   return null;
}

function ModelStatus() {
   const st = S.modelStatus.value;
   // open state lives in the store (not useState) so the key router's Esc chain can un-toggle it
   const open = S.modelStatusOpen.value, setOpen = (v) => { S.modelStatusOpen.value = v; };
   if (!st) return null;

   const pending = st.pending | 0;
   const mae     = Number.isFinite(st.mae) ? st.mae.toFixed(2) : "—";
   const failed  = !!st.last_error;
   const reset   = st.last_status === "reset";
   const warn    = failed || reset || pending > 0 || st.stale;
   const tone    = failed ? " is-error" : (warn ? " is-warn" : " is-ok");

   if (!open) {
      return html`
         <button class=${"v-modelstat-pill" + tone} title="recommendation model status — click for detail"
                 onClick=${() => setOpen(true)}>
            <span class="v-modelstat-tag">model</span>
            <span class="v-modelstat-val">MAE ${mae}</span>
            ${pending > 0 && html`<span class="v-modelstat-badge">${pending}⏳</span>`}
            ${failed && html`<span class="v-modelstat-badge is-error">!</span>`}
         </button>`;
   }

   const sp        = spark(st.history, 196, 44);
   const salPct    = Number.isFinite(st.salience) ? Math.round(st.salience * 100) : null;
   const withinPct = Number.isFinite(st.within_one) ? Math.round(st.within_one * 100) : null;
   const coverPct  = Number.isFinite(st.coverage) ? Math.round(st.coverage * 100) : null;

   return html`
      <div class=${"v-modelstat-card" + tone}>
         <div class="v-modelstat-head">
            <span class="v-modelstat-title">recommendation model</span>
            <button class="v-modelstat-x" onClick=${() => setOpen(false)} title="collapse">×</button>
         </div>

         <div class="v-modelstat-grid">
            <div class="v-modelstat-cell">
               <span class="v-modelstat-k">MAE (±err)</span>
               <span class="v-modelstat-v">${mae}<span class="v-modelstat-sub"> / base ${Number.isFinite(st.baseline_mae) ? st.baseline_mae.toFixed(2) : "—"}</span></span>
            </div>
            <div class="v-modelstat-cell">
               <span class="v-modelstat-k">within ±1</span>
               <span class="v-modelstat-v">${withinPct == null ? "—" : withinPct + "%"}</span>
            </div>
            <div class="v-modelstat-cell">
               <span class="v-modelstat-k">skill vs mean</span>
               <span class="v-modelstat-v">${salPct == null ? "—" : salPct + "%"}</span>
            </div>
            <div class="v-modelstat-cell">
               <span class="v-modelstat-k">coverage</span>
               <span class="v-modelstat-v">${coverPct == null ? "—" : coverPct + "%"}<span class="v-modelstat-sub"> ${st.scored ?? 0}/${st.eligible ?? 0}</span></span>
            </div>
            <div class="v-modelstat-cell">
               <span class="v-modelstat-k">ratings used</span>
               <span class="v-modelstat-v">${(st.rated_count ?? 0).toLocaleString()}</span>
            </div>
            <div class="v-modelstat-cell">
               <span class="v-modelstat-k">not yet used</span>
               <span class=${"v-modelstat-v" + (pending > 0 ? " is-warn" : "")}>${pending}</span>
            </div>
         </div>

         <div class="v-modelstat-graph">
            <div class="v-modelstat-k">MAE over time<span class="v-modelstat-sub"> ${(st.history || []).length} runs</span></div>
            ${sp ? html`
               <svg viewBox="0 0 196 44" class="v-modelstat-svg" preserveAspectRatio="none">
                  ${sp.base && html`<polyline points=${sp.base} class="v-modelstat-line is-base" />`}
                  <polyline points=${sp.mae} class="v-modelstat-line is-mae" />
               </svg>
               <div class="v-modelstat-axis"><span>${sp.hi}</span><span>${sp.lo}</span></div>`
            : html`<div class="v-modelstat-empty">not enough history yet</div>`}
         </div>

         ${st.embeddings && html`
            <div class="v-modelstat-emb">
               <div class="v-modelstat-k">embedding pipelines<span class="v-modelstat-sub"> of ${(st.embeddings.total || 0).toLocaleString()} videos</span></div>
               ${[["text", "Qwen3-0.6B title/desc"], ["clip", "CLIP thumbnail"], ["vision", "caption e5"], ["sparse", "sparse"]].map(([k, label]) => {
                  const n = st.embeddings[k] || 0;
                  const pct = st.embeddings.total ? Math.round((100 * n) / st.embeddings.total) : 0;
                  return html`
                     <div class="v-emb-row" style=${`--fill:${pct}%`} title=${`${label}: ${n.toLocaleString()} of ${(st.embeddings.total || 0).toLocaleString()}`}>
                        <span class="v-emb-k">${k}</span>
                        <span class="v-emb-bar"><span class="v-emb-fill"></span></span>
                        <span class="v-emb-n">${pct}%<span class="v-modelstat-sub"> ${n.toLocaleString()}</span></span>
                     </div>`;
               })}
               ${st.embeddings.pending_text > 0 && html`<div class="v-modelstat-err is-warn">${st.embeddings.pending_text.toLocaleString()} texts still awaiting an embedding</div>`}
            </div>`}

         <div class="v-modelstat-foot">
            <div>last run <b>${relAge(st.last_run_at)}</b>${st.last_status ? html` · ${st.last_status}` : ""}</div>
            <div>scores refreshed <b>${relAge(st.updated_at)}</b></div>
            ${failed && html`<div class="v-modelstat-err">error: ${st.last_error}</div>`}
            ${reset && !failed && html`<div class="v-modelstat-err is-warn">last recalc updated nothing — predictions cleared (${st.last_cleared ?? 0})</div>`}
            ${pending > 0 && !failed && html`<div class="v-modelstat-err is-warn">${pending} rating${pending === 1 ? "" : "s"} awaiting next materialization</div>`}
         </div>
      </div>`;
}

// On-device (WebGPU) model status — a bottom-left pill (toggle button + `b` shortcut) that surfaces
// whenever a browser model runs (the vision captioner or drain loop). Subscribes
// to webgpu/status; the pill pulses while a model is loading/running.
function BrowserStatus() {
   const open = S.browserStatusOpen.value;
   const [snap, setSnap] = useState(brstat.snapshot());
   useEffect(() => brstat.subscribe((s) => setSnap({ ...s })), []);

   const models = Object.values(snap.models || {});
   const active = brstat.isActive();
   const tone = models.some((m) => m.state === "error") ? " is-error" : (active ? " is-warn" : " is-ok");

   if (!open) {
      return html`
         <button class=${"v-brstat-pill" + tone + (active ? " is-active" : "")}
                 title="on-device model status — click (or press b) for detail"
                 onClick=${() => { S.browserStatusOpen.value = true; }}>
            <span class="v-brstat-tag">device</span>
            <span class="v-brstat-val">${active ? "●" : "○"} ${snap.jobs.done | 0}</span>
         </button>`;
   }
   return html`
      <div class="v-brstat-card">
         <div class="v-brstat-head">
            <span>on-device models</span>
            <button class="v-brstat-x" title="close" onClick=${() => { S.browserStatusOpen.value = false; }}>×</button>
         </div>
         ${models.length === 0 && html`<div class="v-brstat-row">no on-device model run yet</div>`}
         ${models.map((m) => html`
            <div class="v-brstat-row">
               <b>${m.label}</b>: ${m.state}${m.progress ? ` (${m.progress}%)` : ""}
               ${m.note && html`<div class="v-brstat-note">${m.note}</div>`}
            </div>`)}
         <div class="v-brstat-row">jobs: done ${snap.jobs.done | 0} · failed ${snap.jobs.failed | 0} · remaining ${snap.jobs.remaining ?? "—"}${snap.jobs.running ? " · ●running" : ""}</div>
         ${snap.last && html`<div class="v-brstat-note">${snap.last}</div>`}
      </div>`;
}

function runtime(ms) {
   const seconds = Math.max(0, Math.round((ms || 0) / 1000));
   return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function ranking(model) {
   const sort = Q.primarySort(model);
   const field = sort.field === "embedding" ? "distance"
               : sort.field === "predicted" ? "prediction"
               : sort.field;
   return `${field}:${sort.dir}`;
}

function EmbeddingSummary() {
   const embedding = S.embedStatus.value;
   if (!embedding?.ok) return null;

   return html`
      <section class="v-embedding-summary">
         <header class="visually-hidden"><h2>${embedding.model}</h2></header>
         <strong>${embedding.model}<span class="v-embedding-runtime"> (${runtime(embedding.runtimeMs)})</span></strong>
         <ul class="v-embedding-facts">
            <li>${embedding.query}</li>
            <li>${embedding.rank}</li>
         </ul>
      </section>`;
}

// just: "translucent full-viewport scrim + spinner while any grid request is in flight
//        (S.loading — search, paging, recommend). pointer-events: none, and the CSS
//        animation delays its appearance ~150ms so fast responses never flicker."
function Loading() {
   return S.loading.value ? html`<div class="v-scrim" aria-hidden="true"></div>` : null;
}

function RatingFeedback() {
   return S.ratingFeedback.value
      ? html`<output class="v-notice v-notice-fade" aria-live="assertive">${S.ratingFeedback.value}</output>`
      : null;
}

function App({ scope = "owner", base = "/", isPublic = false, initialQuery = null }) {
   useEffect(() => {
      cfg = { scope, base, isPublic };
      S.api.runQuery     = runQuery;
      S.api.loadFacets   = loadFacets;
      S.api.reload       = () => runQuery(S.query.value);
      S.api.loadMore     = loadMore;
      S.api.rate         = rate;
      S.api.rateVideo    = rateVideo;
      S.api.rateAndAdvance = rateAndAdvance;
      S.api.openIndex    = (i) => S.refs.player?.openIndex?.(i);
      S.api.focusSearch  = () => S.refs.commandbar?.focus?.();
      S.api.openSearch   = () => S.refs.commandbar?.focus?.();
      // These run cable RPCs; the router's deep-link resolver can fire fetchDetails synchronously
      // during Router.init() below — BEFORE `cable` is assigned — so guard against a missing/closed
      // cable. fetchDetails returns whether it actually dispatched, so the resolver retries once the
      // cable connects instead of latching a request that never went out.
      S.api.registerView = (id) => { if (cable) cable.registerView(id); };
      S.api.fetchDetails = (id, space) => { if (!cable) return false; cable.details(id, space); return true; };
      S.api.fetchCommander = (id, vectors, query) => { if (!cable) return false; cable.commander(id, vectors, query); return true; };
      // hydrate the command-bar string from the URL BEFORE connecting, so the first fetch honors it.
      // The router owns window.location under this scope's base ("/" owner, the official prefix public).
      const stopRouter = Router.init({ base, query: initialQuery });

      buildCable();
      void flushRates();
      addEventListener("online", flushRates);
      // Refresh the recommender-status panel on a slow timer (materialization runs every ~30 min in
      // the background) so "pending ratings / last run" stay current even with no user activity.
      const statusTimer = setInterval(() => { if (cable) cable.modelStatus(); }, 60_000);

      deckBus.setStateProvider(snapshotUI);

      const focusSearch = () => {
         if (S.refs.player?.commanderActive?.()) S.refs.commander?.focus?.();
         else S.refs.commandbar?.focus?.();
      };
      const uninstall = installKeyRouter({
         player: () => S.refs.player,
         grid: () => S.refs.grid,
         openSearch: focusSearch,
         focusSearch,
         rate,
         rateAndAdvance,
         openSelected: () => { const i = S.selection.value; if (i >= 0) S.refs.player?.openIndex?.(i); },
         toggleBrowserStatus: () => { S.browserStatusOpen.value = !S.browserStatusOpen.value; },
         // Esc chain (see keys.js): close the topmost small overlay card, report which (or null).
         // Order: most-foreground first — the status cards sit above the grid and player.
         closeOverlay: () => {
            if (S.browserStatusOpen.value) { S.browserStatusOpen.value = false; return "browser-status"; }
            if (S.modelStatusOpen.value)   { S.modelStatusOpen.value = false;   return "model-status"; }
            return null;
         }
      });

      registerShortcuts("Search & view", [
         { keys: "/", desc: "Focus the command bar" },
         { keys: "?", desc: "Show / hide this help" },
         { keys: "Tab / ⇧Tab", desc: "Next / previous query segment (in the bar)" },
         { keys: "Enter", desc: "Run the query / open the selected video" },
         { keys: "← ↑ → ↓", desc: "Move the grid selection" }
      ]);
      registerShortcuts("Player", [
         { keys: "Space", desc: "Play / pause" }, { keys: "← / →", desc: "Seek ∓10s" },
         { keys: "↑ / ↓", desc: "Previous / next clip" }, { keys: "i", desc: "Toggle info overlay" },
         { keys: "d", desc: "Toggle details (similar + passages)" }, { keys: "f", desc: "Fullscreen" },
         { keys: "⌘ + ← / →", desc: "Seek by scene (±60s until the scene index is built)" },
         { keys: "s", desc: "Toggle the scene strip (filmstrip + novelty profile)" },
         { keys: "e", desc: "Equidistant lighttable → scene transitions → close" },
         { keys: "Esc", desc: "Un-toggle the topmost overlay: help → swipe → lighttable → details → status cards → player" }
      ]);
      registerAbout("Video", "Jedes Bild ist ein kleines Fenster; die Lichttafel macht aus vergehender Zeit einen Raum.");
      registerShortcuts("Rating", [
         { keys: "1–9", desc: "Rate the playing/selected video, then advance" },
         { keys: "⌥/Alt + 0–9", desc: "Rate without advancing (0 clears)" }
      ]);
      registerShortcuts("On-device", [
         { keys: "b", desc: "Toggle the on-device (WebGPU) model-status overlay" }
      ]);
      registerShortcuts("Watcher", [
         // handled by the oversight topframe (it instruments this window); truthful only when framed
         { keys: "w", desc: "Toggle the watcher sidebar (minimal ⇆ informative)",
           recv: "oversight topframe", when: () => window.top !== window }
      ]);

      return () => {
         stopRouter(); uninstall(); clearInterval(statusTimer); clearTimeout(ratingFeedbackTimer);
         removeEventListener("online", flushRates); cable.close(); deckBus.setStateProvider(null);
      };
   }, []);

   // the tab's title is the live subject — the query — and falls back to the page's own path when
   // there is none. (Never a composed name: it would read the same tomorrow with different data.)
   useEffect(() => {
      const q = S.query.value.trim();
      document.title = q || location.pathname;
   }, [ S.query.value ]);

   const count = S.mode.value === "browse" ? S.total.value : S.videos.value.length;

   return html`
      <div class="v-header">
         <${CommandBar} />
         <span class="v-count">${S.loading.value ? "…" : `${count.toLocaleString()} videos`}</span>
         <button class="v-hbtn" title="swipe to rate"
                 onClick=${() => { S.swipeOpen.value = true; }}>swipe</button>
      </div>
      <${QueryStatus} />
      <${EmbeddingSummary} />
      <${EmbedStatus} />
      <${ModelStatus} />
      <${BrowserStatus} />
      <${Grid} />
      <${Loading} />
      <${RatingFeedback} />
      <${Player} />
      <${Swipe} />
   `;
}

// just: "the render-time net. Preact unmounts a subtree whose component throws, so an error inside
//        <Grid/> or <Player/> emptied #v-app and left a white page — the failure mode that made a
//        broken build indistinguishable from a dead server. componentDidCatch turns that into the
//        painted panel instead, and re-throwing is never an option here: nothing above us would
//        render anything."
class Boundary extends Component {
   componentDidCatch(err) {
      this.setState({ failed: true });
      paintFailure(err, "render");
   }
   render(props, state) {
      // paintFailure owns #v-app's contents once it has painted; rendering null here keeps Preact
      // from fighting it for the same subtree.
      return state.failed ? null : props.children;
   }
}

export function mountVideoApp() {
   const root = document.getElementById("v-app");
   if (!root) return;
   const scope    = root.dataset.scope || "owner";
   const base     = root.dataset.base  || "/";
   const isPublic = root.dataset.public === "1";
   const initialQuery = root.dataset.query;
   render(html`<${Boundary}><${App} scope=${scope} base=${base} isPublic=${isPublic} initialQuery=${initialQuery} /><//>`, root);
}

// the layout's importmap entry point is this module, so self-mount.
// Defensive mount: handles race conditions where the module loads after DOMContentLoaded fires.
// — If loading: attach a DOMContentLoaded listener (will fire when DOM is ready)
// — Otherwise: use setTimeout to ensure reliable mount on backgrounded tabs, slow networks
let mounted = false;
const doMount = () => {
   if (mounted) return;  // guard: mount only once
   mounted = true;
   try {
      mountVideoApp();
   } catch (err) {
      // A throw here means no UI at all. Logging it and returning is what used to leave the
      // viewport blank; paint it instead, so the page says what happened.
      paintFailure(err, "mount");
      return;
   }
   // Mounting without throwing still does not prove anything reached the screen — a component can
   // render null all the way down, or an async import can hang. If #v-app is empty a beat later,
   // say so rather than show white.
   if (isBlank()) armMountWatchdog(8000);
};

// Armed before the mount, so an error thrown between here and first paint has somewhere to land.
installFailureNet();
console.info("[spa] boot: error handlers installed");

if (document.readyState === "loading") {
   document.addEventListener("DOMContentLoaded", doMount, { once: true });
} else {
   // DOM is ready. Use setTimeout(0) instead of requestAnimationFrame for reliability:
   // rAF doesn't fire on backgrounded tabs or suspended iframes, leaving #v-app empty
   // and triggering the oversight watcher's 25s timeout. setTimeout fires reliably even
   // on throttled/backgrounded tabs, ensuring the mount completes within seconds.
   setTimeout(doMount, 0);
}
