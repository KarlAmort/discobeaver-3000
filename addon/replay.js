const BIN_S = 1;
const JUMP_S = 1.25;
const MAX_TICK_S = 5;

function finite(value) {
   return Number.isFinite(value) && value >= 0;
}

function spread(values, from, to, amount, width) {
   const length = Math.max(0, to - from);
   if (!length || !amount) return;
   const first = Math.max(0, Math.floor(from / width));
   const last = Math.min(values.length - 1, Math.floor((to - Number.EPSILON) / width));
   for (let index = first; index <= last; index += 1) {
      const overlap = Math.max(0, Math.min(to, (index + 1) * width) - Math.max(from, index * width));
      values[index] += amount * overlap / length;
   }
}

export function replay(duration, { width = BIN_S } = {}) {
   const size = Math.max(1, Math.ceil(duration / width));
   const exposure = new Float32Array(size);
   const visits = new Uint32Array(size);
   const returns = new Float32Array(size);
   let last = null;
   let activeReturn = null;

   function observe(time, wall, playing = true) {
      if (!finite(time) || !finite(wall)) return;
      const index = Math.min(size - 1, Math.floor(time / width));
      if (!last) {
         visits[index] += 1;
         last = { time, wall, index };
         return;
      }

      const media = time - last.time;
      const elapsed = Math.max(0, (wall - last.wall) / 1000);
      const continuous = playing && media >= 0 && media <= MAX_TICK_S && Math.abs(media - elapsed) <= JUMP_S;
      if (continuous) {
         const watched = Math.min(media, elapsed + 0.25);
         spread(exposure, last.time, time, watched, width);
         if (activeReturn && time >= activeReturn.at && time <= activeReturn.at + 30) {
            returns[activeReturn.bin] += watched;
         } else if (activeReturn && time > activeReturn.at + 30) {
            activeReturn = null;
         }
      } else if (playing && media < -JUMP_S) {
         activeReturn = { at: time, bin: index };
      }
      if (index !== last.index || !continuous) visits[index] += 1;
      last = { time, wall, index };
   }

   function scores() {
      const raw = Array.from(exposure, (value, index) => {
         const excess = Math.max(0, value - Math.min(width, value));
         const dwell = Math.min(1, returns[index] / 8);
         const evidence = visits[index];
         return (excess + dwell) * evidence / (evidence + 3);
      });
      return raw.map((value, index) =>
         (raw[index - 1] || 0) * 0.25 + value * 0.5 + (raw[index + 1] || 0) * 0.25
      );
   }

   function peak() {
      const values = scores();
      let bin = 0;
      for (let index = 1; index < values.length; index += 1) if (values[index] > values[bin]) bin = index;
      return { at: bin * width, score: values[bin] };
   }

   function snapshot() {
      return {
         duration,
         width,
         exposure: Array.from(exposure, (value) => Number(value.toFixed(3))),
         visits: Array.from(visits),
         returns: Array.from(returns, (value) => Number(value.toFixed(3)))
      };
   }

   return { observe, peak, scores, snapshot };
}
