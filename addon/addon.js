import { analyze, target } from "./scenes.js";
import { client } from "./fireservice.js";
import { replay } from "./replay.js";

const browser = globalThis.browser || globalThis.chrome;
const VERSION = browser.runtime.getManifest().version;
const controllers = new Map();
let current = null;
let enabled = true;
let mediaKeys = true;

const fire = client((records) => browser.runtime.sendMessage({ type: "fireservice", records }).catch(() => {}));

function stamp(seconds) {
   if (!Number.isFinite(seconds)) return "0:00";
   const minutes = Math.floor(seconds / 60);
   return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function title(video) {
   return video.getAttribute("aria-label") || video.getAttribute("title") || document.title || location.hostname;
}

function active() {
   const playing = [ ...controllers.keys() ].filter((video) => !video.paused && !video.ended);
   const candidates = playing.length ? playing : [ ...controllers.keys() ];
   return candidates.sort((left, right) => right.clientWidth * right.clientHeight - left.clientWidth * left.clientHeight)[0] || null;
}

function css() {
   return `
      :host{all:initial;color-scheme:light dark;position:fixed;z-index:2147483647;right:max(12px,env(safe-area-inset-right));bottom:max(12px,env(safe-area-inset-bottom));width:min(32rem,calc(100vw - 24px));font:13px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;color:#f7f8f1}
      aside{box-sizing:border-box;display:grid;gap:8px;padding:10px 12px;background:rgb(17 20 15 / .94);border:1px solid rgb(245 245 236 / .4);box-shadow:0 8px 32px rgb(0 0 0 / .4);backdrop-filter:blur(12px)}
      header{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:baseline}
      h1{overflow:hidden;margin:0;font:600 15px/1.2 ui-serif,Georgia,serif;text-overflow:ellipsis;white-space:nowrap}
      output{color:#c7cdbd;font-variant-numeric:tabular-nums}
      nav{display:grid;grid-template-columns:1fr 2fr 1fr auto;gap:6px}
      button{min-height:36px;margin:0;padding:5px 9px;color:inherit;background:#171b15;border:1px solid rgb(245 245 236 / .28);font:inherit;cursor:pointer}
      button:hover,button:focus-visible{border-color:#e06f61;outline:2px solid transparent}
      button[aria-pressed=true]{color:#11140f;background:#e06f61}
      @media(max-width:30rem){:host{left:12px;right:12px;width:auto}h1{font-size:13px}}
      @media(prefers-reduced-motion:no-preference){aside{animation:arrive .16s ease-out}@keyframes arrive{from{opacity:0;transform:translateY(8px)}}}
      @media print{:host{display:none}}
   `;
}

function moveHost(host, video) {
   const parent = document.fullscreenElement?.contains(video) ? document.fullscreenElement : document.documentElement;
   if (host.parentElement !== parent) parent.append(host);
}

function connect(video) {
   if (controllers.has(video)) return;
   const state = { chapters: [], abort: null, analyzing: false, replay: null };
   controllers.set(video, state);
   const select = () => {
      current = video;
      render();
   };
   video.addEventListener("play", () => {
      state.replay?.observe(video.currentTime, performance.now(), true);
      select();
   });
   video.addEventListener("loadedmetadata", () => {
      state.replay = replay(video.duration);
      select();
   });
   video.addEventListener("timeupdate", () => {
      state.replay?.observe(video.currentTime, performance.now(), !video.paused);
      if (video === current) render();
   });
   video.addEventListener("pause", () => state.replay?.observe(video.currentTime, performance.now(), false));
   video.addEventListener("emptied", () => {
      state.chapters = [];
      state.replay = null;
      state.abort?.abort();
   });
}

const host = document.createElement("discobeaver-player");
const shadow = host.attachShadow({ mode: "closed" });
const style = document.createElement("style");
style.textContent = css();
shadow.append(style);

function seek(direction) {
   if (!current) return;
   const state = controllers.get(current);
   const scenes = state.chapters.flatMap((chapter) => chapter.scenes);
   const next = scenes.length ? target(scenes, current.currentTime, direction) :
      Math.max(0, Math.min(current.duration || Infinity, current.currentTime + direction * 60));
   if (next != null) current.currentTime = next;
   fire.report(6, "player", "[client.info][player] scene seek", {
      direction,
      indexed: scenes.length > 0,
      "target.s": next ?? current.currentTime
   });
}

async function scan() {
   if (!current) return;
   const video = current;
   const state = controllers.get(video);
   if (state.analyzing) {
      state.abort.abort();
      return;
   }
   state.abort = new AbortController();
   state.analyzing = true;
   const started = performance.now();
   render("0%");
   try {
      state.chapters = await analyze(video, {
         signal: state.abort.signal,
         progress: (fraction) => render(`${Math.round(fraction * 100)}%`)
      });
      const elapsed = performance.now() - started;
      fire.report(elapsed > 30000 ? 4 : 6, "scene",
         elapsed > 30000 ? "[tripwire][scene] analysis exceeded 30000ms" : "[client.info][scene] analysis complete", {
            "actual.ms": Math.round(elapsed),
            "budget.ms": 30000,
            chapters: state.chapters.length,
            scenes: state.chapters.reduce((total, chapter) => total + chapter.scenes.length, 0)
         });
   } catch (error) {
      if (error.name !== "AbortError") fire.report(3, "scene", "[client.error][scene] analysis failed", { error: error.name });
   } finally {
      state.analyzing = false;
      render();
   }
}

function button(label, action, options = {}) {
   const control = document.createElement("button");
   control.type = "button";
   control.textContent = label;
   control.setAttribute("aria-label", options.name || label);
   if (options.pressed != null) control.setAttribute("aria-pressed", String(options.pressed));
   control.addEventListener("click", action);
   return control;
}

function render(progress = null) {
   if (!enabled || !current || !current.isConnected) {
      host.remove();
      return;
   }
   const state = controllers.get(current);
   const scenes = state.chapters.reduce((total, chapter) => total + chapter.scenes.length, 0);
   const replayed = state.replay?.peak();
   const panel = document.createElement("aside");
   const header = document.createElement("header");
   const heading = document.createElement("h1");
   heading.textContent = title(current);
   const output = document.createElement("output");
   output.textContent = `${stamp(current.currentTime)} / ${stamp(current.duration)}${replayed?.score > 0 ? ` · ↺ ${stamp(replayed.at)}` : ""}`;
   header.append(heading, output);
   const controls = document.createElement("nav");
   controls.setAttribute("aria-label", "Video scenes");
   controls.append(
      button("←", () => seek(-1), { name: "Previous scene" }),
      button(progress ?? (scenes ? `${state.chapters.length} chapters · ${scenes} scenes` : "chapters"), scan, {
         name: state.analyzing ? "Stop scene analysis" : "Analyze scenes",
         pressed: state.analyzing
      }),
      button("→", () => seek(1), { name: "Next scene" }),
      button("×", () => { enabled = false; host.remove(); }, { name: "Hide controls" })
   );
   panel.append(header, controls);
   shadow.replaceChildren(style, panel);
   moveHost(host, current);
}

function discover(root = document) {
   root.querySelectorAll?.("video").forEach(connect);
   current = active();
   render();
}

function installMediaKeys() {
   if (!navigator.mediaSession) return;
   [ [ "previoustrack", -1 ], [ "nexttrack", 1 ] ].forEach(([ action, direction ]) => {
      try { navigator.mediaSession.setActionHandler(action, mediaKeys ? () => seek(direction) : null); } catch {}
   });
}

browser.runtime.onMessage.addListener((message, _sender, respond) => {
   if (message?.type === "seek") seek(message.direction);
   if (message?.type === "scan") void scan();
   if (message?.type === "settings") {
      enabled = message.enabled;
      mediaKeys = message.mediaKeys;
      current = active();
      installMediaKeys();
      render();
   }
   if (message?.type === "status") respond({
      videos: controllers.size,
      active: !!current,
      chapters: current ? controllers.get(current).chapters.length : 0,
      scenes: current ? controllers.get(current).chapters.reduce((total, chapter) => total + chapter.scenes.length, 0) : 0,
      version: VERSION
   });
   return false;
});

browser.storage.local.get({ enabled: true, mediaKeys: true }).then((settings) => {
   enabled = settings.enabled;
   mediaKeys = settings.mediaKeys;
   discover();
   installMediaKeys();
});

new MutationObserver((changes) => {
   for (const change of changes) for (const node of change.addedNodes) if (node.nodeType === Node.ELEMENT_NODE) discover(node);
}).observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener("fullscreenchange", () => render());
async function replayKey(video) {
   const source = `${location.origin}${location.pathname}\n${video.currentSrc}`;
   const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
   return `replay.${Array.from(new Uint8Array(digest).slice(0, 12), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

window.addEventListener("pagehide", () => {
   for (const [ video, state ] of controllers) {
      if (!state.replay) continue;
      void replayKey(video).then((key) => browser.storage.local.set({ [key]: state.replay.snapshot() }));
   }
   void fire.flush();
}, { once: true });
