import type { Card, FeedbackAction, RecommendationResult, SourceScope, UserMemory } from "./recommendationCore.ts";
import { computeMissingFields, type CardDraft, type DraftInputType } from "./cardDraftCore.ts";

type SupabaseClient = any;

type CardListOptions = {
  source_scope?: SourceScope;
  status?: string | null;
  eligible_only?: boolean;
  q?: string | null;
  limit?: number;
};

type CardUpdateAction = "archive" | "restore" | "cool" | "complete";

type CardUpdatePayload = {
  action?: CardUpdateAction;
  updates?: Record<string, unknown>;
  cooling_until?: string | null;
};

type ProfilePayload = {
  explicit_profile?: Record<string, unknown>;
  preference_memory?: Record<string, unknown>;
  onboarding_completed?: boolean;
};

export async function loadCards(supabase: SupabaseClient, userId: string, sourceScope: SourceScope): Promise<Card[]> {
  let query = supabase
    .from("entertainment_cards")
    .select("*")
    .or(`user_id.eq.${userId},user_id.is.null`);

  if (sourceScope !== "both") {
    query = query.eq("source_type", sourceScope);
  }

  const { data, error } = await query;
  if (error) throw new Error(`load_cards_failed: ${error.message}`);
  return withSignedCardImages(supabase, (data ?? []).map(mapCardRow));
}

export async function listCards(
  supabase: SupabaseClient,
  userId: string,
  options: CardListOptions = {}
) {
  const sourceScope = options.source_scope ?? "personal";
  const limit = Math.max(1, Math.min(Number(options.limit ?? 100), 200));
  let query = supabase
    .from("entertainment_cards")
    .select("*")
    .or(`user_id.eq.${userId},user_id.is.null`)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (sourceScope !== "both") query = query.eq("source_type", sourceScope);
  if (options.status) query = query.eq("status", options.status);
  if (options.eligible_only) query = query.eq("eligible_for_draw", true);

  const { data, error } = await query;
  if (error) throw new Error(`list_cards_failed: ${error.message}`);

  const q = options.q?.trim().toLowerCase();
  const cards = await withSignedCardImages(supabase, (data ?? []).map(mapCardRow).filter((card) => {
    if (!q) return true;
    return [card.title, card.subtitle, card.description, card.content_category, ...(card.mood_tags ?? [])]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(q));
  }));

  return {
    cards,
    count: cards.length
  };
}

