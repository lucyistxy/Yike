import type {
  ActivityHistoryEvent,
  AgentGateway,
  Card,
  DrawCardResult,
  DrawContext,
  FeedbackAction,
  FeedbackResult,
  MemoryItemAction,
  MemoryItemActionResult,
  MemorySummary,
  ParseCardInput,
  ParseCardResult,
  SaveProfileInput,
  SaveCardResult,
  UserProfile,
  WeatherContext,
} from "../contracts/v1";

const REQUIRED_FIELDS = ["duration_min", "energy_level", "indoor_outdoor", "prep_cost"] as const;

const presets: Card[] = [
  { card_id: "preset-film-001", title: "看一部收藏很久的温柔电影", content_category: "movie", duration_min: 90, duration_max: 110, energy_level: "low", indoor_outdoor: "indoor", prep_cost: "low", source_type: "preset", status: "active", eligible_for_draw: true, missing_fields: [] },
  { card_id: "preset-series-001", title: "补一集轻松下饭剧", content_category: "series", duration_min: 35, duration_max: 55, energy_level: "low", indoor_outdoor: "indoor", prep_cost: "low", source_type: "preset", status: "active", eligible_for_draw: true, missing_fields: [] },
  { card_id: "preset-book-001", title: "读一篇女性叙事短篇", content_category: "book", duration_min: 25, duration_max: 50, energy_level: "low", indoor_outdoor: "indoor", prep_cost: "low", source_type: "preset", status: "active", eligible_for_draw: true, missing_fields: [] },
  { card_id: "preset-food-001", title: "找一家甜品店打卡", content_category: "food", duration_min: 45, duration_max: 75, energy_level: "medium", indoor_outdoor: "outdoor", prep_cost: "medium", source_type: "preset", status: "active", eligible_for_draw: true, missing_fields: [] },
  { card_id: "preset-food-002", title: "试一家收藏的简餐店", content_category: "food", duration_min: 60, duration_max: 90, energy_level: "medium", indoor_outdoor: "outdoor", prep_cost: "medium", source_type: "preset", status: "active", eligible_for_draw: true, missing_fields: [] },
  { card_id: "preset-exhibition-001", title: "看一个小型展览", content_category: "exhibition", duration_min: 90, duration_max: 120, energy_level: "medium", indoor_outdoor: "outdoor", prep_cost: "medium", source_type: "preset", status: "active", eligible_for_draw: true, missing_fields: [] },
  { card_id: "preset-exhibition-002", title: "去看一个香氛或生活方式展", content_category: "exhibition", duration_min: 75, duration_max: 120, energy_level: "medium", indoor_outdoor: "outdoor", prep_cost: "medium", source_type: "preset", status: "active", eligible_for_draw: true, missing_fields: [] },
  { card_id: "preset-game-001", title: "玩一会儿治愈系经营游戏", content_category: "game", duration_min: 35, duration_max: 70, energy_level: "low", indoor_outdoor: "indoor", prep_cost: "low", source_type: "preset", status: "active", eligible_for_draw: true, missing_fields: [] },
  { card_id: "preset-game-002", title: "玩一局轻量解谜游戏", content_category: "game", duration_min: 25, duration_max: 45, energy_level: "low", indoor_outdoor: "indoor", prep_cost: "low", source_type: "preset", status: "active", eligible_for_draw: true, missing_fields: [] },
  { card_id: "preset-craft-001", title: "做一次低成本居家美甲", content_category: "craft", duration_min: 60, duration_max: 120, energy_level: "low", indoor_outdoor: "indoor", prep_cost: "medium", source_type: "preset", status: "active", eligible_for_draw: true, missing_fields: [] },
  { card_id: "preset-craft-002", title: "试一个手帐或贴纸拼贴", content_category: "craft", duration_min: 25, duration_max: 50, energy_level: "low", indoor_outdoor: "indoor", prep_cost: "low", source_type: "preset", status: "active", eligible_for_draw: true, missing_fields: [] },
  { card_id: "preset-walk-001", title: "去附近安静地散步一圈", content_category: "walk", duration_min: 25, duration_max: 45, energy_level: "medium", indoor_outdoor: "outdoor", prep_cost: "low", constraint_tags: ["safe_route"], source_type: "preset", status: "active", eligible_for_draw: true, missing_fields: [] },
  { card_id: "preset-other-001", title: "看一期妆造或穿搭视频", content_category: "other", duration_min: 20, duration_max: 45, energy_level: "low", indoor_outdoor: "indoor", prep_cost: "low", source_type: "preset", status: "active", eligible_for_draw: true, missing_fields: [] },
  { card_id: "preset-other-002", title: "整理一个今晚歌单", content_category: "other", duration_min: 20, duration_max: 35, energy_level: "low", indoor_outdoor: "indoor", prep_cost: "low", source_type: "preset", status: "active", eligible_for_draw: true, missing_fields: [] },
  { card_id: "preset-other-003", title: "泡一杯热饮，听完一集播客", content_category: "other", duration_min: 30, duration_max: 45, energy_level: "low", indoor_outdoor: "either", prep_cost: "low", source_type: "preset", status: "active", eligible_for_draw: true, missing_fields: [] },
  { card_id: "preset-book-002", title: "翻一本画册或摄影集", content_category: "book", duration_min: 20, duration_max: 40, energy_level: "low", indoor_outdoor: "indoor", prep_cost: "low", source_type: "preset", status: "active", eligible_for_draw: true, missing_fields: [] },
  { card_id: "preset-movie-002", title: "做一次房间里的迷你观影夜", content_category: "movie", duration_min: 90, duration_max: 120, energy_level: "low", indoor_outdoor: "indoor", prep_cost: "medium", source_type: "preset", status: "active", eligible_for_draw: true, missing_fields: [] },
  { card_id: "preset-series-002", title: "和朋友云同步看一集剧", content_category: "series", duration_min: 40, duration_max: 60, energy_level: "medium", indoor_outdoor: "indoor", prep_cost: "medium", source_type: "preset", status: "active", eligible_for_draw: true, missing_fields: [] },
  { card_id: "preset-food-003", title: "做一份简单甜品或饮品", content_category: "food", duration_min: 30, duration_max: 60, energy_level: "medium", indoor_outdoor: "indoor", prep_cost: "medium", source_type: "preset", status: "active", eligible_for_draw: true, missing_fields: [] },
  { card_id: "preset-other-004", title: "给朋友发一个轻松邀约", content_category: "other", duration_min: 10, duration_max: 20, energy_level: "medium", indoor_outdoor: "either", prep_cost: "low", source_type: "preset", status: "active", eligible_for_draw: true, missing_fields: [] },
];

