import { recommend, type RecommendationRequest } from "../_shared/recommendationCore.ts";
import { loadCards, loadMemory, writeRecommendationLog } from "../_shared/repository.ts";
import { createRequestClient, createServiceClient, requestHeaders, requireUserId } from "../_shared/supabaseClient.ts";

type RecommendationPayload = RecommendationRequest;

const headers = requestHeaders();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  try {
    const payload = await req.json() as RecommendationPayload;
    validatePayload(payload);

    const supabase = createRequestClient(req);
    await requireUserId(supabase, payload.user_id);

    const serviceSupabase = createServiceClient();
    const cards = await loadCards(supabase, payload.user_id, payload.source_scope, serviceSupabase);
    const memory = await loadMemory(supabase, payload.user_id);

    const result = recommend(payload, cards, memory);
    try {
      await writeRecommendationLog(supabase, payload.user_id, payload.session_id, result);
    } catch (logError) {
      console.warn(logError instanceof Error ? logError.message : logError);
    }

    return json({
      ...result,
      ...toFrontendDrawShape(result)
    });
  } catch (error) {
    return json({
      error: "recommendation_failed",
      message: error instanceof Error ? error.message : "Unknown error"
    }, 400);
  }
});

function validatePayload(payload: RecommendationPayload) {
  if (!payload.user_id) throw new Error("user_id is required");
  if (!payload.session_id) throw new Error("session_id is required");
  if (!payload.context_input) throw new Error("context_input is required");
  if (!payload.source_scope) throw new Error("source_scope is required");
}

function toFrontendDrawShape(result: ReturnType<typeof recommend>) {
  if (!result.selected_card) {
    const availableTime = Number(result.context_snapshot.context_input.available_time ?? 0);
    const relaxSuggestions = availableTime >= 60
      ? [
        { field: "source_scope", label: "同时看看产品推荐", value: "both" },
        { field: "go_out", label: "允许室内外都可", value: true }
      ]
      : [
        { field: "available_time", label: "放宽可用时间", value: 60 },
        { field: "source_scope", label: "同时看看产品推荐", value: "both" }
      ];
    return {
      type: "no_candidate",
      message: availableTime >= 60
        ? "当前时间已经足够宽，可能是来源、出门范围或卡片冷却状态限制了候选。"
        : "当前条件下没有合适的娱乐卡，可以放宽时间、出门或预算限制。",
      excluded_counts: result.excluded_summary,
      relax_suggestions: relaxSuggestions
    };
  }

  const selectedScore = result.top5.find((item) => item.card_id === result.selected_card?.card_id);
  return {
    type: "draw_result",
    card: result.selected_card,
    reasons: result.reason,
    score: selectedScore?.score ?? 0,
    weight: 1,
    candidate_count: result.top5.length,
    candidate_version: `${result.rule_version}/${result.score_version}`
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers
  });
}
