// just: "the video thumbnail grid: a hand-rolled windowed uniform grid (no virtual lib). Measures its
//        own width, lays out equal-height cells absolutely, renders only the visible row band,
//        pages in more on scroll, and floats an enlarged real-size preview of the selected cell.
//        Registers the imperative `grid` controller (keyboard nav) into the store on mount."
import { html } from "htm/preact";
import { useRef, useEffect, useState } from "preact/hooks";
import * as S from "video/store";
import { thumbError } from "video/thumbs";
import { ROW_HEIGHT, MIN_CELL_WIDTH, CELL_GAP, sourceMetric, labelsAt, cardMetrics } from "video/grid_metrics";

const OVERSCAN = 2;                      // extra rows rendered above/below the viewport
function criterion() {
   if (S.embedStatus.value?.ok) return "embedding";
   return S.sort.value.field;
}

// — crop overlay geometry —
// The thumbnail shows the FULL raw frame; the detected crop is a sub-rectangle of that frame in
// source pixels. We map it through the img's fit transform (cover for cells, contain for the float)
// into px within the cw×ch container box. Returns null when crop or raw dims are missing.
function cropBox(v, cw, ch, fit) {
   const c = v && v.crop;
   const rw = v && v.width, rh = v && v.height;
   if (!c || !rw || !rh || !c.w || !c.h) return null;
   const sCover = Math.max(cw / rw, ch / rh);
   const sContain = Math.min(cw / rw, ch / rh);
   const s = fit === "contain" ? sContain : sCover;
   const dw = rw * s, dh = rh * s;          // rendered full-frame size
   const ox = (cw - dw) / 2, oy = (ch - dh) / 2;  // frame offset within the box (cover<0, contain>=0)
   return {
      left:   ox + c.x * s,
      top:    oy + c.y * s,
      width:  c.w * s,
      height: c.h * s
   };
}
function cropFrameEl(v, cw, ch, fit) {
   const b = cropBox(v, cw, ch, fit);
   if (!b) return null;
   return html`<div class="v-crop-frame"
      style=${`left:${b.left}px;top:${b.top}px;width:${b.width}px;height:${b.height}px;`}></div>`;
}

