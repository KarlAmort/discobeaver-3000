// just: "a compact, JSON-serializable snapshot of the video SPA's UI state — the 'before' and 'after'
//        picture the observability console stamps onto every user action. Reads the store signals
//        directly (no subscription; called imperatively by the key router and registered on the bus
//        via setStateProvider). Keep it small and stable: it's what gets pasted back to debug."
import * as S from "video/store";

export function snapshotUI() {
   const p    = S.player.value;
   const vids = S.videos.value;
   const cur  = p.open ? vids[p.index] : null;
   const sel  = S.selection.value;
   const selV = (!p.open && sel >= 0) ? vids[sel] : null;
   return {
      mode:        S.mode.value,
      query:       S.query.value || "",
      loaded:      vids.length,
      total:       S.total.value,
      selection:   sel,
      selectedId:  selV ? selV.id : null,
      searchOpen:  S.searchOpen.value,
      helpOpen:    S.helpOpen.value,
      detailsOpen: S.detailsOpen.value,
      player: p.open
         ? { open: true, index: p.index, videoId: cur ? cur.id : null,
             title: cur ? (cur.title || null) : null, overlayPinned: !!p.overlayPinned }
         : { open: false }
   };
}
