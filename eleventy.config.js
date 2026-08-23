import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SYSTEM = resolve(ROOT, "../tuf-tuf-tufte-3000");

export default function (eleventyConfig) {
   eleventyConfig.addPassthroughCopy("analysis/**/*.html");
   eleventyConfig.addPassthroughCopy("analysis/**/*.md");
   eleventyConfig.addPassthroughCopy("analysis/**/*.json");
   eleventyConfig.on("eleventy.after", ({ directories }) => {
      const link = resolve(directories.output, "tuf-tuf-tufte-3000");
      mkdirSync(directories.output, { recursive: true });
      if (existsSync(link)) rmSync(link, { recursive: true, force: true });
      symlinkSync(SYSTEM, link, "dir");
   });
   return {
      dir: { input: "analysis", output: "site" },
      htmlTemplateEngine: false,
      markdownTemplateEngine: false,
      templateFormats: [ "html" ]
   };
}
