// just: "pure: pick the ⌘←/→ jump target from a SceneIndex. → goes to the next scene start;
//        ← is chapter-style — deep inside a scene it returns to that scene's start, near the
//        start it crosses into the previous scene (the audio-player previous-track feel)."

const AHEAD_SLOP_S = 0.3;    // 'next' must be genuinely ahead, not the boundary we sit on
const RESTART_S = 2;         // further in than this, ← means 'restart this scene'

export function sceneTarget(index, t, dir) {
   const starts = index.scenes.map(s => s.start);
   if (dir > 0) {
      for (const s of starts) if (s > t + AHEAD_SLOP_S) return s;
      for (const s of starts) if (s > t) return s;    // only the slop hid it — still go there
      return null;                                    // already in the last scene
   }
   let cur = 0;
   for (const s of starts) if (s <= t) cur = s;
   if (t - cur > RESTART_S) return cur;
   let prev = 0;
   for (const s of starts) if (s < cur) prev = s;
   return prev;
}
