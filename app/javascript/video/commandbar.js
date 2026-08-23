// just: "the video command bar — one text input that is the whole search/filter/sort UI. Parsing + the
//        suggestion logic live in v/query (pure); this file is only the input, the autocomplete menu,
//        and the keyboard wiring. Enter accepts an ↑/↓-selected suggestion, else runs the query;
//        ↑/↓ move within the menu; Tab / Shift+Tab jump between query segments; Esc closes the menu.
//        The document-level key router (v/keys) yields all keys to the focused input, so these handlers
//        own them here."
import { html } from "htm/preact";
import { useRef, useState, useEffect } from "preact/hooks";
import * as S from "video/store";
import * as Q from "video/query";
import * as Trace from "video/query_status";

const PLACEHOLDER = "search…   try  source:one,!other   rating:>7   sort:embedding";

export function CommandBar() {
   const inputRef = useRef(null);
   const [ value, setValue ] = useState(S.query.value);
   const [ sug, setSug ] = useState({ from: 0, to: 0, items: [] });
   const [ hi, setHi ] = useState(-1);
   const [ open, setOpen ] = useState(false);
   const liveTimer = useRef(null);
   const facets = S.facetList.value;
   const facetStatus = S.facetStatus.value;
   const facetReady = S.facetReady.value;

   // mirror external `query` changes (router hydration, programmatic runs) into the box
   useEffect(() => S.query.subscribe((v) => setValue((prev) => (prev === v ? prev : v))), []);

   // expose a focus controller so "/" (and S.api.focusSearch) can reach the bar
   useEffect(() => {
      S.refs.commandbar = { focus() { const el = inputRef.current; if (el) { el.focus(); el.select?.(); } } };
      return () => { S.refs.commandbar = null; };
   }, []);

   function refresh(val, caret) {
      const s = Q.suggest(val, caret, facets, facetStatus);
      const fields = [ ...new Set(s.items.map((item) => item.facet).filter(Boolean)) ];
      if (S.facetReady.value && fields.length) S.api.loadFacets(fields);
      setSug(s);
      setHi(-1);                          // never pre-highlight — Enter runs unless the user ↑/↓-selects one
      setOpen(s.items.length > 0);
   }

   useEffect(() => {
      const el = inputRef.current;
      if (el && document.activeElement === el) refresh(el.value, el.selectionStart ?? el.value.length);
   }, [ facets, facetStatus, facetReady ]);

   // live "search as you type": after a short pause, run filters, browse, and fulltext queries.
   // Semantic text waits for an explicit form submission so partial words never start embeddings.
   function scheduleLive(val) {
      clearTimeout(liveTimer.current);
      liveTimer.current = setTimeout(() => { if (Q.live(val)) S.api.runQuery(val); }, 350);
   }

   function onInput(e) {
      const val = e.target.value;
      const caret = e.target.selectionStart ?? val.length;
      setValue(val);
      S.staleFacets();
      refresh(val, caret);
      scheduleLive(val);
   }

   // accept a suggestion: splice item.insert over [from,to], restore the caret, re-suggest the next
   // context (so picking a key immediately offers its relations/values).
   function accept(item) {
      const next = value.slice(0, sug.from) + item.insert + value.slice(sug.to);
      const caret = sug.from + item.insert.length;
      setValue(next);
      S.staleFacets();
      requestAnimationFrame(() => {
         const el = inputRef.current;
         if (el) { el.focus(); el.setSelectionRange(caret, caret); }
         refresh(next, caret);
         scheduleLive(next);           // accepting a suggestion completes a token → live-run it
      });
   }

   function run(e) {
      e.preventDefault();
      clearTimeout(liveTimer.current); // cancel any pending live-run; this is the explicit one
      setOpen(false);
      inputRef.current?.blur();        // release focus so grid keyboard nav takes over after Enter
      S.api.runQuery(value);
   }

   function clearSource() {
      const next = Q.withoutSource(value);
      S.setSourceSelection(null);
      setValue(next);
      S.staleFacets();
      scheduleLive(next);
   }

   // select the next/previous whitespace-separated segment (token) for quick replacement
   function moveSegment(dir) {
      const el = inputRef.current;
      if (!el) return;
      const segs = Q.segments(value);
      if (!segs.length) return;
      const caret = el.selectionStart ?? 0;
      let idx = segs.findIndex((s) => caret >= s.start && caret <= s.end);
      if (idx < 0) {                                   // caret in whitespace — pick by direction
         if (dir > 0) { idx = segs.findIndex((s) => s.start >= caret); if (idx < 0) idx = 0; }
         else { idx = segs.length - 1; for (let i = segs.length - 1; i >= 0; i--) { if (segs[i].end <= caret) { idx = i; break; } } }
      } else { idx += dir; }
      idx = (idx + segs.length) % segs.length;         // wrap around
      const seg = segs[idx];
      el.focus();
      el.setSelectionRange(seg.start, seg.end);         // select the whole token
      refresh(value, seg.end);
   }

   function onKeyDown(e) {
      switch (e.key) {
         case "Tab":
            e.preventDefault(); moveSegment(e.shiftKey ? -1 : 1); return;
         case "ArrowDown":
            if (open) { e.preventDefault(); setHi((h) => Math.min(h + 1, sug.items.length - 1)); } return;
         case "ArrowUp":
            if (open) { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); } return;
         case "Enter":
            // accept ONLY a suggestion the user explicitly selected (↑/↓); otherwise run the search.
            // (refresh never auto-highlights, so a plain Enter submits the form.)
            if (open && hi >= 0 && sug.items[hi]) { e.preventDefault(); accept(sug.items[hi]); }
            return;
         case "Escape":
            if (open) { e.preventDefault(); setOpen(false); } return;
      }
   }

   const onFocus = (e) => {
      const v = e.target.value;
      Trace.focus(v);
      refresh(v, e.target.selectionStart ?? v.length);
   };
   const onBlur  = () => setTimeout(() => setOpen(false), 120);   // let an item mousedown land first

   // one suggestion row (global index `i` so ↑/↓ highlight + click-accept work across columns)
   const itemRow = (it, i) => html`
      <div class=${"v-cmd-item" + (i === hi ? " is-hi" : "")} key=${it.insert + i}
           onMouseDown=${(e) => { e.preventDefault(); accept(it); }} onMouseEnter=${() => setHi(i)}>
         <span class="v-cmd-item-label">${it.label}</span>
         ${it.hint ? html`<span class="v-cmd-item-hint">${it.hint}</span>` : null}
         ${it.showEntropy && it.facet ? html`<span class=${"v-cmd-item-stat" + (it.inactive ? " is-inactive" : "")}>H ${it.entropy == null ? "…" : Number(it.entropy).toFixed(2)}</span>` : null}
         ${it.count != null ? html`<span class=${"v-cmd-item-count" + (it.inactive ? " is-inactive" : "")}>${Number(it.count).toLocaleString()}</span>` : null}
      </div>`;
   // group items by their `group` tag (preserving each item's GLOBAL index for keyboard nav)
   function groupCols(items) {
      const order = [], by = {};
      items.forEach((it, i) => { const g = it.group || ""; (by[g] ||= (order.push(g), [])).push({ it, i }); });
      return order.map((g) => ({ title: g, rows: by[g] }));
   }

   return html`
      <form class="v-cmd" onSubmit=${run}>
         <input ref=${inputRef} class="v-cmd-input" type="text" spellcheck="false"
                autocomplete="off" autocorrect="off" autocapitalize="off" enterkeyhint="search"
                name="lit-cmd-noautofill" inputmode="search" data-1p-ignore data-lpignore="true"
                placeholder=${PLACEHOLDER} value=${value}
                onInput=${onInput} onKeyDown=${onKeyDown} onFocus=${onFocus} onBlur=${onBlur} />
         ${S.sourceSelection.value ? html`
            <span class="v-source" title=${`source:${Q.sourceText(S.sourceSelection.value)}`}>
               <span>source:${Q.sourceText(S.sourceSelection.value)}</span>
               <button type="button" aria-label="delete source selection" onClick=${clearSource}>×</button>
            </span>` : null}
         ${open && sug.items.length ? html`
            <div class=${"v-cmd-menu" + (sug.grouped ? " is-grouped" : "")}>
               ${sug.grouped
                  ? groupCols(sug.items).map((col) => html`
                     <div class="v-cmd-group" key=${col.title}>
                        <div class="v-cmd-group-title">${col.title}</div>
                        ${col.rows.map(({ it, i }) => itemRow(it, i))}
                     </div>`)
                  : sug.items.map((it, i) => itemRow(it, i))}
            </div>` : null}
      </form>`;
}
