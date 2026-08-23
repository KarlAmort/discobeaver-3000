const browser = globalThis.browser || globalThis.chrome;
const subject = document.querySelector("#subject");
const state = document.querySelector("#state");
const enabledControl = document.querySelector("#enabled");
const keysControl = document.querySelector("#keys");
const scanControl = document.querySelector("#scan");
const [ tab ] = await browser.tabs.query({ active: true, currentWindow: true });
let settings = await browser.storage.local.get({ enabled: true, mediaKeys: true });

function send(message) {
   return tab?.id ? browser.tabs.sendMessage(tab.id, message).catch(() => null) : Promise.resolve(null);
}

function draw(status) {
   let host = "no page";
   try { host = new URL(tab.url).hostname || "local media"; } catch {}
   subject.textContent = host;
   document.title = host;
   state.value = status ? `${status.videos} video${status.videos === 1 ? "" : "s"} · ${status.chapters} chapters · ${status.scenes} scenes` : "unavailable";
   enabledControl.textContent = settings.enabled ? "disable" : "enable";
   enabledControl.setAttribute("aria-pressed", String(settings.enabled));
   keysControl.textContent = settings.mediaKeys ? "disconnect media keys" : "connect media keys";
   keysControl.setAttribute("aria-pressed", String(settings.mediaKeys));
   scanControl.disabled = !settings.enabled || !status?.active;
}

async function update(name) {
   settings[name] = !settings[name];
   await browser.storage.local.set({ [name]: settings[name] });
   await send({ type: "settings", ...settings });
   draw(await send({ type: "status" }));
}

enabledControl.addEventListener("click", () => void update("enabled"));
keysControl.addEventListener("click", () => void update("mediaKeys"));
scanControl.addEventListener("click", async () => {
   await send({ type: "scan" });
   window.close();
});

draw(await send({ type: "status" }));
