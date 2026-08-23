const WIDTH = 16;
const HEIGHT = 9;
const SAMPLES = 120;
const STEP_S = 2;
const CUT = 0.14;
const MIN_SCENE_S = 8;
const CHAPTER_S = 1800;
const MIN_CHAPTER_S = 300;
const SEEK_TIMEOUT_MS = 5000;

export function distance(left, right) {
   if (!left || !right || left.length !== right.length) return Infinity;
   let total = 0;
   for (let index = 0; index < left.length; index += 1) total += Math.abs(left[index] - right[index]);
   return total / left.length;
}

export function boundaries(samples, duration, { cut = CUT, minimum = MIN_SCENE_S } = {}) {
   const starts = [ { start: 0, strength: 0 } ];
   for (let index = 1; index < samples.length; index += 1) {
      if (samples[index].at - starts.at(-1).start < minimum) continue;
      const strength = distance(samples[index - 1].signature, samples[index].signature);
      if (strength > cut) starts.push({ start: samples[index].at, strength });
   }
   return starts.map((scene, index) => ({
      ...scene,
      end: starts[index + 1]?.start ?? duration
   }));
}

export function outline(scenes, duration, { ideal = CHAPTER_S, minimum = MIN_CHAPTER_S } = {}) {
   const count = Math.max(1, Math.round(duration / ideal));
   const starts = [ 0 ];
   const candidates = scenes.slice(1).sort((left, right) => right.strength - left.strength);
   for (const scene of candidates) {
      if (starts.length >= count) break;
      const proposed = [ ...starts, scene.start ].sort((left, right) => left - right);
      const ends = proposed.slice(1).concat(duration);
      if (proposed.every((start, index) => ends[index] - start >= minimum)) starts.push(scene.start);
   }
   starts.sort((left, right) => left - right);
   return starts.map((start, index) => {
      const end = starts[index + 1] ?? duration;
      return { start, end, scenes: scenes.filter((scene) => scene.start >= start && scene.start < end) };
   });
}

export function target(scenes, time, direction) {
   const starts = scenes.map((scene) => scene.start);
   if (direction > 0) return starts.find((start) => start > time + 0.3) ?? null;
   let current = 0;
   for (const start of starts) if (start <= time) current = start;
   if (time - current > 2) return current;
   return starts.filter((start) => start < current).at(-1) ?? 0;
}

function signature(context, video) {
   context.drawImage(video, 0, 0, WIDTH, HEIGHT);
   const pixels = context.getImageData(0, 0, WIDTH, HEIGHT).data;
   const values = new Float32Array(WIDTH * HEIGHT * 3);
   for (let input = 0, output = 0; input < pixels.length; input += 4) {
      values[output++] = pixels[input] / 255;
      values[output++] = pixels[input + 1] / 255;
      values[output++] = pixels[input + 2] / 255;
   }
   return values;
}

function seek(video, time, signal) {
   return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error("seek timeout")), SEEK_TIMEOUT_MS);
      const done = () => finish();
      const failed = () => finish(new Error("seek failed"));
      const aborted = () => finish(new DOMException("aborted", "AbortError"));
      function finish(error) {
         clearTimeout(timeout);
         video.removeEventListener("seeked", done);
         video.removeEventListener("error", failed);
         signal?.removeEventListener("abort", aborted);
         if (error) reject(error);
         else resolve();
      }
      video.addEventListener("seeked", done, { once: true });
      video.addEventListener("error", failed, { once: true });
      signal?.addEventListener("abort", aborted, { once: true });
      video.currentTime = time;
   });
}

export async function analyze(source, { signal, progress } = {}) {
   const duration = Number(source.duration);
   const url = source.currentSrc || source.src;
   if (!url || !Number.isFinite(duration) || duration <= 0) throw new Error("media metadata unavailable");

   const video = document.createElement("video");
   video.muted = true;
   video.playsInline = true;
   video.preload = "auto";
   video.src = url;
   video.style.cssText = "position:fixed;left:-9999px;top:0;width:2px;height:2px;pointer-events:none";
   document.documentElement.append(video);
   const canvas = document.createElement("canvas");
   canvas.width = WIDTH;
   canvas.height = HEIGHT;
   const context = canvas.getContext("2d", { willReadFrequently: true });
   const step = Math.max(STEP_S, duration / SAMPLES);
   const samples = [];

   try {
      for (let at = step / 2; at < duration; at += step) {
         if (signal?.aborted) throw new DOMException("aborted", "AbortError");
         await seek(video, at, signal);
         samples.push({ at, signature: signature(context, video) });
         progress?.(Math.min(1, at / duration));
      }
      const scenes = boundaries(samples, duration);
      return outline(scenes, duration);
   } finally {
      video.removeAttribute("src");
      video.load();
      video.remove();
   }
}