export async function loadMemory(supabase: SupabaseClient, userId: string): Promise<UserMemory> {
  const [{ data: memory, error: memoryError }, { data: behavior, error: behaviorError }] = await Promise.all([
    supabase
      .from("user_memory")
      .select("user_id, preference_memory, explicit_profile")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("feedback_events")
      .select("card_id, action, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100)
  ]);

  if (memoryError) throw new Error(`load_memory_failed: ${memoryError.message}`);
  if (behaviorError) throw new Error(`load_behavior_failed: ${behaviorError.message}`);

  return {
    user_id: userId,
    preference_memory: memory?.preference_memory ?? {},
    explicit_profile: memory?.explicit_profile ?? { user_editable: true },
    behavior_memory: behavior ?? []
  };
}

export async function getUserProfile(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("user_memory")
    .select("user_id, preference_memory, explicit_profile, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`load_profile_failed: ${error.message}`);

  const explicitProfile = data?.explicit_profile ?? defaultExplicitProfile();
  return {
    user_id: userId,
    onboarding_completed: Boolean((explicitProfile as Record<string, unknown>).onboarding_completed),
    explicit_profile: explicitProfile,
    preference_memory: data?.preference_memory ?? {},
    updated_at: data?.updated_at ?? null
  };
}

export async function upsertUserProfile(supabase: SupabaseClient, userId: string, payload: ProfilePayload) {
  const current = await getUserProfile(supabase, userId);
  const now = new Date().toISOString();
  const explicitProfile = normalizeExplicitProfile({
    ...(current.explicit_profile ?? {}),
    ...(payload.explicit_profile ?? {}),
    ...(payload.onboarding_completed != null ? { onboarding_completed: payload.onboarding_completed } : {})
  });
  const profileHints = profilePreferenceHints(explicitProfile);
  const preferenceMemory = normalizePreferenceMemory({
    ...(current.preference_memory ?? {}),
    ...(payload.preference_memory ?? {}),
    ...profileHints,
    category_weights: {
      ...readRecord((current.preference_memory as Record<string, unknown> | null)?.category_weights),
      ...readRecord(payload.preference_memory?.category_weights),
      ...readRecord(profileHints.category_weights)
    }
  });

  const { data, error } = await supabase
    .from("user_memory")
    .upsert({
      user_id: userId,
      explicit_profile: explicitProfile,
      preference_memory: preferenceMemory,
      updated_at: now
    })
    .select("user_id, preference_memory, explicit_profile, updated_at")
    .single();

  if (error) throw new Error(`upsert_profile_failed: ${error.message}`);

  return {
    user_id: userId,
    onboarding_completed: Boolean((data.explicit_profile as Record<string, unknown>).onboarding_completed),
    explicit_profile: data.explicit_profile,
    preference_memory: data.preference_memory,
    updated_at: data.updated_at
  };
}

function defaultExplicitProfile() {
  return {
    user_editable: true,
    onboarding_completed: false,
    profile_version: "profile_v1"
  };
}

function normalizeExplicitProfile(profile: Record<string, unknown>) {
  const allowed = new Set([
    "nickname",
    "city",
    "timezone",
    "default_available_time",
    "default_energy_level",
    "default_go_out",
    "default_people",
    "default_budget_level",
    "preferred_categories",
    "disliked_categories",
    "mode_preferences",
    "indoor_outdoor_preference",
    "travel_preference",
    "dietary_constraints",
    "active_constraints",
    "accessibility_constraints",
    "disliked_constraints",
    "content_blacklist_keywords",
    "content_whitelist_keywords",
    "social_preference",
    "usual_free_time_windows",
    "raw_answers",
    "onboarding_completed",
    "user_editable",
    "profile_version"
  ]);

  const normalized: Record<string, unknown> = defaultExplicitProfile();
  for (const [key, value] of Object.entries(profile)) {
    if (!allowed.has(key)) continue;
    normalized[key] = normalizeProfileValue(key, value);
  }
  normalized.user_editable = true;
  normalized.profile_version = String(normalized.profile_version ?? "profile_v1");
  return normalized;
}

function normalizePreferenceMemory(memory: Record<string, unknown>) {
  const categoryWeights = normalizeNumberMap(memory.category_weights);
  const normalized: Record<string, unknown> = {
    ...memory,
    category_weights: categoryWeights
  };

  if (Array.isArray(memory.duration_preference)) {
    const [min, max] = memory.duration_preference.map((value) => Number(value));
    if (Number.isFinite(min) && Number.isFinite(max) && max >= min) {
      normalized.duration_preference = [Math.max(0, min), Math.max(0, max)];
    }
  }

  return normalized;
}

function profilePreferenceHints(profile: Record<string, unknown>) {
  const hints: Record<string, unknown> = {};
  const categoryWeights: Record<string, number> = {};

  for (const category of readStringArray(profile.preferred_categories)) {
    categoryWeights[category] = Math.max(categoryWeights[category] ?? 0, 0.2);
  }
  for (const category of readStringArray(profile.disliked_categories)) {
    categoryWeights[category] = Math.min(categoryWeights[category] ?? 0, -0.35);
  }
  if (Object.keys(categoryWeights).length > 0) {
    hints.category_weights = categoryWeights;
  }

  const availableTime = Number(profile.default_available_time);
  if (Number.isFinite(availableTime) && availableTime > 0) {
    hints.duration_preference = [0, Math.min(availableTime, 480)];
  }

  const indoorOutdoor = normalizeEnum(profile.indoor_outdoor_preference, ["indoor", "outdoor", "flexible", "unknown"]);
  if (indoorOutdoor) {
    hints.indoor_outdoor_preference = indoorOutdoor;
  }

  return hints;
}

function normalizeProfileValue(key: string, value: unknown) {
  if (value == null) return null;
  if (key === "default_available_time") {
    const minutes = Number(value);
    return Number.isFinite(minutes) ? Math.max(0, Math.min(Math.round(minutes), 480)) : null;
  }
  if (key === "default_go_out" || key === "onboarding_completed" || key === "user_editable") {
    return Boolean(value);
  }
  if (key === "default_energy_level") return normalizeEnum(value, ["low", "medium", "high", "unknown"]);
  if (key === "default_people") return normalizeEnum(value, ["solo", "pair", "group", "flexible", "unknown"]);
  if (key === "default_budget_level") return normalizeEnum(value, ["free", "low", "medium", "high", "unknown"]);
  if (key === "indoor_outdoor_preference") return normalizeEnum(value, ["indoor", "outdoor", "flexible", "unknown"]);
  if (key === "raw_answers" && typeof value === "object" && !Array.isArray(value)) return value;
  if (Array.isArray(value)) return readStringArray(value);
  return String(value).trim();
}

function normalizeEnum(value: unknown, allowed: string[]) {
  const normalized = String(value ?? "").trim();
  return allowed.includes(normalized) ? normalized : null;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))].slice(0, 50);
}

