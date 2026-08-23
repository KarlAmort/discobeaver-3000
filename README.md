# 🦫 chapter-eleventy 🪩

`chapter-eleventy` turns every `/fast/vid` video longer than 60 minutes into a durable analysis document and a Tufte-rendered HTML page.

The npm package owns `/fast/vid`’s video viewer assets. `/fast/vid` requires this checkout through an absolute `file:` dependency, so `node_modules/chapter-eleventy` is a link to the one local `🦫` worktree.

`bundle install` resolves `discobeaver-3000` from `/fast/3000.amort.berlin`; that gem brings the shared Tufte renderer, fireservice client, and progress system with it.

```sh
npm install
bundle install
npm test
npm run build
```

`npm run build` asks `/fast/vid/bin/rails runner` for the live corpus, persists one Markdown and one derived HTML page per video under the ignored `analysis/`, and lets Eleventy assemble `site/`. Set `CHAPTER_LIMIT=1` for a complete one-video probe.
