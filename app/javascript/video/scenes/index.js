// just: "the scene-seek orchestrator: turn one clip into a SceneIndex, cheapest signal first.
//        (1) bitstream — Range-read the MP4 sample tables (video/scenes/mp4), cut shots from
//        frame-size/keyframe structure (detect), (2) eyes — sample a tiny signature per shot
//        (sampler) and cluster A/B/A/B camera perspectives into scenes (cluster). No MP4 tables
//        (HLS/fragmented)? A coarse visual scan builds shots from signature jumps instead.
//        Canvas tainted? Duration-merged shots still beat plain ±60s. Boundaries are cached in
//        localStorage; thumbnails are cheap to re-grab and never persisted."
//
//   const index = await buildSceneIndex(video, { onProgress, signal });
//   // -> { source: "bitstream"|"scan"|"none", duration, shots, scenes, novelty } | null
//   //    scenes[i]: { start, end, shots, thumb }        (thumb: dataURL | null)

import { indexMp4, fetchRange } from "video/scenes/mp4";
import { detectShots, novelty } from "video/scenes/detect";
import { clusterScenes, scenesByDuration, sigDistance } from "video/scenes/cluster";
import { createSampler } from "video/scenes/sampler";
import { scoreTransitions } from "video/lighttable_math";
export { sceneTarget } from "video/scenes/seek";

const CACHE_PREFIX = "v.scenes.";
const CACHE_V = 2;
const MAX_SAMPLED_SHOTS = 180;    // clustering cap — beyond this, sample evenly-spaced shots only
const SCAN_STEP_S = 2;            // fallback scan granularity…
const SCAN_MAX_SAMPLES = 400;     // …stretched for long clips so a scan stays bounded
const SCAN_CUT_DIST = 0.14;       // signature jump between neighbouring grid points = a cut
const NOVELTY_BINS = 240;

function cacheLoad(id) {
   try {
      const raw = localStorage.getItem(CACHE_PREFIX + id);
      if (!raw) return null;
      const c = JSON.parse(raw);
      return c && c.v === CACHE_V ? c : null;
   } catch { return null; }
}

function cacheStore(id, index) {
   try {
      localStorage.setItem(CACHE_PREFIX + id, JSON.stringify({
         v: CACHE_V,
         source: index.source,
         duration: index.duration,
         shots: index.shots,
         scenes: index.scenes.map(s => ({ start: s.start, end: s.end, shots: s.shots, significance: s.significance })),
         novelty: Array.from(index.novelty, x => +x.toFixed(3))
      }));
   } catch { /* quota — the index still works this session */ }
}

const aborted = (signal) => !!signal?.aborted;

async function sceneThumbs(scenes, sampler, signal, onProgress) {
   for (let i = 0; i < scenes.length; i++) {
      if (aborted(signal)) return;
      const scene = scenes[i];
      const got = await sampler.sample(Math.min(scene.end - 0.01, scene.start + 0.08));
      scenes[i].thumb = got ? got.thumb : null;
      onProgress?.("thumbs", (i + 1) / scenes.length);
   }
}

// bitstream path: MP4 sample tables -> shots; signatures -> scenes
async function fromBitstream(video, sampler, signal, onProgress) {
   const idx = await indexMp4(fetchRange(video.play_url));
   if (!idx || aborted(signal)) return idx === null ? null : undefined;
   onProgress?.("index", 1);

   const shots = detectShots(idx);
   const curve = novelty(idx, NOVELTY_BINS);

   // sample a signature per shot (evenly thinned when there are absurdly many)
   const stride = Math.max(1, Math.ceil(shots.length / MAX_SAMPLED_SHOTS));
   const sigs = Array(shots.length).fill(null);
   for (let i = 0; i < shots.length; i += stride) {
      if (aborted(signal)) return undefined;
      const got = await sampler.sample((shots[i].start + shots[i].end) / 2);
      sigs[i] = got ? got.sig : null;
      onProgress?.("shots", (i + 1) / shots.length);
   }

   const clustered = sampler.tainted || sigs.every(s => !s)
      ? scenesByDuration(shots)
      : clusterScenes(shots, sigs);
   const scenes = scoreTransitions(clustered, sigs, curve, idx.duration);
   return { source: "bitstream", duration: idx.duration, shots, scenes, novelty: curve };
}

// fallback path: no sample tables — walk a coarse time grid and cut where the picture jumps
async function fromScan(video, sampler, signal, onProgress) {
   const duration = Number(video.duration) || 0;
   if (!duration || sampler.tainted) return null;
   const step = Math.max(SCAN_STEP_S, duration / SCAN_MAX_SAMPLES);
   const ts = [], sigs = [];
   for (let t = step / 2; t < duration; t += step) {
      if (aborted(signal)) return undefined;
      const got = await sampler.sample(t);
      ts.push(t); sigs.push(got ? got.sig : null);
      onProgress?.("scan", t / duration);
   }
   const curve = new Float32Array(NOVELTY_BINS);
   const starts = [ 0 ];
   for (let i = 1; i < ts.length; i++) {
      const d = sigDistance(sigs[i - 1], sigs[i]);
      if (!isFinite(d)) continue;
      const b = Math.min(NOVELTY_BINS - 1, Math.floor(ts[i] / duration * NOVELTY_BINS));
      if (d > curve[b]) curve[b] = Math.min(1, d * 3);
      if (d > SCAN_CUT_DIST) starts.push(+((ts[i - 1] + ts[i]) / 2).toFixed(2));
   }
   const shots = starts.map((s, i) => ({ start: s, end: i + 1 < starts.length ? starts[i + 1] : duration }));
   const shotSigs = shots.map((s) => sigs[Math.min(sigs.length - 1, Math.round((s.start + s.end) / 2 / step))] || null);
   const scenes = scoreTransitions(clusterScenes(shots, shotSigs), shotSigs, curve, duration);
   return { source: "scan", duration, shots, scenes, novelty: curve };
}

export async function buildSceneIndex(video, { onProgress, signal } = {}) {
   if (!video?.play_url) return null;
   const sampler = createSampler(video.play_url);
   try {
      const cached = cacheLoad(video.id);
      if (cached) {
         const index = { ...cached, novelty: Float32Array.from(cached.novelty) };
         await sceneThumbs(index.scenes, sampler, signal, onProgress);
         return aborted(signal) ? null : index;
      }

      let index = await fromBitstream(video, sampler, signal, onProgress);
      if (index === undefined) return null;                       // aborted mid-build
      if (index === null) {
         console.warn("[v] scenes: no MP4 sample tables (HLS/fragmented?) — visual scan fallback");
         index = await fromScan(video, sampler, signal, onProgress);
      }
      if (!index) return null;

      cacheStore(video.id, index);
      await sceneThumbs(index.scenes, sampler, signal, onProgress);
      return aborted(signal) ? null : index;
   } finally {
      sampler.destroy();
   }
}