function normalizeNumberMap(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, raw]) => [key, Math.max(-1, Math.min(1, Number(raw)))])
      .filter(([, score]) => Number.isFinite(score as number))
  );
}

function readRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export async function writeRecommendationLog(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
  result: RecommendationResult
) {
  const { error } = await supabase.from("recommendation_logs").insert({
    request_id: result.request_id,
    user_id: userId,
    session_id: sessionId,
    context_snapshot: result.context_snapshot,
    selected_card_id: result.selected_card?.card_id ?? null,
    top5: result.top5,
    excluded_summary: result.excluded_summary,
    rule_version: result.rule_version,
    score_version: result.score_version
  });

  if (error) throw new Error(`write_recommendation_log_failed: ${error.message}`);
}

export async function createCardDraft(
  supabase: SupabaseClient,
  userId: string,
  inputType: DraftInputType,
  sourceAsset: Record<string, unknown>,
  draft: CardDraft
) {
  const { data, error } = await supabase
    .from("card_drafts")
    .insert({
      user_id: userId,
      input_type: inputType,
      source_asset: sourceAsset,
      draft,
      status: "draft"
    })
    .select("draft_id")
    .single();

  if (error) throw new Error(`create_card_draft_failed: ${error.message}`);
  return { draft_id: String(data.draft_id) };
}

export async function loadCardDraft(supabase: SupabaseClient, userId: string, draftId: string) {
  const { data, error } = await supabase
    .from("card_drafts")
    .select("*")
    .eq("draft_id", draftId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`load_card_draft_failed: ${error.message}`);
  if (!data) throw new Error("card_draft_not_found");
  return data as {
    draft_id: string;
    user_id: string;
    input_type: DraftInputType;
    source_asset: Record<string, unknown>;
    draft: CardDraft;
    status: string;
  };
}

export async function saveCardFromDraft(
  supabase: SupabaseClient,
  userId: string,
  draft: CardDraft,
  draftId?: string,
  sourceAsset?: Record<string, unknown> | null
) {
  const normalizedSourceAsset = {
    ...(sourceAsset ?? {}),
    ...(draftId ? { draft_id: draftId } : {})
  };
  const { data, error } = await supabase
    .from("entertainment_cards")
    .insert({
      user_id: userId,
      source_type: "personal",
      source_asset: Object.keys(normalizedSourceAsset).length > 0 ? normalizedSourceAsset : null,
      title: draft.title,
      subtitle: draft.subtitle ?? null,
      description: draft.description ?? null,
      content_category: draft.content_category,
      mood_tags: draft.mood_tags ?? [],
      duration_min: draft.duration_min,
      duration_max: draft.duration_max,
      energy_level: draft.energy_level,
      indoor_outdoor: draft.indoor_outdoor,
      prep_cost: draft.prep_cost,
      people: draft.people ?? "unknown",
      budget_level: draft.budget_level ?? "unknown",
      location_type: draft.location_type ?? "unknown",
      distance_level: draft.distance_level ?? "unknown",
      reservation_required: draft.reservation_required ?? null,
      ticket_required: draft.ticket_required ?? null,
      weather_dependency: draft.weather_dependency ?? "unknown",
      constraint_tags: draft.constraint_tags ?? [],
      status: draft.eligible_for_draw ? "active" : "pending",
      eligible_for_draw: draft.eligible_for_draw,
      missing_fields: draft.missing_fields ?? [],
      confidence: draft.confidence ?? {},
      rule_version: "filter_v1",
      score_version: "score_v1"
    })
    .select("*")
    .single();

  if (error) throw new Error(`save_card_from_draft_failed: ${error.message}`);

  if (draftId) {
    const { error: draftUpdateError } = await supabase
      .from("card_drafts")
      .update({
        status: "saved",
        saved_card_id: data.card_id,
        updated_at: new Date().toISOString()
      })
      .eq("draft_id", draftId)
      .eq("user_id", userId);

    if (draftUpdateError) throw new Error(`mark_card_draft_saved_failed: ${draftUpdateError.message}`);
  }

  const [card] = await withSignedCardImages(supabase, [mapCardRow(data)]);
  return {
    card,
    saved_card: card,
    eligible_for_draw: Boolean(data.eligible_for_draw),
    missing_fields: (data.missing_fields as string[] | null) ?? []
  };
}

