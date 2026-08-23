const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function uniformStages(duration, maxDimension = 16) {
   const bins = maxDimension * maxDimension;
   const seconds = Math.max(0, Number(duration) || 0);
   const stages = [];
   for (let dimension = 2; dimension <= maxDimension; dimension++) {
      const count = dimension * dimension;
      const frames = [];
      for (let i = 0; i < count; i++) {
         const index = Math.min(bins - 1, Math.floor((i + 0.5) / count * bins));
         frames.push({ index, time: (index + 0.5) / bins * seconds });
      }
      stages.push({ dimension, frames });
   }
   return stages;
}

function distance(a, b) {
   if (!a || !b || a.length !== b.length) return null;
   let total = 0;
   for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
   return total / a.length;
}

function average(values) {
   const finite = values.filter(Number.isFinite);
   return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

export function scoreTransitions(scenes, signatures, novelty, duration) {
   return scenes.map((scene, index) => {
      if (index === 0) return { ...scene, significance: 0 };
      const previous = scenes[index - 1].shots.map(i => signatures[i]).filter(Boolean);
      const current = scene.shots.slice(0, 3).map(i => signatures[i]).filter(Boolean);
      const immediate = distance(previous[previous.length - 1], current[0]);
      const context = average(current.map(sig => {
         const distances = previous.map(other => distance(other, sig)).filter(Number.isFinite);
         return distances.length ? Math.min(...distances) : null;
      }));
      const bin = novelty?.length && duration > 0
         ? Math.min(novelty.length - 1, Math.floor(scene.start / duration * novelty.length))
         : 0;
      const stream = Number(novelty?.[bin]) || 0;
      const color = immediate == null ? null : clamp(immediate / 0.45, 0, 1);
      const history = context == null ? null : clamp(context / 0.35, 0, 1);
      const visual = average([ color, history ]);
      const significance = visual == null ? stream : visual * 0.85 + stream * 0.15;
      return { ...scene, significance: +clamp(significance, 0, 1).toFixed(3) };
   });
}

export function timelineLayout(scenes, duration, columns = 16, rows = 9) {
   const slots = columns * rows;
   let selected = scenes.slice(1);
   if (selected.length > slots) {
      selected = selected
         .map((scene, index) => ({ scene, index }))
         .sort((a, b) => (b.scene.significance || 0) - (a.scene.significance || 0))
         .slice(0, slots)
         .sort((a, b) => a.scene.start - b.scene.start)
         .map(({ scene }) => scene);
   }
   let previousSlot = -1;
   return selected.map((scene, index) => {
      const remaining = selected.length - index - 1;
      const ideal = duration > 0 ? Math.round(scene.start / duration * (slots - 1)) : index;
      const slot = clamp(ideal, previousSlot + 1, slots - 1 - remaining);
      previousSlot = slot;
      return {
         ...scene,
         column: slot % columns + 1,
         row: Math.floor(slot / columns) + 1,
         scale: +(1 + clamp(scene.significance || 0, 0, 1) * 1.35).toFixed(2)
      };
   });
}