function missingFields(card: Card) {
  return REQUIRED_FIELDS.filter((field) => card[field] === undefined);
}

export class MockAgentGateway implements AgentGateway {
  private personalCards: Card[] = [];
  private memoryOverrides = new Map<string, "kept" | "cleared">();
  private activityHistory: ActivityHistoryEvent[] = [];
  private profile: UserProfile = {
    user_id: "mock-user",
    onboarding_completed: false,
    explicit_profile: {
      user_editable: true,
      profile_version: "profile_v1",
    },
    preference_memory: {},
    updated_at: null,
  };

  constructor(initialCards: Card[] = []) {
    this.personalCards = [...initialCards];
  }

  replacePersonalCards(cards: Card[]) {
    this.personalCards = [...cards];
  }

  async getProfile(): Promise<UserProfile> {
    return this.profile;
  }

  async saveProfile(input: SaveProfileInput): Promise<UserProfile> {
    this.profile = {
      user_id: this.profile.user_id,
      onboarding_completed: Boolean(input.onboarding_completed ?? this.profile.onboarding_completed),
      explicit_profile: {
        ...this.profile.explicit_profile,
        ...input.explicit_profile,
        user_editable: true,
        profile_version: "profile_v1",
      },
      preference_memory: {
        ...this.profile.preference_memory,
        ...input.preference_memory,
      },
      updated_at: new Date().toISOString(),
    };
    return this.profile;
  }