export async function updateUserCard(
  supabase: SupabaseClient,
  userId: string,
  cardId: string,
  payload: CardUpdatePayload
) {
  const { data: existing, error: loadError } = await supabase
    .from("entertainment_cards")
    .select("*")
    .eq("card_id", cardId)
    .eq("user_id", userId)
    .maybeSingle();

  if (loadError) throw new Error(`load_card_for_update_failed: ${loadError.message}`);
  if (!existing) throw new Error("personal_card_not_found");

  const sanitized = sanitizeCardUpdates(payload.updates ?? {});
  const merged = {
    ...existing,
    ...sanitized
  };
  const missingFields = computeMissingFields({
    duration_min: Number(merged.duration_min ?? 0),
    duration_max: Number(merged.duration_max ?? 0),
    energy_level: merged.energy_level,
    indoor_outdoor: merged.indoor_outdoor,
    prep_cost: merged.prep_cost
  });

  const patch: Record<string, unknown> = {
    ...sanitized,
    missing_fields: missingFields,
    eligible_for_draw: missingFields.length === 0,
    updated_at: new Date().toISOString()
  };

  if (payload.action === "archive") {
    patch.status = "archived";
    patch.cooling_until = null;
  } else if (payload.action === "complete") {
    patch.status = "completed";
    patch.cooling_until = null;
  } else if (payload.action === "cool") {
    patch.status = "cooling";
    patch.cooling_until = payload.cooling_until ?? defaultCoolingUntil();
  } else if (payload.action === "restore") {
    patch.status = missingFields.length === 0 ? "active" : "pending";
    patch.cooling_until = null;
  } else if (!("status" in sanitized)) {
    patch.status = missingFields.length === 0 ? "active" : "pending";
  }

  const { data, error } = await supabase
    .from("entertainment_cards")
    .update(patch)
    .eq("card_id", cardId)
    .eq("user_id", userId)
    .select("*")
    .single();

  if (error) throw new Error(`update_card_failed: ${error.message}`);
  const [card] = await withSignedCardImages(supabase, [mapCardRow(data)]);
  return { card };
}

export async function deleteUserCard(
  supabase: SupabaseClient,
  storageSupabase: SupabaseClient,
  userId: string,
  cardId: string
) {
  const { data: existing, error: loadError } = await supabase
    .from("entertainment_cards")
    .select("card_id, user_id, source_type, source_asset")
    .eq("card_id", cardId)
    .eq("user_id", userId)
    .maybeSingle();

  if (loadError) throw new Error(`load_card_for_delete_failed: ${loadError.message}`);
  if (!existing) throw new Error("personal_card_not_found");
  if (existing.source_type !== "personal") throw new Error("only_personal_cards_can_be_deleted");

  const imagePath = readImagePath(existing.source_asset as Card["source_asset"]);

  const { error: deleteError } = await supabase
    .from("entertainment_cards")
    .delete()
    .eq("card_id", cardId)
    .eq("user_id", userId);

  if (deleteError) throw new Error(`delete_card_failed: ${deleteError.message}`);

  if (imagePath) {
    const { error: storageError } = await storageSupabase.storage
      .from("card-assets")
      .remove([imagePath]);
    if (storageError) {
      console.warn(`delete_card_asset_failed: ${storageError.message}`);
    }
  }

  return {
    card_id: cardId,
    deleted: true
  };
}

