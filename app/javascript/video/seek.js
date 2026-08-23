export const SEEK_SECONDS = 15;
export const SEEK_CONTROL_SECONDS = 60;
export const SEEK_REPEAT_MS = 50;
export const SEEK_REPEAT_LIMIT = 4;

export function seekDelta(e) {
   const dir = e?.key === "ArrowLeft" ? -1 : e?.key === "ArrowRight" ? 1 : 0;
   if (!dir) return 0;
   return dir * (e.ctrlKey ? SEEK_CONTROL_SECONDS : SEEK_SECONDS);
}

export function seekRepeatCount(e, previousTime = null) {
   if (!e?.repeat || previousTime == null) return 1;
   const now = Number(e.timeStamp);
   const prev = Number(previousTime);
   if (!Number.isFinite(now) || !Number.isFinite(prev) || now <= prev) return 1;
   return Math.max(1, Math.min(SEEK_REPEAT_LIMIT, Math.round((now - prev) / SEEK_REPEAT_MS)));
}
