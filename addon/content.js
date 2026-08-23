(function () {
   "use strict";

   const browser = globalThis.browser || globalThis.chrome;
   import(browser.runtime.getURL("addon.js")).catch((error) => {
      browser.runtime.sendMessage({
         type: "fireservice",
         records: [ {
            at: new Date().toISOString(),
            prio: 3,
            subsystem: "addon",
            message: "[client.error][addon] module failed",
            fields: { error: error?.name || "Error", version: browser.runtime.getManifest().version }
         } ]
      }).catch(() => {});
   });
}());
