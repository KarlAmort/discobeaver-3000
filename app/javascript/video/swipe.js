// just: "the swipe-to-rate deck (toggled by S.swipeOpen) — the mobile-friendly counterpart to the
//        mosaic grid. Cards come from the current result set (S.videos: whatever the command bar
//        produced — browse, search, or a `sort:top` recommend queue, which is how public mode gets an
//        active-learning queue since the owner-only rate_queue is disabled there). Swipe right = like
//        (rate 8), left = nope (rate 2), down/skip = pass. Recording goes through S.api.rateVideo, the
//        same `rate` cable action the grid uses. Minimal first cut: one draggable top card, buttons and
//        arrow keys, and a lazy top-up of the deck when it runs low."
import { html } from "htm/preact";
import { useEffect, useRef, useState } from "preact/hooks";
import * as S from "video/store";
import { thumbError } from "video/thumbs";

const THRESHOLD = 90;     // px of horizontal drag past which a release commits a like/nope
const LIKE = 8;
const NOPE = 2;
const LOW_WATER = 5;      // top the deck up (browse mode) when fewer than this remain

export function Swipe() {
   const open = S.swipeOpen.value;
   const videos = S.videos.value;              // subscribe: deck refills as the list changes
   const mode = S.mode.value;
   const [swiped, setSwiped] = useState(() => new Set());
   const [drag, setDrag] = useState(0);        // current horizontal drag offset of the top card (px)
   const startX = useRef(null);
   const lastQuery = useRef(S.query.value);

   // a fresh query replaces the result set — forget which cards we already swiped past.
   if (lastQuery.current !== S.query.value) { lastQuery.current = S.query.value; if (swiped.size) setSwiped(new Set()); }

   const deck = videos.filter(v => v && !swiped.has(v.id));
   const top = deck[0] || null;

   // keyboard: while open, own ←/→/↓ (rate) and Esc (close); capture so the grid/player router yields.
   useEffect(() => {
      if (!open) return undefined;
      const onKey = (e) => {
         if (e.key === "Escape") { e.stopImmediatePropagation(); e.preventDefault(); close(); }
         else if (e.key === "ArrowRight") { e.stopImmediatePropagation(); e.preventDefault(); commit("right"); }
         else if (e.key === "ArrowLeft")  { e.stopImmediatePropagation(); e.preventDefault(); commit("left"); }
         else if (e.key === "ArrowDown")  { e.stopImmediatePropagation(); e.preventDefault(); commit("skip"); }
      };
      window.addEventListener("keydown", onKey, true);
      return () => window.removeEventListener("keydown", onKey, true);
   }, [ open, deck.length, top && top.id ]);

   if (!open) return null;
   const close = () => { S.swipeOpen.value = false; };

   function afterAdvance() {
      // running low in browse mode → ask for the next page (search/recommend refill themselves).
      if (mode === "browse" && videos.length < S.total.value && deck.length <= LOW_WATER) S.api.loadMore();
   }

   function commit(dir) {
      const card = deck[0];
      if (!card) { if (dir === "skip") afterAdvance(); return; }
      if (dir === "right") S.api.rateVideo(card, LIKE);
      else if (dir === "left") S.api.rateVideo(card, NOPE);
      // skip: no rating, just move on
      setSwiped(prev => { const n = new Set(prev); n.add(card.id); return n; });
      setDrag(0);
      startX.current = null;
      afterAdvance();
   }

   // pointer drag on the top card
   const onDown = (e) => { startX.current = e.clientX; try { e.currentTarget.setPointerCapture(e.pointerId); } catch {} };
   const onMove = (e) => { if (startX.current != null) setDrag(e.clientX - startX.current); };
   const onUp = () => {
      if (startX.current == null) return;
      if (drag > THRESHOLD) commit("right");
      else if (drag < -THRESHOLD) commit("left");
      else { setDrag(0); startX.current = null; }
   };

   const hint = drag > THRESHOLD ? "like" : drag < -THRESHOLD ? "nope" : null;

   return html`
      <div class="v-swipe-backdrop">
         <div class="v-swipe">
            <div class="v-swipe-head">
               <span class="v-swipe-title">swipe to rate</span>
               <button class="v-swipe-x" onClick=${close} title="close">×</button>
            </div>

            ${top ? html`
               <div class="v-swipe-stack">
                  ${deck.slice(0, 3).reverse().map((v, ri, arr) => {
                     const depth = arr.length - 1 - ri;           // 0 = top card
                     const isTop = depth === 0;
                     const style = isTop
                        ? `transform:translateX(${drag}px) rotate(${drag / 22}deg);`
                        : `transform:translateY(${depth * 8}px) scale(${1 - depth * 0.04});opacity:${1 - depth * 0.25};`;
                     return html`
                        <div class=${"v-swipe-card" + (isTop ? " is-top" : "")} key=${v.id} style=${style}
                             onPointerDown=${isTop ? onDown : null}
                             onPointerMove=${isTop ? onMove : null}
                             onPointerUp=${isTop ? onUp : null}
                             onPointerCancel=${isTop ? onUp : null}>
                           ${v.thumbnail_url
                              ? html`<img src=${v.thumbnail_url} alt=${v.title || ""} referrerpolicy="no-referrer"
                                          draggable="false" onError=${thumbError(v.id)} />`
                              : html`<div class="v-swipe-blank"></div>`}
                           ${isTop && hint && html`<div class=${"v-swipe-hint is-" + hint}>${hint}</div>`}
                           <div class="v-swipe-cap">
                              <span class="v-swipe-cap-title">${v.title || "Untitled"}</span>
                              ${v.our_rating ? html`<span class="v-swipe-cap-rate">★ ${v.our_rating}</span>` : null}
                           </div>
                        </div>`;
                  })}
               </div>

               <div class="v-swipe-actions">
                  <button class="v-swipe-act is-nope" title="nope (←)" onClick=${() => commit("left")}>✕</button>
                  <button class="v-swipe-act is-skip" title="skip (↓)" onClick=${() => commit("skip")}>↓</button>
                  <button class="v-swipe-act is-like" title="like (→)" onClick=${() => commit("right")}>♥</button>
               </div>
               <div class="v-swipe-count">${deck.length} left in deck</div>
            ` : html`
               <div class="v-swipe-done">
                  <p>deck empty.</p>
                  <button class="v-btn is-primary" onClick=${() => { setSwiped(new Set()); S.api.runQuery("sort:top"); }}>
                     load recommendations
                  </button>
               </div>`}
         </div>
      </div>`;
}
