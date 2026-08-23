// just: "ActionCable client for the video SPA — subscribes to VideosChannel once and exposes
//        page/search/rate/registerView. Mirrors channels/videos_channel.js but adds the SPA's
//        `page` and `search` actions (see app/channels/videos_channel.rb)."
import consumer from "channels/consumer";

// connectV({ onPage, onResults, onRated, onViewed, onFacets, onRecommend, onDetails, onError }) ->
//   { page, search, facets, recommend, rate, registerView, details, close }
export function connectV({ scope = "",
                           onPage, onResults, onRated, onViewed, onFacets, onRecommend, onDetails, onError, onConnected,
                           onRateQueue, onRateStats, onRatedItem, onRateLineScores, onModelStatus, onQueryStatus, onCommander } = {}) {
   let confirmed = false;
   const sub = consumer.subscriptions.create({ channel: "VideosChannel", scope }, {
      // ActionCable drops perform() calls issued before the subscription is confirmed, so the
      // first data load MUST wait for this callback (fires on connect and every reconnect).
      connected() { confirmed = true; onConnected?.(); },
      received(msg) {
         switch (msg?.action) {
            case "page":    onPage?.(msg); break;
            case "results": onResults?.(msg); break;
            case "rated":   onRated?.(msg); break;
            case "viewed":  onViewed?.(msg); break;
            case "facets":  onFacets?.(msg); break;
            case "recommend": onRecommend?.(msg); break;
            case "model_status": onModelStatus?.(msg); break;
            case "details": onDetails?.(msg); break;
            case "commander": onCommander?.(msg); break;
            case "query_status": onQueryStatus?.(msg); break;
            // unified rating wizard (the folded-in /rate; see VideosChannel#rate_*)
            case "rate_queue":       onRateQueue?.(msg); break;
            case "rate_stats":       onRateStats?.(msg); break;
            case "rated_item":       onRatedItem?.(msg); break;
            case "rate_line_scores": onRateLineScores?.(msg); break;
            case "error":   onError?.(msg.message, msg); break;   // full msg carries context/video_id (e.g. a failed rate)
         }
      }
   });

   // Self-heal a dropped subscription confirmation. Under heavy server load ActionCable can lose the
   // `confirm_subscription` frame: the socket stays up (so the stale-monitor never reconnects it) but
   // `connected()` never fires, so the first data load is never dispatched and the SPA sits blank.
   // If we're still unconfirmed a few seconds after subscribing, force a socket reopen (fresh welcome
   // → fresh subscribe), which almost always confirms on a retry. Bounded so a genuinely-down server
   // doesn't reopen-loop forever; healthy connections confirm in <1s and never trip this.
   let heals = 0;
   const healer = setInterval(() => {
      if (confirmed) { clearInterval(healer); return; }
      if (++heals > 6) { clearInterval(healer); return; }
      try { consumer.connection.reopen(); } catch {}
   }, 3000);

   const emptyFilters = { enums: {}, ranges: {}, flags: {}, tags: {} };
   return {
      // browse window, multi-key `sorts:[{field,dir}]`. `token` is echoed back so the client can drop
      // pages from a superseded query (see app.js onPage/onResults).
      page({ sorts = [], offset = 0, limit = 60, filters = emptyFilters, token = 0 } = {}) {
         sub.perform("page", { sorts, offset, limit, filters, token });
      },
      // search: embedding (q + model + sorts) OR fulltext (terms).
      search({ q = "", terms = [], model = "qwen-4b", sorts = [], limit = 500, filters = emptyFilters, token = 0 } = {}) {
         sub.perform("search", { q, terms, model, sorts, limit, filters, token });
      },
      facets({ filters = emptyFilters, fields = [], resultIds = [], request, token = 0 } = {}) {
         sub.perform("facets", { filters, fields, result_ids: resultIds, request, token });
      },
      // recommend: active-learning picks for `strategy`. A search query (q + model, or fulltext
      // `terms`) rides along when a recommender sort was typed after a term, so the server narrows
      // the candidate scope to that subset before ranking (see VideosChannel#recommend / narrow_to_query).
      // limit defaults to the full recommender candidate window (matches search's 500), NOT an arbitrary
      // ~120 cutoff: recommender sorts should surface the whole ranked pool, bounded only by the
      // server's global recommender candidate cap, not a magic feed size.
      recommend({ strategy = "best", filters = emptyFilters, exclude = [], limit = 500, token = 0,
                  q = "", terms = [], model = "qwen-4b", neighborhood } = {}) {
         sub.perform("recommend", { strategy, filters, exclude, limit, token, q, terms, model, neighborhood });
      },
      rate(id, rating) { sub.perform("rate", { video_id: Number(id), rating: Number(rating) }); },
      registerView(id) { sub.perform("register_view", { video_id: Number(id) }); },
      // space: "image" | "text" | "joint" — the embedding neighbourhood to rank "similar" in; omitted
      // ⇒ the server defaults to "text" (backward compatible with clients that don't send one).
      details(id, space) { sub.perform("details", { video_id: Number(id), space: space || undefined }); },
      commander(id, vectors = [], query = "") {
         sub.perform("commander", { video_id: Number(id), vectors, query });
      },
      modelStatus() { sub.perform("model_status", {}); },
      // — unified rating wizard —
      rateQueue({ domain = "video", strategy = "informative", limit = 12, exclude = [] } = {}) {
         sub.perform("rate_queue", { domain, strategy, limit, exclude });
      },
      rateStats(domain = "video") { sub.perform("rate_stats", { domain }); },
      rateItem(domain, id, rating) { sub.perform("rate_item", { domain, id: Number(id), rating: Number(rating) }); },
      rateLineScores(id) { sub.perform("rate_line_scores", { id: Number(id) }); },
      close() { clearInterval(healer); try { sub.unsubscribe(); } catch {} }
   };
}