export async function copyPresetCard(
  supabase: SupabaseClient,
  userId: string,
  presetCardId: string,
  edits: Record<string, unknown> = {}
) {
  const { data, error } = await supabase
    .from("entertainment_cards")
    .select("*")
    .eq("card_id", presetCardId)
    .eq("source_type", "preset")
    .maybeSingle();

  if (error) throw new Error(`load_preset_card_failed: ${error.message}`);
  if (!data) throw new Error("preset_card_not_found");

  const card = await copyPresetToPersonalCard(supabase, mapCardRow(data), userId, sanitizeCardUpdates(edits));
  return {
    card,
    saved_card: card,
    eligible_for_draw: card.eligible_for_draw,
    missing_fields: card.missing_fields
  };
}

function defaultCoolingUntil() {
  return new Date(Date.now() + 72 * 3600000).toISOString();
}

function sanitizeCardUpdates(updates: Record<string, unknown>) {
  const allowed = new Set([
    "title",
    "subtitle",
    "description",
    "content_category",
    "mood_tags",
    "duration_min",
    "duration_max",
    "energy_level",
    "indoor_outdoor",
    "prep_cost",
    "people",
    "budget_level",
    "location_type",
    "distance_level",
    "reservation_required",
    "ticket_required",
    "weather_dependency",
    "constraint_tags",
    "status",
    "cooling_until",
    "notes"
  ]);

  return Object.fromEntries(
    Object.entries(updates)
      .filter(([key]) => allowed.has(key))
      .map(([key, value]) => [key, normalizeFrontendValue(key, value)])
  );
}

function normalizeFrontendValue(key: string, value: unknown) {
  if (key === "indoor_outdoor" && value === "either") return "flexible";
  if (key === "duration_min" || key === "duration_max") return Number(value ?? 0);
  if (Array.isArray(value)) return value.map(String);
  return value;
}

export async function uploadCardAsset(
  supabase: SupabaseClient,
  userId: string,
  payload: {
    image_base64: string;
    image_mime_type?: string | null;
  }
) {
  const mimeType = payload.image_mime_type ?? "image/png";
  const extension = extensionForMimeType(mimeType);
  const imagePath = `${userId}/drafts/${crypto.randomUUID()}.${extension}`;
  const binary = Uint8Array.from(atob(payload.image_base64), (char) => char.charCodeAt(0));

  const { error } = await supabase.storage
    .from("card-assets")
    .upload(imagePath, binary, {
      contentType: mimeType,
      upsert: false
    });

  if (error) throw new Error(`upload_card_asset_failed: ${error.message}`);
  const imageUrl = await createSignedImageUrl(supabase, imagePath);

  return {
    image_path: imagePath,
    image_mime_type: mimeType,
    image_url: imageUrl
  };
}

export async function withSignedCardImages(supabase: SupabaseClient, cards: Card[]) {
  return Promise.all(cards.map(async (card) => {
    const imagePath = readImagePath(card.source_asset);
    if (!imagePath) return card;
    return {
      ...card,
      image_path: imagePath,
      image_url: await createSignedImageUrl(supabase, imagePath)
    };
  }));
}

async function createSignedImageUrl(supabase: SupabaseClient, imagePath: string) {
  const { data, error } = await supabase.storage
    .from("card-assets")
    .createSignedUrl(imagePath, 3600);

  if (error) {
    console.warn(`create_signed_card_asset_url_failed: ${error.message}`);
    return null;
  }
  return data?.signedUrl ?? null;
}

function readImagePath(sourceAsset: Card["source_asset"]) {
  if (!sourceAsset || typeof sourceAsset !== "object") return null;
  const value = sourceAsset.image_path;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function extensionForMimeType(mimeType: string) {
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("heic")) return "heic";
  return "png";
}

