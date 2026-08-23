// just: "pure helper for the 1–9 rapid-rate flow (see app.js#rateAndAdvance). Picks the id of the
//        clip to ADVANCE to after rating the current one — captured from the CURRENT list BEFORE
//        rate() mutates it. In the active-learning feed rate() removes the rated card, shifting every
//        later index down by one, so a post-rate lookup would land on the wrong clip; anchoring on the
//        genuine next id (resolved pre-mutation) makes the advance exact. Returns null at the list end
//        (or when the current clip isn't in the list), i.e. 'stay on the last clip'."
export function nextClipId(list, currentId) {
   if (!Array.isArray(list) || currentId == null) return null;
   const i = list.findIndex(x => x && x.id === currentId);
   if (i < 0) return null;
   return list[i + 1]?.id ?? null;
}
