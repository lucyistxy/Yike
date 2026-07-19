const ENERGY_RANK = { low: 1, medium: 2, high: 3, unknown: 2 };
const BUDGET_RANK = { free: 0, low: 1, medium: 2, high: 3, unknown: 2 };
const PREP_RANK = { low: 1, medium: 2, high: 3, unknown: 2 };

export function buildContext(request, now = new Date()) {
  const hour = now.getHours();
  const time_period = hour < 12 ? "morning" : hour < 18 ? "afternoon" : hour < 23 ? "evening" : "late_night";
  return {
    now: now.toISOString(),
    weekday: now.toLocaleDateString("en-US", { weekday: "long", timeZone: request.location?.timezone ?? "UTC" }),
    time_period,
    weather_tags: request.weather_context?.weather_tags ?? [],
    weather: request.weather_context?.weather ?? null,
    temperature: request.weather_context?.temperature ?? null,
    rain_probability: request.weather_context?.rain_probability ?? null,
    context_input: {
      ...request.context_input,
      active_constraints: request.context_input.active_constraints ?? [],
      mode_preference: request.context_input.mode_preference ?? []
    }
  };
}

export function hardFilterCards(cards, context, sourceScope) {
  const eligible = [];
  const excluded = [];
  for (const card of cards) {
    const reason = getExclusionReason(card, context.context_input, sourceScope, context.now);
    if (reason) excluded.push({ card_id: card.card_id, reason });
    else eligible.push(card);
  }
  return { eligible, excluded, excluded_summary: summarizeExclusions(excluded) };
}

function getExclusionReason(card, input, sourceScope, nowIso) {
  if (sourceScope !== "both" && card.source_type !== sourceScope) return "source_scope";
  if (card.status === "archived" || card.status === "pending" || card.status === "completed") return "status";
  if (card.status === "cooling" && card.cooling_until && card.cooling_until > nowIso) return "cooling";
  if (!card.eligible_for_draw) return "not_eligible";
  if (input.available_time != null && card.duration_min > input.available_time) return "duration";
  if (input.go_out === false && card.indoor_outdoor === "outdoor") return "outdoor";
  if (input.people && !peopleCompatible(input.people, card.people ?? "flexible")) return "people";
  if (input.budget_level && budgetTooHigh(input.budget_level, card.budget_level ?? "unknown")) return "budget";
  if ((input.active_constraints ?? []).includes("no_long_standing") && (card.constraint_tags ?? []).includes("long_standing")) return "long_standing";
  if ((input.active_constraints ?? []).includes("no_transport") && (card.constraint_tags ?? []).includes("transport_needed")) return "transport";
  return null;
}

function peopleCompatible(current, required) {
  if (required === "flexible" || required === "unknown") return true;
  if (current === "flexible" || current === "unknown") return true;
  if (current === "solo") return required === "solo";
  if (current === "pair") return required === "solo" || required === "pair";
  return true;
}

function budgetTooHigh(current, required) {
  if (required === "unknown" || current === "unknown") return false;
  return BUDGET_RANK[required] > BUDGET_RANK[current];
}

function summarizeExclusions(excluded) {
  return excluded.reduce((acc, item) => {
    acc[item.reason] = (acc[item.reason] ?? 0) + 1;
    return acc;
  }, {});
}

export function scoreCards(cards, context, memory, sourceScope) {
  return cards
    .map((card) => {
      const score_breakdown = scoreCard(card, context, memory, sourceScope);
      const score = Object.values(score_breakdown).reduce((sum, value) => sum + value, 0);
      return { card, card_id: card.card_id, score, score_breakdown };
    })
    .sort((a, b) => b.score - a.score);
}

export function scoreCard(card, context, memory, sourceScope) {
  const input = context.context_input;
  return {
    energy_score: energyScore(input.energy_level ?? "unknown", card.energy_level),
    time_fit_score: timeFitScore(input.available_time ?? null, card.duration_min, card.duration_max),
    mood_preference_score: moodScore(input.mode_preference ?? [], card.mood_tags ?? []),
    prep_cost_score: prepCostScore(input.energy_level ?? "unknown", context.time_period, card.prep_cost),
    weather_time_score: weatherTimeScore(context, card),
    feedback_score: feedbackScore(card, memory),
    freshness_score: freshnessScore(card, context.now),
    source_score: sourceScore(card, sourceScope)
  };
}

function energyScore(current, card) {
  if (current === "unknown" || card === "unknown") return 16;
  const distance = Math.abs(ENERGY_RANK[current] - ENERGY_RANK[card]);
  return Math.max(0, 25 - distance * 10);
}

function timeFitScore(available, min, max) {
  if (available == null) return 12;
  if (min > available) return 0;
  const midpoint = (min + max) / 2;
  const utilization = midpoint / Math.max(available, 1);
  if (utilization >= 0.55 && utilization <= 1) return 20;
  if (utilization >= 0.3) return 16;
  return 10;
}

function moodScore(preference, tags) {
  if (preference.length === 0 || tags.length === 0) return 8;
  const matches = preference.filter((item) => tags.includes(item)).length;
  return Math.min(15, 8 + matches * 4);
}

