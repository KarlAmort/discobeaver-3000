// just: "the eye of scene seek — a hidden same-origin <video> that seeks to requested timestamps
//        and grabs two things per stop: a tiny 16×9 RGB signature (what the clusterer compares
//        camera perspectives with) and a small JPEG thumbnail (what the strip shows). Sampling is
//        strictly sequential (one hidden decoder, one in-flight seek), abortable, and degrades
//        cleanly: a canvas SecurityError (tainted pixels) flips `tainted` and every further
//        sample returns null so callers drop to signature-less clustering."
//
//   const s = createSampler(src);
//   await s.sample(t) -> { sig: Float32Array(432), thumb: dataURL } | null
//   s.tainted            // true once pixel reads are disallowed
//   s.destroy()

const SIG_W = 16, SIG_H = 9;         // signature resolution: 16×9×RGB = 432 dims
const THUMB_W = 144, THUMB_H = 81;   // filmstrip thumbnail
const SEEK_TIMEOUT_MS = 8000;        // a stuck seek must not wedge the whole build

export function createSampler(src) {
   const video = document.createElement("video");
   video.muted = true;
   video.playsInline = true;
   video.preload = "auto";
   video.fetchPriority = "low";      // never outrank the visible clip's stream
   // off-screen but NOT display:none — some engines skip decoding for undisplayed videos
   video.style.cssText = "position:fixed;left:-9999px;top:0;width:2px;height:2px;";
   video.src = src;
   document.body.appendChild(video);

   const sigCanvas = document.createElement("canvas");
   sigCanvas.width = SIG_W; sigCanvas.height = SIG_H;
   const sigCtx = sigCanvas.getContext("2d", { willReadFrequently: true });
   const thumbCanvas = document.createElement("canvas");
   thumbCanvas.width = THUMB_W; thumbCanvas.height = THUMB_H;
   const thumbCtx = thumbCanvas.getContext("2d");

   let queue = Promise.resolve();
   let destroyed = false;

   const metadata = new Promise((resolve, reject) => {
      if (video.readyState >= 1) return resolve();
      video.addEventListener("loadedmetadata", () => resolve(), { once: true });
      video.addEventListener("error", () => reject(new Error("sampler: video failed to load")), { once: true });
   });

   function seekTo(t) {
      return new Promise((resolve, reject) => {
         const timer = setTimeout(() => { cleanup(); reject(new Error("sampler: seek timeout")); }, SEEK_TIMEOUT_MS);
         const onSeeked = () => { cleanup(); resolve(); };
         const onError = () => { cleanup(); reject(new Error("sampler: seek error")); };
         const cleanup = () => {
            clearTimeout(timer);
            video.removeEventListener("seeked", onSeeked);
            video.removeEventListener("error", onError);
         };
         video.addEventListener("seeked", onSeeked, { once: true });
         video.addEventListener("error", onError, { once: true });
         try { video.currentTime = Math.max(0, t); } catch (e) { cleanup(); reject(e); }
      });
   }

   function grab() {
      sigCtx.drawImage(video, 0, 0, SIG_W, SIG_H);
      const px = sigCtx.getImageData(0, 0, SIG_W, SIG_H).data;   // throws on taint — caught by caller
      const sig = new Float32Array(SIG_W * SIG_H * 3);
      for (let i = 0, o = 0; i < px.length; i += 4) {
         sig[o++] = px[i] / 255; sig[o++] = px[i + 1] / 255; sig[o++] = px[i + 2] / 255;
      }
      thumbCtx.drawImage(video, 0, 0, THUMB_W, THUMB_H);
      return { sig, thumb: thumbCanvas.toDataURL("image/jpeg", 0.55) };
   }

   const api = {
      tainted: false,
      sample(t) {
         queue = queue.then(async () => {
            if (destroyed || api.tainted) return null;
            try {
               await metadata;
               await seekTo(t);
               return grab();
            } catch (e) {
               if (e && e.name === "SecurityError") {
                  api.tainted = true;
                  console.warn("[v] scenes: canvas tainted — falling back to signature-less scenes");
               }
               return null;                      // one bad timestamp must not sink the build
            }
         });
         return queue;
      },
      destroy() {
         destroyed = true;
         try { video.removeAttribute("src"); video.load(); } catch {}
         video.remove();
      }
   };
   return api;
}
