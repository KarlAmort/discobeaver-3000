import test from "node:test";
import assert from "node:assert/strict";
import { parse, buildRequest, primarySort, suggest, facetField, KEYS, sourceText, withSource, withoutSource, live } from "../../../app/javascript/video/query.js";

test("Qwen 4B is the default embedding model", () => {
   const model = parse("sunset beach");
   assert.equal(model.model, "qwen-4b");
   assert.equal(buildRequest(model).params.model, "qwen-4b");
});

test("search strategies expose their actual ranking signal", () => {
   assert.deepEqual(primarySort(parse("sunset beach")), { field: "embedding", dir: "asc" });
   assert.deepEqual(primarySort(parse("sunset beach sort:top")), { field: "predicted", dir: "desc" });
   assert.deepEqual(primarySort(parse("sunset beach sort:unique")), { field: "novelty", dir: "desc" });
   assert.deepEqual(primarySort(parse("sunset beach sort:learn")), { field: "uncertainty", dir: "desc" });
   assert.equal(buildRequest(parse("sunset beach sort:unique")).params.strategy, "informative");
   assert.equal(buildRequest(parse("sunset beach sort:learn")).params.strategy, "explore");
});

test("limit bounds the embedding neighborhood before a strategy ranks it", () => {
   const request = buildRequest(parse("sunset beach limit:20 sort:top"));
   assert.equal(request.action, "recommend");
   assert.equal(request.params.neighborhood, 20);
   assert.equal(request.params.strategy, "best");
});

test("model selects each available embedding", () => {
   for (const name of [ "qwen-0.6b", "qwen-4b", "e5-sparse" ]) {
      const request = buildRequest(parse(`sunset model:${name}`));
      assert.equal(request.params.model, name);
      assert.equal(request.params.q, "sunset");
   }
});

test("model autocomplete exposes every embedding", () => {
   assert.equal(KEYS.includes("model"), true);
   assert.deepEqual(suggest("model:", 6).items.map(item => item.insert), [ "model:qwen-0.6b", "model:qwen-4b", "model:e5-sparse" ]);
});

test("live updates never start a query embedding", () => {
   assert.equal(live("candid"), false);
   assert.equal(live("candid footage source:tube8"), false);
   assert.equal(live("candid footage sort:top"), false);
   assert.equal(live('"candid footage"'), true);
   assert.equal(live("source:tube8 rating:>7"), true);
});

test("source accepts multiple inclusions and exclusions", () => {
   const model = parse("source:archive,tube8,!local,!youtube");
   assert.deepEqual(model.source, { include: [ "archive", "tube8" ], exclude: [ "local", "youtube" ] });
   assert.deepEqual(buildRequest(model).params.filters.enums.provider, { include: [ "archive", "tube8" ], exclude: [ "local", "youtube" ], invert: false });
   assert.equal(sourceText(model.source), "archive,tube8,!local,!youtube");
});

test("resolution supports path-route relations while retaining bare minimum semantics", () => {
   assert.deepEqual(parse("resolution:1080").filters.ranges.resolution_pixels, { from: 1080 });
   assert.deepEqual(parse("resolution:>1080").filters.ranges.resolution_pixels, { from: 1080 });
   assert.deepEqual(parse("resolution:<1080").filters.ranges.resolution_pixels, { to: 1080 });
   assert.deepEqual(parse("resolution:=1080").filters.ranges.resolution_pixels, { from: 1080, to: 1080 });
});

test("source autocomplete teaches comma inclusion and bang exclusion", () => {
   const facet = { field: "provider", entropy: 1.375, values: [ { value: "tube8", count: 7 } ] };
   const parameter = suggest("sour", 4, [ facet ], { provider: "fresh" }).items.find((item) => item.insert === "source:");
   assert.match(parameter.hint, /! excludes/);
   assert.equal(parameter.entropy, 1.375);
   assert.equal(parameter.inactive, false);
   const item = suggest("source:t", 8, [ facet ], { provider: "pending" }).items[0];
   assert.equal(item.insert, "source:tube8");
   assert.equal(item.count, 7);
   assert.equal(item.inactive, true);
   assert.match(item.hint, /comma adds/);
});

test("numeric options expose histogram frequencies and entropy", () => {
   const facets = [ { field: "duration", entropy: 0.75, bins: [
      { x0: 0, x1: 60, count: 4 }, { x0: 60, x1: 600, count: 6 }
   ] } ];
   const option = suggest("len:", 4, facets, { duration: "fresh" }).items.find(item => item.insert === "len:>=60");
   assert.equal(option.count, 6);
   assert.equal(option.entropy, 0.75);
   assert.equal(option.inactive, false);
});

test("facet values declare their data dependency only after the colon", () => {
   assert.equal(facetField("source", 6), null);
   assert.equal(facetField("source:", 7), "provider");
   assert.equal(facetField("sunset tag:bea", 14), "tag");
   assert.equal(facetField("lang:de", 7), "language");
   assert.equal(facetField('"source:tube8"', 10), null);
   assert.equal(facetField("sort:", 5), null);
});

test("autocomplete omits facets without usable catalog data", () => {
   for (const key of [ "category", "channel", "uploader", "likes", "comments", "favs", "fps", "size",
                       "people", "men", "women", "vcodec", "acodec", "availability", "live", "facemen",
                       "facewomen", "age", "agemin", "agemax" ]) {
      assert.equal(KEYS.includes(key), false, key);
      assert.deepEqual(suggest(`${key}:`, key.length + 1).items, [], key);
   }
});

test("sort autocomplete contains only working data-backed orderings", () => {
   assert.deepEqual(suggest("sort:", 5).items.map((item) => item.insert), [
      "sort:embedding", "sort:top", "sort:unique", "sort:learn", "sort:rating", "sort:plays", "sort:views",
      "sort:len", "sort:duration", "sort:width", "sort:height", "sort:added", "sort:published", "sort:title"
   ]);
});

test("boolean autocomplete offers only the operative exclusion form", () => {
   assert.deepEqual(suggest("seen:", 5).items.map((item) => item.insert), [ "seen:no" ]);
   assert.deepEqual(suggest("rated:", 6).items.map((item) => item.insert), [ "rated:no" ]);
});

test("remembered source is applied only when the command has none", () => {
   const source = { include: [ "archive" ], exclude: [ "local" ] };
   assert.deepEqual(withSource(parse("sunset"), source).filters.enums.provider, { include: [ "archive" ], exclude: [ "local" ], invert: false });
   assert.deepEqual(withSource(parse("source:tube8"), source).filters.enums.provider.include, [ "tube8" ]);
   assert.equal(withoutSource("sunset source:archive,!local sort:rating"), "sunset sort:rating");
});
