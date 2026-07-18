import type { Card } from "../_shared/recommendationCore.ts";
import { listCards } from "../_shared/repository.ts";
import { createRequestClient, requestHeaders, requireUserId } from "../_shared/supabaseClient.ts";

const headers = requestHeaders();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  try {
    const url = new URL(req.url);
    const userId = url.searchParams.get("user_id") ?? "";
    if (!userId) throw new Error("user_id is required");

    const supabase = createRequestClient(req);
    await requireUserId(supabase, userId);

    const result = await listCards(supabase, userId, {
      source_scope: "preset",
      status: url.searchParams.get("status") ?? "active",
      eligible_only: url.searchParams.get("eligible_only") !== "false",
      q: url.searchParams.get("q"),
      limit: Number(url.searchParams.get("limit") ?? 60)
    });
    const cards = uniquePresetCards(result.cards);

    return json({
      version: "preset_v1",
      count: cards.length,
      coverage: buildCoverage(cards),
      duplicate_suppressed_count: result.cards.length - cards.length,
      cards
    });
  } catch (error) {
    return json({
      error: "preset_pool_failed",
      message: error instanceof Error ? error.message : "Unknown error"
    }, 400);
  }
});

function uniquePresetCards(cards: Card[]) {
  const seen = new Set<string>();
  return cards.filter((card) => {
    const key = card.title.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildCoverage(cards: Card[]) {
  return {
    by_category: countBy(cards, "content_category"),
    by_energy: countBy(cards, "energy_level"),
    by_indoor_outdoor: countBy(cards, "indoor_outdoor"),
    by_budget: countBy(cards, "budget_level"),
    duration: {
      short: cards.filter((card) => card.duration_max <= 45).length,
      medium: cards.filter((card) => card.duration_max > 45 && card.duration_max <= 120).length,
      long: cards.filter((card) => card.duration_max > 120).length
    }
  };
}

function countBy(cards: Card[], key: keyof Card) {
  return cards.reduce<Record<string, number>>((acc, card) => {
    const value = String(card[key] ?? "unknown");
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers });
}