  async getMemorySummary(): Promise<MemorySummary> {
    return this.buildMemorySummary();
  }

  async updateMemoryItem(input: { item_key: string; action: MemoryItemAction }): Promise<MemoryItemActionResult> {
    if (input.action === "keep") this.memoryOverrides.set(input.item_key, "kept");
    if (input.action === "clear") this.memoryOverrides.set(input.item_key, "cleared");
    const summary = this.buildMemorySummary();
    return {
      ok: true,
      item_key: input.item_key,
      action: input.action,
      updated: input.action !== "view",
      item: summary.memory_items.find((item) => item.item_key === input.item_key) ?? null,
      summary,
    };
  }

  async listCards(input: { source_scope?: DrawContext["source_scope"]; status?: Card["status"]; eligible_only?: boolean; q?: string; limit?: number } = {}): Promise<{ cards: Card[]; count: number }> {
    const sourceScope = input.source_scope ?? "personal";
    const query = input.q?.trim().toLowerCase();
    const cards = [...this.personalCards, ...presets].filter((card) => {
      if (sourceScope !== "both" && card.source_type !== sourceScope) return false;
      if (input.status && card.status !== input.status) return false;
      if (input.eligible_only && !card.eligible_for_draw) return false;
      if (query && ![card.title, card.content_category].some((value) => value.toLowerCase().includes(query))) return false;
      return true;
    }).slice(0, input.limit ?? 200);
    return { cards, count: cards.length };
  }

  async getWeatherContext(): Promise<WeatherContext> {
    return {
      source: "mock",
      weather: "cloudy",
      temperature: 24,
      rain_probability: 0,
      weather_tags: [],
      observed_at: new Date().toISOString(),
    };
  }

