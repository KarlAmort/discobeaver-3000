function separation(point, window) {
   if (point < window.startMs) return window.startMs - point;
   if (point > window.endMs) return point - window.endMs;
   return 0;
}

function better(left, right) {
   if (!right) return left;
   if (!left) return right;
   if (left.matches !== right.matches) return left.matches > right.matches ? left : right;
   return left.cost <= right.cost ? left : right;
}

function median(values) {
   if (!values.length) return null;
   const ordered = [ ...values ].sort((left, right) => left - right);
   const middle = Math.floor(ordered.length / 2);
   return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

export function match(predictions, references, toleranceMs) {
   const points = [ ...predictions ].sort((left, right) => left - right);
   const windows = [ ...references ].sort((left, right) => left.startMs - right.startMs);
   const table = Array.from({ length: points.length + 1 }, () => Array(windows.length + 1));
   table[0][0] = { matches: 0, cost: 0, pairs: [] };

   for (let point = 0; point <= points.length; point += 1) {
      for (let reference = 0; reference <= windows.length; reference += 1) {
         const current = table[point][reference];
         if (!current) continue;
         if (point < points.length) table[point + 1][reference] = better(table[point + 1][reference], current);
         if (reference < windows.length) table[point][reference + 1] = better(table[point][reference + 1], current);
         if (point >= points.length || reference >= windows.length) continue;
         const deviationMs = separation(points[point], windows[reference]);
         if (deviationMs > toleranceMs) continue;
         const paired = {
            matches: current.matches + 1,
            cost: current.cost + deviationMs,
            pairs: current.pairs.concat({ point: points[point], reference: windows[reference], deviationMs })
         };
         table[point + 1][reference + 1] = better(table[point + 1][reference + 1], paired);
      }
   }

   return table[points.length][windows.length] || { matches: 0, cost: 0, pairs: [] };
}

export function score(predictions, references, toleranceMs) {
   const matched = match(predictions, references, toleranceMs);
   const precision = predictions.length ? matched.matches / predictions.length : references.length ? 0 : 1;
   const recall = references.length ? matched.matches / references.length : predictions.length ? 0 : 1;
   return {
      toleranceMs,
      predictions: predictions.length,
      references: references.length,
      matches: matched.matches,
      falseSplits: predictions.length - matched.matches,
      missedBoundaries: references.length - matched.matches,
      precision,
      recall,
      f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0,
      medianDeviationMs: median(matched.pairs.map((pair) => pair.deviationMs)),
      pairs: matched.pairs
   };
}

export function hierarchy(prediction, reference, tolerances = [ 500, 3000 ]) {
   return Object.fromEntries([ "acts", "scenes" ].map((level) => [
      level,
      Object.fromEntries(tolerances.map((toleranceMs) => [
         String(toleranceMs),
         score(prediction[level] || [], reference[level] || [], toleranceMs)
      ]))
   ]));
}