function prepCostScore(currentEnergy, timePeriod, prepCost) {
  let score = 10 - (PREP_RANK[prepCost] - 1) * 3;
  if (currentEnergy === "low" && prepCost === "high") score -= 4;
  if (timePeriod === "late_night" && prepCost !== "low") score -= 2;
  return Math.max(0, score);
}

function weatherTimeScore(context, card) {
  let score = 0;
  if (context.time_period === "late_night" && (card.constraint_tags ?? []).includes("late_night_risk")) score -= 10;
  if (context.time_period === "evening" && card.prep_cost === "low") score += 4;
  if (context.weather_tags.includes("rain") && card.indoor_outdoor === "indoor") score += 6;
  if (context.weather_tags.includes("rain") && card.indoor_outdoor === "outdoor") score -= 12;
  return Math.max(-15, Math.min(10, score));
}

function feedbackScore(card, memory) {
  let score = 0;
  const categoryWeight = memory?.preference_memory?.category_weights?.[card.content_category];
  if (categoryWeight != null) score += Math.max(-10, Math.min(10, categoryWeight * 10));
  const summary = card.feedback_summary ?? {};
  score += (summary.complete ?? 0) * 2;
  score += (summary.accept ?? 0) * 1;
  score -= (summary.dislike ?? 0) * 8;
  return Math.max(-20, Math.min(15, score));
}

function freshnessScore(card, nowIso) {
  if (!card.last_recommended_at) return 8;
  const now = Date.parse(nowIso);
  const last = Date.parse(card.last_recommended_at);
  if (Number.isNaN(now) || Number.isNaN(last)) return 4;
  const days = (now - last) / 86400000;
  if (days < 1) return -25;
  if (days < 3) return -10;
  if (days > 30) return 10;
  return 4;
}

function sourceScore(card, sourceScope) {
  if (sourceScope === "personal" && card.source_type === "personal") return 5;
  if (sourceScope === "both" && card.source_type === "personal") return 3;
  return 0;
}

export function selectTopK(scored, k = 5) {
  return scored.slice(0, k);
}

export function weightedSample(topK, seed = 1) {
  if (topK.length === 0) return null;
  const minScore = Math.min(...topK.map((item) => item.score));
  const weights = topK.map((item) => Math.max(1, item.score - minScore + 1));
  const total = weights.reduce((sum, value) => sum + value, 0);
  let cursor = seededRandom(seed) * total;
  for (let index = 0; index < topK.length; index += 1) {
    cursor -= weights[index];
    if (cursor <= 0) return topK[index];
  }
  return topK[topK.length - 1];
}

function seededRandom(seed) {
  let state = seed >>> 0;
  state += 0x6D2B79F5;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function generateReason(selected, context) {
  if (!selected) return ["当前条件下没有合适的娱乐卡，可以放宽时间、出门或预算限制。"];
  const reasons = [];
  const input = context.context_input;
  if (input.available_time != null && selected.card.duration_max <= input.available_time) {
    reasons.push(`${input.available_time} 分钟内可以完成`);
  }
  if (input.go_out === false && selected.card.indoor_outdoor !== "outdoor") {
    reasons.push("符合这次不出门的选择");
  }
  if (input.energy_level === "low" && selected.card.prep_cost === "low") {
    reasons.push("低精力时也不需要太多准备");
  }
  if (reasons.length === 0) reasons.push("综合时间、精力和准备成本后排名靠前");
  return reasons.slice(0, 2);
}

export function recommend(request, cards, memory, now = new Date()) {
  const context = buildContext(request, now);
  const { eligible, excluded_summary } = hardFilterCards(cards, context, request.source_scope);
  const scored = scoreCards(eligible, context, memory, request.source_scope);
  const topK = selectTopK(scored, 5);
  const selected = weightedSample(topK, request.seed ?? 1);
  return {
    request_id: `rec_${request.session_id}`,
    selected_card: selected?.card ?? null,
    reason: generateReason(selected, context),
    top5: topK.map(({ card_id, score, score_breakdown }) => ({ card_id, score, score_breakdown })),
    excluded_summary,
    context_snapshot: context,
    rule_version: "filter_v1",
    score_version: "score_v1"
  };
}

export function feedbackEffect(action) {
  const effects = {
    accept: { short_term: "记录本次选择，本会话不重复推荐", long_term: "相关类别轻微加权", cooldown_hours: 0 },
    complete: { short_term: "记录完成和真实体验", long_term: "相似内容适度加权", cooldown_hours: 72 },
    reroll: { short_term: "当前卡本轮短降权", long_term: "不形成长期不喜欢", cooldown_hours: 2 },
    not_suitable: { short_term: "短期冷却当前卡", long_term: "不形成长期不喜欢", cooldown_hours: 12 },
    later: { short_term: "设置较长冷却", long_term: "保留兴趣", cooldown_hours: 72 },
    dislike: { short_term: "强降权或归档", long_term: "更新负偏好且支持撤销", cooldown_hours: 720 },
    save_preset: { short_term: "复制为个人卡", long_term: "保留 origin_preset_id", cooldown_hours: 0 }
  };
  return effects[action];
}
