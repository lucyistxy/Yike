import type { FeedbackAction } from "./recommendationCore.ts";

type SupabaseClient = any;

type CardRow = {
  card_id: string;
  title: string;
  content_category: string;
  mood_tags?: string[] | null;
  duration_min?: number | null;
  duration_max?: number | null;
  energy_level?: string | null;
  indoor_outdoor?: string | null;
  prep_cost?: string | null;
  source_type?: string | null;
};

type FeedbackRow = {
  card_id: string;
  action: FeedbackAction;
  optional_reason?: string | null;
  created_at: string;
};

type OverrideRow = {
  item_key: string;
  action: "keep" | "clear";
  note?: string | null;
  updated_at?: string | null;
};

export type MemoryItemAction = "keep" | "view" | "clear";

export type MemorySummary = {
  user_id: string;
  generated_at: string;
  feedback_calendar: {
    year: number;
    month: number;
    month_label: string;
    current_day: number;
    active_days: number[];
    pearl_count: number;
    feedback_count: number;
    positive_count: number;
    completed_count: number;
  };
  long_term_preference: {
    headline: string;
    tags: Array<{ label: string; value: string }>;
    evidence: string;
  };
  memory_items: Array<{
    item_key: string;
    title: string;
    description: string;
    source: string;
    action_state: "active" | "kept" | "cleared";
    evidence_count: number;
    last_seen_at: string | null;
    detail: Record<string, unknown>;
  }>;
  non_persistent: Array<{ label: string; reason: string }>;
};

const positiveActions = new Set(["accept", "complete", "save_preset"]);
const preferenceLabels: Record<string, string> = {
  indoor: "室内",
  outdoor: "室外",
  flexible: "均可",
  unknown: "未定",
  low: "低",
  medium: "中",
  high: "高"
};

const categoryLabels: Record<string, string> = {
  book: "书籍",
  movie: "电影",
  series: "剧集",
  food: "餐饮",
  restaurant: "餐饮",
  cafe: "餐饮",
  exhibition: "展览",
  game: "游戏",
  craft: "手作",
  walk: "散步",
  other: "其他"
};

