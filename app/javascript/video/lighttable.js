import { html } from "htm/preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { createSampler } from "video/scenes/sampler";
import { timelineLayout, uniformStages } from "video/lighttable_math";

function mmss(seconds) {
   const value = Math.max(0, Number(seconds) || 0);
   return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
}

function UniformLighttable({ video }) {
   const [ grid, setGrid ] = useState({ dimension: 2, frames: [], loaded: 0 });

   useEffect(() => {
      const stages = uniformStages(video?.duration);
      const sampler = createSampler(video.play_url);
      const cache = new Map();
      let cancelled = false;

      const run = async () => {
         for (const stage of stages) {
            if (cancelled) return;
            let frames = stage.frames.map(frame => ({ ...frame, thumb: cache.get(frame.index) || null }));
            setGrid({ dimension: stage.dimension, frames, loaded: frames.filter(frame => frame.thumb).length });
            for (const frame of frames) {
               if (cancelled) return;
               if (!cache.has(frame.index)) {
                  const sample = await sampler.sample(frame.time);
                  if (cancelled) return;
                  cache.set(frame.index, sample?.thumb || "");
               }
               frames = frames.map(item => item.index === frame.index ? { ...item, thumb: cache.get(frame.index) } : item);
               setGrid({ dimension: stage.dimension, frames, loaded: frames.filter(item => item.thumb).length });
            }
         }
      };
      void run();
      return () => { cancelled = true; sampler.destroy(); };
   }, [ video?.id, video?.play_url, video?.duration ]);

   return html`
      <div class="v-lighttable-uniform" style=${`--dimension:${grid.dimension}`}>
         ${grid.frames.map(frame => frame.thumb
            ? html`<figure key=${frame.index}>
                 <img src=${frame.thumb} alt=${mmss(frame.time)} />
                 <figcaption>${mmss(frame.time)}</figcaption>
              </figure>`
            : html`<span class="v-lighttable-empty" key=${frame.index}></span>`)}
      </div>
      <output class="v-lighttable-state">${grid.dimension}×${grid.dimension} · ${grid.loaded}/${grid.frames.length}</output>`;
}

function SceneLighttable({ ui }) {
   if (ui.status === "building" || ui.status === "idle") {
      const percent = Math.round((ui.progress?.frac || 0) * 100);
      return html`
         <progress class="v-lighttable-progress" max="100" value=${percent}>${percent}%</progress>
         <output class="v-lighttable-state">${ui.progress?.stage || "index"} · ${percent}%</output>`;
   }
   if (ui.status !== "ready" || !ui.index) {
      return html`<output class="v-lighttable-state">0 scene transitions</output>`;
   }
   const transitions = timelineLayout(ui.index.scenes, ui.index.duration);
   return html`
      <div class="v-lighttable-scenes">
         ${transitions.map((scene, index) => html`
            <figure key=${`${scene.start}-${index}`}
                    style=${`--column:${scene.column};--row:${scene.row};--scale:${scene.scale};--rank:${Math.round((scene.significance || 0) * 100)}`}>
               ${scene.thumb ? html`<img src=${scene.thumb} alt=${`transition at ${mmss(scene.start)}`} />` : null}
               <figcaption>${mmss(scene.start)}</figcaption>
            </figure>`)}
      </div>
      <output class="v-lighttable-state">${transitions.length}/${Math.max(0, ui.index.scenes.length - 1)} scene transitions</output>`;
}

export function Lighttable({ mode, video, sceneUI, onClose }) {
   const dialogRef = useRef(null);
   const scene = mode === "scenes";
   const label = scene ? "scene-transition lighttable" : "equidistant lighttable";

   useEffect(() => {
      const dialog = dialogRef.current;
      dialog.showModal();
      return () => { if (dialog.open) dialog.close(); };
   }, []);

   return html`
      <dialog class=${"v-lighttable v-lighttable--" + mode} ref=${dialogRef} aria-label=${label}
              onCancel=${(event) => { event.preventDefault(); onClose(); }}>
         <button class="v-lighttable-close" type="button" onClick=${onClose}>close</button>
         ${scene
            ? html`<${SceneLighttable} ui=${sceneUI} />`
            : html`<${UniformLighttable} video=${video} />`}
      </dialog>`;
}
