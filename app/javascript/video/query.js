// just: "the video command-bar query language — pure functions, no DOM, no signals. Turns the single
//        search string into a server request, and powers the autocomplete. The search box is the ONE
//        place the user expresses search text, filters, sort and embedding mode; this module is its
//        grammar. Kept side-effect-free so it round-trips and unit-tests in plain Node (see the harness).
//
//   token shapes (whitespace-separated; quotes group spaces):
//     bare words            → semantic (embedding) search text
//     "quoted phrase"       → FULLTEXT ILIKE across text columns + tags (one or more, AND-ed)
//     key:<rel?><value>     → a filter (numeric rel ∈ > >= = < <=; enums take values, ! excludes)
//     tag:foo,!bar          → tag filter (include foo, exclude bar) over the videos.tags array
//     sort:a+-b+c           → ordering of columns, combine with +, leading - reverses natural direction
//                             (sort:top / sort:unique / sort:learn are recommender STRATEGIES, each a complete
//                              ordering that stands ALONE — they cannot be combined with another sort:)
//     model:qwen-0.6b|qwen-4b|e5-sparse → embedding model (default qwen-4b)
//
//   mode falls out of the parse: a recommender sort ⇒ recommend; else fulltext or bare text ⇒
//   search (bare text auto-sorts by embedding unless you gave an explicit sort:); else ⇒ browse."

// — catalogs (friendly alias → server field) ————————————————————————————————————

// numeric filter keys → a server `ranges` field (> ⇒ from, < ⇒ to, = ⇒ both)
const NUM = {
   rating: "our_rating", plays: "our_view_count", views: "view_count",
   len: "duration", duration: "duration",
   width: "pixel_width", height: "pixel_height",
   year: "published_year", faces: "face_count"
};

// enum filter keys → a server `enums` field (value-suggested from facet counts; ! excludes)
const ENUM = {
   source: "provider", lang: "language", container: "container", hdr: "dynamic_range",
   orientation: "orientation", agelimit: "age_limit",
   gender: "face_gender"
};

// boolean shortcut keys → a server `flags` boolean (only `:no` is meaningful — it excludes)
const BOOL = { seen: "exclude_viewed", rated: "exclude_rated" };

function facetForKey(key) {
   if (NUM[key]) return NUM[key];
   if (ENUM[key]) return ENUM[key];
   if (key === "tag") return "tag";
   if (key === "resolution") return "resolution_pixels";
   if ([ "added", "max_age", "min_age" ].includes(key)) return "created_at";
   if (key === "seen") return "our_view_count";
   if (key === "rated") return "our_rating";
   return null;
}

function facetStats(field, facetList, facetStatus) {
   if (!field) return {};
   const facet = (facetList || []).find((item) => item.field === field);
   return { facet: field, entropy: facet?.entropy, inactive: facetStatus?.[field] !== "fresh" || !facet };
}

function rangeCount(facet, rel, value) {
   if (!facet?.bins || !Number.isFinite(value)) return null;
   return facet.bins.reduce((sum, bin) => {
      const mid = (Number(bin.x0) + Number(bin.x1)) / 2;
      const matches = rel === ">" ? mid > value : rel === ">=" ? mid >= value :
         rel === "<" ? mid < value : rel === "<=" ? mid <= value : value >= Number(bin.x0) && value <= Number(bin.x1);
      return sum + (matches ? Number(bin.count) || 0 : 0);
   }, 0);
}

// sort keys → { field, dir } (natural direction; `-` flips it) or a recommender { strategy }.
// `embedding` is the cosine rank; `top`/`unique`/`learn` switch into recommend (rate) mode.
const SORT = {
   embedding: { field: "embedding", dir: "asc" },
   top: { strategy: "best" }, unique: { strategy: "informative" }, learn: { strategy: "explore" },
   rating: { field: "our_rating", dir: "desc" }, plays: { field: "our_view_count", dir: "desc" },
   views: { field: "view_count", dir: "desc" },
   len: { field: "duration", dir: "desc" }, duration: { field: "duration", dir: "desc" },
   width: { field: "pixel_width", dir: "desc" }, height: { field: "pixel_height", dir: "desc" },
   added: { field: "created_at", dir: "desc" }, published: { field: "published_at", dir: "desc" },
   title: { field: "title", dir: "asc" }
};

