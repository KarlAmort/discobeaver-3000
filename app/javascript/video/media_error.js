const CODES = {
   1: "MEDIA_ERR_ABORTED",
   2: "MEDIA_ERR_NETWORK",
   3: "MEDIA_ERR_DECODE",
   4: "MEDIA_ERR_SRC_NOT_SUPPORTED"
};

export function mediaErrorDetail(media) {
   const error = media?.error;
   if (!error) return "media load failed";
   const code = CODES[error.code] || `MEDIA_ERR_${error.code}`;
   return error.message ? `${code}: ${error.message}` : code;
}

export function mediaSource(target) {
   const media = target?.tagName === "SOURCE" ? target.parentElement : target;
   return target?.currentSrc || target?.src || media?.currentSrc || media?.src || "";
}
