// just: "pure math: fold SHOTS into SCENES. A scene keeps cutting between the same few camera
//        perspectives (A/B/A/B dialogue), so a shot that looks like any RECENTLY-SEEN perspective
//        continues the scene; only a shot that looks genuinely new — AND isn't immediately
//        followed by a return to the old perspectives — opens a new one. That lookahead is the
//        crux: B's first appearance inside an A/B/A/B scene must not split it, so a tentative
//        boundary is confirmed only when the next shots ALSO stay away from the old clusters."
//
//   clusterScenes(shots, sigs, opts?) -> [{ start, end, shots: [indices] }]
//
// sigs[i]: Float32Array signature for shots[i] (values 0..1), or null (sampling failed — treated
// as 'continues the scene': missing data must never split). Distance = mean |Δ| per dimension.

const MATCH = 0.10;       // mean-abs-diff below this = same camera perspective
const RECENT = 6;         // clusters seen within the last N shots stay matchable
const CONFIRM = 2;        // shots after a tentative boundary that must all stay "new"

export function sigDistance(a, b) {
   if (!a || !b || a.length !== b.length) return Infinity;
   let d = 0;
   for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
   return d / a.length;
}

// running list of perspective clusters: { sig (centroid), n, lastShot }
function bestMatch(clusters, sig, shotIdx, match) {
   let best = null, bd = match;
   for (const c of clusters) {
      if (shotIdx - c.lastShot > RECENT) continue;
      const d = sigDistance(c.sig, sig);
      if (d < bd) { bd = d; best = c; }
   }
   return best;
}

function absorb(cluster, sig, shotIdx) {
   const n = cluster.n;
   for (let i = 0; i < sig.length; i++) cluster.sig[i] = (cluster.sig[i] * n + sig[i]) / (n + 1);
   cluster.n = n + 1;
   cluster.lastShot = shotIdx;
}

export function clusterScenes(shots, sigs, { match = MATCH, confirm = CONFIRM } = {}) {
   if (!shots.length) return [];
   const scenes = [ { start: shots[0].start, end: shots[0].end, shots: [ 0 ] } ];
   let clusters = [];                      // perspectives of the CURRENT scene (+ recency-gated older ones)
   if (sigs[0]) clusters.push({ sig: Float32Array.from(sigs[0]), n: 1, lastShot: 0 });

   let i = 1;
   while (i < shots.length) {
      const sig = sigs[i];
      const cur = scenes[scenes.length - 1];
      const hit = sig ? bestMatch(clusters, sig, i, match) : null;

      if (!sig || hit) {                   // known perspective (or no data) — the scene continues
         if (hit) absorb(hit, sig, i);
         cur.shots.push(i);
         cur.end = shots[i].end;
         i++;
         continue;
      }

      // tentative boundary: shot i looks new. Confirm only if the next `confirm` shots (where we
      // have data) ALSO fail to match the current scene's clusters — a single novel insert shot
      // followed by a return to A/B is part of the scene, not a new one.
      let returns = false;
      for (let k = i + 1; k <= i + confirm && k < shots.length; k++) {
         if (sigs[k] && bestMatch(clusters, sigs[k], i, match)) { returns = true; break; }
      }
      if (returns) {                       // insert shot — absorb as a new perspective of THIS scene
         clusters.push({ sig: Float32Array.from(sig), n: 1, lastShot: i });
         cur.shots.push(i);
         cur.end = shots[i].end;
         i++;
         continue;
      }

      // confirmed: a genuinely new scene — fresh perspective memory
      clusters = [ { sig: Float32Array.from(sig), n: 1, lastShot: i } ];
      scenes.push({ start: shots[i].start, end: shots[i].end, shots: [ i ] });
      i++;
   }
   return scenes;
}

// no signatures at all (canvas unavailable): shots merged forward to a minimum scene length is
// still a far better ⌘←/→ than nothing.
export function scenesByDuration(shots, minScene = 8) {
   const scenes = [];
   for (let i = 0; i < shots.length; i++) {
      const cur = scenes[scenes.length - 1];
      if (cur && cur.end - cur.start < minScene) { cur.shots.push(i); cur.end = shots[i].end; }
      else scenes.push({ start: shots[i].start, end: shots[i].end, shots: [ i ] });
   }
   return scenes;
}
