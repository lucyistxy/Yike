export const CONTRACT_VERSION = "1.0.0" as const;

export type ContentCategory =
  | "book"
  | "movie"
  | "series"
  | "food"
  | "exhibition"
  | "game"
  | "craft"
  | "walk"
  | "other";

export type Level = "low" | "medium" | "high";
export type SourceType = "personal" | "preset";
export type SourceScope = SourceType | "both";
export type CardStatus = "active" | "cooling" | "archived" | "completed";
export type MoodPreference = "random" | "relax" | "active" | "quiet";

export interface Card {
  card_id: string;
  draft_id?: string;
  title: string;
  content_category: ContentCategory;
  duration_min?: number;
  duration_max?: number;
  energy_level?: Level;
  indoor_outdoor?: "indoor" | "outdoor" | "either";
  prep_cost?: Level;
  people?: number;
  budget_level?: Level;
  constraint_tags?: string[];
  image_url?: string | null;
  image_path?: string | null;
  source_asset?: Record<string, unknown> | null;
  source_type: SourceType;
  status: CardStatus;
  eligible_for_draw: boolean;
  missing_fields: string[];
  origin_preset_id?: string;
}

export interface DrawContext {
  available_time_min: number;
  source_scope: SourceScope;
  energy_level?: Level;
  outing_preference?: "stay_in" | "can_go_out";
  people?: number;
  budget_level?: Level;
  mood_preference?: MoodPreference;
  session_constraints?: string[];
  weather_context?: WeatherContext | null;
  location?: {
    city?: string | null;
    timezone?: string;
  } | null;
}

export interface WeatherContext {
  source?: string;
  city?: string | null;
  weather?: string | null;
  temperature?: number | null;
  rain_probability?: number | null;
  weather_tags: string[];
  observed_at?: string;
}

export interface GatewayErrorShape {
  code: string;
  message: string;
  retryable: boolean;
  field_errors?: Record<string, string>;
  request_id: string;
}

export interface ParseCardInput {
  text?: string;
  image?: File;
  uploaded_asset_id?: string;
}

export interface ParseCardResult {
  draft_card: Card;
  field_confidence: Array<{ field: string; confidence: number }>;
  missing_fields: string[];
  duplicate_candidates: Array<{ card_id: string; title: string; similarity: number }>;
}

export interface SaveCardResult {
  saved_card: Card;
  eligible_for_draw: boolean;
  missing_fields: string[];
}

export type DrawCardResult =
  | {
      type: "draw_result";
      card: Card;
      reasons: string[];
      score: number;
      weight: number;
      candidate_count: number;
      candidate_version: string;
    }
  | {
      type: "no_candidate";
      message: string;
      excluded_counts: Record<string, number>;
      relax_suggestions: Array<{ field: string; label: string; value: string | number | boolean }>;
    };

export type FeedbackAction = "accept" | "complete" | "not_suitable" | "later" | "dislike";

export interface FeedbackResult {
  card_id: string;
  action: FeedbackAction;
  status: CardStatus;
  explanation: string;
  weight_delta?: number;
  cooling_until?: string;
  effect?: {
    short_term: string;
    long_term: string;
    cooldown_hours: number;
  };
  learning_signal?: {
    category: string;
    previous_weight: number;
    weight_delta: number;
    next_weight: number;
    long_term_impact: boolean;
  };
  card_patch?: {
    status?: CardStatus;
    cooling_until?: string | null;
  } | null;
}

export interface UserProfile {
  user_id: string;
  onboarding_completed: boolean;
  explicit_profile: {
    nickname?: string | null;
    city?: string | null;
    timezone?: string | null;
    default_available_time?: number | null;
    default_energy_level?: Level | "unknown" | null;
    default_go_out?: boolean | null;
    default_people?: "solo" | "pair" | "group" | "flexible" | "unknown" | null;
    default_budget_level?: "free" | Level | "unknown" | null;
    preferred_categories?: string[];
    disliked_categories?: string[];
    mode_preferences?: string[];
    indoor_outdoor_preference?: "indoor" | "outdoor" | "flexible" | "unknown" | null;
    travel_preference?: string | null;
    dietary_constraints?: string[];
    active_constraints?: string[];
    accessibility_constraints?: string[];
    content_blacklist_keywords?: string[];
    usual_free_time_windows?: string[];
    raw_answers?: Record<string, unknown>;
    user_editable?: boolean;
    profile_version?: string;
  };
  preference_memory?: Record<string, unknown>;
  updated_at?: string | null;
}

export interface SaveProfileInput {
  onboarding_completed?: boolean;
  explicit_profile: UserProfile["explicit_profile"];
  preference_memory?: Record<string, unknown>;
}

export interface AgentGateway {
  getProfile(): Promise<UserProfile>;
  saveProfile(input: SaveProfileInput): Promise<UserProfile>;
  listCards(input?: { source_scope?: SourceScope; status?: CardStatus; eligible_only?: boolean; q?: string; limit?: number }): Promise<{ cards: Card[]; count: number }>;
  getWeatherContext(input: { city?: string | null; timezone?: string | null; latitude?: number | null; longitude?: number | null }): Promise<WeatherContext>;
  parseCard(input: ParseCardInput): Promise<ParseCardResult>;
  saveCard(card: Card): Promise<SaveCardResult>;
  archiveCard(card_id: string): Promise<{ card: Card }>;
  deleteCard(card_id: string): Promise<{ card_id: string; deleted: boolean }>;
  drawCard(input: { context: DrawContext; recent_card_ids: string[] }): Promise<DrawCardResult>;
  submitFeedback(input: { card_id: string; action: FeedbackAction; reason?: string; actual_duration_min?: number }): Promise<FeedbackResult>;
  copyPreset(input: { preset_card_id: string; edits?: Partial<Card> }): Promise<SaveCardResult>;
}