// suggested common values per numeric key (autocomplete only; free entry always allowed)
const NUM_COMMON = {
   rating: [ 9, 7, 5, 3, 1 ], resolution: [ 2160, 1440, 1080, 720, 480 ],
   len: [ 10, 30, 60, 120, 300 ], duration: [ 10, 30, 60, 120, 300 ],
   width: [ 3840, 1920, 1280, 720 ], height: [ 2160, 1080, 720, 480 ],
   views: [ 100, 1000, 10000, 100000 ], plays: [ 1, 3, 5 ], year: [ 2024, 2022, 2020, 2015 ],
   faces: [ 1, 2, 3 ]
};

// the key vocabulary offered when the caret is on a bare (no-colon) token
export const KEYS = [ ...Object.keys(NUM), "resolution", "max_age", "min_age", "added", ...Object.keys(ENUM), "tag", ...Object.keys(BOOL), "model", "sort", "limit" ];

// age filters on created_at (import time). Units: h d w m(onth) y(ear); default d.
//   max_age:1d  → keep videos AT MOST 1 day old (added recently)   → server flag max_age_days
//   min_age:1w  → keep videos AT LEAST a week old                  → server flag min_age_days
//   added:<1d / added:>3d → relational alias (< newer-than ⇒ max_age, > older-than ⇒ min_age)
const UNIT_DAYS = { h: 1 / 24, d: 1, w: 7, m: 30, y: 365 };
function parseDur(raw) {                            // "1d" "6h" "2w" "3m" "1y" "1.5d" → days, or null
   const m = String(raw).trim().match(/^([\d.]+)\s*([hdwmy])?$/i);
   if (!m) return null;
   const d = parseFloat(m[1]) * (UNIT_DAYS[(m[2] || "d").toLowerCase()] ?? 1);
   return Number.isFinite(d) && d > 0 ? d : null;
}
function ageFlag(key, raw) {                        // max_age / min_age → a flagNum on created_at
   const d = parseDur(raw);
   return d == null ? null : { type: "flagNum", flag: (key === "min_age" ? "min_age_days" : "max_age_days"), num: d };
}
function parseAdded(raw) {                           // added:<1d alias (< newer ⇒ max_age, > older ⇒ min_age)
   const m = String(raw).match(/^(>=|<=|>|<|=)?\s*(.*)$/);
   const d = parseDur(m[2]);
   return d == null ? null : { type: "flagNum", flag: (m[1] && m[1][0] === ">" ? "min_age_days" : "max_age_days"), num: d };
}

// — small helpers ————————————————————————————————————————————————————————————

function unquote(s) {
   s = String(s);
   if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') return s.slice(1, -1);
   return s[0] === '"' ? s.slice(1) : s;
}
function maybeQuote(v) { v = String(v); return /\s/.test(v) ? `"${v}"` : v; }

// "<value>" with an optional leading relation → { rel, num }. num is null if no number is present yet.
function parseRel(raw) {
   const m = String(raw).match(/^(>=|<=|>|<|=)?\s*(.*)$/);
   const rel = m[1] || "=";
   const v = m[2].trim();
   const num = v === "" ? null : Number(v);
   return { rel, num: Number.isFinite(num) ? num : null };
}

// comma-separated values; a leading ! marks exclusion; a quoted whole disables comma-splitting.
function splitValues(raw) {
   const inc = [], exc = [];
   if (raw[0] === '"') { const v = unquote(raw); if (v) inc.push(v); return { inc, exc }; }
   for (let part of String(raw).split(",")) {
      part = part.trim();
      if (!part) continue;
      if (part[0] === "!") { const v = unquote(part.slice(1)); if (v) exc.push(v); }
      else { const v = unquote(part); if (v) inc.push(v); }
   }
   return { inc, exc };
}

// — tokenizer: split on whitespace, but keep "quoted spans" (incl. spaces) intact. Offsets included
//   so the autocomplete can target the token under the caret and Tab can jump between segments. —
export function tokenize(str) {
   const toks = [];
   let start = -1, inQ = false;
   for (let i = 0; i <= str.length; i++) {
      const end = i === str.length;
      const c = str[i];
      if (!end && c === '"') inQ = !inQ;
      const isSpace = !end && /\s/.test(c) && !inQ;
      if (isSpace || end) {
         if (start >= 0) { toks.push({ text: str.slice(start, i), start, end: i }); start = -1; }
      } else if (start < 0) { start = i; }
   }
   return toks;
}

