import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { recommend, feedbackEffect } from "../src/core/recommendationCore.mjs";

const [request, cards, memory] = await Promise.all([
  readJson("fixtures/demo-request.json"),
  readJson("fixtures/demo-cards.json"),
  readJson("fixtures/demo-memory.json")
]);

const fixedNow = new Date("2026-07-18T12:00:00.000Z");
const result = recommend(request, cards, memory, fixedNow);

assert.equal(result.rule_version, "filter_v1");
assert.equal(result.score_version, "score_v1");
assert.ok(result.selected_card, "expected one selected card");
assert.ok(result.top5.length > 0, "expected non-empty top5");
assert.ok(result.top5.length <= 5, "expected top5 length <= 5");
assert.equal(result.excluded_summary.outdoor, 1, "outdoor card should be excluded when go_out=false");
assert.equal(result.excluded_summary.status, 1, "pending card should be excluded");
assert.ok(!result.top5.some((item) => item.card_id === "preset_walk_001"), "outdoor walk should not be in top5");

const reroll = feedbackEffect("reroll");
assert.equal(reroll.long_term, "不形成长期不喜欢");

console.log(JSON.stringify({
  selected_card: result.selected_card.title,
  reasons: result.reason,
  top5: result.top5.map((item) => ({ card_id: item.card_id, score: item.score })),
  excluded_summary: result.excluded_summary
}, null, 2));

async function readJson(path) {
  return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
}
