// just: "pure math: turn the MP4 sample index (frame times / byte sizes / keyframe flags) into
//        SHOT boundaries — the hard cuts between camera perspectives. Two independent signals:
//        (1) irregular keyframes — encoders drop an IDR at a cut, so a keyframe that breaks the
//        regular GOP cadence is a cut; (2) frame-size spikes — a frame the encoder couldn't
//        predict from its predecessor costs many× the local median, even in fixed-GOP encodes
//        where keyframe placement says nothing. No decoding, no DOM — portable + node-testable."
//
//   detectShots(idx, opts?) -> [{ start, end }]           (seconds; contiguous, covers [0, duration])
//   novelty(idx, bins)      -> Float32Array(bins) in 0..1  (the strip's height profile)

const MIN_SHOT_S = 1.0;      // merge cuts closer than this — flashes/strobes aren't shots
const SPIKE_RATIO = 3.5;     // frame size vs local median that counts as a cut
const WINDOW = 24;           // samples of local context for the median baseline
const CADENCE_TOL = 0.25;    // keyframe interval within ±25% of the median = regular cadence
const REGIME_S = 1.0;        // seconds of P-frames compared on each side of a keyframe
const REGIME_RATIO = 2.5;    // before/after P-median ratio that marks the keyframe as a cut
const REGIME_MIN_N = 4;      // need at least this many P samples per side to judge a regime

function median(arr) {
   if (!arr.length) return 0;
   const s = Array.from(arr).sort((a, b) => a - b);
   return s[s.length >> 1];
}

// local median of the non-sync sizes around i (sync frames are always big — they'd drown the baseline)
function localBase(sizes, sync, i) {
   const vals = [];
   for (let k = Math.max(0, i - WINDOW); k < Math.min(sizes.length, i + WINDOW); k++) {
      if (k !== i && !sync[k] && sizes[k] > 0) vals.push(sizes[k]);
   }
   return median(vals);
}

// keyframe times that BREAK the encoder's regular cadence. With a fixed GOP (HLS-style keyframe
// every 2s) every interval matches the median and nothing is flagged; with scene-cut keyframe
// placement, the short irregular intervals mark the cuts.
function irregularSyncTimes(times, sync) {
   const keys = [];
   for (let i = 0; i < sync.length; i++) if (sync[i]) keys.push(i);
   if (keys.length < 4 || keys.length === sync.length) return [];   // all-sync (no stss) says nothing
   const gaps = [];
   for (let k = 1; k < keys.length; k++) gaps.push(times[keys[k]] - times[keys[k - 1]]);
   const m = median(gaps);
   if (!m) return [];
   const out = [];
   for (let k = 1; k < keys.length; k++) {
      if (Math.abs(gaps[k - 1] - m) > m * CADENCE_TOL) out.push(times[keys[k]]);
   }
   // an encoder in pure scene-cut mode has NO regular cadence: most gaps irregular means every
   // keyframe after the first is a cut candidate — that is exactly right, keep them all.
   return out;
}

// median non-keyframe size in [t0, t1) plus how many samples supported it
function pRegime(times, sizes, sync, t0, t1) {
   const vals = [];
   for (let i = 0; i < sizes.length; i++) {
      if (!sync[i] && sizes[i] > 0 && times[i] >= t0 && times[i] < t1) vals.push(sizes[i]);
   }
   return { m: median(vals), n: vals.length };
}

// keyframes where the P-frame cost REGIME changes: after a real cut the predicted frames price a
// different shot (a static angle costs a few bytes/frame, a moving one hundreds), so the median
// P size before vs after the keyframe jumps. Catches evenly-spaced scene-cut keyframes that the
// cadence check must let through (regular spacing is indistinguishable from a fixed GOP).
function regimeShiftSyncTimes(times, sizes, sync) {
   const out = [];
   for (let i = 1; i < sync.length; i++) {
      if (!sync[i]) continue;
      const t = times[i];
      const before = pRegime(times, sizes, sync, t - REGIME_S, t);
      const after = pRegime(times, sizes, sync, t, t + REGIME_S);
      if (before.n < REGIME_MIN_N || after.n < REGIME_MIN_N || !before.m || !after.m) continue;
      const r = Math.max(before.m, after.m) / Math.min(before.m, after.m);
      if (r >= REGIME_RATIO) out.push(t);
   }
   return out;
}

export function detectShots(idx, { minShot = MIN_SHOT_S, spike = SPIKE_RATIO } = {}) {
   const { times, sizes, sync, duration } = idx;
   const n = sizes.length;
   const cutTimes = new Set(irregularSyncTimes(times, sync).map(t => +t.toFixed(3)));
   for (const t of regimeShiftSyncTimes(times, sizes, sync)) cutTimes.add(+t.toFixed(3));

   for (let i = 1; i < n; i++) {
      if (sync[i]) continue;                        // keyframes handled by cadence above
      const base = localBase(sizes, sync, i);
      if (!base || sizes[i] < base * spike) continue;
      // local maximum only — a cut is one frame, not a plateau of them
      if (sizes[i] < sizes[i - 1] && i > 1 && !sync[i - 1]) continue;
      cutTimes.add(+times[i].toFixed(3));
   }

   // sorted cuts -> contiguous shots, merging anything shorter than minShot into its predecessor
   const cuts = Array.from(cutTimes).filter(t => t > 0 && t < duration).sort((a, b) => a - b);
   const starts = [ 0 ];
   for (const c of cuts) if (c - starts[starts.length - 1] >= minShot) starts.push(c);
   return starts.map((s, i) => ({ start: s, end: i + 1 < starts.length ? starts[i + 1] : duration }));
}

// per-bin novelty in 0..1 for the height profile: how unpredictable the stream is around each
// moment — P frames score size vs local baseline, keyframes score the regime jump across them —
// max-pooled into `bins` buckets.
export function novelty(idx, bins = 240) {
   const { times, sizes, sync, duration } = idx;
   const out = new Float32Array(bins);
   if (!duration) return out;
   for (let i = 1; i < sizes.length; i++) {
      let r;
      if (sync[i]) {
         const t = times[i];
         const before = pRegime(times, sizes, sync, t - REGIME_S, t);
         const after = pRegime(times, sizes, sync, t, t + REGIME_S);
         if (before.n < REGIME_MIN_N || after.n < REGIME_MIN_N) continue;
         r = Math.abs(Math.log2((before.m + 1) / (after.m + 1)));
      } else {
         const base = localBase(sizes, sync, i);
         if (!base) continue;
         r = Math.log2(Math.max(1, sizes[i] / base));              // 0 = predictable, ~2+ = a cut
      }
      const b = Math.min(bins - 1, Math.floor(times[i] / duration * bins));
      if (r > out[b]) out[b] = r;
   }
   let max = 0;
   for (const v of out) if (v > max) max = v;
   if (max > 0) for (let b = 0; b < bins; b++) out[b] /= max;
   return out;
}