export async function writeFeedback(
  supabase: SupabaseClient,
  payload: {
    user_id: string;
    card_id: string;
    action: FeedbackAction;
    optional_reason?: string | null;
  }
) {
  const { data: card, error: cardError } = await supabase
    .from("entertainment_cards")
    .select("*")
    .eq("card_id", payload.card_id)
    .maybeSingle();

  if (cardError) throw new Error(`load_feedback_card_failed: ${cardError.message}`);
  if (!card) throw new Error("card_not_found");

  const { error: insertError } = await supabase.from("feedback_events").insert({
    user_id: payload.user_id,
    card_id: payload.card_id,
    action: payload.action,
    optional_reason: payload.optional_reason ?? null
  });

  if (insertError) throw new Error(`write_feedback_failed: ${insertError.message}`);

  const mappedCard = mapCardRow(card);
  const summary = {
    ...(mappedCard.feedback_summary ?? {}),
    [payload.action]: Number(card.feedback_summary?.[payload.action] ?? 0) + 1
  };

  const cardPatch = mappedCard.user_id === payload.user_id
    ? buildCardFeedbackPatch(payload.action, summary)
    : null;

  if (cardPatch) {
    const { error: updateCardError } = await supabase
      .from("entertainment_cards")
      .update(cardPatch)
      .eq("card_id", payload.card_id);

    if (updateCardError) throw new Error(`update_card_feedback_failed: ${updateCardError.message}`);
  }

  let createdPersonalCardId: string | null = null;
  if (payload.action === "save_preset" && mappedCard.source_type === "preset") {
    const copiedCard = await copyPresetToPersonalCard(supabase, mappedCard, payload.user_id);
    createdPersonalCardId = copiedCard.card_id;
  }

  const learningSignal = await updatePreferenceMemory(supabase, payload.user_id, mappedCard.content_category, payload.action);

  return {
    card_id: payload.card_id,
    action: payload.action,
    card_patch: cardPatch,
    created_personal_card_id: createdPersonalCardId,
    learning_signal: learningSignal
  };
}

function buildCardFeedbackPatch(action: FeedbackAction, feedbackSummary: Record<string, number>) {
  const now = new Date();
  const cooldownHours: Record<FeedbackAction, number> = {
    accept: 12,
    complete: 72,
    reroll: 2,
    not_suitable: 12,
    later: 72,
    dislike: 720,
    save_preset: 0
  };
  const coolingUntil = cooldownHours[action] > 0
    ? new Date(now.getTime() + cooldownHours[action] * 3600000).toISOString()
    : null;

  return {
    feedback_summary: feedbackSummary,
    status: action === "save_preset" ? "active" : "cooling",
    cooling_until: coolingUntil,
    updated_at: now.toISOString()
  };
}

async function updatePreferenceMemory(
  supabase: SupabaseClient,
  userId: string,
  category: string,
  action: FeedbackAction
) {
  const deltaByAction: Record<FeedbackAction, number> = {
    accept: 0.05,
    complete: 0.08,
    reroll: -0.02,
    not_suitable: 0,
    later: 0,
    dislike: -0.15,
    save_preset: 0.06
  };

  const delta = deltaByAction[action];

  const { data, error } = await supabase
    .from("user_memory")
    .select("preference_memory, explicit_profile")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`load_preference_for_update_failed: ${error.message}`);

  const preferenceMemory = data?.preference_memory ?? {};
  const categoryWeights = preferenceMemory.category_weights ?? {};
  const current = Number(categoryWeights[category] ?? 0);

  if (delta === 0) {
    return {
      category,
      previous_weight: current,
      weight_delta: 0,
      next_weight: current,
      long_term_impact: false
    };
  }

  const next = Math.max(-1, Math.min(1, current + delta));

  const { error: upsertError } = await supabase.from("user_memory").upsert({
    user_id: userId,
    preference_memory: {
      ...preferenceMemory,
      category_weights: {
        ...categoryWeights,
        [category]: next
      },
      updated_at: new Date().toISOString()
    },
    explicit_profile: data?.explicit_profile ?? { user_editable: true },
    updated_at: new Date().toISOString()
  });

  if (upsertError) throw new Error(`update_preference_memory_failed: ${upsertError.message}`);

  return {
    category,
    previous_weight: current,
    weight_delta: delta,
    next_weight: next,
    long_term_impact: true
  };
}