export function Grid() {
   const scrollRef = useRef(null);
   const [ width, setWidth ]       = useState(0);
   const [ scrollTop, setScrollTop ] = useState(0);
   const rafRef  = useRef(0);
   const lastLoadLenRef = useRef(-1);    // guards loadMore() against spamming
   const colsRef = useRef(1);            // latest column count, readable inside the controller closure

   // — measure container width via ResizeObserver —
   useEffect(() => {
      const el = scrollRef.current;
      if (!el) return;
      const measure = () => setWidth(el.clientWidth);
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
   }, []);

   // — the DOCUMENT scrolls, not the grid (2026-07-30) —
   //
   // The grid used to be its own overflow:auto box inside a 100vh flex column, which is what pinned
   // the header and the status panels to the top forever. Now the page scrolls as a whole and they
   // scroll away with it, so the virtualization has to measure against the window: `scrollTop` is
   // how far the document has scrolled PAST the top of the grid (never negative, so rows before
   // first paint stay at 0), and the viewport height replaces the container's clientHeight.
   useEffect(() => {
      const read = () => {
         const el = scrollRef.current;
         if (!el) return;
         const top = el.getBoundingClientRect().top + window.scrollY;
         setScrollTop(Math.max(0, window.scrollY - top));
      };
      const onScroll = () => {
         if (rafRef.current) return;
         rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; read(); });
      };
      read();
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onScroll, { passive: true });
      return () => {
         window.removeEventListener("scroll", onScroll);
         window.removeEventListener("resize", onScroll);
         if (rafRef.current) cancelAnimationFrame(rafRef.current);
         rafRef.current = 0;
      };
   }, []);

   // — read reactive signals in the body so this component re-renders on change —
   const videos = S.videos.value;
   const total  = S.total.value;
   const sel    = S.selection.value;
   void S.sort.value;
   void S.mode.value;
   void S.embedStatus.value;
   void S.loading.value;  // subscribe (overlay/paging depend on these)

   const n    = videos.length;
   const cols = Math.max(1, Math.floor((width || MIN_CELL_WIDTH) / MIN_CELL_WIDTH));
   const cellW = (width || MIN_CELL_WIDTH) / cols;
   colsRef.current = cols;
   const innerH = Math.ceil(n / cols) * ROW_HEIGHT;
   const clientH = typeof window !== "undefined" ? window.innerHeight : 0;

   // — visible row band (with overscan) —
   const firstRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
   const lastRow  = Math.ceil((scrollTop + clientH) / ROW_HEIGHT) + OVERSCAN;
   const start = firstRow * cols;
   const end   = Math.min(n, (lastRow + 1) * cols);

   // — lazy paging: when the last rendered row nears the bottom (browse mode, more to load) —
   useEffect(() => {
      if (S.mode.value !== "browse" || n >= total) return;
      const rowsTotal = Math.ceil(n / cols);
      if (lastRow >= rowsTotal - 3 && lastLoadLenRef.current !== n) {
         lastLoadLenRef.current = n;
         S.api.loadMore();
      }
   }, [ scrollTop, n, total, cols, clientH ]);

   // — register the keyboard controller; cols read live through colsRef —
   useEffect(() => {
      S.refs.grid = {
         move(dx, dy) {
            const len = S.videos.value.length; if (!len) return;
            const c = colsRef.current;
            let i = S.selection.value;
            if (i < 0) i = 0;
            else { const ni = i + dx + dy * c; if (ni >= 0 && ni < len) i = ni; }
            S.selection.value = i;
            // scroll the selected row into view — the DOCUMENT scrolls now, so the row's
            // position is measured from the top of the grid in page coordinates.
            const el = scrollRef.current;
            if (el) {
               const gridTop = el.getBoundingClientRect().top + window.scrollY;
               const rowTop  = gridTop + Math.floor(i / c) * ROW_HEIGHT;
               const rowBot  = rowTop + ROW_HEIGHT;
               const viewH   = window.innerHeight;
               if (rowTop < window.scrollY) window.scrollTo({ top: rowTop });
               else if (rowBot > window.scrollY + viewH) window.scrollTo({ top: rowBot - viewH });
            }
            // page in more if we've stepped near the end
            if (S.mode.value === "browse" && len < S.total.value && i >= len - c * 3) {
               if (lastLoadLenRef.current !== len) { lastLoadLenRef.current = len; S.api.loadMore(); }
            }
         },
         hasSelection() { return S.selection.value >= 0; },
         selectedVideo() { return S.videos.value[S.selection.value] || null; },
         columns() { return colsRef.current; }
      };
      return () => { S.refs.grid = null; };
   }, []);

   // — render the visible cells —
   const cells = [];
   for (let i = start; i < end; i++) {
      const v = videos[i]; if (!v) continue;
      const left = (i % cols) * cellW + CELL_GAP / 2;
      const top  = Math.floor(i / cols) * ROW_HEIGHT + CELL_GAP / 2;
      const w = Math.max(120, cellW - CELL_GAP);
      const h = ROW_HEIGHT - CELL_GAP;
      const cls  = "v-cell" + (i === sel ? " is-selected" : "");
      const activeCriterion = criterion();
      const labelled = labelsAt(i, cols);
      const metrics = cardMetrics(v, activeCriterion);
      const source = sourceMetric(v);
      cells.push(html`
         <div class=${cls} key=${v.id ?? i}
              style=${`left:${left}px;top:${top}px;width:${w}px;height:${h}px;`}
              onMouseEnter=${() => { S.selection.value = i; }}
              onClick=${() => S.api.openIndex(i)}>
            ${v.thumbnail_url ? html`<img src=${v.thumbnail_url} loading="lazy" alt=${v.title || ""}
                                          referrerpolicy="no-referrer" onError=${thumbError(v.id)} />` : null}
            ${cropFrameEl(v, w, h, "cover")}
            <div class=${"v-cell-scores" + (labelled ? " is-labelled" : "")}>
               ${metrics.map((m) => html`
                  <data class=${"v-cell-score" +
                               (m.field === "predicted" ? " is-predicted" : "") +
                               (m.field === "embedding" ? " is-embedding" : "") +
                               (m.field === "our_rating" ? " v-cell-rating" : "") +
                               (![ "predicted", "embedding", "our_rating" ].includes(m.field) ? " v-cell-sort" : "") +
                               (m.field === activeCriterion ? " is-criterion" : "")}
                        key=${m.field} data-metric=${m.field} value=${m.raw}
                        aria-label=${m.label} title=${m.label}>${labelled ? m.label : m.value}</data>`)}
            </div>
            <div class="v-cell-overlay">
               <span class=${"v-cell-title" + (activeCriterion === "title" ? " is-criterion" : "")}>${v.title || "Untitled"}</span>
               <span class=${"v-cell-source" + (activeCriterion === source.field ? " is-criterion" : "")}>${source.value}</span>
            </div>
         </div>`);
   }

   return html`
      <div class="v-grid" ref=${scrollRef}>
         <div class="v-grid-inner" style=${`height:${innerH}px;`}>
            ${cells}
         </div>
      </div>
   `;
}
