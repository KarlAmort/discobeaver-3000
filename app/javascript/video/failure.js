// just: "the SPA's visible failure surface. When the Preact app cannot mount, crashes while
//        rendering, or never arrives at all, this paints the error INTO #v-app instead of leaving
//        the viewport blank. A white page reports nothing and looks like a dead server; the panel
//        below names what threw, where, and when, and offers a reload.
//
//        Deliberately dependency-free: no preact, no htm, no store, no stylesheet. Every one of
//        those is a thing that can be the reason we got here, so this module imports nothing and
//        styles itself inline. It must work when everything else is broken.
//
//        Errors still travel to the server the usual way — console/log taps console.error and
//        window.onerror and ships them over ClientChannel — so painting here does not replace
//        reporting, it adds the half the visitor can see."

const ROOT_ID = "v-app";

// The first failure is the interesting one; later errors are usually its wreckage. We keep painting
// the first and only tally the rest, so a render loop can't hide the original cause.
let painted = null;
let extra = 0;
let watchdog = 0;

const css = {
   panel: [
      "margin:0", "padding:2rem 1.5rem", "max-width:72ch",
      "font:400 16px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
      "color:#111", "background:#fff"
   ].join(";"),
   h1: "margin:0 0 1.25rem;font:inherit;font-size:1.5rem;font-weight:700;word-break:break-all",
   row: "display:grid;grid-template-columns:5.5rem 1fr;gap:.5rem 1rem;margin:0 0 .6rem",
   key: "color:#767676;text-transform:lowercase",
   val: "margin:0;white-space:pre-wrap;word-break:break-word",
   pre: [
      "margin:.35rem 0 1.25rem", "padding:.75rem", "overflow-x:auto",
      "background:#f4f4f4", "border-left:3px solid #c00",
      "font:inherit;font-size:13px", "white-space:pre", "tab-size:2"
   ].join(";"),
   bar: "display:flex;gap:.5rem;flex-wrap:wrap;margin-top:1.5rem",
   btn: [
      "font:inherit;font-size:14px", "padding:.45rem .9rem", "cursor:pointer",
      "color:#111", "background:#fff", "border:1px solid #111", "border-radius:0"
   ].join(";")
};

function el(tag, style, text) {
   const n = document.createElement(tag);
   if (style) n.setAttribute("style", style);
   if (text != null) n.textContent = String(text);
   return n;
}

function row(parent, key, value) {
   if (value == null || value === "") return;
   const r = el("div", css.row);
   r.appendChild(el("span", css.key, key));
   r.appendChild(el("p", css.val, value));
   parent.appendChild(r);
}

// An error can arrive as an Error, a rejection value, an ErrorEvent, or a bare string. Normalize to
// { name, message, stack, source } without ever throwing on the way — this runs in the failure path.
function describe(err) {
   const out = { name: "", message: "", stack: "", source: "" };
   try {
      if (err && typeof err === "object") {
         if (err instanceof ErrorEvent || (err.filename !== undefined && err.message !== undefined)) {
            out.source = [err.filename, err.lineno, err.colno].filter(Boolean).join(":");
            err = err.error || err.message;
         }
      }
      if (err instanceof Error) {
         out.name = err.name || "Error";
         out.message = err.message || "";
         out.stack = err.stack || "";
      } else if (err && typeof err === "object") {
         out.name = err.constructor?.name || "object";
         out.message = (() => { try { return JSON.stringify(err); } catch { return String(err); } })();
      } else {
         out.name = typeof err;
         out.message = String(err);
      }
   } catch {
      out.name = "unknown";
      out.message = "the error object could not be read";
   }
   // strip the origin so the frames stay legible at this width
   out.stack = String(out.stack || "").split("\n").slice(0, 12)
      .map((l) => l.replace(location.origin, "")).join("\n");
   return out;
}

function tally(node) {
   if (!node || !extra) return;
   let t = node.querySelector("[data-since]");
   if (!t) {
      t = el("div", css.row);
      t.setAttribute("data-since", "1");
      t.appendChild(el("span", css.key, "since"));
      t.appendChild(el("p", css.val, ""));
      node.insertBefore(t, node.querySelector("[data-bar]"));
   }
   t.lastChild.textContent = `${extra} further error${extra === 1 ? "" : "s"}`;
}

// Paint the failure into #v-app. `context` names WHERE we caught it (mount / render / window /
// promise / watchdog) — the single most useful field when reading these server-side.
export function paintFailure(err, context) {
   clearTimeout(watchdog);
   const root = document.getElementById(ROOT_ID);
   if (!root) return;

   if (painted) { extra += 1; tally(painted); return; }

   const d = describe(err);
   const panel = el("div", css.panel);
   panel.setAttribute("data-spa-failure", context || "unknown");

   // No subject is loaded — by the house rule the h1 is then the page's own path.
   panel.appendChild(el("h1", css.h1, location.pathname + location.search));

   row(panel, "caught", context || "unknown");
   row(panel, "error", d.name && d.message ? `${d.name}: ${d.message}` : d.name || d.message);
   row(panel, "source", d.source);
   row(panel, "at", new Date().toISOString());
   if (d.stack) panel.appendChild(el("pre", css.pre, d.stack));

   const bar = el("div", css.bar);
   bar.setAttribute("data-bar", "1");
   const reload = el("button", css.btn, "reload");
   reload.type = "button";
   reload.addEventListener("click", () => location.reload());
   bar.appendChild(reload);

   const copy = el("button", css.btn, "copy");
   copy.type = "button";
   copy.addEventListener("click", () => {
      const text = [location.href, context, `${d.name}: ${d.message}`, d.source, d.stack]
         .filter(Boolean).join("\n");
      navigator.clipboard?.writeText(text).then(
         () => { copy.textContent = "copied"; },
         () => { copy.textContent = "clipboard denied"; }
      );
   });
   bar.appendChild(copy);
   panel.appendChild(bar);

   root.textContent = "";
   root.appendChild(panel);
   painted = panel;

   // Ship it: console/log's tap turns console.error into a [client.error] line on the server. Guarded
   // because the tap itself may be what failed.
   try {
      console.error(`[spa] ${context || "failure"}: ${d.name}: ${d.message}`, d.stack);
   } catch {}
}

export function hasFailed() { return painted !== null; }

// Did the app actually put anything on screen? An empty #v-app after boot is the blank-page symptom.
export function isBlank() {
   const root = document.getElementById(ROOT_ID);
   return !!root && root.childElementCount === 0;
}

// Arm the last-resort net: if #v-app is still empty `ms` after this call, nothing rendered and no
// error was thrown where we could see it (a hung import, a promise nobody rejected, a mount that
// silently returned). Paint that fact rather than leave the viewport white.
export function armMountWatchdog(ms = 8000) {
   clearTimeout(watchdog);
   watchdog = setTimeout(() => {
      if (painted || !isBlank()) return;
      paintFailure(
         new Error(`#${ROOT_ID} still empty ${ms}ms after boot — the app never rendered`),
         "watchdog"
      );
   }, ms);
}

// Catch what escapes the app entirely: a module that throws at import time, a rejected promise with
// no handler. Only paints while the page is still blank — once the UI is up, a stray error is the
// console's business, not a reason to replace a working screen.
export function installFailureNet() {
   const onError = (event) => {
      if (painted || !isBlank()) return;
      paintFailure(event.error || event, "window");
   };
   const onRejection = (event) => {
      if (painted || !isBlank()) return;
      paintFailure(event.reason, "promise");
   };
   // never preventDefault: console/log must still see these and ship them
   window.addEventListener("error", onError);
   window.addEventListener("unhandledrejection", onRejection);
}
