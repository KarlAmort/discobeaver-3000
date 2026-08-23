// just: "the `s` view — a scene strip over the player's bottom edge. Top: the novelty height
//        profile (how unpredictable the bitstream is, peaks = cuts) with the playhead. Below: a
//        filmstrip of scene blocks, width ∝ scene duration, each with its representative frame;
//        the CURRENT scene carries a fill showing how deep into it playback is (the 'depth into
//        the scene system'). Click a scene to seek. Playhead/depth update straight on the DOM
//        from timeupdate — no re-render per frame (same pattern as the shell's progress bar)."
import { html } from "htm/preact";
import { useRef, useEffect } from "preact/hooks";

const cssVar = (name, fallback) =>
   (getComputedStyle(document.documentElement).getPropertyValue(name) || "").trim() || fallback;

function drawProfile(canvas, index) {
   const dpr = window.devicePixelRatio || 1;
   const w = canvas.clientWidth, h = canvas.clientHeight;
   if (!w || !h) return;
   canvas.width = w * dpr; canvas.height = h * dpr;
   const ctx = canvas.getContext("2d");
   ctx.scale(dpr, dpr);
   ctx.clearRect(0, 0, w, h);

   const curve = index.novelty, n = curve.length;
   ctx.beginPath();
   ctx.moveTo(0, h);
   for (let i = 0; i < n; i++) ctx.lineTo((i + 0.5) / n * w, h - curve[i] * (h - 1));
   ctx.lineTo(w, h);
   ctx.closePath();
   ctx.fillStyle = cssVar("--gold-soft", "rgb(216 189 106 / 0.4)");
   ctx.fill();

   ctx.strokeStyle = cssVar("--accent", "#e06f61");    // scene boundaries as full-height ticks
   ctx.lineWidth = 1;
   for (const s of index.scenes) {
      if (!s.start) continue;
      const x = Math.round(s.start / index.duration * w) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
   }
}

// SceneStrip({ ui, getEl, onSeek })
//   ui: { status: "idle"|"building"|"ready"|"none", index, progress: { stage, frac } }
//   getEl(): the live <video>;  onSeek(seconds)
export function SceneStrip({ ui, getEl, onSeek }) {
   const canvasRef = useRef(null);
   const headRef = useRef(null);      // playhead over the profile
   const filmRef = useRef(null);      // the filmstrip: depth fill + is-now live here
   const index = ui.status === "ready" ? ui.index : null;

   useEffect(() => {
      if (index && canvasRef.current) drawProfile(canvasRef.current, index);
   }, [ index ]);

   // playhead + current-scene depth, straight on the DOM per timeupdate
   useEffect(() => {
      const el = getEl();
      if (!el || !index) return;
      const paint = () => {
         const t = el.currentTime || 0, d = index.duration || 1;
         if (headRef.current) headRef.current.style.left = `${Math.min(100, t / d * 100)}%`;
         const film = filmRef.current;
         if (!film) return;
         const blocks = film.children;
         for (let i = 0; i < index.scenes.length && i < blocks.length; i++) {
            const s = index.scenes[i];
            const now = t >= s.start && t < s.end;
            blocks[i].classList.toggle("is-now", now);
            const fill = blocks[i].querySelector(".v-scene-depth");
            if (fill) fill.style.width = now ? `${((t - s.start) / (s.end - s.start)) * 100}%` : "0";
         }
      };
      el.addEventListener("timeupdate", paint);
      paint();
      return () => el.removeEventListener("timeupdate", paint);
   }, [ index, getEl ]);

   if (ui.status === "building") {
      const pct = Math.round((ui.progress?.frac || 0) * 100);
      return html`
         <div class="v-scenes is-building">
            <span class="v-scenes-label">scenes — ${ui.progress?.stage || "analyzing"}… ${pct}%</span>
            <div class="v-scenes-progress"><div style=${`width:${pct}%`}></div></div>
         </div>`;
   }
   if (ui.status === "none") {
      return html`
         <div class="v-scenes is-empty">
            <span class="v-scenes-label">no scene data for this clip — ⌘←/→ seeks ±60s</span>
         </div>`;
   }
   if (!index) return null;

   return html`
      <div class="v-scenes">
         <div class="v-scenes-profile">
            <canvas ref=${canvasRef}></canvas>
            <div class="v-scenes-head" ref=${headRef}></div>
         </div>
         <div class="v-scenes-film" ref=${filmRef}>
            ${index.scenes.map((s, i) => html`
               <button class="v-scene" key=${i}
                       style=${`flex-grow:${Math.max(1, Math.round((s.end - s.start) * 10))}`}
                       title=${`scene ${i + 1} · ${Math.round(s.start)}s → ${Math.round(s.end)}s · ${s.shots.length} shot${s.shots.length === 1 ? "" : "s"}`}
                       onClick=${() => onSeek(s.start)}>
                  ${s.thumb ? html`<img src=${s.thumb} alt="" />` : null}
                  <span class="v-scene-n">${i + 1}</span>
                  <span class="v-scene-depth"></span>
               </button>`)}
         </div>
         <span class="v-scenes-label">
            ${index.scenes.length} scenes · ${index.shots.length} shots · ${index.source === "bitstream" ? "from the bitstream" : "visual scan"}
         </span>
      </div>`;
}
