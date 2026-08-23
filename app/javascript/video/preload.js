const STORAGE_KEY = "v.preload.v1";
const DEFAULT_MS = 10_000;

function scale(duration) {
   const seconds = Math.max(30, Math.min(7_200, Number(duration) || 300));
   return Math.pow(seconds / 300, 0.2);
}

export function sourceKey(video) {
   if (video?.provider) return String(video.provider);
   try { return new URL(video?.play_url, globalThis.location?.href).hostname || "unknown"; }
   catch { return "unknown"; }
}

export function readPreloadStats(storage = globalThis.localStorage) {
   try {
      const value = JSON.parse(storage?.getItem(STORAGE_KEY) || "null");
      if (value?.sources && value?.global) return value;
   } catch {}
   return { sources: {}, global: { n: 0, meanUnitMs: DEFAULT_MS } };
}

function updated(sample, unitMs) {
   const n = Number(sample?.n) || 0;
   const mean = Number(sample?.meanUnitMs) || DEFAULT_MS;
   const weight = n < 100 ? 1 / (n + 1) : 0.01;
   return { n: Math.min(n + 1, 100), meanUnitMs: mean + (unitMs - mean) * weight };
}

export function recordPreload(stats, video, elapsedMs, storage = globalThis.localStorage) {
   const ms = Number(elapsedMs);
   if (!Number.isFinite(ms) || ms <= 0) return stats;
   const next = { sources: { ...stats?.sources }, global: { ...stats?.global } };
   const unitMs = ms / scale(video?.duration);
   const key = sourceKey(video);
   next.sources[key] = updated(next.sources[key], unitMs);
   next.global = updated(next.global, unitMs);
   try { storage?.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
   return next;
}

export function estimatedLoadMs(stats, video) {
   const source = stats?.sources?.[sourceKey(video)];
   const unitMs = Number(source?.meanUnitMs) || Number(stats?.global?.meanUnitMs) || DEFAULT_MS;
   return unitMs * scale(video?.duration);
}

export function rankPreloads(videos, stats) {
   return videos.map((video, order) => ({ video, order, estimate: estimatedLoadMs(stats, video) }))
      .sort((a, b) => b.estimate - a.estimate || a.order - b.order)
      .map(item => item.video);
}

export function pickNext(queue, ready) {
   if (!queue.length) return null;
   if (ready.has(queue[0])) return queue[0];
   return queue.find(id => ready.has(id)) ?? queue[0];
}
