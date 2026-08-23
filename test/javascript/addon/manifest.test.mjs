import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../../addon");
const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));

test("one Manifest V3 package targets Safari and Chrome", () => {
   assert.equal(manifest.manifest_version, 3);
   assert.equal(manifest.name, "🦫-3000->🪩");
   assert.equal(manifest.author, "🦫-3000->🪩");
   assert.equal(manifest.background.type, "module");
   assert(manifest.host_permissions.includes("https://*/*"));
});

test("every declared package resource exists", async () => {
   const files = [
      manifest.action.default_popup,
      manifest.background.service_worker,
      ...manifest.content_scripts.flatMap((script) => script.js),
      ...manifest.web_accessible_resources.flatMap((entry) => entry.resources),
      ...Object.values(manifest.icons)
   ];
   await Promise.all(files.map(async (file) => assert((await readFile(join(root, file))).length > 0, file)));
});

test("the popup subject is live rather than branded static text", async () => {
   const popup = await readFile(join(root, "popup.html"), "utf8");
   assert.match(popup, /<h1 id="subject"><\/h1>/);
   assert.doesNotMatch(popup, /discobeaver|3000|player/i);
});