  async getActivityHistory({ from, to }: { from: string; to: string }): Promise<{ events: ActivityHistoryEvent[] }> {
    if (!this.activityHistory.length) {
      const today = new Date();
      const atDay = (offset: number, hour: number) => {
        const date = new Date(today);
        date.setDate(today.getDate() + offset);
        date.setHours(hour, 20, 0, 0);
        return date.toISOString();
      };
      this.activityHistory = [
        { event_id: "demo-feedback-1", kind: "feedback", action: "complete", card_id: presets[1].card_id, title: presets[1].title, content_category: presets[1].content_category, occurred_at: atDay(-2, 21), is_demo: true },
        { event_id: "demo-draw-2", kind: "draw", card_id: presets[0].card_id, title: presets[0].title, content_category: presets[0].content_category, occurred_at: atDay(-4, 20), is_demo: true },
        { event_id: "demo-draw-3", kind: "draw", card_id: presets[2].card_id, title: presets[2].title, content_category: presets[2].content_category, occurred_at: atDay(-8, 19), is_demo: true },
      ];
    }
    const start = new Date(from).getTime();
    const end = new Date(to).getTime();
    return { events: this.activityHistory.filter((event) => {
      const occurredAt = new Date(event.occurred_at).getTime();
      return occurredAt >= start && occurredAt < end;
    }).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)) };
  }

  async parseCard(input: ParseCardInput): Promise<ParseCardResult> {
    const text = input.text?.trim() || "看看这张收藏里的娱乐内容";
    const category = text.includes("电影") ? "movie" : text.includes("游戏") ? "game" : "other";
    const draft: Card = {
      card_id: `draft-${Date.now()}`,
      title: text.slice(0, 28),
      content_category: category,
      duration_min: 45,
      duration_max: 45,
      energy_level: "low",
      indoor_outdoor: "indoor",
      prep_cost: "low",
      source_type: "personal",
      status: "active",
      eligible_for_draw: true,
      missing_fields: [],
    };
    return { draft_card: draft, field_confidence: [{ field: "title", confidence: 0.96 }, { field: "duration_min", confidence: 0.72 }], missing_fields: [], duplicate_candidates: [] };
  }

  async saveCard(card: Card): Promise<SaveCardResult> {
    const missing = missingFields(card);
    const saved = { ...card, card_id: card.card_id.replace(/^draft-/, "personal-"), eligible_for_draw: missing.length === 0, missing_fields: [...missing] };
    this.personalCards = [saved, ...this.personalCards.filter((item) => item.card_id !== saved.card_id)];
    return { saved_card: saved, eligible_for_draw: saved.eligible_for_draw, missing_fields: saved.missing_fields };
  }

  async deleteCard(card_id: string): Promise<{ card_id: string; deleted: boolean }> {
    this.personalCards = this.personalCards.filter((card) => card.card_id !== card_id);
    return { card_id, deleted: true };
  }

  async archiveCard(card_id: string): Promise<{ card: Card }> {
    const card = this.personalCards.find((item) => item.card_id === card_id);
    const archived = { ...(card ?? this.personalCards[0]), card_id, status: "archived" as const };
    this.personalCards = this.personalCards.map((item) => item.card_id === card_id ? archived : item);
    return { card: archived };
  }

  async drawCard({ context, recent_card_ids }: { context: DrawContext; recent_card_ids: string[] }): Promise<DrawCardResult> {
    const pool = [...this.personalCards, ...presets];
    const excluded = { source: 0, duration: 0, outing: 0, constraint: 0, unavailable: 0, recent: 0 };
    const candidates = pool.filter((card) => {
      if (context.source_scope !== "both" && card.source_type !== context.source_scope) { excluded.source += 1; return false; }
      if (!card.eligible_for_draw || card.status !== "active") { excluded.unavailable += 1; return false; }
      if ((card.duration_max ?? card.duration_min ?? Infinity) > context.available_time_min) { excluded.duration += 1; return false; }
      if (context.outing_preference === "stay_in" && card.indoor_outdoor === "outdoor") { excluded.outing += 1; return false; }
      if (context.session_constraints?.includes("no-standing") && card.content_category === "walk") { excluded.constraint += 1; return false; }
      if (recent_card_ids.includes(card.card_id)) { excluded.recent += 1; return false; }
      return true;
    });
    if (!candidates.length) return { type: "no_candidate", message: "这些条件有点严格，这次没有硬抽一个不合适的结果。", excluded_counts: excluded, relax_suggestions: [{ field: "available_time_min", label: "把可用时间放宽到 60 分钟", value: 60 }, { field: "source_scope", label: "同时看看产品推荐", value: "both" }] };
    const index = (context.available_time_min + (context.mood_preference?.length ?? 0) + recent_card_ids.length) % candidates.length;
    const card = candidates[index];
    this.activityHistory.unshift({ event_id: `mock-draw-${Date.now()}`, kind: "draw", card_id: card.card_id, title: card.title, content_category: card.content_category, occurred_at: new Date().toISOString(), is_demo: true });
    return { type: "draw_result", card, reasons: [`能在 ${context.available_time_min} 分钟内开始`, context.outing_preference === "stay_in" ? "不需要出门" : "符合今晚的行动范围", card.prep_cost === "low" ? "准备成本很低" : "准备成本与当前状态匹配"], score: 82, weight: 1, candidate_count: candidates.length, candidate_version: "mock-v1" };
  }

  async submitFeedback({ card_id, action }: { card_id: string; action: FeedbackAction }): Promise<FeedbackResult> {
    const card = [...this.personalCards, ...presets].find((item) => item.card_id === card_id);
    if (card) this.activityHistory.unshift({ event_id: `mock-feedback-${Date.now()}`, kind: "feedback", action, card_id, title: card.title, content_category: card.content_category, occurred_at: new Date().toISOString(), is_demo: true });
    const effect = action === "complete"
      ? { short_term: "记录完成和真实体验", long_term: "相似内容适度加权", cooldown_hours: 72 }
      : action === "reroll"
        ? { short_term: "当前卡本轮短降权", long_term: "不形成长期不喜欢", cooldown_hours: 2 }
      : action === "not_suitable"
        ? { short_term: "短期冷却当前卡", long_term: "不形成长期不喜欢", cooldown_hours: 12 }
        : action === "later"
          ? { short_term: "设置较长冷却", long_term: "保留兴趣", cooldown_hours: 72 }
          : action === "dislike"
            ? { short_term: "强降权或归档", long_term: "更新负偏好且支持撤销", cooldown_hours: 720 }
            : { short_term: "本会话不重复推荐", long_term: "相关类别轻微加权", cooldown_hours: 12 };
    const delta = action === "complete" ? 0.08 : action === "dislike" ? -0.15 : action === "accept" ? 0.05 : action === "reroll" ? -0.02 : 0;
    const explanation = effect.short_term;
    const status = action === "complete" ? "completed" : action === "later" || action === "not_suitable" || action === "reroll" ? "cooling" : action === "dislike" ? "archived" : "active";
    return { card_id, action, status, explanation, effect, learning_signal: { category: "other", previous_weight: 0.2, weight_delta: delta, next_weight: 0.2 + delta, long_term_impact: delta !== 0 }, weight_delta: delta, card_patch: { status } };
  }

  async copyPreset({ preset_card_id, edits }: { preset_card_id: string; edits?: Partial<Card> }): Promise<SaveCardResult> {
    const preset = presets.find((card) => card.card_id === preset_card_id);
    if (!preset) throw new Error("PRESET_NOT_FOUND");
    return this.saveCard({ ...preset, ...edits, card_id: `personal-${Date.now()}`, source_type: "personal", origin_preset_id: preset.card_id });
  }

  private buildMemorySummary(): MemorySummary {
    const now = new Date();
    const items = [
      { item_key: "pref_quiet", title: "偏爱安静独处", description: "低精力、安静、可独处的内容会在疲惫时更容易被推荐。", source: "来自 4 次主动选择", evidence_count: 4 },
      { item_key: "pref_indoor", title: "更常选择室内活动", description: "室内内容会在条件合适时略微前置，但仍会保留室外探索。", source: "来自卡片完成记录", evidence_count: 3 },
      { item_key: "pref_low_prep", title: "暂时减少高准备内容", description: "准备成本较低的卡会更容易进入 Top5，高准备内容不会被永久删除。", source: "可随时撤回", evidence_count: 2 },
    ].map((item) => ({
      ...item,
      action_state: this.memoryOverrides.get(item.item_key) ?? "active",
      last_seen_at: now.toISOString(),
      detail: {},
    })).filter((item) => item.action_state !== "cleared") as MemorySummary["memory_items"];

    return {
      user_id: this.profile.user_id,
      generated_at: now.toISOString(),
      feedback_calendar: {
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        month_label: `${now.getFullYear()} 年 ${now.getMonth() + 1} 月`,
        current_day: now.getDate(),
        active_days: [1, 2, 4, 7, 8, 10, 15, 16],
        pearl_count: 8,
        feedback_count: 10,
        positive_count: 8,
        completed_count: 3,
      },
      long_term_preference: {
        headline: "室内 · 低准备 · 45 分钟",
        tags: [
          { label: "活动场景", value: "室内" },
          { label: "准备程度", value: "低" },
          { label: "可用时长", value: "45 分钟" },
        ],
        evidence: "来自演示记忆",
      },
      memory_items: items,
      non_persistent: [
        { label: "经期不适", reason: "只在当次会话中使用" },
        { label: "不久站", reason: "只影响本次硬过滤" },
        { label: "不需妆容", reason: "只用于当次准备成本判断" },
      ],
    };
  }
}
