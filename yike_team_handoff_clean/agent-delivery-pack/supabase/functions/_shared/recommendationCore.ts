export type SourceType = "personal" | "preset";
export type SourceScope = "personal" | "preset" | "both";
export type EnergyLevel = "low" | "medium" | "high" | "unknown";
export type IndoorOutdoor = "indoor" | "outdoor" | "flexible" | "unknown";
export type PrepCost = "low" | "medium" | "high" | "unknown";
export type People = "solo" | "pair" | "group" | "flexible" | "unknown";
export type BudgetLevel = "free" | "low" | "medium" | "high" | "unknown";
export type CardStatus = "active" | "pending" | "cooling" | "archived" | "completed";
export type FeedbackAction = "accept" | "complete" | "reroll" | "not_suitable" | "later" | "dislike" | "save_preset";

export type Card = {
  card_id: string;
  user_id?: string | null;
  source_type: SourceType;
  origin_preset_id?: string | null;
  source_asset?: Record<string, unknown> | null;
  image_url?: string | null;
  image_path?: string | null;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  content_category: string;
  mood_tags?: string[];
  duration_min: number;
  duration_max: number;
  energy_level: EnergyLevel;
  indoor_outdoor: IndoorOutdoor;
  prep_cost: PrepCost;
  people?: People;
  budget_level?: BudgetLevel;
  location_type?: string;
  distance_level?: string;
  reservation_required?: boolean | null;
  ticket_required?: boolean | null;
  weather_dependency?: string;
  constraint_tags?: string[];
  status: CardStatus;
  eligible_for_draw: boolean;
  missing_fields: string[];
  cooling_until?: string | null;
  last_recommended_at?: string | null;
  recommend_count?: number;
  feedback_summary?: Record<string, number> | null;
  confidence?: Record<string, number> | null;
  rule_version?: string | null;
  score_version?: string | null;
  created_at: string;
  updated_at: string;
};

export type ContextInput = {
  available_time?: number | null;
  energy_level?: EnergyLevel | null;
  go_out?: boolean | null;
  people?: People | null;
  budget_level?: BudgetLevel | null;
  active_constraints?: string[];
  mode_preference?: string[];
};

export type RecommendationRequest = {
  user_id: string;
  session_id: string;
  context_input: ContextInput;
  source_scope: SourceScope;
  weather_context?: {
    weather?: string | null;
    temperature?: number | null;
    rain_probability?: number | null;
    weather_tags?: string[];
  } | null;
  location?: {
    city?: string | null;
    timezone?: string;
  } | null;
  seed?: number;
};

export type UserMemory = {
  user_id: string;
  preference_memory?: {
    category_weights?: Record<string, number>;
    duration_preference?: [number, number];
    indoor_outdoor_preference?: IndoorOutdoor | null;
  };
  behavior_memory?: Array<{
    card_id: string;
    action: FeedbackAction;
    created_at: string;
  }>;
  explicit_profile?: {
    default_budget_level?: BudgetLevel | null;
    dietary_constraints?: string[];
    travel_preference?: string | null;
    user_editable: true;
  };
};

export type RuntimeContext = {
  now: string;
  weekday: string;
  time_period: "morning" | "afternoon" | "evening" | "late_night";
  weather_tags: string[];
  weather?: string | null;
  temperature?: number | null;
  rain_probability?: number | null;
  context_input: Required<Pick<ContextInput, "active_constraints" | "mode_preference">> & ContextInput;
};

export type ExcludedCard = {
  card_id: string;
  reason: string;
};

export type ScoreBreakdown = {
  energy_score: number;
  time_fit_score: number;
  mood_preference_score: number;
  prep_cost_score: number;
  weather_time_score: number;
  feedback_score: number;
  freshness_score: number;
  source_score: number;
};

export type ScoredCard = {
  card: Card;
  card_id: string;
  score: number;
  score_breakdown: ScoreBreakdown;
};

export type RecommendationResult = {
  request_id: string;
  selected_card: Card | null;
  reason: string[];
  top5: Array<{
    card_id: string;
    score: number;
    score_breakdown: ScoreBreakdown;
  }>;
  excluded_summary: Record<string, number>;
  context_snapshot: RuntimeContext;
  rule_version: "filter_v1";
  score_version: "score_v1";
};

const ENERGY_RANK: Record<EnergyLevel, number> = { low: 1, medium: 2, high: 3, unknown: 2 };
const BUDGET_RANK: Record<BudgetLevel, number> = { free: 0, low: 1, medium: 2, high: 3, unknown: 2 };
const PREP_RANK: Record<PrepCost, number> = { low: 1, medium: 2, high: 3, unknown: 2 };

