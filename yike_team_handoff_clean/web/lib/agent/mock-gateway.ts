import type {
  AgentGateway,
  Card,
  DrawCardResult,
  DrawContext,
  FeedbackAction,
  FeedbackResult,
  ParseCardInput,
  ParseCardResult,
  SaveProfileInput,
  SaveCardResult,
  UserProfile,
  WeatherContext,
} from "../contracts/v1";

const REQUIRED_FIELDS = ["duration_min", "energy_level", "indoor_outdoor", "prep_cost"] as const;

const presets: Card[] = [
  { card_id: "preset-podcast-002", title: "泡一杯热饮，听完一集播客", content_category: "other", duration_min: 30, duration_max: 45, energy_level: "low", indoor_outdoor: "indoor", prep_cost: "low", source_type: "preset", status: "active", eligible_for_draw: true, missing_fields: [] },
  { card_id: "preset-game-001", title: "玩半小时轻松的单机游戏", content_category: "game", duration_min: 30, duration_max: 30, energy_level: "low", indoor_outdoor: "indoor", prep_cost: "low", source_type: "preset", status: "active", eligible_for_draw: true, missing_fields: [] },
  { card_id: "preset-walk-001", title: "去附近安静地散步一圈", content_category: "walk", duration_min: 35, duration_max: 45, energy_level: "medium", indoor_outdoor: "outdoor", prep_cost: "medium", source_type: "preset", status: "active", eligible_for_draw: true, missing_fields: [] },
  { card_id: "preset-film-001", title: "看一部收藏很久的温柔电影", content_category: "movie", duration_min: 90, duration_max: 110, energy_level: "low", indoor_outdoor: "indoor", prep_cost: "low", source_type: "preset", status: "active", eligible_for_draw: true, missing_fields: [] },
];

function missingFields(card: Card) {
  return REQUIRED_FIELDS.filter((field) => card[field] === undefined);
}

export class MockAgentGateway implements AgentGateway {
  private personalCards: Card[] = [];
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
    return { type: "draw_result", card, reasons: [`能在 ${context.available_time_min} 分钟内开始`, context.outing_preference === "stay_in" ? "不需要出门" : "符合今晚的行动范围", card.prep_cost === "low" ? "准备成本很低" : "准备成本与当前状态匹配"], score: 82, weight: 1, candidate_count: candidates.length, candidate_version: "mock-v1" };
  }

  async submitFeedback({ card_id, action }: { card_id: string; action: FeedbackAction }): Promise<FeedbackResult> {
    const effect = action === "complete"
      ? { short_term: "记录完成和真实体验", long_term: "相似内容适度加权", cooldown_hours: 72 }
      : action === "not_suitable"
        ? { short_term: "短期冷却当前卡", long_term: "不形成长期不喜欢", cooldown_hours: 12 }
        : action === "later"
          ? { short_term: "设置较长冷却", long_term: "保留兴趣", cooldown_hours: 72 }
          : action === "dislike"
            ? { short_term: "强降权或归档", long_term: "更新负偏好且支持撤销", cooldown_hours: 720 }
            : { short_term: "本会话不重复推荐", long_term: "相关类别轻微加权", cooldown_hours: 12 };
    const delta = action === "complete" ? 0.08 : action === "dislike" ? -0.15 : action === "accept" ? 0.05 : 0;
    const explanation = effect.short_term;
    const status = action === "complete" ? "completed" : action === "later" || action === "not_suitable" ? "cooling" : action === "dislike" ? "archived" : "active";
    return { card_id, action, status, explanation, effect, learning_signal: { category: "other", previous_weight: 0.2, weight_delta: delta, next_weight: 0.2 + delta, long_term_impact: delta !== 0 }, weight_delta: delta, card_patch: { status } };
  }

  async copyPreset({ preset_card_id, edits }: { preset_card_id: string; edits?: Partial<Card> }): Promise<SaveCardResult> {
    const preset = presets.find((card) => card.card_id === preset_card_id);
    if (!preset) throw new Error("PRESET_NOT_FOUND");
    return this.saveCard({ ...preset, ...edits, card_id: `personal-${Date.now()}`, source_type: "personal", origin_preset_id: preset.card_id });
  }
}
