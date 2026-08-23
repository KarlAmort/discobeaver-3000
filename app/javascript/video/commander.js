import { html } from "htm/preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import * as S from "video/store";
import { embedText } from "webgpu/clip";
import { decodeVector, encodeVector, poles, projection } from "video/commander/math";
import { ParticleView } from "video/commander/view";

const textCache = new Map();

function textVector(text) {
   const key = String(text || "").trim();
   if (!textCache.has(key)) textCache.set(key, embedText(key).then(result => result[0]));
   return textCache.get(key);
}

function compoundTone(id) {
   return `tone-${Math.abs(Number(id) || 0) % 6}`;
}

function ParticleField({ points, onSelect }) {
   const canvas = useRef(null);
   const layer = useRef(null);
   const view = useRef(null);
   useEffect(() => {
      try { view.current = new ParticleView(canvas.current, layer.current); }
      catch (error) { canvas.current.dataset.error = error.message; }
      return () => { view.current?.destroy(); view.current = null; };
   }, []);
   useEffect(() => { view.current?.set(points); }, [ points ]);
   const labelled = points.filter(point => point.selected || point.kind === "term" || point.thumbnail_url)
      .sort((left, right) => Number(right.selected) - Number(left.selected) || Number(right.kind === "term") - Number(left.kind === "term"))
      .slice(0, 40);
   const labelKey = labelled.map(point => point.id).join("\0");
   useEffect(() => { view.current?.invalidate(); }, [ labelKey ]);
   return html`
      <figure class="v-commander-field">
         <canvas ref=${canvas} aria-label="CLIP particle neighborhood"></canvas>
         <div class="v-commander-labels" ref=${layer}>
            ${labelled.map(point => html`
               <button class=${`v-commander-point is-${point.kind}`}
                       type="button" data-commander-point=${point.id} title=${point.label || point.title || ""}
                       onClick=${() => onSelect(point)}>
                  ${point.thumbnail_url ? html`<img src=${point.thumbnail_url} alt=${point.title || ""} loading="lazy" />` : null}
                  <span>${point.label || point.title || point.id}</span>
               </button>`)}
         </div>
         <figcaption>${points.length.toLocaleString()} · CLIP · ${S.commander.value?.query_ms ?? "—"} ms</figcaption>
      </figure>`;
}

