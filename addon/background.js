const browser = globalThis.browser || globalThis.chrome;
const ENDPOINT = "https://3000.amort.berlin/fireservice/report";
const VERSION = browser.runtime.getManifest().version;

function valid(record) {
   return record && typeof record.message === "string" && record.message.length > 0 &&
      typeof record.subsystem === "string" && Number.isInteger(record.prio);
}

async function submit(records) {
   const safe = records.filter(valid).map((record) => ({
      ...record,
      ident: "discobeaver-3000",
      fields: { ...record.fields, version: VERSION }
   }));
   if (!safe.length) return;
   const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ records: safe }),
      credentials: "omit"
   });
   if (response.status !== 204) throw new Error(`fireservice ${response.status}`);
}

browser.runtime.onMessage.addListener((message, _sender, respond) => {
   if (message?.type !== "fireservice" || !Array.isArray(message.records)) return false;
   submit(message.records).then(() => respond({ accepted: message.records.length }), (error) => {
      console.error("[client.error][fireservice] submission failed", error.name);
      respond({ accepted: 0 });
   });
   return true;
});

browser.commands.onCommand.addListener(async (command) => {
   const [ tab ] = await browser.tabs.query({ active: true, currentWindow: true });
   if (!tab?.id) return;
   const direction = command === "previous-scene" ? -1 : command === "next-scene" ? 1 : 0;
   if (direction) browser.tabs.sendMessage(tab.id, { type: "seek", direction }).catch(() => {});
});

browser.runtime.onInstalled.addListener((details) => {
   void submit([ {
      at: new Date().toISOString(),
      prio: 6,
      subsystem: "addon",
      message: `[client.info][addon] ${details.reason}`,
      fields: {}
   } ]).catch(() => {});
});