// classify one token's text → a typed descriptor (or null to ignore)
function classify(t) {
   if (!t) return null;
   if (t[0] === '"') return { type: "fulltext", value: unquote(t) };
   // leading '-' on a known enum/tag key negates it: -source:tube8 ⇒ exclude tube8 (alias for source:!tube8)
   let neg = false;
   if (t[0] === "-" && t.indexOf(":") > 1) {
      const nk = t.slice(1, t.indexOf(":")).toLowerCase();
      if (ENUM[nk] || nk === "tag") { neg = true; t = t.slice(1); }
   }
   const ci = t.indexOf(":");
   if (ci > 0) {
      const key = t.slice(0, ci).toLowerCase();
      const raw = t.slice(ci + 1);
      if (key === "model") return [ "qwen-0.6b", "qwen-4b", "e5-sparse" ].includes(raw.toLowerCase()) ? { type: "model", model: raw.toLowerCase() } : null;
      if (key === "sort") return { type: "sort", value: raw };
      // limit:N — how many nearest clips the embedding keeps before a recommender sort re-ranks them
      if (key === "limit") { const n = parseInt(raw, 10); return Number.isFinite(n) && n > 0 ? { type: "hood", num: Math.min(n, 1000) } : null; }
      if (key === "tag") { const { inc, exc } = splitValues(raw); return neg ? { type: "tag", include: [], exclude: inc.concat(exc) } : { type: "tag", include: inc, exclude: exc }; }
      if (key === "resolution") {
         const { rel, num } = parseRel(raw);
         if (num == null) return null;
         return { type: "range", field: "resolution_pixels", rel: /^(>=|<=|>|<|=)/.test(raw) ? rel : ">=", num };
      }
      if (key === "max_age" || key === "min_age") return ageFlag(key, raw);
      if (key === "added") return parseAdded(raw);
      if (BOOL[key]) return { type: "bool", flag: BOOL[key], on: /^no$/i.test(raw) };
      if (NUM[key]) { const { rel, num } = parseRel(raw); return num == null ? null : { type: "range", field: NUM[key], rel, num }; }
      if (ENUM[key]) { const { inc, exc } = splitValues(raw); return neg ? { type: "enum", field: ENUM[key], include: [], exclude: inc.concat(exc) } : { type: "enum", field: ENUM[key], include: inc, exclude: exc }; }
      return { type: "text", value: t };                 // unknown key → treat as a search word
   }
   return { type: "text", value: t };
}

// split a sort:value (a+-b+c) into [{field,dir}|{strategy}], honoring each key's natural direction.
function parseSort(value) {
   return String(value).split("+").map(p => p.trim()).filter(Boolean).flatMap(p => {
      let rev = false, name = p;
      if (p[0] === "-") { rev = true; name = p.slice(1); }
      const s = SORT[name.toLowerCase()];
      if (!s) return [];
      if (s.strategy) return [ { strategy: s.strategy } ];
      const dir = rev ? (s.dir === "asc" ? "desc" : "asc") : s.dir;
      return [ { field: s.field, dir } ];
   });
}

function addRange(ranges, field, rel, num) {
   const r = ranges[field] || (ranges[field] = {});
   if (rel === ">" || rel === ">=") r.from = num;
   else if (rel === "<" || rel === "<=") r.to = num;
   else { r.from = num; r.to = num; }
}
function addEnum(enums, field, inc, exc) {
   const e = enums[field] || (enums[field] = { include: [], exclude: [], invert: false });
   inc.forEach(v => { if (!e.include.includes(v)) e.include.push(v); });
   exc.forEach(v => { if (!e.exclude.includes(v)) e.exclude.push(v); });
}
function addTags(tags, inc, exc) {
   if (inc.length) tags.include = [ ...new Set([ ...(tags.include || []), ...inc ]) ];
   if (exc.length) tags.exclude = [ ...new Set([ ...(tags.exclude || []), ...exc ]) ];
}

