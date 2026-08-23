const KEY = "v.rating.outbox";

function read(storage = localStorage) {
   try {
      const value = JSON.parse(storage.getItem(KEY) || "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
   } catch {
      return {};
   }
}

function write(value, storage = localStorage) {
   storage.setItem(KEY, JSON.stringify(value));
}

export function enqueue(videoId, rating, storage = localStorage) {
   const value = read(storage);
   const item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      video_id: Number(videoId),
      rating: Number(rating),
      queued_at: new Date().toISOString()
   };
   value[item.video_id] = item;
   write(value, storage);
   return item;
}

export function pending(storage = localStorage) {
   return Object.values(read(storage)).sort((a, b) => a.queued_at.localeCompare(b.queued_at));
}

export function acknowledge(item, storage = localStorage) {
   const value = read(storage);
   if (value[item.video_id]?.id !== item.id) return false;
   delete value[item.video_id];
   write(value, storage);
   return true;
}
