import type {
  ActivityHistoryEvent,
  AgentGateway,
  Card,
  ContentCategory,
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

type HttpAgentGatewayOptions = {
  baseUrl?: string;
  userId?: string;
  accessToken?: string;
};

const CATEGORY_MAP: Record<string, ContentCategory> = {
  book: "book",
  movie: "movie",
  series: "series",
  restaurant: "food",
  cafe: "food",
  food: "food",
  exhibition: "exhibition",
  game: "game",
  craft: "craft",
  walk: "walk",
};

const TOKEN_REFRESH_MARGIN_MS = 60_000;

export class HttpAgentGateway implements AgentGateway {
  private readonly baseUrl: string;
  private readonly configuredUserId?: string;
  private readonly configuredAccessToken?: string;

  constructor(options: HttpAgentGatewayOptions = {}) {
    this.baseUrl = stripTrailingSlash(
      options.baseUrl ?? process.env.NEXT_PUBLIC_YIKE_AGENT_BASE_URL ?? defaultAgentBaseUrl(),
    );
    this.configuredUserId = options.userId ?? process.env.NEXT_PUBLIC_YIKE_USER_ID;
    this.configuredAccessToken = options.accessToken;
  }

  async getProfile(): Promise<UserProfile> {
    const auth = await this.getAuth();
    return this.request<UserProfile>(`profile?user_id=${encodeURIComponent(auth.userId)}`, {
      method: "GET",
    });
  }

  async saveProfile(input: SaveProfileInput): Promise<UserProfile> {
    const auth = await this.getAuth();
    return this.request<UserProfile>("profile", {
      method: "POST",
      body: {
        user_id: auth.userId,
        onboarding_completed: input.onboarding_completed,
        explicit_profile: input.explicit_profile,
        preference_memory: input.preference_memory,
      },
    });
  }

  async getMemorySummary(): Promise<MemorySummary> {
    const auth = await this.getAuth();
    return this.request<MemorySummary>(`memory?user_id=${encodeURIComponent(auth.userId)}`, {
      method: "GET",
    });
  }

  async updateMemoryItem(input: { item_key: string; action: MemoryItemAction }): Promise<MemoryItemActionResult> {
    const auth = await this.getAuth();
    return this.request<MemoryItemActionResult>("memory", {
      method: "POST",
      body: {
        user_id: auth.userId,
        item_key: input.item_key,
        action: input.action,
      },
    });
  }

  async listCards(input: {
    source_scope?: DrawContext["source_scope"];
    status?: Card["status"];
    eligible_only?: boolean;
    q?: string;
    limit?: number;
  } = {}): Promise<{ cards: Card[]; count: number }> {
    const auth = await this.getAuth();
    const params = new URLSearchParams({
      user_id: auth.userId,
      source_scope: input.source_scope ?? "personal",
      limit: String(input.limit ?? 200),
    });
    if (input.status) params.set("status", input.status);
    if (input.eligible_only) params.set("eligible_only", "true");
    if (input.q) params.set("q", input.q);
    const response = await this.request<Record<string, unknown>>(`cards?${params.toString()}`, {
      method: "GET",
    });
    const cards = Array.isArray(response.cards)
      ? response.cards.map((card) => normalizeCard(card as Record<string, unknown>))
      : [];
    return {
      cards,
      count: Number(response.count ?? cards.length),
    };
  }

  async getWeatherContext(input: { city?: string | null; timezone?: string | null; latitude?: number | null; longitude?: number | null }): Promise<WeatherContext> {
    const response = await this.request<Record<string, unknown>>("weather-context", {
      method: "POST",
      body: input,
    });
    return normalizeWeatherContext(response);
  }

  async getActivityHistory(input: { from: string; to: string }): Promise<{ events: ActivityHistoryEvent[] }> {
    const auth = await this.getAuth();
    const params = new URLSearchParams({ user_id: auth.userId, from: input.from, to: input.to });
    const response = await this.request<Record<string, unknown>>(`activity-history?${params.toString()}`, { method: "GET" });
    const events = Array.isArray(response.events)
      ? response.events.map((event) => normalizeActivityHistoryEvent(event as Record<string, unknown>))
      : [];
    return { events };
  }

  async parseCard(input: ParseCardInput): Promise<ParseCardResult> {
    const auth = await this.getAuth();
    const imagePayload = input.image ? await fileToBase64Payload(input.image) : {};
    const response = await this.request<Record<string, unknown>>("card-drafts", {
      method: "POST",
      body: {
        user_id: auth.userId,
        input_type: input.image && input.text ? "mixed" : input.image ? "image" : "text",
        text: input.text || null,
        uploaded_asset_id: input.uploaded_asset_id,
        ...imagePayload,
      },
    });

    const draftCard = normalizeCard((response.draft_card ?? response.draft) as Record<string, unknown>);
    return {
      draft_card: draftCard,
      field_confidence: normalizeFieldConfidence(response.field_confidence),
      missing_fields: normalizeStringArray(response.missing_fields ?? draftCard.missing_fields),
      duplicate_candidates: normalizeDuplicateCandidates(response.duplicate_candidates),
    };
  }

  async saveCard(card: Card): Promise<SaveCardResult> {
    const auth = await this.getAuth();
    const body = card.draft_id
      ? {
        user_id: auth.userId,
        draft_id: card.draft_id,
        overrides: toBackendCard(card),
      }
      : {
        user_id: auth.userId,
        draft: toBackendCard(card),
      };
    const response = await this.request<Record<string, unknown>>("cards", {
      method: "POST",
      body,
    });

    const saved = normalizeCard((response.saved_card ?? response.card) as Record<string, unknown>);
    return {
      saved_card: saved,
      eligible_for_draw: Boolean(response.eligible_for_draw ?? saved.eligible_for_draw),
      missing_fields: normalizeStringArray(response.missing_fields ?? saved.missing_fields),
    };
  }

  async deleteCard(card_id: string): Promise<{ card_id: string; deleted: boolean }> {
    const auth = await this.getAuth();
    return this.request<{ card_id: string; deleted: boolean }>("cards", {
      method: "DELETE",
      body: {
        user_id: auth.userId,
        card_id,
      },
    });
  }

  async archiveCard(card_id: string): Promise<{ card: Card }> {
    const auth = await this.getAuth();
    const response = await this.request<Record<string, unknown>>("cards", {
      method: "PATCH",
      body: {
        user_id: auth.userId,
        card_id,
        action: "archive",
      },
    });
    return { card: normalizeCard(response.card as Record<string, unknown>) };
  }

  async updateCard(card_id: string, updates: Partial<Card>): Promise<{ card: Card }> {
    const auth = await this.getAuth();
    const response = await this.request<Record<string, unknown>>("cards", {
      method: "PATCH",
      body: {
        user_id: auth.userId,
        card_id,
        action: "restore",
        updates: toBackendCard(updates),
      },
    });
    return { card: normalizeCard(response.card as Record<string, unknown>) };
  }

  async drawCard(input: { context: DrawContext; recent_card_ids: string[] }): Promise<DrawCardResult> {
    const auth = await this.getAuth();
    const response = await this.request<Record<string, unknown>>("recommendations", {
      method: "POST",
      body: {
        user_id: auth.userId,
        session_id: `web_${Date.now()}`,
        source_scope: input.context.source_scope,
        context_input: toBackendContext(input.context),
        weather_context: input.context.weather_context ?? null,
        location: input.context.location ?? null,
        seed: Date.now(),
      },
    });

    if (response.type === "no_candidate" || !response.card && !response.selected_card) {
      return {
        type: "no_candidate",
        message: String(response.message ?? "当前条件下没有合适的娱乐卡。"),
        excluded_counts: normalizeCounts(response.excluded_counts ?? response.excluded_summary),
        relax_suggestions: normalizeRelaxSuggestions(response.relax_suggestions),
      };
    }

    return {
      type: "draw_result",
      card: normalizeCard((response.card ?? response.selected_card) as Record<string, unknown>),
      reasons: normalizeStringArray(response.reasons ?? response.reason),
      score: Number(response.score ?? 0),
      weight: Number(response.weight ?? 1),
      candidate_count: Number(response.candidate_count ?? 0),
      candidate_version: String(response.candidate_version ?? response.score_version ?? "score_v1"),
    };
  }

  async submitFeedback(input: {
    card_id: string;
    action: FeedbackAction;
    reason?: string;
    actual_duration_min?: number;
  }): Promise<FeedbackResult> {
    const auth = await this.getAuth();
    const response = await this.request<Record<string, unknown>>("feedback", {
      method: "POST",
      body: {
        user_id: auth.userId,
        card_id: input.card_id,
        action: input.action,
        optional_reason: input.reason ?? null,
        actual_duration_min: input.actual_duration_min,
      },
    });

    const effect = response.effect as FeedbackResult["effect"] | undefined;
    const learningSignal = response.learning_signal as FeedbackResult["learning_signal"] | undefined;
    const cardPatch = response.card_patch as FeedbackResult["card_patch"] | null;
    return {
      card_id: String(response.card_id ?? input.card_id),
      action: input.action,
      status: normalizeStatus(cardPatch?.status ?? "active"),
      explanation: String(effect?.short_term ?? "反馈已记录"),
      effect,
      learning_signal: learningSignal,
      weight_delta: learningSignal?.weight_delta,
      cooling_until: cardPatch?.cooling_until == null ? undefined : String(cardPatch.cooling_until),
      card_patch: cardPatch,
    };
  }

  async copyPreset(input: { preset_card_id: string; edits?: Partial<Card> }): Promise<SaveCardResult> {
    const auth = await this.getAuth();
    const response = await this.request<Record<string, unknown>>("cards", {
      method: "POST",
      body: {
        user_id: auth.userId,
        preset_card_id: input.preset_card_id,
        edits: input.edits ? toBackendCard(input.edits as Card) : {},
      },
    });

    const saved = normalizeCard((response.saved_card ?? response.card) as Record<string, unknown>);
    return {
      saved_card: saved,
      eligible_for_draw: Boolean(response.eligible_for_draw ?? saved.eligible_for_draw),
      missing_fields: normalizeStringArray(response.missing_fields ?? saved.missing_fields),
    };
  }

  private async request<T>(path: string, init: { method: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown }): Promise<T> {
    const auth = await this.getAuth();
    if (!this.baseUrl) throw new Error("NEXT_PUBLIC_YIKE_AGENT_BASE_URL is required");
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || readBrowserValue("yike-supabase-anon-key");
    if (!anonKey) {
      throw new Error("真实 Agent 请求缺少 Supabase anon public key，请在顶部登录面板补充后重新登录");
    }

    let response = await this.fetchAgent(path, init, auth, anonKey);
    if (response.status === 401 && canRefreshAuth()) {
      const refreshed = await this.refreshAuth(anonKey, true);
      response = await this.fetchAgent(path, init, refreshed, anonKey);
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(formatAgentError(response.status, data));
    }
    return data as T;
  }

  private async fetchAgent(
    path: string,
    init: { method: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown },
    auth: { accessToken: string; userId: string },
    anonKey: string
  ) {
    try {
      return await fetch(`${this.baseUrl}/${path}`, {
        method: init.method,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${auth.accessToken}`,
          ...(anonKey ? { apikey: anonKey } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
      });
    } catch (error) {
      throw new Error(formatNetworkError(path, error));
    }
  }

  private async getAuth() {
    const accessToken = this.configuredAccessToken ?? readBrowserValue("yike-user-access-token");
    const userId = this.configuredUserId ?? readBrowserValue("yike-user-id");
    if (!accessToken || !userId) {
      throw new Error("请先在账号面板登录后再使用真实 Agent");
    }
    if (this.configuredAccessToken || !tokenNeedsRefresh(accessToken)) {
      return { accessToken, userId };
    }
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || readBrowserValue("yike-supabase-anon-key");
    if (!anonKey || !canRefreshAuth()) {
      throw new Error("Supabase 用户登录已失效，请在账号面板重新登录");
    }
    return this.refreshAuth(anonKey, true);
  }

  private async refreshAuth(anonKey: string, clearOnFailure = false) {
    const refreshToken = readBrowserValue("yike-user-refresh-token");
    const authBaseUrl = getSupabaseAuthUrl();
    if (!refreshToken || !authBaseUrl) {
      throw new Error("Supabase 用户登录已失效，请在账号面板重新登录");
    }
    try {
      const response = await fetch(`${authBaseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: {
          apikey: anonKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(data.msg ?? data.error_description ?? data.error ?? "refresh_failed"));
      return persistAuthSession(data);
    } catch (error) {
      if (clearOnFailure) clearAuthSession();
      const reason = error instanceof Error ? error.message : "refresh_failed";
      throw new Error(`Supabase 用户登录已失效，请在账号面板重新登录。原因：${reason}`);
    }
  }
}

export function persistAuthSession(data: Record<string, unknown>) {
  const accessToken = String(data.access_token ?? "");
  const refreshToken = String(data.refresh_token ?? readBrowserValue("yike-user-refresh-token") ?? "");
  const user = data.user as Record<string, unknown> | undefined;
  const userId = String(user?.id ?? readBrowserValue("yike-user-id") ?? "");
  if (!accessToken || !userId) throw new Error("登录返回里没有用户 token");

  const expiresAt = Number(data.expires_at ?? 0) || Math.floor(Date.now() / 1000) + Number(data.expires_in ?? 3600);
  window.localStorage.setItem("yike-user-id", userId);
  window.localStorage.setItem("yike-user-access-token", accessToken);
  window.localStorage.setItem("yike-user-token-expires-at", String(expiresAt));
  if (refreshToken) window.localStorage.setItem("yike-user-refresh-token", refreshToken);
  window.dispatchEvent(new Event("yike-auth-change"));

  return { accessToken, userId };
}

export function canUseHttpAgentGateway() {
  return Boolean(process.env.NEXT_PUBLIC_YIKE_AGENT_BASE_URL || defaultAgentBaseUrl());
}

export function clearAuthSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem("yike-user-id");
  window.localStorage.removeItem("yike-user-access-token");
  window.localStorage.removeItem("yike-user-refresh-token");
  window.localStorage.removeItem("yike-user-token-expires-at");
  window.dispatchEvent(new Event("yike-auth-change"));
}

function canRefreshAuth() {
  return Boolean(readBrowserValue("yike-user-refresh-token") && getSupabaseAuthUrl());
}

function tokenNeedsRefresh(accessToken: string) {
  const explicitExpiresAt = Number(readBrowserValue("yike-user-token-expires-at"));
  const expiresAtMs = Number.isFinite(explicitExpiresAt) && explicitExpiresAt > 0
    ? explicitExpiresAt * 1000
    : decodeJwtExpMs(accessToken);
  if (!expiresAtMs) return false;
  return expiresAtMs - Date.now() < TOKEN_REFRESH_MARGIN_MS;
}

function decodeJwtExpMs(token: string) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return 0;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(atob(normalized));
    return Number(decoded.exp ?? 0) * 1000;
  } catch {
    return 0;
  }
}

function getSupabaseAuthUrl() {
  return stripTrailingSlash(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
}

function defaultAgentBaseUrl() {
  const supabaseUrl = stripTrailingSlash(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  return supabaseUrl ? `${supabaseUrl}/functions/v1` : "";
}

function formatNetworkError(path: string, error: unknown) {
  const reason = error instanceof Error ? error.message : "network_error";
  return `无法连接真实 Agent：${path} 请求没有到达 Supabase。请确认网络、登录状态、anon public key 和本地 dev server 已重启。原始错误：${reason}`;
}

function formatAgentError(status: number, data: unknown) {
  const body = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const message = String(body.message ?? body.error ?? "agent_request_failed");
  if (status === 401 && message.toLowerCase().includes("jwt")) {
    return "Supabase 用户登录已失效，请用调试登录面板重新登录";
  }
  if (message === "auth_required" || message === "user_id_mismatch") {
    return "当前登录用户和请求用户不匹配，请重新登录";
  }
  return message;
}

function toBackendContext(context: DrawContext) {
  return {
    available_time: context.available_time_min,
    energy_level: context.energy_level,
    go_out: context.outing_preference === "can_go_out" ? true : context.outing_preference === "stay_in" ? false : null,
    people: context.people,
    budget_level: context.budget_level,
    active_constraints: context.session_constraints ?? [],
    mode_preference: context.mood_preference && context.mood_preference !== "random" ? [context.mood_preference] : [],
  };
}

function toBackendCard(card: Partial<Card>) {
  return {
    ...card,
    indoor_outdoor: card.indoor_outdoor === "either" ? "flexible" : card.indoor_outdoor,
  };
}

function normalizeCard(raw: Record<string, unknown>): Card {
  const durationMin = Number(raw.duration_min ?? 0);
  const durationMax = Number(raw.duration_max ?? durationMin);
  return {
    card_id: String(raw.card_id ?? raw.draft_id ?? `card-${Date.now()}`),
    draft_id: raw.draft_id == null ? undefined : String(raw.draft_id),
    title: String(raw.title ?? "待确认的娱乐收藏"),
    content_category: normalizeCategory(raw.content_category),
    duration_min: durationMin,
    duration_max: durationMax,
    energy_level: normalizeLevel(raw.energy_level),
    indoor_outdoor: normalizeIndoorOutdoor(raw.indoor_outdoor),
    prep_cost: normalizeLevel(raw.prep_cost),
    people: typeof raw.people === "number" ? raw.people : undefined,
    budget_level: normalizeLevel(raw.budget_level),
    constraint_tags: normalizeStringArray(raw.constraint_tags),
    image_url: raw.image_url == null ? null : String(raw.image_url),
    image_path: raw.image_path == null ? null : String(raw.image_path),
    source_asset: raw.source_asset && typeof raw.source_asset === "object" ? raw.source_asset as Record<string, unknown> : null,
    source_type: raw.source_type === "preset" ? "preset" : "personal",
    status: normalizeStatus(raw.status),
    eligible_for_draw: Boolean(raw.eligible_for_draw),
    missing_fields: normalizeStringArray(raw.missing_fields),
    origin_preset_id: raw.origin_preset_id == null ? undefined : String(raw.origin_preset_id),
  };
}

function normalizeCategory(value: unknown): ContentCategory {
  return CATEGORY_MAP[String(value ?? "")] ?? "other";
}

function normalizeLevel(value: unknown) {
  return value === "medium" || value === "high" ? value : "low";
}

function normalizeIndoorOutdoor(value: unknown) {
  if (value === "outdoor") return "outdoor";
  if (value === "flexible" || value === "either") return "either";
  return "indoor";
}

function normalizeStatus(value: unknown) {
  if (value === "cooling" || value === "archived" || value === "completed") return value;
  return "active";
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

function normalizeWeatherContext(raw: Record<string, unknown>): WeatherContext {
  return {
    source: typeof raw.source === "string" ? raw.source : undefined,
    city: typeof raw.city === "string" ? raw.city : null,
    weather: typeof raw.weather === "string" ? raw.weather : null,
    temperature: raw.temperature == null ? null : Number(raw.temperature),
    apparent_temperature: raw.apparent_temperature == null ? null : Number(raw.apparent_temperature),
    rain_probability: raw.rain_probability == null ? null : Number(raw.rain_probability),
    weather_tags: normalizeStringArray(raw.weather_tags),
    observed_at: typeof raw.observed_at === "string" ? raw.observed_at : new Date().toISOString(),
  };
}

function normalizeActivityHistoryEvent(raw: Record<string, unknown>): ActivityHistoryEvent {
  const action = String(raw.action ?? "");
  const normalizedAction = action === "accept" || action === "complete" || action === "not_suitable" || action === "later" || action === "dislike"
    ? action as FeedbackAction
    : undefined;
  return {
    event_id: String(raw.event_id ?? `${raw.kind ?? "event"}-${raw.occurred_at ?? Date.now()}`),
    kind: raw.kind === "feedback" ? "feedback" : "draw",
    ...(normalizedAction ? { action: normalizedAction } : {}),
    card_id: String(raw.card_id ?? ""),
    title: String(raw.title ?? "一张今晚的卡"),
    content_category: normalizeCategory(raw.content_category),
    occurred_at: String(raw.occurred_at ?? new Date().toISOString()),
  };
}

function normalizeCounts(value: unknown) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).map(([key, count]) => [key, Number(count ?? 0)]));
}

function normalizeFieldConfidence(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    field: String((item as Record<string, unknown>).field ?? ""),
    confidence: Number((item as Record<string, unknown>).confidence ?? 0),
  }));
}

function normalizeDuplicateCandidates(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    card_id: String((item as Record<string, unknown>).card_id ?? ""),
    title: String((item as Record<string, unknown>).title ?? ""),
    similarity: Number((item as Record<string, unknown>).similarity ?? 0),
  }));
}

function normalizeRelaxSuggestions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const suggestion = item as Record<string, unknown>;
    return {
      field: String(suggestion.field ?? ""),
      label: String(suggestion.label ?? ""),
      value: suggestion.value as string | number | boolean,
    };
  });
}

async function fileToBase64Payload(file: File) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

  return {
    image_base64: dataUrl.split(",")[1] ?? "",
    image_mime_type: file.type || "image/png",
  };
}

function readBrowserValue(key: string) {
  if (typeof window === "undefined") return undefined;
  return window.localStorage.getItem(key) ?? undefined;
}

function stripTrailingSlash(value: string) {
  return value.replace(/\/$/, "");
}