async function copyPresetToPersonalCard(
  supabase: SupabaseClient,
  presetCard: Card,
  userId: string,
  edits: Record<string, unknown> = {}
) {
  const merged = {
    ...presetCard,
    ...edits
  };
  const missingFields = computeMissingFields({
    duration_min: Number(merged.duration_min ?? 0),
    duration_max: Number(merged.duration_max ?? 0),
    energy_level: merged.energy_level,
    indoor_outdoor: merged.indoor_outdoor,
    prep_cost: merged.prep_cost
  });

  const normalizedSourceAsset = {
    ...(presetCard.source_asset ?? {}),
    copied_from: "preset",
    origin_preset_id: presetCard.card_id
  };
  const { data, error } = await supabase
    .from("entertainment_cards")
    .insert({
      user_id: userId,
      source_type: "personal",
      origin_preset_id: presetCard.card_id,
      source_asset: normalizedSourceAsset,
      title: merged.title,
      subtitle: merged.subtitle,
      description: merged.description,
      content_category: merged.content_category,
      mood_tags: merged.mood_tags ?? [],
      duration_min: merged.duration_min,
      duration_max: merged.duration_max,
      energy_level: merged.energy_level,
      indoor_outdoor: merged.indoor_outdoor,
      prep_cost: merged.prep_cost,
      people: merged.people ?? "unknown",
      budget_level: merged.budget_level ?? "unknown",
      location_type: merged.location_type ?? "unknown",
      distance_level: merged.distance_level ?? "unknown",
      reservation_required: merged.reservation_required ?? null,
      ticket_required: merged.ticket_required ?? null,
      weather_dependency: merged.weather_dependency ?? "unknown",
      constraint_tags: merged.constraint_tags ?? [],
      status: missingFields.length === 0 ? "active" : "pending",
      eligible_for_draw: missingFields.length === 0,
      missing_fields: missingFields,
      rule_version: "filter_v1",
      score_version: "score_v1"
    })
    .select("*")
    .single();

  if (error) throw new Error(`copy_preset_to_personal_failed: ${error.message}`);
  const [card] = await withSignedCardImages(supabase, [mapCardRow(data)]);
  return card;
}

function mapCardRow(row: Record<string, unknown>): Card {
  return {
    card_id: String(row.card_id),
    user_id: row.user_id == null ? null : String(row.user_id),
    source_type: row.source_type as Card["source_type"],
    origin_preset_id: row.origin_preset_id == null ? null : String(row.origin_preset_id),
    source_asset: row.source_asset as Card["source_asset"],
    image_path: readImagePath(row.source_asset as Card["source_asset"]),
    image_url: row.image_url == null ? null : String(row.image_url),
    title: String(row.title),
    subtitle: row.subtitle == null ? null : String(row.subtitle),
    description: row.description == null ? null : String(row.description),
    content_category: String(row.content_category),
    mood_tags: (row.mood_tags as string[] | null) ?? [],
    duration_min: Number(row.duration_min),
    duration_max: Number(row.duration_max),
    energy_level: row.energy_level as Card["energy_level"],
    indoor_outdoor: row.indoor_outdoor as Card["indoor_outdoor"],
    prep_cost: row.prep_cost as Card["prep_cost"],
    people: row.people as Card["people"],
    budget_level: row.budget_level as Card["budget_level"],
    location_type: String(row.location_type ?? "unknown"),
    distance_level: String(row.distance_level ?? "unknown"),
    reservation_required: row.reservation_required as boolean | null,
    ticket_required: row.ticket_required as boolean | null,
    weather_dependency: String(row.weather_dependency ?? "unknown"),
    constraint_tags: (row.constraint_tags as string[] | null) ?? [],
    status: row.status as Card["status"],
    eligible_for_draw: Boolean(row.eligible_for_draw),
    missing_fields: (row.missing_fields as string[] | null) ?? [],
    cooling_until: row.cooling_until == null ? null : String(row.cooling_until),
    last_recommended_at: row.last_recommended_at == null ? null : String(row.last_recommended_at),
    recommend_count: Number(row.recommend_count ?? 0),
    feedback_summary: row.feedback_summary as Record<string, number> | null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}
