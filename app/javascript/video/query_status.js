import { html } from "htm/preact";
import { useEffect, useState } from "preact/hooks";
import * as S from "video/store";

const LIMIT = 240;
let sequence = 0;
let heartbeat = null;

function elapsed(startedAt, endedAt = Date.now()) {
   return Math.max(0, endedAt - startedAt);
}

function event(phase, state, message, options = {}) {
   const trace = S.queryStatus.value;
   if (!trace || (options.token != null && options.token !== trace.token)) return;
   const nextProgress = Number.isFinite(options.progress) ? Math.max(0, Math.min(100, options.progress)) : null;
   const prior = trace.events.at(-1);
   if (prior?.phase === phase && prior.state === state && prior.message === (message || phase) &&
       prior.elapsedMs === options.elapsedMs && prior.progress === nextProgress) return;
   const at = Date.now();
   const item = {
      id: ++sequence,
      phase,
      state,
      level: options.level || (state === "error" ? "error" : "info"),
      message: message || phase,
      at,
      elapsedMs: options.elapsedMs,
      progress: nextProgress,
      detail: options.detail || null,
   };
   const active = { ...trace.active };
   if (state === "start") active[phase] = { message: item.message, at };
   if (state === "end" || state === "error") delete active[phase];
   const events = trace.events.concat(item).slice(-LIMIT);
   const done = trace.outcome && Object.keys(active).length === 0;
   S.queryStatus.value = {
      ...trace,
      open: true,
      active,
      events,
      updatedAt: at,
      state: done ? trace.outcome : (trace.outcome === "error" ? "error" : "running"),
   };
   if (done) stopHeartbeat();
}

function startHeartbeat() {
   stopHeartbeat();
   heartbeat = setInterval(() => {
      const trace = S.queryStatus.value;
      if (!trace || trace.state !== "running") return;
      if (Date.now() - trace.updatedAt < 4_000) return;
      const names = Object.values(trace.active).map((item) => item.message);
      event("heartbeat", "progress", names.join(" · ") || "query active", {
         token: trace.token,
         level: "notice",
         elapsedMs: elapsed(trace.startedAt),
      });
   }, 1_000);
}

function stopHeartbeat() {
   if (heartbeat) clearInterval(heartbeat);
   heartbeat = null;
}

export function focus(query) {
   const trace = S.queryStatus.value;
   if (trace) {
      S.queryStatus.value = { ...trace, open: true };
      event("textfield", "end", query ? `selected · ${query}` : "selected", { level: "notice" });
      return;
   }
   const now = Date.now();
   S.queryStatus.value = {
      open: true, token: 0, query: query || location.pathname, action: "ready", model: null,
      state: "ready", outcome: null, startedAt: now, updatedAt: now, active: {},
      events: [{ id: ++sequence, phase: "textfield", state: "end", level: "notice",
                 message: query ? `selected · ${query}` : "selected", at: now, elapsedMs: 0, progress: null, detail: null }],
   };
}

export function begin({ token, query, action, model }) {
   const now = Date.now();
   S.queryStatus.value = {
      open: true, token, query: query || location.pathname, action, model,
      state: "running", outcome: null, startedAt: now, updatedAt: now,
      active: {}, events: [],
   };
   event("query", "start", action, { token, level: "notice" });
   startHeartbeat();
}

export function start(phase, message, options = {}) { event(phase, "start", message, options); }
export function progress(phase, message, options = {}) { event(phase, "progress", message, options); }
export function end(phase, message, options = {}) { event(phase, "end", message, options); }
export function error(phase, message, options = {}) { event(phase, "error", message, { ...options, level: "error" }); }

export function receive(message) {
   const state = message.state || "progress";
   event(message.phase || "server", state, message.message, {
      token: message.token,
      level: message.level,
      progress: message.progress,
      elapsedMs: message.elapsed_ms,
      detail: message.detail,
   });
}

export function finish(message, options = {}) {
   const trace = S.queryStatus.value;
   if (!trace || (options.token != null && options.token !== trace.token)) return;
   end("query", message, options);
   const current = S.queryStatus.value;
   const outcome = options.error ? "error" : "complete";
   const done = Object.keys(current.active).length === 0;
   S.queryStatus.value = { ...current, outcome, state: done ? outcome : "running" };
   if (done) stopHeartbeat();
}

function clock(ms) {
   if (ms < 1_000) return `${Math.round(ms)}ms`;
   return `${(ms / 1_000).toFixed(ms < 10_000 ? 2 : 1)}s`;
}

export function QueryStatus() {
   const trace = S.queryStatus.value;
   const [ now, setNow ] = useState(Date.now());
   useEffect(() => {
      if (!trace?.open || trace.state !== "running") return undefined;
      const timer = setInterval(() => setNow(Date.now()), 250);
      return () => clearInterval(timer);
   }, [ trace?.open, trace?.state, trace?.token ]);
   if (!trace?.open) return null;

   const activeProgress = trace.events.toReversed().find((item) => item.progress != null && item.state !== "end");
   return html`
      <aside class=${`v-query-status is-${trace.state}`} aria-live="polite" aria-atomic="false">
         <header class="v-query-status-head">
            <h2>${trace.query}</h2>
            <output>${trace.state} · ${clock(elapsed(trace.startedAt, trace.state === "running" ? now : trace.updatedAt))}</output>
            <button type="button" aria-label="close query status" onClick=${() => {
               S.queryStatus.value = { ...S.queryStatus.value, open: false };
            }}>×</button>
         </header>
         <progress max="100" value=${activeProgress?.progress ?? undefined}></progress>
         <ol class="v-query-events" role="log">
            ${trace.events.map((item) => html`
               <li key=${item.id} class=${`is-${item.level}`}>
                  <time>+${clock(elapsed(trace.startedAt, item.at))}</time>
                  <b>${item.phase}</b>
                  <span>${item.message}</span>
                  ${item.progress != null && html`<progress max="100" value=${item.progress}>${item.progress}%</progress>`}
                  ${Number.isFinite(item.elapsedMs) && html`<data value=${item.elapsedMs}>${clock(item.elapsedMs)}</data>`}
                  ${item.detail && html`<small>${item.detail}</small>`}
               </li>`)}
         </ol>
      </aside>`;
}