// — parse: the search string → a structured model ——————————————————————————————
export function parse(str) {
   str = str || "";
   const filters = { enums: {}, ranges: {}, flags: {}, tags: {} };
   const sorts = [], words = [], fulltext = [];
   let strategy = null, embeddingModel = "qwen-4b", explicitSort = false, hood = null;

   for (const tk of tokenize(str)) {
      const c = classify(tk.text);
      if (!c) continue;
      switch (c.type) {
         case "model":    embeddingModel = c.model; break;
         case "hood":     hood = c.num; break;
         case "fulltext": if (c.value) fulltext.push(c.value); break;
         case "text":     words.push(c.value); break;
         case "sort":
            explicitSort = true;
            for (const part of parseSort(c.value)) {
               if (part.strategy) { if (!strategy) strategy = part.strategy; }   // first strategy wins; it's exclusive
               else sorts.push({ field: part.field, dir: part.dir });
            }
            break;
         case "range":    addRange(filters.ranges, c.field, c.rel, c.num); break;
         case "flagNum":  filters.flags[c.flag] = c.num; break;
         case "enum":     addEnum(filters.enums, c.field, c.include, c.exclude); break;
         case "tag":      addTags(filters.tags, c.include, c.exclude); break;
         case "bool":     if (c.on) filters.flags[c.flag] = true; break;
      }
   }
   // Recommender strategies are complete orderings on their own and
   // switch the grid into recommend mode, where column ORDER BYs are ignored (buildRequest drops
   // model.sorts there). So a strategy can't be combined with another sort: — neither a column sort
   // (sort:top+rating) nor a second strategy (sort:top+learn). Enforce it: the strategy stands
   // alone and any column sorts that rode along are dropped, rather than silently pretending they apply.
   if (strategy) sorts.length = 0;
   const source = filters.enums.provider
      ? { include: [ ...filters.enums.provider.include ], exclude: [ ...filters.enums.provider.exclude ] }
      : null;
   return { raw: str, text: words.join(" ").trim(), fulltext, filters, sorts, strategy, model: embeddingModel, explicitSort, hood, source };
}

export function withSource(model, source) {
   if (model.source || !source || (!source.include?.length && !source.exclude?.length)) return model;
   return { ...model, filters: { ...model.filters, enums: { ...model.filters.enums,
      provider: { include: [ ...(source.include || []) ], exclude: [ ...(source.exclude || []) ], invert: false }
   } } };
}

export function sourceText(source) {
   if (!source) return "";
   return [ ...(source.include || []), ...(source.exclude || []).map((value) => `!${value}`) ]
      .map(maybeQuote).join(",");
}

export function withoutSource(str) {
   return tokenize(str || "").filter(({ text }) => !/^-?source:/i.test(text)).map(({ text }) => text).join(" ");
}

// column sorts only (browse + fulltext can't rank by embedding)
function columnSorts(sorts) { return sorts.filter(s => s.field !== "embedding"); }

// the visible ranking criterion. Embedding results expose SQL cosine distance, while sort:top exposes
// the recommender's predicted rating.
export function primarySort(model) {
   if (model.strategy === "best") return { field: "predicted", dir: "desc" };
   if (model.strategy === "informative") return { field: "novelty", dir: "desc" };
   if (model.strategy === "explore") return { field: "uncertainty", dir: "desc" };
   if (model.text && !model.explicitSort) return { field: "embedding", dir: "asc" };
   return columnSorts(model.sorts)[0] || { field: "created_at", dir: "desc" };
}

// — buildRequest: model → { action, mode, params } the cable layer sends —————————
export function buildRequest(model) {
   const filters = model.filters;
   if (model.strategy) {
      // A recommender sort alongside a search term means "rank THIS subset by the recommender",
      // not "ignore the term and recommend over everything". Carry the query into the recommend
      // request so the server can narrow the candidate scope to the fulltext/embedding subset first
      // (see VideosChannel#recommend). Without this, "mainstream sort:top" == bare "sort:top".
      const params = { strategy: model.strategy, filters };
      if (model.fulltext.length) params.terms = model.fulltext;
      else if (model.text) { params.q = model.text; params.model = model.model; }
      if (model.hood) params.neighborhood = model.hood;   // limit: — the embedding pool sort:top re-ranks
      return { action: "recommend", mode: "rate", params };
   }
   if (model.fulltext.length) {
      return { action: "search", mode: "search",
               params: { terms: model.fulltext, sorts: columnSorts(model.sorts), filters, limit: 500 } };
   }
   if (model.text) {
      const sorts = model.sorts.length ? model.sorts : [ { field: "embedding", dir: "asc" } ];
      return { action: "search", mode: "search",
               params: { q: model.text, model: model.model, sorts, filters, limit: 500 } };
   }
   return { action: "page", mode: "browse", params: { sorts: columnSorts(model.sorts), filters } };
}

