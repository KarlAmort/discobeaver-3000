// just: "thumbnail <img> resilience — remote thumbs live on other sites' CDNs (hotlink/referer
//        checks, signed URLs that expire, dead hosts). Render them referrer-less, and when one
//        errors fall back ONCE to our /video/:id/thumb proxy — which serves a cached copy or
//        re-validates the source URI server-side — then give up and hide the broken image."
export function thumbError(id) {
   return (e) => {
      const img = e.currentTarget;
      if (img.dataset.thumbFallback) {
         // Fallback failed — the video legitimately has no thumbnail (server returned 404 because
         // remote_thumbnail_url is nil) or the network request failed. Either way, hiding the
         // broken image is the expected graceful degradation. Don't warn — this is normal behavior,
         // not an error worth triaging.
         img.style.display = "none";
         return;
      }
      img.dataset.thumbFallback = "1";
      img.src = `/video/${id}/thumb`;
   };
}
