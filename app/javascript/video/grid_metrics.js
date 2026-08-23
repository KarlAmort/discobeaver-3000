export const GRID_SCALE = 1.25;
export const ROW_HEIGHT = 200 * GRID_SCALE;
export const MIN_CELL_WIDTH = 240 * GRID_SCALE;
export const CELL_GAP = 10 * GRID_SCALE;

const pad = (n) => String(n).padStart(2, "0");

function number(value) {
   if (value == null || value === "") return null;
   const n = Number(value);
   return Number.isFinite(n) ? n : null;
}

function fixed(value) {
   const n = number(value);
   return n == null ? null : n.toFixed(2);
}

function count(value) {
   const n = number(value);
   return n == null ? null : n.toLocaleString();
}

function date(value) {
   if (!value) return null;
   const d = new Date(value);
   return Number.isNaN(d.valueOf()) ? null : d.toLocaleDateString(undefined, { year: "2-digit", month: "short", day: "numeric" });
}

function datum(field, value, label, raw = value) {
   return { field, value, label, raw };
}

export function sourceMetric(video) {
   for (const field of [ "provider", "channel", "uploader" ]) {
      if (video[field]) return { field, value: video[field] };
   }
   return { field: null, value: video.id == null ? "" : `#${video.id}` };
}

export function labelsAt(index, columns) {
   if (index === 0) return true;
   const row = Math.floor(index / columns) + 1;
   return index % columns === 0 && row % 4 === 0;
}

export function metric(video, field) {
   let value;
   switch (field) {
      case "embedding":
         value = number(video.embedding_distance);
         if (value == null || value < 0 || value > 2) return null;
         return datum(field, fixed(value), `cosine distance ${fixed(value)}`, value);
      case "predicted":
         value = number(video.predicted);
         if (value == null || value < 1 || value > 9) return null;
         return datum(field, fixed(value), `prediction ${fixed(value)} / 9`, value);
      case "novelty":
         value = number(video.novelty);
         return value == null ? null : datum(field, fixed(value), `uniqueness ${fixed(value)}`, value);
      case "uncertainty":
         value = number(video.uncertainty);
         return value == null ? null : datum(field, fixed(value), `rating information ${fixed(value)}`, value);
      case "duration": {
         const seconds = number(video.duration);
         if (seconds == null) return null;
         const rounded = Math.round(seconds);
         const minutes = Math.floor(rounded / 60);
         value = `${minutes}:${pad(rounded % 60)}`;
         return datum(field, value, `duration ${minutes} min ${rounded % 60} s`, rounded);
      }
      case "filesize": {
         const bytes = number(video.filesize);
         if (bytes == null) return null;
         value = `${(bytes / 1048576).toFixed(0)} MB`;
         return datum(field, value, `file size ${value}`, bytes);
      }
      case "our_rating":
         value = number(video.our_rating);
         return value == null ? null : datum(field, `★ ${value}`, `rating ${value} / 9`, value);
      case "created_at":
         value = date(video.created_at);
         return value == null ? null : datum(field, value, `added ${value}`, video.created_at);
      case "published_at":
         value = date(video.published_at);
         return value == null ? null : datum(field, value, `published ${value}`, video.published_at);
      case "pixel_width":
         value = number(video.ewidth ?? video.width);
         return value == null ? null : datum(field, String(value), `width ${value} px`, value);
      case "pixel_height":
         value = number(video.eheight ?? video.height);
         return value == null ? null : datum(field, String(value), `height ${value} px`, value);
      case "view_count":
         value = count(video.view_count);
         return value == null ? null : datum(field, value, `views ${value}`, video.view_count);
      case "our_view_count":
         value = count(video.our_view_count);
         return value == null ? null : datum(field, value, `plays ${value}`, video.our_view_count);
      case "favorite_count":
         value = count(video.favorite_count);
         return value == null ? null : datum(field, value, `favorites ${value}`, video.favorite_count);
      case "like_count":
         value = count(video.like_count);
         return value == null ? null : datum(field, value, `likes ${value}`, video.like_count);
      case "comment_count":
         value = count(video.comment_count);
         return value == null ? null : datum(field, value, `comments ${value}`, video.comment_count);
      case "fps":
         value = number(video.fps);
         return value == null ? null : datum(field, String(value), `frame rate ${value} fps`, value);
      case "video_bitrate":
         value = number(video.video_bitrate);
         return value == null ? null : datum(field, String(value), `video bitrate ${value} kb/s`, value);
      case "face_count": {
         const faces = number(video.face_count);
         if (faces == null) return null;
         const gender = video.face_gender;
         const mark = gender === "female" ? "♀" : gender === "male" ? "♂" : gender === "mixed" ? "⚥" : "·";
         value = faces ? `${mark} ${faces}` : "no face";
         return datum(field, value, gender && faces ? `faces ${faces} · ${gender}` : `faces ${faces}`, faces);
      }
      case "face_age_mean":
         value = number(video.face_age_mean);
         return value == null ? null : datum(field, `~${value}y`, `mean face age ${value} years`, value);
      case "face_gender":
         value = video.face_gender;
         return value == null ? null : datum(field, String(value), `face gender ${value}`);
      default:
         value = video[field];
         return value == null ? null : datum(field, String(value), `${field.replaceAll("_", " ")} ${value}`);
   }
}

export function cardMetrics(video, activeCriterion) {
   const source = sourceMetric(video);
   const inMetadata = new Set([ "title", source.field ]);
   const fields = [ "predicted", "embedding", "our_rating" ];
   if (activeCriterion && !inMetadata.has(activeCriterion)) fields.push(activeCriterion);
   return [ ...new Set(fields) ].map((field) => metric(video, field)).filter(Boolean);
}