// — valid: is the string in a runnable state? ————————————————————————————————————————————————
// True unless the user is mid-token: an unbalanced quote, or a trailing key:value still being typed
// (a "key:" with a value that doesn't classify yet, e.g. "sort:", "rating:>"). Empty string is valid
// (runs the default browse). Bare words are valid when the form is submitted.
export function valid(str) {
   str = str || "";
   if ((str.match(/"/g) || []).length % 2 !== 0) return false;        // unterminated quote
   const toks = tokenize(str);
   const last = toks[toks.length - 1];
   if (last) {
      const t = last.text;
      if (t[0] !== '"' && t.indexOf(":") > 0 && classify(t) == null) return false;  // half-typed key:value
   }
   return true;
}

export function live(str) {
   return valid(str) && !buildRequest(parse(str)).params.q;
}

// — autocomplete: suggest({str,caret,facetList}) → { from, to, items } —————————————
// `items[i].insert` replaces str.slice(from,to). Labels are display-only; hints are counts/notes.
const REL_ITEMS = [ ">", ">=", "=", "<", "<=" ];

// keys grouped into similar attributes — drives the multi-column key picker (each group = a column)
export const KEY_GROUPS = [
   { title: "content",   keys: [ "tag", "lang", "orientation" ] },
   { title: "your taste", keys: [ "rating", "plays" ] },
   { title: "popularity", keys: [ "views" ] },
   { title: "size/quality", keys: [ "len", "duration", "resolution", "width", "height" ] },
   { title: "time",      keys: [ "year", "added", "max_age", "min_age" ] },
   { title: "source/tech", keys: [ "source", "container", "hdr", "agelimit" ] },
   { title: "flags/sort", keys: [ "seen", "rated", "sort", "limit" ] }
];
function keyItems(seg, facetList, facetStatus) {
   const q = seg.toLowerCase();
   const items = [];
   for (const g of KEY_GROUPS) {
      for (const k of g.keys) {
         if (!KEYS.includes(k) || !k.startsWith(q)) continue;
         items.push({ label: `${k}:`, insert: `${k}:`, hint: keyHint(k), group: g.title,
                      showEntropy: true, ...facetStats(facetForKey(k), facetList, facetStatus) });
         // `sort` is special: its recommender orderings switch the
         // grid into recommend mode. Surface them here so they're discoverable from the bare `sort`
         // key — otherwise you'd have to type the colon first to see them (see SORT / sortItems).
         if (k === "sort") {
            items.push({ label: "sort:top",   insert: "sort:top",   hint: "rate · exploit", group: g.title });
            items.push({ label: "sort:unique", insert: "sort:unique", hint: "rate · novelty", group: g.title });
            items.push({ label: "sort:learn", insert: "sort:learn", hint: "rate · explore", group: g.title });
         }
      }
   }
   return items;   // grouped + un-truncated; the picker lays them out in columns by `group`
}
function keyHint(k) {
   if (NUM[k]) return "num";
   if (k === "source") return "one,!other · ! excludes";
   if (ENUM[k]) return "enum";
   if (k === "tag") return "tag";
   if (k === "resolution") return "px";
   if (k === "max_age" || k === "min_age" || k === "added") return "age";
   if (BOOL[k]) return "yes/no";
   if (k === "sort") return "order by";
   if (k === "limit") return "embedding pool";
   return "";
}
function modelItems(val) {
   return [ "qwen-0.6b", "qwen-4b", "e5-sparse" ].filter(model => model.startsWith(val.toLowerCase())).map(model => ({ label: `model:${model}`, insert: `model:${model}`, hint: "embedding" }));
}
function numItems(key, val, facetList, facetStatus) {
   const m = val.match(/^(>=|<=|>|<|=)?(.*)$/);
   const rel = m[1] || "";
   const rest = (m[2] || "").trim();
   const items = [];
   const field = facetForKey(key);
   const facet = (facetList || []).find(item => item.field === field);
   const stats = facetStats(field, facetList, facetStatus);
   if (!rel && !rest) for (const r of REL_ITEMS) items.push({ label: `${key}:${r}`, insert: `${key}:${r}`, ...stats });
   for (const c of (NUM_COMMON[key] || [])) {
      const s = String(c);
      const relation = rel || ">=";
      if (!rest || s.startsWith(rest)) items.push({ label: `${key}:${relation}${s}`, insert: `${key}:${relation}${s}`,
                                                   count: rangeCount(facet, relation, c), ...stats });
   }
   return items.slice(0, 14);
}
function enumItems(key, val, facetList, facetStatus) {
   const field = key === "tag" ? "tag" : ENUM[key];
   const facet = (facetList || []).find(f => f.field === field);
   const stats = facetStats(field, facetList, facetStatus);
   const values = facet ? (facet.values || []) : [];
   const ci = val.lastIndexOf(",");
   const prefix = val.slice(0, ci + 1);                  // keeps earlier comma-separated values
   let cur = val.slice(ci + 1), bang = "";
   if (cur[0] === "!") { bang = "!"; cur = cur.slice(1); }
   const curl = cur.toLowerCase();
   return values
      .filter(v => String(v.value).toLowerCase().includes(curl))
      .slice(0, 14)
      .map(v => ({ label: String(v.value), count: v.count, insert: `${key}:${prefix}${bang}${maybeQuote(v.value)}`,
                   hint: key === "source" ? "comma adds · ! excludes" : "", ...stats }));
}
function boolItems(key, val, facetList, facetStatus) {
   const stats = facetStats(facetForKey(key), facetList, facetStatus);
   return [ "no" ].filter(o => o.startsWith(val.toLowerCase())).map(o => ({ label: `${key}:${o}`, insert: `${key}:${o}`, ...stats }));
}
function ageItems(key, val, facetList, facetStatus) {
   const opts = key === "added" ? [ "<6h", "<1d", "<3d", "<1w", ">1w", ">1m" ] : [ "6h", "1d", "3d", "1w", "1m", "1y" ];
   const v = val.toLowerCase();
   const field = facetForKey(key);
   const facet = (facetList || []).find(item => item.field === field);
   const stats = facetStats(field, facetList, facetStatus);
   return opts.filter(o => !v || o.toLowerCase().startsWith(v)).slice(0, 14).map(o => {
      const relation = o.startsWith(">") || key === "min_age" ? "<=" : ">=";
      const cutoff = Date.now() / 1000 - parseDur(o.replace(/^[<>]/, "")) * 86_400;
      return { label: `${key}:${o}`, insert: `${key}:${o}`, hint: "age", count: rangeCount(facet, relation, cutoff), ...stats };
   });
}
function sortItems(val) {
   const pi = val.lastIndexOf("+");
   const prefix = val.slice(0, pi + 1);
   let cur = val.slice(pi + 1), neg = "";
   if (cur[0] === "-") { neg = "-"; cur = cur.slice(1); }
   const curl = cur.toLowerCase();
   return Object.keys(SORT).filter(k => k.startsWith(curl)).slice(0, 14).map(k => ({
      label: `sort:${prefix}${neg}${k}`, insert: `sort:${prefix}${neg}${k}`,
      hint: SORT[k].strategy ? "rate" : (k === "embedding" ? "rank" : "")
   }));
}

export function suggest(str, caret, facetList = [], facetStatus = {}) {
   str = str || "";
   caret = Math.max(0, Math.min(caret, str.length));
   let tok = null;
   for (const t of tokenize(str)) { if (caret >= t.start && caret <= t.end) { tok = t; break; } }
   const from = tok ? tok.start : caret;
   const to   = tok ? tok.end : caret;
   const seg  = tok ? str.slice(tok.start, caret) : "";   // the token text UP TO the caret

   if (seg[0] === '"') return { from, to, items: [] };     // inside a fulltext phrase — nothing to suggest
   if (!seg.includes(":")) return { from, to, items: keyItems(seg, facetList, facetStatus), grouped: true };

   const ci = seg.indexOf(":");
   const key = seg.slice(0, ci).toLowerCase();
   const val = seg.slice(ci + 1);
   if (key === "sort") return { from, to, items: sortItems(val) };
   if (key === "model") return { from, to, items: modelItems(val) };
   if (key === "max_age" || key === "min_age" || key === "added") return { from, to, items: ageItems(key, val, facetList, facetStatus) };
   if (key === "resolution" || NUM[key]) return { from, to, items: numItems(key, val, facetList, facetStatus) };
   if (key === "tag" || ENUM[key]) return { from, to, items: enumItems(key, val, facetList, facetStatus) };
   if (BOOL[key]) return { from, to, items: boolItems(key, val, facetList, facetStatus) };
   return { from, to, items: [] };
}

export function facetField(str, caret) {
   str = str || "";
   caret = Math.max(0, Math.min(caret, str.length));
   const tok = tokenize(str).find((part) => caret >= part.start && caret <= part.end);
   if (!tok) return null;
   const seg = str.slice(tok.start, caret);
   const ci = seg.indexOf(":");
   if (ci < 1) return null;
   const key = seg.slice(0, ci).toLowerCase();
   return key === "tag" ? "tag" : (ENUM[key] || null);
}

// — segment offsets for Tab / Shift+Tab navigation in the command bar —————————————
// returns the [start,end] spans of each token, so the bar can select the next/previous one.
export function segments(str) { return tokenize(str).map(t => ({ start: t.start, end: t.end })); }
