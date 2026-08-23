// just: "the shared test fixture: a tiny synthetic MP4 with KNOWN hard cuts, generated with the
//        box's ffmpeg on first use (no binary in the repo). Five segments — A B A B C — so the
//        A/B/A/B case exists in the actual bitstream: cuts at 3, 5, 7 and 9 seconds, 13s total.
//        x264's default scene-cut keyframe placement + the size spikes at each cut are exactly
//        the signals video/scenes/{mp4,detect}.js are built on."
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readSync, closeSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
export const FIXTURE = join(root, "tmp", "scenes-fixture.mp4");
export const CUTS = [ 3, 5, 7, 9 ];
export const DURATION = 13;

// A=testsrc2, B=smptebars, C=mandelbrot — A and B repeat (same "camera"), C is genuinely new
const SEGS = [
   [ "testsrc2=duration=3:size=160x90:rate=15", 3 ],
   [ "smptebars=duration=2:size=160x90:rate=15", 2 ],
   [ "testsrc2=duration=2:size=160x90:rate=15", 2 ],
   [ "smptebars=duration=2:size=160x90:rate=15", 2 ],
   [ "mandelbrot=size=160x90:rate=15", 4 ]
];

export function ensureFixture() {
   if (existsSync(FIXTURE)) return FIXTURE;
   mkdirSync(dirname(FIXTURE), { recursive: true });
   const args = [];
   for (const [ src, secs ] of SEGS) args.push("-f", "lavfi", "-t", String(secs), "-i", src);
   const chain = SEGS.map((_, i) => `[${i}:v]`).join("") + `concat=n=${SEGS.length}:v=1:a=0[v]`;
   args.push("-filter_complex", chain, "-map", "[v]",
             "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-y", FIXTURE);
   execFileSync("ffmpeg", args, { stdio: "pipe" });
   return FIXTURE;
}

// the node stand-in for the browser's Range fetch: read [offset, offset+length) from the file
export function fileRange(path) {
   return async (offset, length) => {
      const fd = openSync(path, "r");
      try {
         const buf = new Uint8Array(length);
         const n = readSync(fd, buf, 0, length, offset);
         return buf.subarray(0, n);
      } finally { closeSync(fd); }
   };
}