export async function buildMemorySummary(supabase: SupabaseClient, userId: string): Promise<MemorySummary> {
  const generatedAt = new Date();
  const [{ data: memory, error: memoryError }, { data: feedback, error: feedbackError }, { data: overrides, error: overridesError }] = await Promise.all([
    supabase
      .from("user_memory")
      .select("preference_memory, explicit_profile, updated_at")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("feedback_events")
      .select("card_id, action, optional_reason, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("memory_item_overrides")
      .select("item_key, action, note, updated_at")
      .eq("user_id", userId)
  ]);

  if (memoryError) throw new Error(`load_memory_failed: ${memoryError.message}`);
  if (feedbackError) throw new Error(`load_feedback_events_failed: ${feedbackError.message}`);
  if (overridesError) throw new Error(`load_memory_overrides_failed: ${overridesError.message}`);

  const events = (feedback ?? []) as FeedbackRow[];
  const cards = await loadFeedbackCards(supabase, events);
  const overrideMap = new Map((overrides ?? [] as OverrideRow[]).map((item: OverrideRow) => [item.item_key, item]));
  const preferenceMemory = readRecord(memory?.preference_memory);
  const explicitProfile = readRecord(memory?.explicit_profile);

  return {
    user_id: userId,
    generated_at: generatedAt.toISOString(),
    feedback_calendar: buildFeedbackCalendar(generatedAt, events),
    long_term_preference: buildLongTermPreference(explicitProfile, preferenceMemory, events, cards),
    memory_items: buildMemoryItems(explicitProfile, events, cards, overrideMap),
    non_persistent: [
      { label: "经期不适", reason: "只在当次会话中作为约束使用，不沉淀为长期健康标签" },
      { label: "不久站", reason: "只影响本次硬过滤和解释，不默认长期保存" },
      { label: "不需妆容", reason: "只用于当次出门准备成本判断" }
    ]
  };
}

export async function updateMemoryItemOverride(
  supabase: SupabaseClient,
  userId: string,
  itemKey: string,
  action: MemoryItemAction
) {
  if (!itemKey) throw new Error("item_key is required");
  if (!["keep", "view", "clear"].includes(action)) throw new Error("unsupported memory item action");
  if (action === "view") return { item_key: itemKey, action: "view" as const, updated: false };

  const { error } = await supabase
    .from("memory_item_overrides")
    .upsert({
      user_id: userId,
      item_key: itemKey,
      action,
      updated_at: new Date().toISOString()
    }, { onConflict: "user_id,item_key" });

  if (error) throw new Error(`update_memory_item_failed: ${error.message}`);
  return { item_key: itemKey, action, updated: true };
}

async function loadFeedbackCards(supabase: SupabaseClient, events: FeedbackRow[]) {
  const cardIds = [...new Set(events.map((event) => event.card_id).filter(Boolean))];
  if (cardIds.length === 0) return new Map<string, CardRow>();

  const { data, error } = await supabase
    .from("entertainment_cards")
    .select("card_id, title, content_category, mood_tags, duration_min, duration_max, energy_level, indoor_outdoor, prep_cost, source_type")
    .in("card_id", cardIds);

  if (error) throw new Error(`load_memory_cards_failed: ${error.message}`);
  return new Map(((data ?? []) as CardRow[]).map((card) => [card.card_id, card]));
}

function buildFeedbackCalendar(now: Date, events: FeedbackRow[]) {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const monthEvents = events.filter((event) => event.created_at.startsWith(monthKey));
  const positiveMonthEvents = monthEvents.filter((event) => positiveActions.has(event.action));
  const activeDays = [...new Set(positiveMonthEvents.map((event) => Number(event.created_at.slice(8, 10))).filter((day) => day > 0))]
    .sort((a, b) => a - b);

  return {
    year,
    month,
    month_label: `${year} 年 ${month} 月`,
    current_day: now.getDate(),
    active_days: activeDays,
    pearl_count: positiveMonthEvents.length,
    feedback_count: monthEvents.length,
    positive_count: positiveMonthEvents.length,
    completed_count: monthEvents.filter((event) => event.action === "complete").length
  };
}

function buildLongTermPreference(
  explicitProfile: Record<string, unknown>,
  preferenceMemory: Record<string, unknown>,
  events: FeedbackRow[],
  cards: Map<string, CardRow>
) {
  const positiveCards = events
    .filter((event) => positiveActions.has(event.action))
    .map((event) => cards.get(event.card_id))
    .filter(Boolean) as CardRow[];

  const indoorOutdoor = mostCommon(positiveCards.map((card) => card.indoor_outdoor), explicitProfile.indoor_outdoor_preference, "indoor");
  const prepCost = mostCommon(positiveCards.map((card) => card.prep_cost), explicitProfile.default_prep_cost, "low");
  const duration = inferDuration(explicitProfile, preferenceMemory, positiveCards);
  const topCategory = mostCommon(positiveCards.map((card) => card.content_category), topWeightedCategory(preferenceMemory), null);

  const headline = `${label(indoorOutdoor)} · ${label(prepCost)}准备 · ${duration} 分钟`;
  const tags = [
    { label: "活动场景", value: label(indoorOutdoor) },
    { label: "准备程度", value: label(prepCost) },
    { label: "可用时长", value: `${duration} 分钟` }
  ];
  if (topCategory) tags.push({ label: "常选品类", value: categoryLabel(topCategory) });

  return {
    headline,
    tags,
    evidence: positiveCards.length > 0 ? `来自 ${positiveCards.length} 次主动选择或完成记录` : "来自初始偏好，等待更多反馈校准"
  };
}

function buildMemoryItems(
  explicitProfile: Record<string, unknown>,
  events: FeedbackRow[],
  cards: Map<string, CardRow>,
  overrideMap: Map<string, OverrideRow>
) {
  const positiveEvents = events.filter((event) => positiveActions.has(event.action));
  const negativeEvents = events.filter((event) => ["reroll", "not_suitable", "dislike", "later"].includes(event.action));
  const positiveCards = positiveEvents.map((event) => ({ event, card: cards.get(event.card_id) })).filter((item) => item.card) as Array<{ event: FeedbackRow; card: CardRow }>;
  const negativeCards = negativeEvents.map((event) => ({ event, card: cards.get(event.card_id) })).filter((item) => item.card) as Array<{ event: FeedbackRow; card: CardRow }>;

  const candidates = [
    buildIndoorMemory(explicitProfile, positiveCards),
    buildPrepMemory(positiveCards, negativeCards),
    buildQuietMemory(positiveCards),
    buildDurationMemory(explicitProfile, positiveCards),
    buildCategoryMemory(positiveCards),
    buildPresetMemory(positiveCards)
  ].filter(Boolean) as ReturnType<typeof buildIndoorMemory>[];

  return candidates
    .map((item) => applyOverride(item, overrideMap))
    .filter((item) => item.action_state !== "cleared")
    .sort((a, b) => Number(b.action_state === "kept") - Number(a.action_state === "kept") || b.evidence_count - a.evidence_count)
    .slice(0, 3);
}

function buildIndoorMemory(explicitProfile: Record<string, unknown>, items: Array<{ event: FeedbackRow; card: CardRow }>) {
  const indoorItems = items.filter(({ card }) => card.indoor_outdoor === "indoor");
  const profileIndoor = explicitProfile.indoor_outdoor_preference === "indoor";
  if (indoorItems.length === 0 && !profileIndoor) return null;
  const count = Math.max(indoorItems.length, profileIndoor ? 1 : 0);
  return memoryItem("pref_indoor", "更常选择室内活动", "室内内容会在条件合适时略微前置，但仍会保留室外探索。", count, indoorItems[0]?.event.created_at ?? null, {
    source: indoorItems.length > 0 ? `来自 ${indoorItems.length} 次主动选择` : "来自初始偏好",
    detail: { indoor_positive_count: indoorItems.length, from_profile: profileIndoor }
  });
}

function buildPrepMemory(positiveItems: Array<{ event: FeedbackRow; card: CardRow }>, negativeItems: Array<{ event: FeedbackRow; card: CardRow }>) {
  const lowPrep = positiveItems.filter(({ card }) => card.prep_cost === "low");
  const highPrepNegative = negativeItems.filter(({ card }) => card.prep_cost === "high" || card.prep_cost === "medium");
  if (lowPrep.length + highPrepNegative.length === 0) return null;
  const count = lowPrep.length + highPrepNegative.length;
  return memoryItem("pref_low_prep", "暂时减少高准备内容", "准备成本较低的卡会更容易进入 Top5，高准备内容不会被永久删除。", count, lowPrep[0]?.event.created_at ?? highPrepNegative[0]?.event.created_at ?? null, {
    source: highPrepNegative.length > 0 ? `来自 ${highPrepNegative.length} 次换卡/不合适反馈` : `来自 ${lowPrep.length} 次低准备选择`,
    detail: { low_prep_positive_count: lowPrep.length, high_prep_negative_count: highPrepNegative.length }
  });
}

function buildQuietMemory(items: Array<{ event: FeedbackRow; card: CardRow }>) {
  const quietItems = items.filter(({ card }) => {
    const tags = card.mood_tags ?? [];
    return tags.some((tag) => ["quiet", "solo", "healing", "calm", "night"].includes(tag)) || card.energy_level === "low";
  });
  if (quietItems.length === 0) return null;
  return memoryItem("pref_quiet", "偏爱安静独处", "低精力、安静、可独处的内容会在疲惫时更容易被推荐。", quietItems.length, quietItems[0]?.event.created_at ?? null, {
    source: `来自 ${quietItems.length} 次低精力/安静选择`,
    detail: { quiet_positive_count: quietItems.length }
  });
}

function buildDurationMemory(explicitProfile: Record<string, unknown>, items: Array<{ event: FeedbackRow; card: CardRow }>) {
  const duration = inferDuration(explicitProfile, {}, items.map((item) => item.card));
  if (!duration) return null;
  const matched = items.filter(({ card }) => Number(card.duration_max ?? card.duration_min ?? 999) <= duration + 15);
  return memoryItem("pref_duration", `常选择 ${duration} 分钟内可完成的内容`, "抽卡时会优先避免超出当前可用时间的内容。", Math.max(matched.length, explicitProfile.default_available_time ? 1 : 0), matched[0]?.event.created_at ?? null, {
    source: matched.length > 0 ? `来自 ${matched.length} 次时长匹配记录` : "来自初始可用时长",
    detail: { preferred_duration_min: duration, matched_count: matched.length }
  });
}

function buildCategoryMemory(items: Array<{ event: FeedbackRow; card: CardRow }>) {
  const category = mostCommon(items.map(({ card }) => card.content_category), null, null);
  if (!category) return null;
  const matched = items.filter(({ card }) => card.content_category === category);
  return memoryItem(`pref_category_${category}`, `更常选择${categoryLabel(category)}内容`, "同类内容会轻微加权，但不会挤掉其它品类。", matched.length, matched[0]?.event.created_at ?? null, {
    source: `来自 ${matched.length} 次同类反馈`,
    detail: { category, category_label: categoryLabel(category), count: matched.length }
  });
}

function buildPresetMemory(items: Array<{ event: FeedbackRow; card: CardRow }>) {
  const presetItems = items.filter(({ card }) => card.source_type === "preset");
  if (presetItems.length === 0) return null;
  return memoryItem("pref_preset_pool", "产品推荐也会参与校准", "保存或完成预置卡后，相似预置内容会被轻量加权。", presetItems.length, presetItems[0]?.event.created_at ?? null, {
    source: `来自 ${presetItems.length} 次产品推荐反馈`,
    detail: { preset_positive_count: presetItems.length }
  });
}

function memoryItem(
  itemKey: string,
  title: string,
  description: string,
  evidenceCount: number,
  lastSeenAt: string | null,
  extra: { source: string; detail: Record<string, unknown> }
) {
  return {
    item_key: itemKey,
    title,
    description,
    source: extra.source,
    action_state: "active" as const,
    evidence_count: evidenceCount,
    last_seen_at: lastSeenAt,
    detail: extra.detail
  };
}

function applyOverride<T extends ReturnType<typeof memoryItem>>(item: T, overrideMap: Map<string, OverrideRow>) {
  const override = overrideMap.get(item.item_key);
  if (!override) return item;
  return {
    ...item,
    action_state: override.action === "keep" ? "kept" as const : "cleared" as const,
    detail: { ...item.detail, override_updated_at: override.updated_at ?? null }
  };
}

function inferDuration(explicitProfile: Record<string, unknown>, preferenceMemory: Record<string, unknown>, cards: CardRow[]) {
  const explicit = Number(explicitProfile.default_available_time);
  if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit);

  const durationPreference = preferenceMemory.duration_preference;
  if (Array.isArray(durationPreference)) {
    const max = Number(durationPreference[1] ?? durationPreference[0]);
    if (Number.isFinite(max) && max > 0) return Math.round(max);
  }

  const durations = cards
    .map((card) => Number(card.duration_max ?? card.duration_min))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (durations.length === 0) return 45;
  const median = durations[Math.floor(durations.length / 2)];
  return Math.max(15, Math.round(median / 15) * 15);
}

function mostCommon(values: Array<unknown>, fallback: unknown, defaultValue: string | null) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = String(value ?? "").trim();
    if (!key || key === "unknown") continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const [winner] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  return winner ?? normalizeString(fallback) ?? defaultValue;
}

function topWeightedCategory(memory: Record<string, unknown>) {
  const weights = readRecord(memory.category_weights);
  const [winner] = Object.entries(weights)
    .map(([category, value]) => [category, Number(value)] as const)
    .filter(([, value]) => Number.isFinite(value) && value > 0)
    .sort((a, b) => b[1] - a[1])[0] ?? [];
  return winner ?? null;
}

function label(value: string | null) {
  return preferenceLabels[value ?? ""] ?? String(value ?? "未定");
}

function categoryLabel(value: string | null) {
  return categoryLabels[value ?? ""] ?? String(value ?? "其他");
}

function normalizeString(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized && normalized !== "null" && normalized !== "undefined" ? normalized : null;
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