export function buildContext(request: RecommendationRequest, now = new Date()): RuntimeContext {
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

export function hardFilterCards(cards: Card[], context: RuntimeContext, sourceScope: SourceScope) {
  const eligible: Card[] = [];
  const excluded: ExcludedCard[] = [];
  const input = context.context_input;

  for (const card of cards) {
    const reason = getExclusionReason(card, input, sourceScope, context.now);
    if (reason) {
      excluded.push({ card_id: card.card_id, reason });
    } else {
      eligible.push(card);
    }
  }

  return { eligible, excluded, excluded_summary: summarizeExclusions(excluded) };
}

function getExclusionReason(card: Card, input: ContextInput, sourceScope: SourceScope, nowIso: string): string | null {
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

function peopleCompatible(current: People, required: People) {
  if (required === "flexible" || required === "unknown") return true;
  if (current === "flexible" || current === "unknown") return true;
  if (current === "solo") return required === "solo";
  if (current === "pair") return required === "solo" || required === "pair";
  return true;
}

function budgetTooHigh(current: BudgetLevel, required: BudgetLevel) {
  if (required === "unknown" || current === "unknown") return false;
  return BUDGET_RANK[required] > BUDGET_RANK[current];
}

function summarizeExclusions(excluded: ExcludedCard[]) {
  return excluded.reduce<Record<string, number>>((acc, item) => {
    acc[item.reason] = (acc[item.reason] ?? 0) + 1;
    return acc;
  }, {});
}

export function scoreCards(cards: Card[], context: RuntimeContext, memory: UserMemory | null, sourceScope: SourceScope): ScoredCard[] {
  return cards
    .map((card) => {
      const score_breakdown = scoreCard(card, context, memory, sourceScope);
      const score = Object.values(score_breakdown).reduce((sum, value) => sum + value, 0);
      return { card, card_id: card.card_id, score, score_breakdown };
    })
    .sort((a, b) => b.score - a.score);
}

export function scoreCard(card: Card, context: RuntimeContext, memory: UserMemory | null, sourceScope: SourceScope): ScoreBreakdown {
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

function energyScore(current: EnergyLevel, card: EnergyLevel) {
  if (current === "unknown" || card === "unknown") return 16;
  const distance = Math.abs(ENERGY_RANK[current] - ENERGY_RANK[card]);
  return Math.max(0, 25 - distance * 10);
}

function timeFitScore(available: number | null, min: number, max: number) {
  if (available == null) return 12;
  if (min > available) return 0;
  const midpoint = (min + max) / 2;
  const utilization = midpoint / Math.max(available, 1);
  if (utilization >= 0.55 && utilization <= 1) return 20;
  if (utilization >= 0.3) return 16;
  return 10;
}

function moodScore(preference: string[], tags: string[]) {
  if (preference.length === 0 || tags.length === 0) return 8;
  const matches = preference.filter((item) => tags.includes(item)).length;
  return Math.min(15, 8 + matches * 4);
}

function prepCostScore(currentEnergy: EnergyLevel, timePeriod: RuntimeContext["time_period"], prepCost: PrepCost) {
  let score = 10 - (PREP_RANK[prepCost] - 1) * 3;
  if (currentEnergy === "low" && prepCost === "high") score -= 4;
  if (timePeriod === "late_night" && prepCost !== "low") score -= 2;
  return Math.max(0, score);
}

function weatherTimeScore(context: RuntimeContext, card: Card) {
  let score = 0;
  if (context.time_period === "late_night" && (card.constraint_tags ?? []).includes("late_night_risk")) score -= 10;
  if (context.time_period === "evening" && card.prep_cost === "low") score += 4;
  if (context.weather_tags.includes("rain") && card.indoor_outdoor === "indoor") score += 6;
  if (context.weather_tags.includes("rain") && card.indoor_outdoor === "outdoor") score -= 12;
  return Math.max(-15, Math.min(10, score));
}

function feedbackScore(card: Card, memory: UserMemory | null) {
  let score = 0;
  const categoryWeight = memory?.preference_memory?.category_weights?.[card.content_category];
  if (categoryWeight != null) score += Math.max(-10, Math.min(10, categoryWeight * 10));
  const summary = card.feedback_summary ?? {};
  score += (summary.complete ?? 0) * 2;
  score += (summary.accept ?? 0) * 1;
  score -= (summary.dislike ?? 0) * 8;
  return Math.max(-20, Math.min(15, score));
}

function freshnessScore(card: Card, nowIso: string) {
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

function sourceScore(card: Card, sourceScope: SourceScope) {
  if (sourceScope === "personal" && card.source_type === "personal") return 5;
  if (sourceScope === "both" && card.source_type === "personal") return 3;
  return 0;
}

export function selectTopK(scored: ScoredCard[], k = 5) {
  return scored.slice(0, k);
}

export function weightedSample(topK: ScoredCard[], seed = 1): ScoredCard | null {
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

function seededRandom(seed: number) {
  let state = seed >>> 0;
  state += 0x6D2B79F5;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function generateReason(selected: ScoredCard | null, context: RuntimeContext) {
  if (!selected) return ["当前条件下没有合适的娱乐卡，可以放宽时间、出门或预算限制。"];
  const reasons: string[] = [];
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

export function recommend(request: RecommendationRequest, cards: Card[], memory: UserMemory | null, now = new Date()): RecommendationResult {
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

export function feedbackEffect(action: FeedbackAction) {
  const effects: Record<FeedbackAction, { short_term: string; long_term: string; cooldown_hours: number }> = {
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
