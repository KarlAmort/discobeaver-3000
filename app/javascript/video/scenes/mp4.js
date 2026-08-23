// just: "the bitstream half of scene seek — read an MP4's video sample tables (frame timestamps,
//        per-frame byte sizes, keyframe flags) with a handful of Range requests and ZERO frame
//        decoding. The compressed stream already encodes 'how different is this moment': encoders
//        spend many more bytes on frames they can't predict from the previous one, and drop
//        keyframes at cuts. I/O is injected (readRange) so node tests can read a file and the
//        browser passes a same-origin fetch — the module itself is pure and portable."
//
//   const idx = await indexMp4(readRange);
//   // -> { times: Float64Array (s), sizes: Uint32Array (bytes), sync: Uint8Array (0/1),
//   //      duration: Number (s), timescale } — or null (fragmented / not MP4 / parse failure)
//
// Scope (v1): plain progressive MP4 (moov + mdat, either order). Fragmented MP4 (moof/mvex) and
// non-MP4 containers return null — callers fall back to the visual scan. stz2 (compact sizes) is
// rare enough to punt on. Edit lists are ignored (worst case a small constant time offset).

const HEAD = 16;                    // enough for size(4) + type(4) + largesize(8)
const MAX_MOOV = 64 * 1024 * 1024;  // sanity cap — a moov beyond this is not worth trusting

const te = new TextDecoder("ascii");

function u32(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
function u64(b, o) { return u32(b, o) * 4294967296 + u32(b, o + 4); }
function type4(b, o) { return te.decode(b.subarray(o, o + 4)); }

// walk the children of a container box in an in-memory buffer; cb(type, bodyStart, bodyEnd, headerStart)
function children(buf, start, end, cb) {
   let pos = start;
   while (pos + 8 <= end) {
      let size = u32(buf, pos);
      const t = type4(buf, pos + 4);
      let body = pos + 8;
      if (size === 1) { size = u64(buf, pos + 8); body = pos + 16; }
      else if (size === 0) { size = end - pos; }
      if (size < 8 || pos + size > end) return;          // corrupt — stop walking, keep what we have
      cb(t, body, pos + size, pos);
      pos += size;
   }
}

function findBox(buf, start, end, path) {
   let found = null;
   children(buf, start, end, (t, b, e) => {
      if (found || t !== path[0]) return;
      found = path.length === 1 ? [ b, e ] : findBox(buf, b, e, path.slice(1));
   });
   return found;
}

// parse one video trak's stbl into typed arrays; returns null if this trak isn't video
function parseTrak(buf, start, end) {
   const hdlr = findBox(buf, start, end, [ "mdia", "hdlr" ]);
   if (!hdlr || type4(buf, hdlr[0] + 8) !== "vide") return null;
   const mdhd = findBox(buf, start, end, [ "mdia", "mdhd" ]);
   const stbl = findBox(buf, start, end, [ "mdia", "minf", "stbl" ]);
   if (!mdhd || !stbl) return null;

   const v = buf[mdhd[0]];                               // mdhd version: 0 => 32-bit fields, 1 => 64-bit
   const timescale = v === 1 ? u32(buf, mdhd[0] + 20) : u32(buf, mdhd[0] + 12);
   if (!timescale) return null;

   const stts = findBox(buf, stbl[0], stbl[1], [ "stts" ]);
   const stsz = findBox(buf, stbl[0], stbl[1], [ "stsz" ]);
   if (!stts || !stsz) return null;

   // stsz: sample_size (uniform when != 0) + count, then per-sample sizes
   const uniform = u32(buf, stsz[0] + 4);
   const count = u32(buf, stsz[0] + 8);
   if (!count || count > 5e7) return null;
   const sizes = new Uint32Array(count);
   if (uniform) sizes.fill(uniform);
   else for (let i = 0; i < count; i++) sizes[i] = u32(buf, stsz[0] + 12 + i * 4);

   // stts: run-length (sample_count, sample_delta) pairs -> absolute decode time per sample
   const times = new Float64Array(count);
   const runs = u32(buf, stts[0] + 4);
   let i = 0, t = 0, o = stts[0] + 8;
   for (let r = 0; r < runs && i < count; r++, o += 8) {
      const n = u32(buf, o), delta = u32(buf, o + 4);
      for (let k = 0; k < n && i < count; k++) { times[i++] = t / timescale; t += delta; }
   }

   // stss: keyframe sample numbers (1-based). ABSENT stss means every sample is sync (spec) —
   // that carries no cut signal, which the detector accounts for.
   const sync = new Uint8Array(count);
   const stss = findBox(buf, stbl[0], stbl[1], [ "stss" ]);
   if (stss) {
      const n = u32(buf, stss[0] + 4);
      for (let k = 0; k < n; k++) {
         const s = u32(buf, stss[0] + 8 + k * 4) - 1;
         if (s >= 0 && s < count) sync[s] = 1;
      }
   } else sync.fill(1);

   return { times, sizes, sync, timescale, duration: t / timescale };
}

// indexMp4(readRange) — readRange(offset, length) -> Uint8Array (may be shorter at EOF).
// Walks top-level boxes (each costs one ~16-byte read; mdat is skipped by size, never fetched),
// fetches the moov whole, and returns the video track's sample index — or null.
export async function indexMp4(readRange) {
   try {
      let pos = 0;
      for (let hops = 0; hops < 64; hops++) {
         const head = await readRange(pos, HEAD);
         if (!head || head.length < 8) return null;      // EOF without a moov
         let size = u32(head, 0);
         const t = type4(head, 4);
         if (size === 1) { if (head.length < 16) return null; size = u64(head, 8); }
         else if (size === 0) size = Infinity;            // box runs to EOF
         if (hops === 0 && t !== "ftyp") return null;     // not an MP4 — bail before wasting reads
         if (t === "moov") {
            if (!isFinite(size) || size > MAX_MOOV) return null;
            const buf = await readRange(pos, size);
            if (!buf || buf.length < size) return null;
            if (findBox(buf, 8, size, [ "mvex" ])) return null;   // fragmented — sample tables live in moofs
            let out = null;
            children(buf, 8, size, (ct, b, e) => { if (!out && ct === "trak") out = parseTrak(buf, b, e); });
            return out && out.times.length > 8 ? out : null;
         }
         if (!isFinite(size)) return null;                // to-EOF box that isn't moov — nothing after it
         pos += size;
      }
      return null;
   } catch {
      return null;
   }
}

// the browser's readRange: same-origin Range fetch against the stream URL
export function fetchRange(url) {
   return async (offset, length) => {
      const r = await fetch(url, {
         headers: { Range: `bytes=${offset}-${offset + length - 1}` },
         credentials: "same-origin"
      });
      if (!r.ok && r.status !== 206) throw new Error(`range fetch ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
   };
}