export function Commander({ video }) {
   const payload = S.commander.value;
   const [ tokens, setTokens ] = useState([]);
   const [ query, setQuery ] = useState("");
   const [ state, setState ] = useState("loading");
   const [ termVectors, setTermVectors ] = useState([]);
   const input = useRef(null);
   const initialized = useRef(null);

   useEffect(() => {
      initialized.current = null;
      setTokens([]);
      setTermVectors([]);
      setState("loading");
      S.refs.commander = { focus() { input.current?.focus(); } };
      S.api.fetchCommander(video.id, [], "");
      return () => { S.refs.commander = null; };
   }, [ video.id ]);

   useEffect(() => {
      if (!payload || payload.video_id !== video.id || initialized.current === video.id) return;
      initialized.current = video.id;
      const image = {
         id: `video-${video.id}-image`, kind: "image", label: payload.current.title,
         title: payload.current.title, thumbnail_url: payload.current.thumbnail_url,
         compound: video.id, tone: compoundTone(video.id), vector: decodeVector(payload.current.vector), selected: true,
      };
      setTokens([ image ]);
      setState("text model");
      textVector(payload.current.text).then(result => {
         const text = {
            id: `video-${video.id}-text`, kind: "text", label: payload.current.title,
            compound: video.id, tone: compoundTone(video.id), vector: result.vector, selected: true,
         };
         setTokens([ image, text ]);
         setState(result.truncated ? `${result.tokens} tokens · truncated` : `${result.tokens} tokens`);
         S.api.fetchCommander(video.id, [ encodeVector(result.vector) ], "");
      }).catch(error => setState(error.message));
   }, [ payload, video.id ]);

   const nodes = useMemo(() => {
      if (!payload || payload.video_id !== video.id) return [];
      return payload.nodes.map(node => ({ ...node, vector: decodeVector(node.vector), label: node.title }));
   }, [ payload, video.id ]);

   const view = useMemo(() => projection(tokens, [ ...nodes, ...tokens ]), [ nodes, tokens ]);
   const candidates = useMemo(() => Array.from(new Set([
      ...tokens.filter(token => token.kind === "term").map(token => token.label),
      ...nodes.flatMap(node => node.terms || [])
   ])).filter(Boolean).slice(0, 6), [ nodes, tokens ]);

   useEffect(() => {
      if (tokens.length < 2) { setTermVectors([]); return; }
      let live = true;
      (async () => {
         const values = [];
         for (const label of candidates) {
            const result = await textVector(label);
            values.push({ id: `term-${label}`, kind: "term", label, vector: result.vector });
            if (live) setTermVectors([ ...values ]);
         }
      })().catch(() => { if (live) setTermVectors([]); });
      return () => { live = false; };
   }, [ candidates.join("\0"), tokens.length ]);

   const named = poles(termVectors, view.axes[0] || new Float32Array(512));
   const fieldPoints = useMemo(() => {
      const values = [ ...view.points ];
      const extent = Math.max(0.1, ...values.map(point => Math.abs(point.position[0])));
      if (named.negative) values.push({ ...named.negative, id: `pole-negative-${named.negative.label}`, position: [ -extent * 1.15, 0, 0 ], selected: true });
      if (named.positive) values.push({ ...named.positive, id: `pole-positive-${named.positive.label}`, position: [ extent * 1.15, 0, 0 ], selected: true });
      return values;
   }, [ view, named.negative?.label, named.positive?.label ]);

   function send(next, text = "") {
      const vectors = next.filter(token => token.kind !== "image" || token.compound !== video.id).map(token => encodeVector(token.vector));
      S.api.fetchCommander(video.id, vectors, text);
   }

   function addTerm(event) {
      event.preventDefault();
      const label = query.trim();
      if (!label) return;
      setState("text model");
      textVector(label).then(result => {
         const token = { id: `query-${Date.now()}`, kind: "term", label, tone: "tone-term", vector: result.vector, selected: true };
         const next = [ ...tokens, token ];
         setTokens(next);
         setQuery("");
         setState(result.truncated ? `${result.tokens} tokens · truncated` : `${result.tokens} tokens`);
         send(next, label);
      }).catch(error => setState(error.message));
   }

   function addVideo(node) {
      if (!node || node.kind !== "video") return;
      const image = { id: `video-${node.id}-image`, kind: "image", label: node.title, compound: node.id,
         title: node.title, thumbnail_url: node.thumbnail_url,
         tone: compoundTone(node.id), vector: node.vector, selected: true };
      setState("text model");
      textVector(node.text).then(result => {
         const text = { id: `video-${node.id}-text`, kind: "text", label: node.title, compound: node.id,
            tone: compoundTone(node.id), vector: result.vector, selected: true };
         const next = [ ...tokens.filter(token => token.compound !== node.id), image, text ];
         setTokens(next);
         setState(result.truncated ? `${result.tokens} tokens · truncated` : `${result.tokens} tokens`);
         send(next);
      }).catch(error => setState(error.message));
   }

   function remove(id) {
      const next = tokens.filter(token => token.id !== id);
      setTokens(next);
      send(next);
   }

   return html`
      <section class="v-commander" aria-label="Win-Win Commander 3000">
         <form class="v-commander-query" role="search" onSubmit=${addTerm}>
            <label class="visually-hidden" for="commander-query">term, sentence, or video</label>
            <div class="v-commander-tokens">
               ${tokens.map(token => html`
                  <button class=${"v-commander-token " + token.tone + " is-" + token.kind} type="button"
                          title=${`remove ${token.kind}: ${token.label}`} onClick=${() => remove(token.id)}>
                     <span>${token.kind}</span><b>${token.label}</b>
                  </button>`)}
               <input id="commander-query" ref=${input} type="search" value=${query}
                      onKeyDown=${event => { if (event.key === "Enter") { event.stopPropagation(); addTerm(event); } }}
                      onInput=${event => setQuery(event.currentTarget.value)} autocomplete="off" />
            </div>
            <button type="submit">add</button>
         </form>
         <output class="v-commander-state" aria-live="polite">${state}</output>
         <${ParticleField} points=${fieldPoints} onSelect=${addVideo} />
         <ol class="v-commander-list">
            ${nodes.slice(0, 40).map(node => html`
               <li><button type="button" onClick=${() => addVideo(node)}>${node.title}</button></li>`)}
         </ol>
      </section>`;
}
