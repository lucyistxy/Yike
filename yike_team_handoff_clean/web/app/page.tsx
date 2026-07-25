"use client";

/* eslint-disable @next/next/no-img-element -- 本地海獭资源与用户上传预览不需要远程图片优化 */

import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createAgentGateway } from "../lib/agent";
import { clearAuthSession, persistAuthSession } from "../lib/agent/http-gateway";
import type { ActivityHistoryEvent, Card as ContractCard, ContentCategory, DrawContext, FeedbackAction, FeedbackResult, MemoryItemAction, MemorySummary, UserProfile, WeatherContext } from "../lib/contracts/v1";

type View = "home" | "pool" | "add" | "memory" | "achievements" | "result" | "activity";
type Source = "personal" | "preset";
type SourceScope = Source | "both";
type Level = "low" | "medium" | "high";
type Mood = "random" | "relax" | "active" | "quiet";
type DrawPhase = "idle" | "holding" | "lifting" | "waiting" | "revealing" | "settled";
type FallbackStep = "auth" | "onboarding" | "add" | "draw" | "pool" | "feedback";

type Card = {
  id: string;
  draftId?: string;
  title: string;
  category: string;
  duration: number;
  energy: Level;
  outing: "indoor" | "outdoor" | "either";
  prep: Level;
  source: Source;
  status: "active" | "cooling" | "archived" | "completed";
  eligible: boolean;
  imageUrl?: string | null;
  imagePath?: string | null;
  sourceAsset?: Record<string, unknown> | null;
};

type ActivitySession = {
  id: string;
  card: Card;
  startedAt: string;
  estimatedFinishAt: string;
  rewardPetals: number;
  status: "active" | "completed";
  completedAt?: string;
};

type PetalLedgerEntry = {
  id: string;
  amount: number;
  cardTitle: string;
  cardSource: Source;
  reason: string;
  occurredAt: string;
};

type Context = {
  time: number;
  energy: Level;
  outing: "stay_in" | "can_go_out";
  mood: Mood;
  source: SourceScope;
  constraints: string[];
};

type FeedbackInsight = {
  actionLabel: string;
  shortTerm: string;
  longTerm: string;
  memoryShift: string;
  cooldown: string;
  tone: "positive" | "neutral" | "negative";
};

type OnboardingForm = {
  nickname: string;
  city: string;
  defaultAvailableTime: number;
  defaultEnergyLevel: Level;
  indoorOutdoorPreference: "indoor" | "outdoor" | "flexible";
  defaultPeople: "solo" | "pair" | "group" | "flexible";
  defaultBudgetLevel: "free" | Level;
  preferredCategories: string[];
  dislikedCategories: string[];
};

type AmbientContext = {
  localTime: string;
  hour: number;
  timezone: string;
  weather: WeatherContext | null;
  loading: boolean;
  notice: string;
};

const DEFAULT_CONTEXT: Context = {
  time: 45,
  energy: "low",
  outing: "stay_in",
  mood: "random",
  source: "both",
  constraints: [],
};

const navItems: Array<{ id: Exclude<View, "result" | "activity">; label: string; icon: string }> = [
  { id: "home", label: "此刻", icon: "⌂" },
  { id: "pool", label: "卡池", icon: "◇" },
  { id: "add", label: "添加", icon: "+" },
  { id: "memory", label: "记忆", icon: "✦" },
  { id: "achievements", label: "潮汐花笺", icon: "✿" },
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const levelText = { low: "想省点力", medium: "刚刚好", high: "还有元气" };
const sourceText = { personal: "我的收藏", preset: "小宜推荐", both: "都可以" };
const moodText = { random: "随缘就好", relax: "彻底放松", active: "来点元气", quiet: "安静独处" };
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const realAgentEnabled = Boolean(process.env.NEXT_PUBLIC_YIKE_AGENT_BASE_URL);

const categoryToContract: Record<string, ContentCategory> = { 书籍: "book", 电影: "movie", 剧集: "series", 美食: "food", 展览: "exhibition", 游戏: "game", 手作: "craft", 散步: "walk", 其他: "other", 播客: "other" };
const categoryFromContract: Record<ContentCategory, string> = { book: "书籍", movie: "电影", series: "剧集", food: "美食", exhibition: "展览", game: "游戏", craft: "手作", walk: "散步", other: "其他" };
const shellCategories: Array<{ category: string; contract: ContentCategory; image: string; note: string }> = [
  { category: "书籍", contract: "book", image: "/art/yike/lavender-book.png", note: "一页一页展开" },
  { category: "电影", contract: "movie", image: "/art/yike/lavender-movie.png", note: "让故事慢慢旋转" },
  { category: "剧集", contract: "series", image: "/art/yike/lavender-series.png", note: "留住连续的期待" },
  { category: "美食", contract: "food", image: "/art/yike/lavender-food.png", note: "收藏一口好滋味" },
  { category: "展览", contract: "exhibition", image: "/art/yike/lavender-exhibition.png", note: "把灵感带回海湾" },
  { category: "游戏", contract: "game", image: "/art/yike/lavender-game.png", note: "进入一个小世界" },
  { category: "手作", contract: "craft", image: "/art/yike/lavender-craft.png", note: "在手心慢慢成形" },
  { category: "散步", contract: "walk", image: "/art/yike/lavender-walk.png", note: "沿着风去走一走" },
  { category: "其他", contract: "other", image: "/art/yike/lavender-other.png", note: "还没被命名的惊喜" },
];
type AchievementCategory = "record" | "growth" | "mood" | "daily";
type AchievementMetric = "completed" | "petals" | "personal" | "preset" | "uniqueDays";
type Achievement = {
  id: string;
  category: AchievementCategory;
  title: string;
  body: string;
  image: string;
  metric: AchievementMetric;
  target: number;
};
type AchievementProgress = Achievement & {
  current: number;
  unlocked: boolean;
  unlockedAt?: string;
};
const achievementCategories: Array<{ id: AchievementCategory | "all"; label: string; total: number; image: string }> = [
  { id: "all", label: "全部成就", total: 30, image: "/art/yike/lavender-other.png" },
  { id: "record", label: "花间记录", total: 10, image: "/art/yike/lavender-book.png" },
  { id: "growth", label: "慢慢成长", total: 8, image: "/art/yike/garden-sprout-3.png" },
  { id: "mood", label: "心情花园", total: 6, image: "/art/yike/achievement-plant-dew.png" },
  { id: "daily", label: "日常芬芳", total: 6, image: "/art/yike/lavender-craft.png" },
];
const achievements: Achievement[] = [
  { id: "first-heart", category: "record", title: "第一株心动", body: "第一次留下属于你和海湾的温柔记忆", image: "/art/yike/achievement-first-heart.png", metric: "completed", target: 1 },
  { id: "plant-dew", category: "growth", title: "种下一片紫雾", body: "收集 10 份美好记录，让小花园慢慢生长", image: "/art/yike/achievement-plant-dew.png", metric: "petals", target: 10 },
  { id: "first-scent", category: "record", title: "第一缕花香", body: "完成第一次陪伴记录", image: "/art/yike/achievement-first-scent.png", metric: "completed", target: 1 },
  { id: "lavender-heart", category: "daily", title: "连续两日花开", body: "在两个不同日子留下生活记录", image: "/art/yike/achievement-lavender-heart.png", metric: "uniqueDays", target: 2 },
  { id: "old-letter", category: "record", title: "旧日花笺", body: "翻开过去，重新遇见曾经的温柔", image: "/art/yike/achievement-old-letter.png", metric: "completed", target: 3 },
  { id: "nest-scent", category: "mood", title: "小窝里的香气", body: "在安心的小窝里分享 5 次心情", image: "/art/yike/achievement-nest-scent.png", metric: "personal", target: 5 },
  { id: "set-out", category: "daily", title: "带着花香出发", body: "和小宜一起完成一次现实中的小目标", image: "/art/yike/achievement-set-out.png", metric: "preset", target: 1 },
  { id: "misty-wanderer", category: "growth", title: "紫雾漫游者", body: "收集 40 片花露，探索更多生活主题", image: "/art/yike/achievement-misty-wanderer.png", metric: "petals", target: 40 },
];
const feedbackActionText: Record<FeedbackAction, string> = { accept: "就它了", complete: "已完成", reroll: "换一张", not_suitable: "当下不合适", later: "以后再说", dislike: "不喜欢" };
const onboardingCategories = ["电影", "剧集", "书籍", "美食", "展览", "游戏", "手作", "散步"];
const badWeatherTags = ["rain", "snow", "thunderstorm", "fog", "hot", "cold"];
const defaultOnboardingForm: OnboardingForm = {
  nickname: "",
  city: "",
  defaultAvailableTime: 45,
  defaultEnergyLevel: "low",
  indoorOutdoorPreference: "flexible",
  defaultPeople: "solo",
  defaultBudgetLevel: "low",
  preferredCategories: [],
  dislikedCategories: [],
};

const fallbackDemoCard: Card = {
  id: "demo-personal-billiards",
  title: "去台球厅打一小时台球",
  category: "游戏",
  duration: 60,
  energy: "medium",
  outing: "outdoor",
  prep: "low",
  source: "personal",
  status: "active",
  eligible: true,
};

const fallbackDraftCard: Card = {
  ...fallbackDemoCard,
  id: "demo-draft-billiards",
  draftId: "demo-draft-billiards",
  title: "去台球厅打台球",
};

const fallbackPresetCard: Card = {
  id: "demo-preset-film-night",
  title: "做一次房间里的迷你观影夜",
  category: "电影",
  duration: 90,
  energy: "low",
  outing: "indoor",
  prep: "medium",
  source: "preset",
  status: "active",
  eligible: true,
};

const fallbackProfile: UserProfile = {
  user_id: "demo-user",
  onboarding_completed: true,
  explicit_profile: {
    nickname: "演示用户",
    city: "上海",
    timezone: "Asia/Shanghai",
    default_available_time: 60,
    default_energy_level: "low",
    indoor_outdoor_preference: "flexible",
    preferred_categories: ["game", "movie", "food"],
    user_editable: true,
    profile_version: "profile_v1",
  },
  preference_memory: {
    category_weights: { game: 0.24, movie: 0.18, food: 0.12 },
    indoor_outdoor_preference: "flexible",
    duration_preference: [30, 90],
  },
  updated_at: new Date().toISOString(),
};

function formatDelta(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
}

function petalRewardForCard(card: Card) {
  return card.source === "preset" ? 8 : 3;
}

function formatClock(value: string) {
  return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function formatRemaining(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours} 小时 ${String(minutes).padStart(2, "0")} 分`;
  if (minutes > 0) return `${minutes} 分 ${String(seconds).padStart(2, "0")} 秒`;
  return `${seconds} 秒`;
}

function buildFeedbackInsight(card: Card, response: FeedbackResult): FeedbackInsight {
  const signal = response.learning_signal;
  const rawCategory = signal?.category;
  const learnedCategory = rawCategory && rawCategory in categoryFromContract ? categoryFromContract[rawCategory as ContentCategory] : card.category;
  const memoryShift = !signal
    ? "小宜还在慢慢懂你"
    : signal.long_term_impact
      ? `${learnedCategory} ${formatDelta(signal.weight_delta)}，当前权重 ${signal.next_weight.toFixed(2)}`
      : `${learnedCategory} 权重不变`;
  const cooldownHours = response.effect?.cooldown_hours ?? 0;
  const cooldown = cooldownHours > 0 ? `${cooldownHours} 小时内降低再次出现概率` : "立即进入个人卡池";
  const tone = response.action === "dislike" ? "negative" : response.action === "not_suitable" || response.action === "later" ? "neutral" : "positive";

  return {
    actionLabel: feedbackActionText[response.action],
    shortTerm: response.effect?.short_term ?? response.explanation,
    longTerm: response.effect?.long_term ?? "反馈已写入记忆策略",
    memoryShift,
    cooldown,
    tone,
  };
}

function summarizePreferenceMemory(profile?: UserProfile) {
  const weights = profile?.preference_memory?.category_weights;
  if (!weights || typeof weights !== "object") return "";
  return Object.entries(weights as Record<string, unknown>)
    .map(([category, value]) => ({ category, value: Number(value) }))
    .filter((item) => Number.isFinite(item.value) && Math.abs(item.value) >= 0.01)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 3)
    .map((item) => `${categoryLabel(item.category)} ${formatDelta(item.value)}`)
    .join("，");
}

function profileHasMeaningfulAnswers(profile?: UserProfile | null) {
  const explicit = profile?.explicit_profile;
  if (!explicit) return false;
  return Boolean(
    explicit.default_available_time ||
    explicit.default_energy_level ||
    explicit.indoor_outdoor_preference ||
    explicit.city ||
    explicit.nickname ||
    explicit.preferred_categories?.length ||
    explicit.disliked_categories?.length
  );
}

function shouldTreatAsOnboarded(profile: UserProfile, cardCount: number) {
  if (profile.onboarding_completed || profile.explicit_profile?.onboarding_completed === true) return true;
  return cardCount > 0 || profileHasMeaningfulAnswers(profile) || Boolean(summarizePreferenceMemory(profile));
}

function withOnboardingCompleted(profile: UserProfile): UserProfile {
  return {
    ...profile,
    onboarding_completed: true,
    explicit_profile: {
      ...profile.explicit_profile,
      onboarding_completed: true,
    },
  };
}

function buildFallbackMemorySummary(): MemorySummary {
  const now = new Date();
  return {
    user_id: "demo-user",
    generated_at: now.toISOString(),
    feedback_calendar: {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      month_label: `${now.getFullYear()} 年 ${now.getMonth() + 1} 月`,
      current_day: now.getDate(),
      active_days: [now.getDate()],
      pearl_count: 4,
      feedback_count: 4,
      positive_count: 3,
      completed_count: 1,
    },
    long_term_preference: {
      headline: "轻松出门 · 低准备 · 60 分钟",
      tags: [
        { label: "喜欢类别", value: "游戏/电影/美食" },
        { label: "准备程度", value: "低" },
        { label: "可用时长", value: "30-90 分钟" },
      ],
      evidence: "来自兜底演示路径，不写入真实账号。",
    },
    memory_items: [
      {
        item_key: "demo_game",
        title: "对轻量娱乐活动有兴趣",
        description: "台球、轻量游戏、观影夜会在合适时间进入候选。",
        source: "演示反馈",
        action_state: "active",
        evidence_count: 3,
        last_seen_at: now.toISOString(),
        detail: {},
      },
      {
        item_key: "demo_low_prep",
        title: "偏好准备成本低一点",
        description: "疲惫或晚间会优先推荐不用复杂准备的内容。",
        source: "演示初始化",
        action_state: "active",
        evidence_count: 2,
        last_seen_at: now.toISOString(),
        detail: {},
      },
    ],
    non_persistent: [
      { label: "经期不舒服", reason: "只在当次会话中使用" },
      { label: "不想久站", reason: "只影响本次硬过滤" },
      { label: "不想费心打扮", reason: "只用于当次准备成本判断" },
    ],
  };
}

function buildFallbackFeedback(card: Card, action: FeedbackAction): FeedbackResult {
  const delta = action === "complete" ? 0.08 : action === "dislike" ? -0.15 : action === "accept" ? 0.04 : 0;
  const status = action === "complete" ? "completed" : action === "later" || action === "not_suitable" ? "cooling" : action === "dislike" ? "archived" : "active";
  return {
    card_id: card.id,
    action,
    status,
    explanation: action === "accept" ? "已记录本次选择" : "演示反馈已记录",
    effect: {
      short_term: action === "accept" ? "本轮不再重复推荐" : "本轮会调整这张卡的出现机会",
      long_term: action === "not_suitable" || action === "later" ? "不写成长期不喜欢" : "相似类别会轻微调整权重",
      cooldown_hours: action === "accept" ? 12 : action === "complete" ? 72 : 24,
    },
    learning_signal: {
      category: categoryToContract[card.category] ?? "other",
      previous_weight: 0.2,
      weight_delta: delta,
      next_weight: 0.2 + delta,
      long_term_impact: delta !== 0,
    },
    weight_delta: delta,
    card_patch: { status },
  };
}

function buildFallbackHistoryEvents(): ActivityHistoryEvent[] {
  const now = new Date();
  return [
    { event_id: "demo-draw-billiards", kind: "draw", card_id: fallbackDemoCard.id, title: fallbackDemoCard.title, content_category: "game", occurred_at: now.toISOString(), is_demo: true },
    { event_id: "demo-feedback-billiards", kind: "feedback", action: "complete", card_id: fallbackDemoCard.id, title: fallbackDemoCard.title, content_category: "game", occurred_at: now.toISOString(), is_demo: true },
  ];
}

function categoryLabel(category: string) {
  const labels: Record<string, string> = {
    book: "书籍",
    movie: "电影",
    series: "剧集",
    restaurant: "美食",
    cafe: "美食",
    food: "美食",
    exhibition: "展览",
    game: "游戏",
    craft: "手作",
    walk: "散步",
    other: "其他",
  };
  return labels[category] ?? category;
}

function makeAmbientContext(): AmbientContext {
  const now = new Date();
  return {
    localTime: now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
    hour: now.getHours(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
    weather: null,
    loading: false,
    notice: "时间和天气，小宜已经替你看过啦",
  };
}

function weatherText(weather: WeatherContext | null) {
  if (!weather) return "小宜还没看到天气呢";
  const label: Record<string, string> = { clear: "晴", cloudy: "多云", fog: "有雾", rain: "有雨", snow: "有雪", thunderstorm: "雷雨", unknown: "天气未知" };
  const name = weather.weather ? label[weather.weather] ?? weather.weather : "天气未知";
  const temperature = weather.temperature == null || Number.isNaN(weather.temperature) ? "" : ` · ${Math.round(weather.temperature)}°C`;
  return `${name}${temperature}`;
}

function buildCareNotice(card: Card, context: Context, ambient: AmbientContext) {
  const notices: string[] = [];
  const wantsOuting = context.outing === "can_go_out" || card.outing === "outdoor";
  if (wantsOuting && ambient.hour >= 21) {
    notices.push("现在已经比较晚了，出门的话把路线和回程先想好，别把今晚安排得太满。");
  }
  const tags = ambient.weather?.weather_tags ?? [];
  if (tags.some((tag) => badWeatherTags.includes(tag))) {
    const weather = ambient.weather;
    if (tags.includes("rain") || tags.includes("thunderstorm")) notices.push("外面天气不太稳定，记得带伞；如果不想折腾，可以优先换一张室内卡。");
    else if (tags.includes("hot")) notices.push("气温偏高，出门记得补水，尽量避开太晒或需要久走的安排。");
    else if (tags.includes("cold")) notices.push("外面有点冷，出门多加一层，今晚选轻量一点也很好。");
    else if (tags.includes("fog") || tags.includes("snow")) notices.push("天气能见度或路况可能不太友好，出门前确认交通和安全。");
    if (weather?.temperature != null && !Number.isNaN(weather.temperature)) {
      notices.push(`当前约 ${Math.round(weather.temperature)}°C。`);
    }
  }
  return notices.join(" ");
}

function noCandidateHelp(context: Context) {
  if (context.time >= 60) {
    return "现在是已经足够宽，可能是来源、出门范围或卡片冷却状态限制了候选。可以同时看看产品推荐，或把行动范围改成均可。";
  }
  return "这些条件有点严格。可以把今晚想留给自己多久？放宽一点，或同时看看产品推荐。";
}

function toContractCard(card: Card): ContractCard {
  return { card_id: card.id, draft_id: card.draftId, title: card.title, content_category: categoryToContract[card.category] ?? "other", duration_min: card.duration, duration_max: card.duration, energy_level: card.energy, indoor_outdoor: card.outing, prep_cost: card.prep, image_url: card.imageUrl, image_path: card.imagePath, source_asset: card.sourceAsset, source_type: card.source, status: card.status, eligible_for_draw: card.eligible, missing_fields: card.eligible ? [] : ["duration_min", "energy_level", "indoor_outdoor", "prep_cost"] };
}

function fromContractCard(card: ContractCard): Card {
  return { id: card.card_id, draftId: card.draft_id, title: card.title, category: categoryFromContract[card.content_category], duration: card.duration_max ?? card.duration_min ?? 0, energy: card.energy_level ?? "low", outing: card.indoor_outdoor ?? "either", prep: card.prep_cost ?? "low", source: card.source_type, status: card.status, eligible: card.eligible_for_draw, imageUrl: card.image_url, imagePath: card.image_path, sourceAsset: card.source_asset };
}

function toDrawContext(context: Context, ambient?: AmbientContext): DrawContext {
  return {
    available_time_min: context.time,
    source_scope: context.source,
    energy_level: context.energy,
    outing_preference: context.outing,
    mood_preference: context.mood,
    session_constraints: [...context.constraints, ...(ambient?.weather?.weather_tags ?? [])],
    weather_context: ambient?.weather ?? null,
    location: { timezone: ambient?.timezone ?? "Asia/Shanghai", city: ambient?.weather?.city ?? null },
  };
}

function Chip({ active, children, onClick, subtle = false }: { active?: boolean; children: React.ReactNode; onClick?: () => void; subtle?: boolean }) {
  return <button type="button" className={`chip ${active ? "active" : ""} ${subtle ? "subtle" : ""}`} onClick={onClick}>{children}</button>;
}

function SourceBadge({ source }: { source: Source }) {
  return <span className={`source-badge ${source}`}>{source === "personal" ? "我的收藏" : "小宜推荐"}</span>;
}

function EmptyState({ title, body, action, onAction }: { title: string; body: string; action?: string; onAction?: () => void }) {
  return <div className="empty-state"><img className="empty-shell-art" src="/art/yike/lavender-other.png" alt="" /><h3>{title}</h3><p>{body}</p>{action && <button className="secondary-button" type="button" onClick={onAction}>{action}</button>}</div>;
}

function shellForCategory(category: string) {
  return shellCategories.find((item) => item.category === category) ?? shellCategories[shellCategories.length - 1];
}

function achievementMetricValue(metric: AchievementMetric, ledger: PetalLedgerEntry[], petalBalance: number) {
  if (metric === "petals") return petalBalance;
  if (metric === "personal") return ledger.filter((entry) => entry.cardSource === "personal").length;
  if (metric === "preset") return ledger.filter((entry) => entry.cardSource === "preset").length;
  if (metric === "uniqueDays") return new Set(ledger.map((entry) => localDateKey(new Date(entry.occurredAt)))).size;
  return ledger.length;
}

function buildAchievementProgress(ledger: PetalLedgerEntry[], petalBalance: number): AchievementProgress[] {
  return achievements.map((achievement, index) => {
    const current = achievementMetricValue(achievement.metric, ledger, petalBalance);
    const unlocked = current >= achievement.target;
    return { ...achievement, current, unlocked, unlockedAt: unlocked ? ledger[index % Math.max(1, ledger.length)]?.occurredAt ?? new Date().toISOString() : undefined };
  });
}

function achievementDateLabel(value?: string) {
  if (!value) return "待解锁";
  return new Date(value).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }).replace("/", ".");
}

const otterArtMap: Record<string, string> = {
  书籍: "/art/yike/otter-reading.png",
  电影: "/art/yike/otter-movie.png",
  剧集: "/art/yike/otter-series.png",
  美食: "/art/yike/otter-food.png",
  展览: "/art/yike/otter-exhibition.png",
  游戏: "/art/yike/otter-game.png",
  手作: "/art/yike/otter-craft.png",
  散步: "/art/yike/otter-walk.png",
  其他: "/art/yike/otter-other.png",
};

function otterArtForCategory(category: string) {
  return otterArtMap[category] ?? otterArtMap["其他"];
}

function BrandLockup({ compact = false }: { compact?: boolean }) {
  return <div className={`brand-lockup art-brand ${compact ? "compact" : ""}`}><img src="/art/yike/logo-yike-lavender.png" alt="Yike 宜刻" /></div>;
}

export default function Home() {
  const [view, setView] = useState<View>("home");
  const [context, setContext] = useState<Context>(DEFAULT_CONTEXT);
  const [personalCards, setPersonalCards] = useState<Card[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawPhase, setDrawPhase] = useState<DrawPhase>("idle");
  const [result, setResult] = useState<Card | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [noCandidate, setNoCandidate] = useState(false);
  const [exchangeCount, setExchangeCount] = useState(0);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackInsight, setFeedbackInsight] = useState<FeedbackInsight | null>(null);
  const [memoryNote, setMemoryNote] = useState("还没有新的反馈");
  const [memorySummary, setMemorySummary] = useState<MemorySummary | null>(null);
  const [toast, setToast] = useState("");
  const [debugLog, setDebugLog] = useState("等待第一次小宜的尝试");
  const [inputText, setInputText] = useState("");
  const [imageName, setImageName] = useState("");
  const [imagePreview, setImagePreview] = useState("");
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [parseStep, setParseStep] = useState<"input" | "reading" | "organizing" | "draft">("input");
  const [draft, setDraft] = useState<Card | null>(null);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [cloudReady, setCloudReady] = useState(!realAgentEnabled);
  const [onboardingSaving, setOnboardingSaving] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [fallbackDemo, setFallbackDemo] = useState(false);
  const [fallbackGuideOpen, setFallbackGuideOpen] = useState(false);
  const [fallbackStep, setFallbackStep] = useState<FallbackStep>("auth");
  const [ambient, setAmbient] = useState<AmbientContext>({
    localTime: "--:--",
    hour: 0,
    timezone: "Asia/Shanghai",
    weather: null,
    loading: false,
    notice: "正在读取本地时间",
  });
  const [careNotice, setCareNotice] = useState("");
  const [acceptanceNote, setAcceptanceNote] = useState("");
  const [activeActivity, setActiveActivity] = useState<ActivitySession | null>(null);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [petalLedger, setPetalLedger] = useState<PetalLedgerEntry[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const gatewayRef = useRef(createAgentGateway());
  const savingDraftRef = useRef(false);
  const authPreview = useSyncExternalStore(subscribeAuthPreview, readAuthPreview, readServerAuthPreview);
  const isSignedIn = authPreview !== "未登录";
  const drawing = drawPhase !== "idle" && drawPhase !== "settled";
  const petalBalance = petalLedger.reduce((total, entry) => total + entry.amount, 0);

  useEffect(() => {
    const cards = localStorage.getItem("yike-personal-cards");
    const savedContext = localStorage.getItem("yike-context");
    const savedPetals = localStorage.getItem("yike-petal-ledger");
    const savedActivity = localStorage.getItem("yike-active-activity");
    // 从浏览器存储恢复初始演示数据，只在挂载时执行一次。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (cards && !(realAgentEnabled && readLocalValue("yike-user-id"))) setPersonalCards(JSON.parse(cards));
    if (savedContext) setContext({ ...DEFAULT_CONTEXT, ...JSON.parse(savedContext), constraints: [] });
    if (savedPetals) setPetalLedger(JSON.parse(savedPetals));
    if (savedActivity) {
      const restored = JSON.parse(savedActivity) as ActivitySession;
      if (restored?.card?.id) {
        setActiveActivity(restored);
        if (restored.status === "active") setView("activity");
      }
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setAmbient(makeAmbientContext()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }, []);

  // 邮箱确认后 Supabase 会把 token 放在 URL hash 里，自动读取并登录
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash || !hash.includes("access_token")) return;
    const params = new URLSearchParams(hash.slice(1));
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const type = params.get("type");
    if (accessToken && type === "signup") {
      try {
        const session = persistAuthSession({
          access_token: accessToken,
          refresh_token: refreshToken || "",
          token_type: "bearer",
          expires_in: 3600,
          user: { id: "" },
        });
        if (session.userId) {
          window.dispatchEvent(new Event("yike-auth-change"));
          window.setTimeout(() => showToast("邮箱确认成功，已自动登录"), 0);
        }
      } catch {
        window.setTimeout(() => showToast("邮箱确认链接已失效，请重新注册或重新发送确认邮件"), 0);
      }
    }
    // 清理 URL hash
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, [showToast]);

  useEffect(() => {
    localStorage.setItem("yike-personal-cards", JSON.stringify(personalCards));
  }, [personalCards]);

  useEffect(() => {
    const safeContext = {
      time: context.time,
      energy: context.energy,
      outing: context.outing,
      mood: context.mood,
      source: context.source,
    };
    localStorage.setItem("yike-context", JSON.stringify(safeContext));
  }, [context]);

  useEffect(() => {
    localStorage.setItem("yike-petal-ledger", JSON.stringify(petalLedger));
  }, [petalLedger]);

  useEffect(() => {
    if (activeActivity) {
      localStorage.setItem("yike-active-activity", JSON.stringify(activeActivity));
    } else {
      localStorage.removeItem("yike-active-activity");
    }
  }, [activeActivity]);

  const loadCloudState = useCallback(async (reason = "manual") => {
    if (!realAgentEnabled || !readLocalValue("yike-user-id") || !readLocalValue("yike-user-access-token")) return;
    setCloudReady(false);
    try {
      const [cardsResponse, profile, cloudMemory] = await Promise.all([
        gatewayRef.current.listCards({ source_scope: "personal", limit: 200 }),
        gatewayRef.current.getProfile(),
        gatewayRef.current.getMemorySummary(),
      ]);
      setPersonalCards(cardsResponse.cards.map(fromContractCard));
      const restoredProfile = shouldTreatAsOnboarded(profile, cardsResponse.count) ? withOnboardingCompleted(profile) : profile;
      setProfile(restoredProfile);
      setMemorySummary(cloudMemory);
      if (!profile.onboarding_completed && restoredProfile.onboarding_completed) {
        void gatewayRef.current.saveProfile({
          onboarding_completed: true,
          explicit_profile: restoredProfile.explicit_profile,
        }).catch((error) => {
          setDebugLog(JSON.stringify({ method: "repairLegacyOnboarding", error: error instanceof Error ? error.message : "repair_failed" }, null, 2));
        });
      }
      if (restoredProfile.explicit_profile?.default_available_time) {
        setContext((value) => ({
          ...value,
          time: Number(restoredProfile.explicit_profile.default_available_time) || value.time,
          energy: restoredProfile.explicit_profile?.default_energy_level === "medium" || restoredProfile.explicit_profile?.default_energy_level === "high" ? restoredProfile.explicit_profile.default_energy_level : value.energy,
          outing: restoredProfile.explicit_profile?.indoor_outdoor_preference === "outdoor" ? "can_go_out" : restoredProfile.explicit_profile?.indoor_outdoor_preference === "indoor" ? "stay_in" : value.outing,
        }));
      }
      const memoryText = cloudMemory.long_term_preference?.headline || summarizePreferenceMemory(restoredProfile);
      setMemoryNote(memoryText ? `云端记忆已恢复：${memoryText}` : "云端记忆已连接，暂无明显长期偏好");
      setDebugLog(JSON.stringify({ method: "restoreCloudState", reason, cards: cardsResponse.count, memory: cloudMemory }, null, 2));
      if (reason !== "startup") showToast("已同步云端卡池和记忆");
    } catch (error) {
      const message = error instanceof Error ? error.message : "云端数据同步失败";
      setDebugLog(JSON.stringify({ method: "restoreCloudState", reason, error: message }, null, 2));
      if (!message.includes("requires yike-user-id")) showToast(message);
    } finally {
      setCloudReady(true);
    }
  }, [showToast]);

  const updateMemoryItem = useCallback(async (itemKey: string, action: MemoryItemAction) => {
    if (fallbackDemo) {
      setMemorySummary((summary) => summary ? {
        ...summary,
        memory_items: summary.memory_items
          .map((item) => item.item_key === itemKey ? { ...item, action_state: action === "keep" ? "kept" : item.action_state } : item)
          .filter((item) => !(item.item_key === itemKey && action === "clear")),
      } : summary);
      if (action === "view") showToast("这条演示记忆来自初始化、抽卡和反馈链路");
      if (action === "keep") showToast("已在演示态保留这条记忆");
      if (action === "clear") showToast("已在演示态清除这条记忆");
      return;
    }
    try {
      const response = await gatewayRef.current.updateMemoryItem({ item_key: itemKey, action });
      setMemorySummary(response.summary);
      setDebugLog(JSON.stringify({ method: "updateMemoryItem", request: { item_key: itemKey, action }, response }, null, 2));
      if (action === "view") showToast(response.item?.description ?? "这条记忆来自近期反馈和卡片字段");
      if (action === "keep") showToast("已保留这条记忆");
      if (action === "clear") showToast("已清除这条记忆");
    } catch (error) {
      const message = error instanceof Error ? error.message : "记忆操作失败";
      setDebugLog(JSON.stringify({ method: "updateMemoryItem", request: { item_key: itemKey, action }, error: message }, null, 2));
      showToast(message);
    }
  }, [fallbackDemo, showToast]);

  const refreshAmbientContext = useCallback(async () => {
    const base = makeAmbientContext();
    setAmbient({ ...base, loading: true });
    if (realAgentEnabled && (!readLocalValue("yike-user-id") || !readLocalValue("yike-user-access-token"))) {
      setAmbient({ ...base, loading: false, notice: "时间和天气，小宜已经替你看过啦" });
      return;
    }

    const city = typeof profile?.explicit_profile?.city === "string" ? profile.explicit_profile.city : null;
    try {
      const coords = await new Promise<GeolocationCoordinates | null>((resolve) => {
        if (typeof navigator === "undefined" || !navigator.geolocation) {
          resolve(null);
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (position) => resolve(position.coords),
          () => resolve(null),
          { enableHighAccuracy: false, timeout: 4500, maximumAge: 15 * 60 * 1000 }
        );
      });
      const weather = await gatewayRef.current.getWeatherContext({
        city,
        timezone: base.timezone,
        latitude: coords?.latitude ?? null,
        longitude: coords?.longitude ?? null,
      });
      setAmbient({
        ...base,
        weather,
        loading: false,
        notice: "时间和天气，小宜已经替你看过啦",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "天气读取失败";
      setAmbient({ ...base, loading: false, notice: "时间已更新，天气暂时没读到" });
      setDebugLog(JSON.stringify({ method: "weatherContext", error: message }, null, 2));
    }
  }, [profile]);

  useEffect(() => {
    if (!realAgentEnabled) return;
    const syncSignedInState = () => {
      if (readLocalValue("yike-user-id") && readLocalValue("yike-user-access-token")) {
        void loadCloudState("startup");
      } else {
        setProfile(null);
        setCloudReady(true);
      }
    };
    syncSignedInState();
    window.addEventListener("yike-auth-change", syncSignedInState);
    return () => window.removeEventListener("yike-auth-change", syncSignedInState);
  }, [loadCloudState]);

  useEffect(() => {
    if (!realAgentEnabled || !isSignedIn || !cloudReady) return;
    const timer = window.setTimeout(() => void refreshAmbientContext(), 0);
    return () => window.clearTimeout(timer);
  }, [cloudReady, isSignedIn, refreshAmbientContext]);

  const contextSummary = `${context.time} 分钟 · ${context.outing === "stay_in" ? "窝在家" : "可出门"} · ${levelText[context.energy]}精力`;
  const hasOngoingActivity = activeActivity?.status === "active";

  const returnToOngoingActivity = useCallback((message = "这件事还在进行中，先结束后再抽下一张") => {
    setDrawerOpen(false);
    setNoCandidate(false);
    setView("activity");
    showToast(message);
  }, [showToast]);

  const canStartNewDraw = useCallback(() => {
    if (!hasOngoingActivity) return true;
    returnToOngoingActivity();
    return false;
  }, [hasOngoingActivity, returnToOngoingActivity]);

  const loadActivityHistory = useCallback(async ({ from, to }: { from: string; to: string }) => {
    if (fallbackDemo) return { events: buildFallbackHistoryEvents() };
    return gatewayRef.current.getActivityHistory({ from, to });
  }, [fallbackDemo]);

  const enterFallbackDemo = useCallback((step: FallbackStep = "auth") => {
    setFallbackDemo(true);
    setFallbackGuideOpen(true);
    setFallbackStep(step);
    setCloudReady(true);
    setProfile(fallbackProfile);
    setMemorySummary(buildFallbackMemorySummary());
    setMemoryNote("兜底演示记忆已载入：轻松出门 · 低准备 · 60 分钟");
    setContext({ ...DEFAULT_CONTEXT, time: 60, energy: "low", outing: "can_go_out", source: "both" });
    setPersonalCards([fallbackDemoCard]);
    setRecentIds([]);
    setFeedbackInsight(null);
    setFeedbackOpen(false);
    setAcceptanceNote("");
    setActiveActivity(null);
    setCompletionOpen(false);
    setDebugLog(JSON.stringify({
      method: "fallbackDemo",
      status: "ready",
      path: ["注册登录", "初始化", "添加卡", "抽卡", "卡池显示", "反馈机制"],
    }, null, 2));
    setView(step === "pool" ? "pool" : "home");
    showToast("已打开兜底演示路径");
  }, [showToast]);

  const showFallbackStep = useCallback((step: FallbackStep) => {
    if (!fallbackDemo) enterFallbackDemo(step);
    setFallbackStep(step);
    setFallbackGuideOpen(true);
    if (step === "auth" || step === "onboarding") {
      setParseStep("input");
      setDraft(null);
      setResult(null);
      setFeedbackInsight(null);
      setFeedbackOpen(false);
      setAcceptanceNote("");
      setView("home");
    }
    if (step === "add") {
      setInputText("朋友收藏的台球厅，今晚想找个轻松但有点活动量的安排。");
      setImageName("demo-billiards-screenshot.png");
      setImagePreview("");
      setSelectedImage(null);
      setDraft(fallbackDraftCard);
      setEditingCardId(null);
      setParseStep("draft");
      setView("add");
    }
    if (step === "pool") {
      setPersonalCards((cards) => cards.some((card) => card.id === fallbackDemoCard.id) ? cards : [fallbackDemoCard, ...cards]);
      setDraft(null);
      setParseStep("input");
      setView("pool");
    }
    if (step === "draw" || step === "feedback") {
      const card = step === "feedback" ? fallbackDemoCard : fallbackPresetCard;
      setResult(card);
      setReasons([
        `能放进今晚 ${context.time} 分钟左右的空档`,
        card.outing === "indoor" ? "不需要出门，准备成本可控" : "符合今晚可以出门的状态",
        "在长期偏好里有轻量娱乐的正向信号",
      ]);
      setCareNotice(buildCareNotice(card, context, ambient));
      setFeedbackInsight(null);
      setFeedbackOpen(step === "feedback");
      setAcceptanceNote("");
      setDrawPhase("settled");
      setView("result");
    }
    setDebugLog(JSON.stringify({ method: "fallbackDemo.step", step }, null, 2));
  }, [ambient, context, enterFallbackDemo, fallbackDemo]);

  const performFallbackDraw = async (isExchange = false) => {
    if (drawing) return;
    if (!canStartNewDraw()) return;
    setDrawPhase(isExchange ? "waiting" : "holding");
    setNoCandidate(false);
    setCareNotice("");
    setAcceptanceNote("");
    setFeedbackInsight(null);
    setFeedbackOpen(false);
    await sleep(isExchange ? 360 : 900);
    const card = isExchange ? fallbackPresetCard : fallbackDemoCard;
    setResult(card);
    setReasons([
      `能放进今晚 ${context.time} 分钟左右的空档`,
      card.outing === "indoor" ? "不需要出门，准备成本可控" : "符合今晚可以出门的状态",
      "演示记忆里对轻松娱乐有正向权重",
    ]);
    setCareNotice(buildCareNotice(card, context, ambient));
    setRecentIds((ids) => [card.id, ...ids.filter((id) => id !== card.id)].slice(0, 2));
    setDrawPhase("revealing");
    setView("result");
    window.setTimeout(() => setDrawPhase("settled"), 650);
    setDebugLog(JSON.stringify({ method: "fallbackDemo.drawCard", card }, null, 2));
  };

  const performDraw = async (isExchange = false) => {
    if (drawing) return;
    if (!canStartNewDraw()) return;
    if (fallbackDemo) {
      await performFallbackDraw(isExchange);
      return;
    }
    const animationStartedAt = Date.now();
    const minimumDuration = isExchange ? 460 : 2000;
    setDrawPhase("holding");
    setNoCandidate(false);
    setCareNotice("");
    const liftingTimer = window.setTimeout(() => setDrawPhase("lifting"), 650);
    const waitingTimer = window.setTimeout(() => setDrawPhase("waiting"), 1450);
    const request = { context: toDrawContext(context, ambient), recent_card_ids: recentIds };
    setDebugLog(JSON.stringify({ method: "drawCard", request, status: "pending" }, null, 2));
    if ("replacePersonalCards" in gatewayRef.current && typeof gatewayRef.current.replacePersonalCards === "function") {
      gatewayRef.current.replacePersonalCards(personalCards.map(toContractCard));
    }
    try {
      const response = await gatewayRef.current.drawCard(request);
      setDebugLog(JSON.stringify({ method: "drawCard", request, response }, null, 2));
      await sleep(Math.max(0, minimumDuration - (Date.now() - animationStartedAt)));
      window.clearTimeout(liftingTimer);
      window.clearTimeout(waitingTimer);
      if (response.type === "no_candidate") {
        setNoCandidate(true);
        setDrawPhase("idle");
        return;
      }
      const card = fromContractCard(response.card);
      const notice = buildCareNotice(card, context, ambient);
      setResult(card);
      setReasons(response.reasons);
      setCareNotice(notice);
      setRecentIds((ids) => [card.id, ...ids.filter((id) => id !== card.id)].slice(0, 2));
      setFeedbackOpen(false);
      setFeedbackInsight(null);
      setDrawPhase("revealing");
      setView("result");
      window.setTimeout(() => setDrawPhase("settled"), 650);
      if (notice) window.setTimeout(() => showToast(notice), 350);
    } catch (error) {
      window.clearTimeout(liftingTimer);
      window.clearTimeout(waitingTimer);
      const message = error instanceof Error ? error.message : "抽卡失败";
      setDebugLog(JSON.stringify({ method: "drawCard", request, error: message }, null, 2));
      showToast(message);
      setDrawPhase("idle");
    }
  };

  const exchange = async () => {
    if (!canStartNewDraw()) return;
    if (result && !feedbackSubmitting && isUuid(result.id)) {
      try {
        const response = await gatewayRef.current.submitFeedback({ card_id: result.id, action: "reroll" });
        setDebugLog(JSON.stringify({ method: "submitFeedback", request: { card_id: result.id, action: "reroll" }, response }, null, 2));
      } catch (error) {
        const message = error instanceof Error ? error.message : "换一张反馈记录失败";
        setDebugLog(JSON.stringify({ method: "submitFeedback", request: { card_id: result.id, action: "reroll" }, error: message }, null, 2));
      }
    }
    const count = exchangeCount + 1;
    setExchangeCount(count);
    if (count >= 3) {
      setDrawerOpen(true);
      showToast("连续换了三次，试着换一个条件吧");
      return;
    }
    await performDraw(true);
  };

  const submitFeedbackBestEffort = async (card: Card, action: FeedbackAction) => {
    if (fallbackDemo || !isUuid(card.id)) {
      const response = buildFallbackFeedback(card, action);
      setDebugLog(JSON.stringify({ method: "fallbackDemo.submitFeedback", request: { card_id: card.id, action }, response }, null, 2));
      return response;
    }
    try {
      const response = await gatewayRef.current.submitFeedback({ card_id: card.id, action });
      setDebugLog(JSON.stringify({ method: "submitFeedback", request: { card_id: card.id, action }, response }, null, 2));
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : "反馈记录失败";
      const fallback = buildFallbackFeedback(card, action);
      setDebugLog(JSON.stringify({ method: "submitFeedback", request: { card_id: card.id, action }, error: message, localFallback: fallback }, null, 2));
      return fallback;
    }
  };

  const startActivity = async () => {
    if (!result || feedbackSubmitting || drawPhase === "revealing") return;
    setFeedbackSubmitting(true);
    try {
      await submitFeedbackBestEffort(result, "accept");
      const startedAt = new Date();
      const estimatedFinishAt = new Date(startedAt);
      estimatedFinishAt.setMinutes(startedAt.getMinutes() + Math.max(5, result.duration || 30));
      setActiveActivity({
        id: `activity-${Date.now()}`,
        card: result,
        startedAt: startedAt.toISOString(),
        estimatedFinishAt: estimatedFinishAt.toISOString(),
        rewardPetals: petalRewardForCard(result),
        status: "active",
      });
      setCompletionOpen(false);
      setAcceptanceNote("");
      setFeedbackInsight(null);
      setFeedbackOpen(false);
      setView("activity");
      showToast("已开始，完成后再回来记一笔");
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  const completeActivity = async () => {
    if (!activeActivity || feedbackSubmitting) return;
    setFeedbackSubmitting(true);
    const card = activeActivity.card;
    try {
      const response = await submitFeedbackBestEffort(card, "complete");
      const insight = buildFeedbackInsight(card, response);
      const completedAt = new Date().toISOString();
      const entry: PetalLedgerEntry = {
        id: `petal-${Date.now()}`,
        amount: activeActivity.rewardPetals,
        cardTitle: card.title,
        cardSource: card.source,
        reason: card.source === "preset" ? "小宜推荐完成奖励" : "个人收藏完成奖励",
        occurredAt: completedAt,
      };
      setPetalLedger((items) => [entry, ...items].slice(0, 30));
      setFeedbackInsight(insight);
      setMemoryNote(`${insight.actionLabel}：${insight.memoryShift}`);
      setActiveActivity({ ...activeActivity, status: "completed", completedAt });
      if (card.source === "personal") {
        setResult({ ...card, status: response.status });
        setPersonalCards((cards) => cards.map((item) => item.id === card.id ? { ...item, status: response.status } : item));
      }
      setCompletionOpen(false);
      showToast(`已收下 ${activeActivity.rewardPetals} 片薰衣草花瓣`);
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  const handleImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setSelectedImage(file);
    setImageName(file.name);
    setImagePreview(URL.createObjectURL(file));
  };

  const parseCard = async () => {
    if (!inputText.trim() && !imageName) {
      showToast("先放一张截图或写下一段文字吧");
      return;
    }
    setParseStep("reading");
    await sleep(520);
    setParseStep("organizing");
    await sleep(620);
    const request = { text: inputText, image: imageName };
    try {
      const response = await gatewayRef.current.parseCard({ text: inputText, image: selectedImage ?? undefined, uploaded_asset_id: imageName || undefined });
      const nextDraft = { ...fromContractCard(response.draft_card), imageUrl: response.draft_card.image_url ?? imagePreview };
      setDraft(nextDraft);
      setDebugLog(JSON.stringify({ method: "parseCard", input: request, response }, null, 2));
      setParseStep("draft");
    } catch (error) {
      const message = error instanceof Error ? error.message : "识别失败";
      setDebugLog(JSON.stringify({ method: "parseCard", input: request, error: message }, null, 2));
      setParseStep("input");
      showToast(message);
    }
  };

  const saveDraft = async () => {
    if (!draft) return;
    if (savingDraftRef.current) return;
    savingDraftRef.current = true;
    setSavingDraft(true);
    if (fallbackDemo) {
      const saved = { ...draft, id: draft.id.startsWith("demo-draft") ? fallbackDemoCard.id : draft.id, draftId: undefined, status: "active" as const, eligible: true };
      setPersonalCards((cards) => [saved, ...cards.filter((card) => card.id !== saved.id)]);
      setDebugLog(JSON.stringify({ method: "fallbackDemo.saveCard", response: { saved_card: saved } }, null, 2));
      setParseStep("input");
      setInputText("");
      setImageName("");
      setImagePreview("");
      setSelectedImage(null);
      setDraft(null);
      setView("pool");
      setFallbackStep("pool");
      showToast("已在演示卡池收好这枚贝壳");
      savingDraftRef.current = false;
      setSavingDraft(false);
      return;
    }
    if ("replacePersonalCards" in gatewayRef.current && typeof gatewayRef.current.replacePersonalCards === "function") {
      gatewayRef.current.replacePersonalCards(personalCards.map(toContractCard));
    }
    try {
      const response = await gatewayRef.current.saveCard(toContractCard(draft));
      const saved = fromContractCard(response.saved_card);
      setPersonalCards((cards) => [saved, ...cards.filter((card) => card.id !== saved.id)]);
      setDebugLog(JSON.stringify({ method: "saveCard", response }, null, 2));
      setParseStep("input");
      setInputText("");
      setImageName("");
      setImagePreview("");
      setSelectedImage(null);
      setDraft(null);
      setView("pool");
      showToast("已收进海湾");
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存失败";
      setDebugLog(JSON.stringify({ method: "saveCard", error: message }, null, 2));
      showToast(message);
    } finally {
      savingDraftRef.current = false;
      setSavingDraft(false);
    }
  };

  const archiveCard = async (id: string) => {
    if (!isUuid(id)) {
      setPersonalCards((cards) => cards.map((card) => card.id === id ? { ...card, status: "archived" } : card));
      showToast("已归档");
      return;
    }
    try {
      const response = await gatewayRef.current.archiveCard(id);
      const archived = fromContractCard(response.card);
      setPersonalCards((cards) => cards.map((card) => card.id === id ? archived : card));
      setDebugLog(JSON.stringify({ method: "archiveCard", request: { card_id: id }, response }, null, 2));
      showToast("已归档");
    } catch (error) {
      const message = error instanceof Error ? error.message : "归档失败";
      setDebugLog(JSON.stringify({ method: "archiveCard", request: { card_id: id }, error: message }, null, 2));
      showToast(message);
    }
  };

  const deleteCard = async (id: string) => {
    const target = personalCards.find((card) => card.id === id);
    if (!target || target.status !== "archived") return;
    if (!window.confirm("确定删除这张已归档的卡片吗？")) return;
    if (!isUuid(id)) {
      setPersonalCards((cards) => cards.filter((card) => card.id !== id));
      setDebugLog(JSON.stringify({ method: "deleteCard", request: { card_id: id }, response: { deleted: true, scope: "local_legacy_card" } }, null, 2));
      showToast("已删除");
      return;
    }
    try {
      const response = await gatewayRef.current.deleteCard(id);
      setPersonalCards((cards) => cards.filter((card) => card.id !== id));
      setDebugLog(JSON.stringify({ method: "deleteCard", request: { card_id: id }, response }, null, 2));
      showToast("已删除");
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除失败";
      setDebugLog(JSON.stringify({ method: "deleteCard", request: { card_id: id }, error: message }, null, 2));
      showToast(message);
    }
  };

  const submitFeedback = async (action: "accept" | "complete" | "not-suitable" | "later" | "dislike") => {
    if (!result) return;
    if (feedbackSubmitting) return;
    const gatewayAction: FeedbackAction = action === "not-suitable" ? "not_suitable" : action;
    if (action === "accept") {
      setAcceptanceNote("好好享受这个夜晚吧");
      setFeedbackOpen(false);
      setFeedbackInsight(null);
    }
    if (fallbackDemo || !isUuid(result.id)) {
      const response = buildFallbackFeedback(result, gatewayAction);
      if (action !== "accept") {
        const insight = buildFeedbackInsight(result, response);
        setFeedbackInsight(insight);
        setMemoryNote(`${insight.actionLabel}：${insight.memoryShift}`);
      }
      if (result.source === "personal") {
        setResult({ ...result, status: response.status });
        setPersonalCards((cards) => cards.map((card) => card.id === result.id ? { ...card, status: response.status } : card));
      }
      setFeedbackOpen(false);
      setDebugLog(JSON.stringify({ method: "fallbackDemo.submitFeedback", request: { card_id: result.id, action: gatewayAction }, response }, null, 2));
      showToast(action === "accept" ? "好好享受这个夜晚吧" : "演示反馈已记录");
      return;
    }
    setFeedbackSubmitting(true);
    try {
      const response = await gatewayRef.current.submitFeedback({ card_id: result.id, action: gatewayAction });
      if (action !== "accept") {
        const insight = buildFeedbackInsight(result, response);
        setFeedbackInsight(insight);
        setMemoryNote(`${insight.actionLabel}：${insight.memoryShift}`);
      }
      setDebugLog(JSON.stringify({ method: "submitFeedback", request: { card_id: result.id, action: gatewayAction }, response }, null, 2));
      if (result.source === "personal") {
        setResult({ ...result, status: response.status });
        setPersonalCards((cards) => cards.map((card) => card.id === result.id ? { ...card, status: response.status } : card));
      }
      setFeedbackOpen(false);
      setAcceptanceNote(action === "accept" ? "好好享受这个夜晚吧" : "");
      showToast(action === "accept" ? "好好享受这个夜晚吧" : "反馈已记录");
    } catch (error) {
      const message = error instanceof Error ? error.message : "反馈失败";
      setDebugLog(JSON.stringify({ method: "submitFeedback", request: { card_id: result.id, action: gatewayAction }, error: message }, null, 2));
      showToast(message);
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  const copyPreset = async () => {
    if (!result || result.source !== "preset") return;
    if (fallbackDemo || !isUuid(result.id)) {
      const copied = { ...result, id: `demo-copy-${Date.now()}`, source: "personal" as const };
      setPersonalCards((cards) => [copied, ...cards]);
      setDebugLog(JSON.stringify({ method: "fallbackDemo.copyPreset", request: { preset_card_id: result.id }, response: { saved_card: copied } }, null, 2));
      showToast("已在演示卡池生成个人副本");
      return;
    }
    try {
      const response = await gatewayRef.current.copyPreset({ preset_card_id: result.id });
      const copied = fromContractCard(response.saved_card);
      setPersonalCards((cards) => [copied, ...cards]);
      setDebugLog(JSON.stringify({ method: "copyPreset", request: { preset_card_id: result.id }, response }, null, 2));
      showToast("已存成可编辑的个人副本");
    } catch (error) {
      const message = error instanceof Error ? error.message : "复制失败";
      setDebugLog(JSON.stringify({ method: "copyPreset", request: { preset_card_id: result.id }, error: message }, null, 2));
      showToast(message);
    }
  };

  const saveOnboarding = async (form: OnboardingForm) => {
    if (onboardingSaving) return;
    setOnboardingSaving(true);
    try {
      const explicitProfile = {
        nickname: form.nickname.trim() || null,
        city: form.city.trim() || null,
        timezone: "Asia/Shanghai",
        default_available_time: form.defaultAvailableTime,
        default_energy_level: form.defaultEnergyLevel,
        indoor_outdoor_preference: form.indoorOutdoorPreference,
        default_go_out: form.indoorOutdoorPreference === "outdoor" ? true : form.indoorOutdoorPreference === "indoor" ? false : null,
        default_people: form.defaultPeople,
        default_budget_level: form.defaultBudgetLevel,
        preferred_categories: form.preferredCategories.map((category) => categoryToContract[category] ?? "other"),
        disliked_categories: form.dislikedCategories.map((category) => categoryToContract[category] ?? "other"),
        user_editable: true,
        profile_version: "profile_v1",
      };
      const savedProfile = await gatewayRef.current.saveProfile({
        onboarding_completed: true,
        explicit_profile: explicitProfile,
      });
      setProfile(savedProfile);
      setContext((value) => ({
        ...value,
        time: form.defaultAvailableTime,
        energy: form.defaultEnergyLevel,
        outing: form.indoorOutdoorPreference === "outdoor" ? "can_go_out" : form.indoorOutdoorPreference === "indoor" ? "stay_in" : value.outing,
      }));
      const memorySummary = summarizePreferenceMemory(savedProfile);
      setMemoryNote(memorySummary ? `已建立初始记忆：${memorySummary}` : "已建立初始记忆");
      setDebugLog(JSON.stringify({ method: "saveProfile", request: { onboarding_completed: true, explicit_profile: explicitProfile }, response: savedProfile }, null, 2));
      setView("home");
      showToast("个人信息已保存，开始抽卡吧");
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存个人信息失败";
      setDebugLog(JSON.stringify({ method: "saveProfile", error: message }, null, 2));
      showToast(message);
    } finally {
      setOnboardingSaving(false);
    }
  };

  const go = (next: Exclude<View, "result" | "activity">) => {
    if (hasOngoingActivity) {
      returnToOngoingActivity("当前活动还在进行中，先留在这张卡里");
      return;
    }
    setView(next);
    setNoCandidate(false);
  };

  const clearCompletedActivity = () => {
    setActiveActivity(null);
    setCompletionOpen(false);
    setAcceptanceNote("");
    setFeedbackInsight(null);
    setResult(null);
    setDrawPhase("idle");
    setView("home");
  };

  const handleEditCard = (card: Card) => {
    setDraft(card);
    setEditingCardId(card.id);
    setParseStep("draft");
    setInputText("");
    setImageName("");
    setImagePreview("");
    setSelectedImage(null);
    go("add");
  };

  const handleSaveEdit = async () => {
    if (!draft || !editingCardId) return;
    if (savingDraftRef.current) return;
    savingDraftRef.current = true;
    setSavingDraft(true);
    if (fallbackDemo || !isUuid(editingCardId)) {
      const updated = { ...draft, id: editingCardId, status: "active" as const, eligible: true };
      setPersonalCards((cards) => cards.map((card) => card.id === editingCardId ? updated : card));
      setDebugLog(JSON.stringify({ method: "fallbackDemo.updateCard", response: { card: updated } }, null, 2));
      setParseStep("input");
      setDraft(null);
      setEditingCardId(null);
      setInputText("");
      setImageName("");
      setImagePreview("");
      setSelectedImage(null);
      setView("pool");
      showToast("已更新演示卡片");
      savingDraftRef.current = false;
      setSavingDraft(false);
      return;
    }
    try {
      const response = await gatewayRef.current.saveCard(toContractCard(draft));
      const saved = fromContractCard(response.saved_card);
      setPersonalCards((cards) => cards.map((card) => card.id === editingCardId ? { ...saved, id: editingCardId } : card));
      setDebugLog(JSON.stringify({ method: "saveCard(edit)", response }, null, 2));
      setParseStep("input");
      setDraft(null);
      setEditingCardId(null);
      setInputText("");
      setImageName("");
      setImagePreview("");
      setSelectedImage(null);
      setView("pool");
      showToast("已更新卡片");
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存失败";
      setDebugLog(JSON.stringify({ method: "saveCard(edit)", error: message }, null, 2));
      showToast(message);
    } finally {
      savingDraftRef.current = false;
      setSavingDraft(false);
    }
  };

  const authRequired = realAgentEnabled;
  const needsOnboarding = !fallbackDemo && authRequired && isSignedIn && cloudReady && profile?.onboarding_completed === false;
  const appReady = fallbackDemo || !authRequired || (isSignedIn && cloudReady && !needsOnboarding);
  const showPageRail = appReady && view !== "result";

  return (
    <main className={`app-shell ${showPageRail ? "" : "no-page-rail"}`}>
      <aside className="desktop-sidebar">
        <BrandLockup />
        {appReady && <nav aria-label="主导航">{navItems.map((item) => <button key={item.id} className={view === item.id ? "current" : ""} type="button" onClick={() => go(item.id)}><span>{item.icon}</span>{item.label}</button>)}</nav>}
        <div className="sidebar-bottom">
          <img className="sidebar-otter" src="/art/yike/otter-lavender-sidebar.png" alt="抱着薰衣草的小宜" />
          <img className="sidebar-handwritten" src="/art/yike/handwritten-sidebar-lavender.png" alt="今天辛苦啦，快来和小宜一起躺在薰衣草花园吧" />
        </div>
      </aside>

      <section className="main-stage">
        <header className="mobile-header"><BrandLockup compact /><button className="avatar-button" type="button" onClick={() => go("memory")}>小宜</button></header>
        {authRequired && !isSignedIn && !fallbackDemo && <AuthLanding onToast={showToast} onDebug={setDebugLog} />}
        {authRequired && isSignedIn && !cloudReady && !fallbackDemo && <LoadingView title="正在恢复你的卡池和记忆" body="正在读取 Supabase 里的个人卡池、记忆和偏好权重。" />}
        {needsOnboarding && <OnboardingView saving={onboardingSaving} onSave={saveOnboarding} />}

        {appReady && view === "home" && <HomeView
          context={context}
          contextSummary={contextSummary}
          ambient={ambient}
          drawing={drawing}
          drawPhase={drawPhase}
          noCandidate={noCandidate}
          personalCount={personalCards.length}
          setContext={setContext}
          onOpenContext={() => setDrawerOpen(true)}
          onDraw={() => performDraw(false)}
          onAdd={() => go("add")}
        />}

        {appReady && view === "add" && <AddView
          inputText={inputText}
          imageName={imageName}
          imagePreview={imagePreview}
          parseStep={parseStep}
          draft={draft}
          isEditing={!!editingCardId}
          fileInputRef={fileInputRef}
          setInputText={setInputText}
          setDraft={setDraft}
          onImage={handleImage}
          onParse={parseCard}
          onSave={editingCardId ? handleSaveEdit : saveDraft}
          savingDraft={savingDraft}
        />}

        {appReady && view === "pool" && <PoolView cards={personalCards} onAdd={() => { setEditingCardId(null); setDraft(null); setParseStep("input"); go("add"); }} onArchive={archiveCard} onDelete={deleteCard} onEdit={handleEditCard} />}

        {appReady && view === "memory" && <MemoryView memoryNote={memoryNote} memorySummary={memorySummary} feedbackInsight={feedbackInsight} debugLog={debugLog} petalBalance={petalBalance} petalLedger={petalLedger} onLoadHistory={loadActivityHistory} onMemoryAction={updateMemoryItem} onReset={() => { setPersonalCards([]); setContext(DEFAULT_CONTEXT); setRecentIds([]); setFeedbackInsight(null); setMemoryNote("还没有新的反馈"); setMemorySummary(null); setActiveActivity(null); setPetalLedger([]); showToast("演示数据已重置"); }} />}

        {appReady && view === "achievements" && <AchievementView petalBalance={petalBalance} petalLedger={petalLedger} />}

        {appReady && view === "result" && result && <ResultView
          card={result}
          reasons={reasons}
          revealing={drawPhase === "revealing"}
          feedbackOpen={feedbackOpen}
          feedbackSubmitting={feedbackSubmitting}
          feedbackInsight={feedbackInsight}
          acceptanceNote={acceptanceNote}
          careNotice={careNotice}
          ambient={ambient}
          setFeedbackOpen={setFeedbackOpen}
          onAccept={startActivity}
          onExchange={exchange}
          onContext={() => setDrawerOpen(true)}
          onFeedback={submitFeedback}
          onCopy={copyPreset}
        />}

        {appReady && view === "activity" && activeActivity && <ActivityView
          activity={activeActivity}
          completionOpen={completionOpen}
          feedbackSubmitting={feedbackSubmitting}
          petalBalance={petalBalance}
          ambient={ambient}
          onOpenCompletion={() => setCompletionOpen(true)}
          onCloseCompletion={() => setCompletionOpen(false)}
          onComplete={completeActivity}
          onBackHome={clearCompletedActivity}
          onMemory={() => go("memory")}
        />}
      </section>

      {showPageRail && <PageRail view={view} cardCount={personalCards.length} context={context} contextSummary={contextSummary} ambient={ambient} petalBalance={petalBalance} petalLedger={petalLedger} onRefreshAmbient={refreshAmbientContext} setContext={setContext} onNavigate={go} />}

      {appReady && <nav className="mobile-nav" aria-label="移动端主导航">{navItems.map((item) => <button key={item.id} className={view === item.id ? "current" : ""} type="button" onClick={() => go(item.id)}><span>{item.icon}</span><small>{item.label}</small></button>)}</nav>}

      {drawerOpen && <div className="drawer-backdrop" onMouseDown={() => setDrawerOpen(false)}><div className="context-drawer" onMouseDown={(event) => event.stopPropagation()}><div className="drawer-handle" /><div className="drawer-head"><div><h2>今晚，怎么抽？</h2><p>只调整真正影响选择的条件。</p></div><button type="button" onClick={() => setDrawerOpen(false)} aria-label="关闭">×</button></div><ContextControls context={context} setContext={setContext} /><button className="primary-button" type="button" onClick={() => { if (!canStartNewDraw()) return; setDrawerOpen(false); performDraw(false); }}>按这些条件捞一枚今晚卡</button></div></div>}
      <button className="fallback-demo-trigger" type="button" onClick={() => enterFallbackDemo("auth")} aria-label="打开兜底演示路径">demo</button>
      {fallbackDemo && fallbackGuideOpen && <FallbackDemoPanel activeStep={fallbackStep} onStep={showFallbackStep} onClose={() => setFallbackGuideOpen(false)} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

function AuthLanding({ onToast, onDebug }: { onToast: (message: string) => void; onDebug: (message: string) => void }) {
  return <div className="view auth-landing"><div className="eyebrow">ACCOUNT · 开始使用</div><div className="auth-hero"><div><img className="auth-handwritten" src="/art/yike/handwritten-auth.png" alt="先拥有一片自己的卡池" /><p>登录后，截图识别、个人卡池、推荐反馈和长期记忆都会按你的账号保存。</p></div><img className="auth-otter-lavender" src="/art/yike/otter-auth-lavender.png" alt="带着花香出发的小宜" /></div><AuthPanel onToast={onToast} onDebug={onDebug} startExpanded /></div>;
}

function LoadingView({ title, body }: { title: string; body: string }) {
  return <div className="view loading-view"><div className="agent-progress"><div className="progress-visual"><div className="scan-line" /><span>◇</span><img src="/otter-front.png" alt="正在恢复数据的小宜" /></div><h2>{title}</h2><p>{body}</p></div></div>;
}

function FallbackDemoPanel({ activeStep, onStep, onClose }: { activeStep: FallbackStep; onStep: (step: FallbackStep) => void; onClose: () => void }) {
  const steps: Array<{ id: FallbackStep; label: string; note: string }> = [
    { id: "auth", label: "注册登录", note: "模拟账号已进入" },
    { id: "onboarding", label: "初始化", note: "已有初始偏好" },
    { id: "add", label: "添加卡", note: "展示识别草稿" },
    { id: "draw", label: "抽卡", note: "展示推荐结果" },
    { id: "pool", label: "卡池", note: "展示我的收藏" },
    { id: "feedback", label: "反馈", note: "展示学习机制" },
  ];
  return <aside className="fallback-demo-panel" aria-label="兜底演示路径">
    <div><strong>兜底演示</strong><button type="button" onClick={onClose} aria-label="收起兜底演示">×</button></div>
    <p>接口临时不可用时，用这条路径展示完整产品闭环。</p>
    <div>{steps.map((step) => <button key={step.id} type="button" className={activeStep === step.id ? "active" : ""} onClick={() => onStep(step.id)}><span>{step.label}</span><small>{step.note}</small></button>)}</div>
  </aside>;
}

function OnboardingView({ saving, onSave }: { saving: boolean; onSave: (form: OnboardingForm) => void }) {
  const [form, setForm] = useState<OnboardingForm>(defaultOnboardingForm);
  const toggleCategory = (field: "preferredCategories" | "dislikedCategories", category: string) => {
    setForm((value) => {
      const current = value[field];
      const next = current.includes(category) ? current.filter((item) => item !== category) : [...current, category];
      const oppositeField = field === "preferredCategories" ? "dislikedCategories" : "preferredCategories";
      return { ...value, [field]: next, [oppositeField]: value[oppositeField].filter((item) => item !== category) };
    });
  };

  return <div className="view onboarding-view"><div className="eyebrow">PROFILE · 初始偏好</div><div className="page-title"><div><h1>先让小宜认识你一点点</h1><p>这些信息会写入可查看、可修改的长期记忆，只用于初始化推荐。</p></div><span className="step-badge">约 1 分钟</span></div><form className="onboarding-form" onSubmit={(event) => { event.preventDefault(); onSave(form); }}>
    <section className="onboarding-section"><h2>基本信息</h2><div className="onboarding-grid"><label><span>怎么称呼你</span><input value={form.nickname} onChange={(event) => setForm({ ...form, nickname: event.target.value })} placeholder="可以留空" /></label><label><span>常用城市</span><input value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} placeholder="例如 上海" /></label></div></section>
    <section className="onboarding-section"><h2>默认状态</h2><div className="onboarding-grid"><label><span>常见今晚想留给自己多久？</span><select value={form.defaultAvailableTime} onChange={(event) => setForm({ ...form, defaultAvailableTime: Number(event.target.value) })}>{[15, 30, 45, 60, 120].map((time) => <option key={time} value={time}>{time} 分钟</option>)}</select></label><label><span>默认精力</span><select value={form.defaultEnergyLevel} onChange={(event) => setForm({ ...form, defaultEnergyLevel: event.target.value as Level })}><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label><label><span>更适合在哪里偏好</span><select value={form.indoorOutdoorPreference} onChange={(event) => setForm({ ...form, indoorOutdoorPreference: event.target.value as OnboardingForm["indoorOutdoorPreference"] })}><option value="flexible">都可以</option><option value="indoor">更常室内</option><option value="outdoor">愿意出门</option></select></label><label><span>常见人数</span><select value={form.defaultPeople} onChange={(event) => setForm({ ...form, defaultPeople: event.target.value as OnboardingForm["defaultPeople"] })}><option value="solo">自己</option><option value="pair">两个人</option><option value="group">多人</option><option value="flexible">都可以</option></select></label><label><span>默认预算</span><select value={form.defaultBudgetLevel} onChange={(event) => setForm({ ...form, defaultBudgetLevel: event.target.value as OnboardingForm["defaultBudgetLevel"] })}><option value="free">尽量免费</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label></div></section>
    <section className="onboarding-section"><h2>内容偏好</h2><div className="preference-columns"><div><span>更想看到</span><div className="chip-row">{onboardingCategories.map((category) => <Chip key={category} active={form.preferredCategories.includes(category)} onClick={() => toggleCategory("preferredCategories", category)}>{category}</Chip>)}</div></div><div><span>少一点</span><div className="chip-row">{onboardingCategories.map((category) => <Chip key={category} subtle active={form.dislikedCategories.includes(category)} onClick={() => toggleCategory("dislikedCategories", category)}>{category}</Chip>)}</div></div></div></section>
    <button className="primary-button wide" type="submit" disabled={saving}>{saving ? "正在保存…" : "保存并开始"}</button>
  </form></div>;
}

function AuthPanel({ onToast, onDebug, onSignedOut, startExpanded = false }: {
  onToast: (message: string) => void;
  onDebug: (message: string) => void;
  onSignedOut?: () => void;
  startExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(startExpanded);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [anonKey, setAnonKey] = useState(() => readLocalValue("yike-supabase-anon-key"));
  const sessionPreview = useSyncExternalStore(subscribeAuthPreview, readAuthPreview, readServerAuthPreview);
  const [submitting, setSubmitting] = useState<"signin" | "signup" | null>(null);

  const submitAuth = async (intent: "signin" | "signup", event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const key = supabaseAnonKey || anonKey.trim();
    if (!supabaseUrl || !key) {
      onToast("需要 Supabase URL 和 anon public key");
      return;
    }
    if (!email.trim() || !password) {
      onToast("请填写邮箱和密码");
      return;
    }
    setSubmitting(intent);
    try {
      const redirectTo = typeof window !== "undefined" ? `${window.location.origin}/auth/callback` : undefined;
      const signupBody: Record<string, unknown> = { email, password };
      if (redirectTo) signupBody.data = { redirect_to: redirectTo };
      const response = await fetch(`${supabaseUrl}/auth/v1/${intent === "signin" ? "token?grant_type=password" : "signup"}`, {
        method: "POST",
        headers: {
          apikey: key,
          "content-type": "application/json",
        },
        body: JSON.stringify(intent === "signup" ? { email, password, options: { emailRedirectTo: redirectTo } } : { email, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const errMsg = String(data.msg ?? data.error_description ?? data.error ?? (intent === "signin" ? "登录失败" : "注册失败"));
        if (errMsg.includes("otp_expired") || errMsg.includes("expired") || errMsg.includes("token")) {
          throw new Error("邮箱确认链接已失效，请重新注册或重新发送确认邮件");
        }
        throw new Error(errMsg);
      }
      if (intent === "signup" && !data.access_token) {
        onDebug(JSON.stringify({ method: "supabaseAuth", status: "signup_pending_email_confirmation" }, null, 2));
        onToast("注册成功，请先完成邮箱确认后登录");
        return;
      }
      const session = persistAuthSession(data);
      if (!supabaseAnonKey) localStorage.setItem("yike-supabase-anon-key", key);
      onDebug(JSON.stringify({ method: "supabaseAuth", status: intent === "signup" ? "signed_up" : "signed_in", user_id: session.userId }, null, 2));
      onToast(intent === "signup" ? "注册并登录成功" : "登录成功，正在恢复记忆");
      setExpanded(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : intent === "signin" ? "登录失败" : "注册失败";
      onDebug(JSON.stringify({ method: "supabaseAuth", error: message }, null, 2));
      onToast(message);
    } finally {
      setSubmitting(null);
    }
  };

  const clear = () => {
    clearAuthSession();
    onSignedOut?.();
    onToast("已退出登录");
  };

  return <section className="dev-auth-panel">
    <button className="dev-auth-summary" type="button" onClick={() => setExpanded((value) => !value)}>
      <span>账号与云端记忆</span>
      <strong>{sessionPreview}</strong>
    </button>
    {expanded && <form className="dev-auth-form" onSubmit={(event) => submitAuth("signin", event)}>
      {!supabaseAnonKey && <input value={anonKey} onChange={(event) => setAnonKey(event.target.value)} placeholder="Supabase anon public key" />}
      <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Supabase Auth 邮箱" autoComplete="email" />
      <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="密码" autoComplete="current-password" />
      <div>
        <button className="secondary-button" type="button" onClick={() => submitAuth("signup")} disabled={Boolean(submitting)}>{submitting === "signup" ? "注册中" : "注册"}</button>
        <button className="secondary-button" type="button" onClick={clear} disabled={Boolean(submitting)}>退出</button>
        <button className="primary-button compact" type="submit" disabled={Boolean(submitting)}>{submitting === "signin" ? "登录中" : "登录"}</button>
      </div>
    </form>}
  </section>;
}

function readLocalValue(key: string) {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(key) ?? "";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function readAuthPreview() {
  const userId = readLocalValue("yike-user-id");
  const token = readLocalValue("yike-user-access-token");
  return userId && token ? `${userId.slice(0, 8)} · ${token.slice(0, 12)}...` : "未登录";
}

function readServerAuthPreview() {
  return "未登录";
}

function subscribeAuthPreview(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", onStoreChange);
  window.addEventListener("yike-auth-change", onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener("yike-auth-change", onStoreChange);
  };
}

function HomeView({ context, contextSummary, ambient, drawing, drawPhase, noCandidate, personalCount, setContext, onOpenContext, onDraw, onAdd }: {
  context: Context; contextSummary: string; ambient: AmbientContext; drawing: boolean; drawPhase: DrawPhase; noCandidate: boolean; personalCount: number;
  setContext: React.Dispatch<React.SetStateAction<Context>>; onOpenContext: () => void; onDraw: () => void; onAdd: () => void;
}) {
  const journalCopy = ambient.hour < 5
    ? { greeting: "夜深了，今天的你", lines: ["今晚，", "拾一件", "轻一点的事"] }
    : ambient.hour < 12
      ? { greeting: "早上好，今天的你", lines: ["今天，", "拾一件", "刚刚好的事"] }
      : ambient.hour < 18
        ? { greeting: "下午好，此刻的你", lines: ["傍晚前，", "拾一件", "刚刚好的事"] }
        : { greeting: "晚上好，今天的你", lines: ["今晚，", "拾一件", "刚刚好的事"] };

  return <div className="view home-view">
    <div className="eyebrow">GOOD EVENING · 此刻</div>
    <section className="hero-card journal-hero journal-reference-hero">
      <img className="journal-reference-art" src="/art/yike/home-journal-lavender.png" alt="" aria-hidden="true" />
      <div className="journal-dynamic-copy">
        <p className="kicker">{journalCopy.greeting}</p>
        <img className="journal-handwritten" src="/art/yike/handwritten-journal.png" alt="现在，拾一件刚刚好的事" />
        <p>告诉小宜今晚有多少时间、还剩多少力气，<br />剩下的，就交给一枚刚刚好的贝壳。</p>
      </div>
    </section>

    <div className="ambient-strip"><div><span>此刻</span><strong>{ambient.localTime}</strong></div><i /><div><span>天气</span><strong>{ambient.loading ? "读取中" : weatherText(ambient.weather)}</strong></div><p>{ambient.notice}</p></div>
    <div className="mobile-context-card"><div><span>今晚的状态</span><strong>{contextSummary}</strong></div><button type="button" onClick={onOpenContext}>调整</button></div>

    <section className="pick-section"><div className="section-heading"><div><span className="section-index">01</span><h2>今晚，捞一枚贝壳</h2></div><p>小宜会照顾你的时间、精力和去处，也悄悄留一点点惊喜。</p></div>
      <div className="source-selector"><span>今晚想从哪里遇见它？</span><div>{(["personal", "preset", "both"] as SourceScope[]).map((source) => <Chip key={source} active={context.source === source} onClick={() => setContext((value) => ({ ...value, source }))}>{sourceText[source]}</Chip>)}</div></div>
      <button className={`card-pack draw-ritual phase-${drawPhase}`} type="button" onClick={onDraw} disabled={drawing} aria-label={drawing ? "正在抽取一张娱乐卡" : "捞一枚今晚卡娱乐卡"}>
        <span className="pack-stitch" />
        <span className="draw-copy"><span className="pack-label">TONIGHT&apos;S PICK</span>{drawing ? <strong>小宜正在打开贝壳…</strong> : <img className="draw-handwritten" src="/art/yike/handwritten-draw.png" alt="轻轻打开" />}<small>{contextSummary}</small></span>
        <span className="draw-stage" aria-hidden="true"><img className="draw-otter hold" src="/art/yike/otter-front-lavender.png" alt="" /><img className="draw-otter lift" src="/art/yike/otter-front-lavender.png" alt="" /></span>
      </button>
      <button className="primary-button draw-button" type="button" onClick={onDraw} disabled={drawing}>{drawing ? "正在匹配此刻…" : "捞一枚今晚卡"}</button>
    </section>

    {noCandidate && <EmptyState title="这次没有硬抽一个不合适的结果" body={noCandidateHelp(context)} action="放宽一个条件" onAction={() => setContext((value) => ({ ...value, time: Math.max(value.time, 60), source: "both", outing: "can_go_out" }))} />}
    {personalCount === 0 && <div className="cold-start"><div className="mini-shell">◇</div><div><strong>海湾还空空的</strong><p>收进第一份心动，今晚就有贝壳可以抽啦。</p></div><button type="button" onClick={onAdd}>收一颗花种</button></div>}
  </div>;
}

function ContextControls({ context, setContext }: { context: Context; setContext: React.Dispatch<React.SetStateAction<Context>> }) {
  const toggleConstraint = (constraint: string) => setContext((value) => ({ ...value, constraints: value.constraints.includes(constraint) ? value.constraints.filter((item) => item !== constraint) : [...value.constraints, constraint] }));
  return <div className="context-controls">
    <div className="control-group"><label>今晚想留给自己多久？</label><div className="chip-row">{[15, 30, 45, 60, 120].map((time) => <Chip key={time} active={context.time === time} onClick={() => setContext((value) => ({ ...value, time }))}>{time} 分钟</Chip>)}</div></div>
    <div className="control-group"><label>精力</label><div className="segmented">{(["low", "medium", "high"] as Level[]).map((energy) => <button key={energy} className={context.energy === energy ? "active" : ""} type="button" onClick={() => setContext((value) => ({ ...value, energy }))}>{levelText[energy]}</button>)}</div></div>
    <div className="control-group"><label>今晚想待在哪里？</label><div className="segmented"><button className={context.outing === "stay_in" ? "active" : ""} type="button" onClick={() => setContext((value) => ({ ...value, outing: "stay_in" }))}>窝在家</button><button className={context.outing === "can_go_out" ? "active" : ""} type="button" onClick={() => setContext((value) => ({ ...value, outing: "can_go_out" }))}>出去透透气</button></div></div>
    <div className="control-group"><label>今晚更想怎样？</label><div className="chip-row">{(["random", "relax", "active", "quiet"] as Mood[]).map((mood) => <Chip key={mood} active={context.mood === mood} onClick={() => setContext((value) => ({ ...value, mood }))}>{moodText[mood]}</Chip>)}</div></div>
    <div className="control-group sensitive"><div className="control-label"><label>只照顾今晚的小状况</label><span>只陪你过今晚</span></div><div className="chip-row"><Chip subtle active={context.constraints.includes("period")} onClick={() => toggleConstraint("period")}>经期不舒服</Chip><Chip subtle active={context.constraints.includes("no-standing")} onClick={() => toggleConstraint("no-standing")}>不想久站</Chip><Chip subtle active={context.constraints.includes("no-makeup")} onClick={() => toggleConstraint("no-makeup")}>不想费心打扮</Chip></div></div>
  </div>;
}

function ContextPanel({ context, contextSummary, ambient, onRefreshAmbient, setContext }: { context: Context; contextSummary: string; ambient: AmbientContext; onRefreshAmbient: () => void; setContext: React.Dispatch<React.SetStateAction<Context>> }) {
  return <aside className="desktop-context"><div className="context-title"><span>今晚的小状态</span><b>LIVE</b></div><h2>{contextSummary}</h2><div className="ambient-panel"><div><span>现在是</span><strong>{ambient.localTime}</strong></div><div><span>当地天气</span><strong>{ambient.loading ? "读取中" : weatherText(ambient.weather)}</strong></div><p>{ambient.notice}</p><button type="button" onClick={onRefreshAmbient}>刷新</button></div><p>调整会立刻影响候选集合，敏感状态不会进入长期记忆。</p><ContextControls context={context} setContext={setContext} /><div className="privacy-note"><span>✓</span><div><strong>隐私边界</strong><p>当次状态仅保留在当前浏览器会话。</p></div></div></aside>;
}

function PageRail({ view, cardCount, context, contextSummary, ambient, petalBalance, petalLedger, onRefreshAmbient, setContext, onNavigate }: {
  view: View; cardCount: number; context: Context; contextSummary: string; ambient: AmbientContext; petalBalance: number; petalLedger: PetalLedgerEntry[];
  onRefreshAmbient: () => void; setContext: React.Dispatch<React.SetStateAction<Context>>; onNavigate: (next: Exclude<View, "result" | "activity">) => void;
}) {
  if (view === "home") {
    return <ContextPanel context={context} contextSummary={contextSummary} ambient={ambient} onRefreshAmbient={onRefreshAmbient} setContext={setContext} />;
  }
  if (view === "activity") {
    return <aside className="desktop-context page-rail activity-rail"><div className="context-title"><span>今晚进行中</span><b>NOW</b></div><img className="rail-shell" src="/art/yike/lavender-other.png" alt="薰衣草" /><h2>先开始，再轻轻记一笔</h2><p>这里先用轻量占位展示完成链路，后续再接真实核销与兑换。</p><div className="rail-note privacy"><strong>推荐仍以适合为先</strong><span>小宜推荐卡只是候选池的一部分，不会越过时间、天气和你的当下状态。</span></div></aside>;
  }
  if (view === "pool") {
    return <aside className="desktop-context page-rail pool-rail"><div className="context-title"><span>海湾小记</span><b>ATLAS</b></div><img className="rail-shell" src="/art/yike/lavender-movie.png" alt="薰衣草" /><h2>{cardCount} 张卡，九种贝壳</h2><p>每一种贝壳代表一类故事。选中贝壳，就能打捞对应的收藏。</p><div className="rail-note"><strong>图鉴规则</strong><span>有收藏的类别会留下数量；空图鉴也会保留位置，等你慢慢拾满。</span></div></aside>;
  }
  if (view === "add") {
    return <aside className="desktop-context page-rail capture-rail"><div className="context-title"><span>先交给小宜</span><b>3 STEPS</b></div><ol className="capture-steps"><li><b>1</b><div><strong>先认一认</strong><span>找出标题、类别和内容线索</span></div></li><li><b>2</b><div><strong>再补一补</strong><span>估一估需要的时间、力气和准备</span></div></li><li><b>3</b><div><strong>你点头后再收好</strong><span>确认合适，再放进你的卡池</span></div></li></ol><img className="rail-otter" src="/art/yike/otter-companion.webp" alt="拿着贝壳的小宜" /><div className="rail-note privacy"><strong>图片仅用于本次整理</strong><span>原图默认私有，不会公开展示。</span></div></aside>;
  }
  if (view === "achievements") {
    return <AchievementRail petalBalance={petalBalance} petalLedger={petalLedger} onNavigate={onNavigate} />;
  }
  return <aside className="desktop-context page-rail memory-rail"><div className="context-title"><span>只陪你过今晚的事</span><b>PRIVATE</b></div><img className="rail-shell" src="/art/yike/lavender-other.png" alt="薰衣草" /><h2>有些小状况，小宜只在今晚记得</h2><ul><li>经期不舒服</li><li>不想久站</li><li>不想费心打扮</li></ul><p>这些只用来照顾当下，不会被写成长期偏好，也不会被拿来猜测你的身体或性格。</p><div className="rail-note privacy"><strong>这些记忆都由你做主</strong><span>看得到、改得了、删得掉，也可以全部清空。</span></div></aside>;
}

function AchievementView({ petalBalance, petalLedger }: { petalBalance: number; petalLedger: PetalLedgerEntry[] }) {
  const [filter, setFilter] = useState<AchievementCategory | "all">("all");
  const [sort, setSort] = useState<"recent" | "progress">("recent");
  const progress = buildAchievementProgress(petalLedger, petalBalance);
  const unlockedCount = progress.filter((item) => item.unlocked).length;
  const filtered = filter === "all" ? progress : progress.filter((item) => item.category === filter);
  const visible = [...filtered].sort((a, b) => {
    if (sort === "progress") return (b.current / b.target) - (a.current / a.target);
    if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
    return new Date(b.unlockedAt ?? 0).getTime() - new Date(a.unlockedAt ?? 0).getTime();
  });
  return <div className="view achievement-view"><div className="achievement-hero"><img src="/art/yike/home-journal-lavender.png" alt="" /><div><span>ACHIEVEMENT · 潮汐花笺</span><h1>潮汐花笺</h1><p>看见那些慢慢发生的温柔瞬间。</p></div></div><section className="achievement-board"><div className="achievement-head"><div><h2>潮汐花笺</h2><p>每一次记录、每一次觉察，都会悄悄成为一张小贴士。</p></div><div className="achievement-stats"><span>已解锁 {unlockedCount} / 30</span><span>花露 {petalBalance}</span></div></div><div className="achievement-toolbar"><div>{achievementCategories.map((category) => <button key={category.id} type="button" className={filter === category.id ? "active" : ""} onClick={() => setFilter(category.id)}>{category.label}</button>)}</div><select value={sort} onChange={(event) => setSort(event.target.value as "recent" | "progress")}><option value="recent">最近解锁</option><option value="progress">进度优先</option></select></div><div className="achievement-grid">{visible.map((item) => <article className={`achievement-card ${item.unlocked ? "unlocked" : "locked"}`} key={item.id}><div className="achievement-art"><img src={item.image} alt="" /></div><h3>{item.title}</h3><p>{item.body}</p><div className="achievement-progress"><i style={{ width: `${Math.min(100, (item.current / item.target) * 100)}%` }} /></div><footer><span>{item.unlocked ? "已解锁" : `${Math.min(item.current, item.target)} / ${item.target}`}</span><time>{achievementDateLabel(item.unlockedAt)}</time></footer></article>)}</div><div className="achievement-footnote"><span>✿</span><p>继续收集，更多小美好还在等你发现。</p><span>✿</span></div></section></div>;
}

function AchievementRail({ petalBalance, petalLedger, onNavigate }: { petalBalance: number; petalLedger: PetalLedgerEntry[]; onNavigate: (next: Exclude<View, "result" | "activity">) => void }) {
  const progress = buildAchievementProgress(petalLedger, petalBalance);
  const recent = progress.filter((item) => item.unlocked).slice(0, 3);
  const nextGoal = progress.find((item) => !item.unlocked) ?? progress[progress.length - 1];
  const dewProgress = Math.min(100, (petalBalance / 300) * 100);
  return <aside className="desktop-context page-rail achievement-rail"><div className="achievement-rail-note"><img src="/art/yike/lavender-other.png" alt="" /><div><strong>潮汐成就小贴士</strong><p>每一次记录、每一次觉察，都是你与自己和解的证明。</p></div></div><div className="achievement-rail-section"><div className="rail-section-head"><span>已解锁类别</span><button type="button">详情</button></div><div className="achievement-category-mini">{achievementCategories.filter((category) => category.id !== "all").map((category) => { const unlocked = progress.filter((item) => item.category === category.id && item.unlocked).length; return <div key={category.id}><img src={category.image} alt="" /><strong>{category.label}</strong><small>{unlocked} / {category.total}</small></div>; })}</div></div><div className="achievement-rail-section"><div className="rail-section-head"><span>最近获得</span><button type="button">全部</button></div><div className="achievement-recent-list">{recent.length === 0 ? <p>完成一次活动后，第一枚成就贴纸会出现在这里。</p> : recent.map((item) => <article key={item.id}><img src={item.image} alt="" /><div><strong>{item.title}</strong><small>{item.body}</small></div><time>{achievementDateLabel(item.unlockedAt)}</time></article>)}</div></div><div className="achievement-rail-section"><span className="rail-mini-title">花露进度</span><div className="dew-progress"><img src="/art/yike/lavender-book.png" alt="" /><div><strong>{petalBalance}<small> / 300</small></strong><i><b style={{ width: `${dewProgress}%` }} /></i><p>再收集 {Math.max(0, 300 - petalBalance)} 滴花露即可解锁新奖励。</p></div></div></div><div className="achievement-target"><img src="/art/yike/lavender-craft.png" alt="" /><div><span>推荐目标</span><strong>{nextGoal?.title ?? "继续记录 3 天"}</strong><small>{nextGoal ? `${Math.min(nextGoal.current, nextGoal.target)} / ${nextGoal.target}` : "让小花园因为你的陪伴慢慢盛开"}</small></div><button type="button" onClick={() => onNavigate("home")}>去记录</button></div></aside>;
}

function AddView({ inputText, imageName, imagePreview, parseStep, draft, isEditing, savingDraft, fileInputRef, setInputText, setDraft, onImage, onParse, onSave }: {
  inputText: string; imageName: string; imagePreview: string; parseStep: string; draft: Card | null; isEditing: boolean;
  savingDraft: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>; setInputText: (value: string) => void; setDraft: React.Dispatch<React.SetStateAction<Card | null>>;
  onImage: (event: ChangeEvent<HTMLInputElement>) => void; onParse: () => void; onSave: () => void;
}) {
  return <div className="view add-view"><div className="eyebrow">{isEditing ? "EDIT · 修改卡片" : "CAPTURE · 收一枚贝壳"}</div><div className="page-title"><div><img className="page-title-handwritten" src="/art/yike/handwritten-add.png" alt="把种草，变成一张能抽的卡" /><p>{isEditing ? "修改字段后点击保存，不会新增重复卡片。" : "截图、照片或一句话都可以。小宜会先帮你认出来，再陪你补好适合什么时候做。"}</p></div><span className="step-badge">{isEditing ? "编辑中" : "约 10 秒"}</span></div>
    {parseStep === "input" && <div className="add-grid capture-book"><span className="book-rings" aria-hidden="true" /><button className="upload-zone" type="button" onClick={() => fileInputRef.current?.click()}>{imagePreview ? <img src={imagePreview} alt="待识别截图预览" /> : <><span className="upload-icon">＋</span><strong>上传截图或图片</strong><small>支持 PNG、JPG，原图默认私有</small></>}<input ref={fileInputRef} type="file" accept="image/*" hidden onChange={onImage} /></button><div className="text-entry"><label htmlFor="capture-text">也可以直接告诉小宜</label><textarea id="capture-text" value={inputText} onChange={(event) => setInputText(event.target.value)} placeholder="比如：周末想去看海边主题展，听说现场很安静……" /><div className="entry-meta"><span>{imageName || "也可以只输入标题"}</span><span>{inputText.length}/300</span></div></div><button className="primary-button wide" type="button" onClick={onParse}>开始整理</button></div>}
    {(parseStep === "reading" || parseStep === "organizing") && <div className="agent-progress"><div className="progress-visual"><div className="scan-line" /><img src="/art/yike/lavender-other.png" alt="" /><img src="/art/yike/otter-companion.webp" alt="正在工作的海獭小宜" /></div><h2>{parseStep === "reading" ? "正在看懂这份收藏…" : "正在整理执行信息…"}</h2><div className="progress-steps"><span className="done">看内容</span><i /><span className={parseStep === "organizing" ? "done" : ""}>整理字段</span><i /><span>生成草稿</span></div><div className="parse-progress-bar"><div className="parse-progress-fill" style={{ width: parseStep === "reading" ? "33%" : "66%" }} /></div></div>}
    {parseStep === "draft" && draft && <div className="draft-layout"><div className="agent-summary"><img className="summary-shell" src={shellForCategory(draft.category).image} alt="" /><div><span>小宜先整理了一版</span><h2>这枚贝壳，可以这样开始</h2><p>蓝色框里是小宜还没拿准的地方，点一下就能改。</p></div><img src="/art/yike/otter-companion.webp" alt="海獭小宜" /></div><div className="draft-form"><Field label="标题" hint="已识别"><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></Field><Field label="娱乐类别" hint="请确认" uncertain><select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}><option>电影</option><option>剧集</option><option>书籍</option><option>美食</option><option>展览</option><option>游戏</option><option>手作</option><option>散步</option><option>其他</option></select></Field><Field label="预计时长" hint="请确认" uncertain><input type="number" value={draft.duration} onChange={(event) => setDraft({ ...draft, duration: Number(event.target.value) })} /><em>分钟</em></Field><Field label="精力"><select value={draft.energy} onChange={(event) => setDraft({ ...draft, energy: event.target.value as Level })}><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></Field><Field label="更适合在哪里"><select value={draft.outing} onChange={(event) => setDraft({ ...draft, outing: event.target.value as Card["outing"] })}><option value="indoor">室内</option><option value="outdoor">室外</option><option value="either">均可</option></select></Field><Field label="准备起来麻烦吗"><select value={draft.prep} onChange={(event) => setDraft({ ...draft, prep: event.target.value as Level })}><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></Field></div><button className="primary-button wide" type="button" onClick={onSave} disabled={savingDraft}>{savingDraft ? "保存中…" : isEditing ? "保存修改" : "确认，收好这枚贝壳"}</button></div>}
  </div>;
}

function Field({ label, hint, uncertain, children }: { label: string; hint?: string; uncertain?: boolean; children: React.ReactNode }) {
  return <label className={`field-row ${uncertain ? "uncertain" : ""}`}><span><small>{label}</small>{hint && <i>{hint}</i>}</span><div>{children}</div></label>;
}

function PoolView({ cards, onAdd, onArchive, onDelete, onEdit }: { cards: Card[]; onAdd: () => void; onArchive: (id: string) => void; onDelete: (id: string) => void; onEdit: (card: Card) => void }) {
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [status, setStatus] = useState<"all" | Card["status"]>("active");
  const normalizedQuery = query.trim().toLowerCase();
  const counts = Object.fromEntries(shellCategories.map((item) => [item.category, cards.filter((card) => card.category === item.category).length]));
  const visible = cards.filter((card) => {
    const matchesQuery = !normalizedQuery || card.title.toLowerCase().includes(normalizedQuery) || card.category.toLowerCase().includes(normalizedQuery);
    return matchesQuery && (!selectedCategory || card.category === selectedCategory) && (status === "all" || card.status === status);
  });
  const statusOptions: Array<{ value: "all" | Card["status"]; label: string }> = [
    { value: "active", label: "可抽取" }, { value: "all", label: "全部" }, { value: "cooling", label: "稍后" }, { value: "completed", label: "已完成" }, { value: "archived", label: "已归档" },
  ];

  return <div className="view pool-view"><div className="eyebrow">COLLECTION · 我的海湾</div><div className="page-title"><div><img className="page-title-handwritten" src="/art/yike/handwritten-pool.png" alt="收进来的好故事" /><p>每一种贝壳都收着一类心动。点开它，就能看看那些曾经想做的事。</p></div><button className="primary-button compact" type="button" onClick={onAdd}>＋ 收一颗花种</button></div>
    <section className="shell-atlas" aria-labelledby="shell-atlas-title"><div className="atlas-heading"><div><span>贝壳小图鉴</span><h2 id="shell-atlas-title">从一枚喜欢的贝壳开始逛</h2></div><button type="button" className={selectedCategory ? "" : "active"} onClick={() => setSelectedCategory(null)}>查看全部</button></div><div className="shell-atlas-grid">{shellCategories.map((item) => { const count = counts[item.category] ?? 0; const selected = selectedCategory === item.category; return <button type="button" key={item.category} className={`${selected ? "selected" : ""} ${count === 0 ? "empty" : ""}`} aria-pressed={selected} onClick={() => setSelectedCategory(selected ? null : item.category)}><img src={item.image} alt={`${item.category}类别薰衣草`} /><strong>{item.category}</strong><span>{count ? `${count} 张卡` : "等第一枚贝壳靠岸"}</span></button>; })}</div></section>
    <div className="pool-toolbar"><div className="search-box">⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="找找某部剧、某家店，或那首歌" /></div><div className="pool-count"><strong>{cards.length}</strong><span>枚已收藏</span></div></div>
    <div className="status-filters" aria-label="按状态筛选">{statusOptions.map((option) => <button type="button" key={option.value} className={status === option.value ? "active" : ""} aria-pressed={status === option.value} onClick={() => setStatus(option.value)}>{option.label}</button>)}</div>
    {cards.length === 0 ? <EmptyState title="海湾里还没有卡片" body="先收进一张真正感兴趣的娱乐收藏吧。" action="添加一张" onAction={onAdd} /> : visible.length === 0 ? <EmptyState title="这一格暂时没有卡片" body="换一枚贝壳或清空搜索条件，再打捞一次。" action="查看全部" onAction={() => { setSelectedCategory(null); setStatus("all"); setQuery(""); }} /> : <div className="card-grid atlas-card-grid">{visible.map((card) => { const shell = shellForCategory(card.category); return <article className="pool-card" key={card.id}><div className={`pool-card-art ${card.imageUrl ? "has-image" : ""}`}>{card.imageUrl ? <img src={card.imageUrl} alt={card.title} /> : <><img className="category-shell-art" src={shell.image} alt="" /><small>{card.category}</small></>}</div><div className="pool-card-body"><div><SourceBadge source={card.source} /><span className={`status-pill ${card.status}`}>{card.status === "active" ? "可抽取" : card.status === "cooling" ? "稍后" : card.status === "completed" ? "已完成" : "已归档"}</span></div><h3>{card.title}</h3><p>{card.duration} 分钟 · {card.outing === "indoor" ? "室内" : card.outing === "outdoor" ? "室外" : "均可"} · {levelText[card.prep]}准备</p><div className="pool-actions">{card.status === "archived" ? <><button type="button" onClick={() => onEdit(card)}>编辑</button><button className="danger" type="button" onClick={() => onDelete(card.id)}>删除</button></> : <><button type="button" onClick={() => onEdit(card)}>编辑</button><button type="button" onClick={() => onArchive(card.id)}>归档</button></>}</div></div></article>; })}</div>}
  </div>;
}

function ResultView({ card, reasons, revealing, feedbackOpen, feedbackSubmitting, feedbackInsight, acceptanceNote, careNotice, ambient, setFeedbackOpen, onAccept, onExchange, onContext, onFeedback, onCopy }: {
  card: Card; reasons: string[]; revealing: boolean; feedbackOpen: boolean; feedbackSubmitting: boolean; feedbackInsight: FeedbackInsight | null; acceptanceNote: string; careNotice: string; ambient: AmbientContext; setFeedbackOpen: (value: boolean) => void;
  onAccept: () => void; onExchange: () => void; onContext: () => void; onFeedback: (action: "complete" | "not-suitable" | "later" | "dislike") => void; onCopy: () => void;
}) {
  return <div className={`view result-view ${revealing ? "is-revealing" : ""}`}>
    <div className="eyebrow">REVEAL · 今晚的卡</div>
    <div className="result-heading"><div><h1>今晚，就从这个开始</h1><p>只给一张，也告诉你为什么是它。</p></div><img src="/otter-side.png" alt="为你揭晓结果的海獭小宜" /></div>
    <div className="result-reveal-stage">
      <article className={`result-card ${revealing ? "revealing" : ""}`}>
        <div className={`result-art ${card.imageUrl ? "has-image" : "has-otter"}`}>{card.imageUrl ? <img src={card.imageUrl} alt={card.title} /> : <img className="result-otter-art" src={otterArtForCategory(card.category)} alt={`${card.category}海獭插画`} />}</div>
        <div className="result-content"><div className="result-badges"><SourceBadge source={card.source} /><span>{card.category}</span></div><h2>{card.title}</h2><p className="result-meta">预计 {card.duration} 分钟　·　{card.outing === "indoor" ? "室内" : card.outing === "outdoor" ? "室外" : "均可"}　·　{levelText[card.prep]}准备</p><div className="reason-block"><strong>为什么现在适合</strong>{reasons.map((reason) => <p key={reason}><span>●</span>{reason}</p>)}</div><div className="companion-line">小宜：今晚只把节奏放慢一点，也很好。</div></div>
      </article>
      {revealing && <div className="result-pearl-reveal" aria-hidden="true"><i /><img src={shellForCategory(card.category).image} alt="" /></div>}
    </div>
    <div className="context-trace"><span>本次参考</span><strong>{ambient.localTime} · {weatherText(ambient.weather)}</strong></div>
    {careNotice && <div className="care-notice"><span>关怀提醒</span><p>{careNotice}</p></div>}
    <div className="result-actions"><button className="primary-button" type="button" onClick={onAccept} disabled={feedbackSubmitting || revealing || Boolean(acceptanceNote)}>{feedbackSubmitting ? "记录中…" : acceptanceNote ? "已选择" : "就它"}</button>{acceptanceNote && <div className="acceptance-note">{acceptanceNote}</div>}<div><button className="secondary-button" type="button" onClick={onExchange} disabled={feedbackSubmitting || revealing}>换一张</button><button className="secondary-button" type="button" onClick={onContext} disabled={feedbackSubmitting || revealing}>改条件</button></div>{card.source === "preset" && <button className="text-button" type="button" onClick={onCopy} disabled={feedbackSubmitting || revealing}>存成我的卡</button>}{!acceptanceNote && <button className="feedback-link" type="button" onClick={() => setFeedbackOpen(!feedbackOpen)} disabled={feedbackSubmitting || revealing}>{feedbackOpen ? "收起反馈" : "这张卡怎么样？"}</button>}</div>
    {!acceptanceNote && feedbackInsight && <FeedbackInsightPanel insight={feedbackInsight} />}
    {!acceptanceNote && feedbackOpen && <div className="feedback-grid"><Feedback title="已完成" impact="长期加权" body="记录真实体验，轻轻增加相似内容" disabled={feedbackSubmitting} onClick={() => onFeedback("complete")} /><Feedback title="当下不合适" impact="仅短期" body="只做短期调整，不理解为讨厌" disabled={feedbackSubmitting} onClick={() => onFeedback("not-suitable")} /><Feedback title="以后再说" impact="冷却保留" body="保留兴趣，先放回稍后口袋" disabled={feedbackSubmitting} onClick={() => onFeedback("later")} /><Feedback title="不喜欢" impact="长期降权" body="显著减少类似内容，仍可撤回" disabled={feedbackSubmitting} onClick={() => onFeedback("dislike")} /></div>}
  </div>;
}

function ActivityView({ activity, completionOpen, feedbackSubmitting, petalBalance, ambient, onOpenCompletion, onCloseCompletion, onComplete, onBackHome, onMemory }: {
  activity: ActivitySession; completionOpen: boolean; feedbackSubmitting: boolean; petalBalance: number; ambient: AmbientContext;
  onOpenCompletion: () => void; onCloseCompletion: () => void; onComplete: () => void; onBackHome: () => void; onMemory: () => void;
}) {
  const card = activity.card;
  const completed = activity.status === "completed";
  const [now, setNow] = useState(() => Date.now());
  const timeUpPromptedRef = useRef(false);
  const startedMs = new Date(activity.startedAt).getTime();
  const finishMs = new Date(activity.estimatedFinishAt).getTime();
  const totalMs = Math.max(1, finishMs - startedMs);
  const remainingMs = completed ? 0 : Math.max(0, finishMs - now);
  const progress = completed ? 100 : Math.min(100, Math.max(0, ((now - startedMs) / totalMs) * 100));
  const timeUp = !completed && remainingMs <= 0;

  useEffect(() => {
    if (completed) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [completed]);

  useEffect(() => {
    if (!timeUp || completionOpen || timeUpPromptedRef.current) return;
    timeUpPromptedRef.current = true;
    onOpenCompletion();
  }, [completionOpen, onOpenCompletion, timeUp]);

  return <div className="view activity-view">
    <div className="eyebrow">NOW · 正在进行</div>
    <div className="result-heading"><div><h1>{completed ? "这件事已经完成啦" : timeUp ? "预计时间到啦" : "这件事正在进行中"}</h1><p>{completed ? "完成记录已经留下，花瓣也收进记忆里。" : timeUp ? "可以结束并记录这次体验，也可以再多享受一会儿。" : "小宜会先帮你守住这张卡，结束前不能再抽下一张。"}</p></div><img src="/otter-side.png" alt="陪你开始活动的海獭小宜" /></div>
    <article className={`activity-card ${completed ? "completed" : ""}`}>
      <div className={`activity-art ${card.imageUrl ? "has-image" : ""}`}>{card.imageUrl ? <img src={card.imageUrl} alt={card.title} /> : <img src={otterArtForCategory(card.category)} alt={`${card.category}海獭插画`} />}</div>
      <div className="activity-content"><div className="result-badges"><SourceBadge source={card.source} /><span>{card.category}</span></div><h2>{card.title}</h2><p className="result-meta">预计 {card.duration} 分钟　·　{card.outing === "indoor" ? "室内" : card.outing === "outdoor" ? "室外" : "均可"}　·　{levelText[card.prep]}准备</p>
        <div className="activity-timeline"><div><span>开始</span><strong>{formatClock(activity.startedAt)}</strong></div><i /><div><span>预计完成</span><strong>{formatClock(activity.estimatedFinishAt)}</strong></div><i /><div><span>花瓣</span><strong>+{activity.rewardPetals}</strong></div></div>
        {!completed && <div className={`activity-countdown ${timeUp ? "time-up" : ""}`}><div><span>{timeUp ? "预计时间已到" : "剩余时间"}</span><strong>{timeUp ? "可以结束记录" : formatRemaining(remainingMs)}</strong></div><div className="activity-progress" aria-hidden="true"><i style={{ width: `${progress}%` }} /></div><p>{timeUp ? "完成确认会帮助小宜记录反馈，并把花瓣放进收集池。" : "进行中会锁住抽卡入口，避免今晚的选择被新的抽卡覆盖。"}</p></div>}
        {card.source === "preset" && <div className="soft-benefit"><span>小宜推荐权益</span><p>这张推荐卡保留一个轻量权益占位，完成时先用页面确认。</p><strong>YIKE-{card.category.toUpperCase().slice(0, 2)}-{String(activity.rewardPetals).padStart(2, "0")}</strong></div>}
        {completed ? <div className="activity-complete-note"><span>已收集</span><strong>+{activity.rewardPetals} 片薰衣草花瓣</strong><p>当前花瓣池共有 {petalBalance} 片。</p></div> : <div className="activity-actions single"><button className="primary-button" type="button" onClick={onOpenCompletion}>{timeUp ? "结束并记录" : "提前结束这件事"}</button></div>}
        {completed && <div className="activity-actions"><button className="primary-button" type="button" onClick={onMemory}>去记忆看看</button><button className="secondary-button" type="button" onClick={onBackHome}>再抽一张</button></div>}
      </div>
    </article>
    <div className="context-trace"><span>本次参考</span><strong>{ambient.localTime} · {weatherText(ambient.weather)}</strong></div>
    {completionOpen && <div className="completion-backdrop" onMouseDown={onCloseCompletion}><section className="completion-modal" role="dialog" aria-modal="true" aria-label="完成活动" onMouseDown={(event) => event.stopPropagation()}><button className="completion-close" type="button" onClick={onCloseCompletion} aria-label="关闭">×</button><span>{card.source === "preset" ? "完成确认 · 权益占位" : "完成确认"}</span><h2>{card.source === "preset" ? "确认完成后，花瓣会进入收集池" : "完成了吗？小宜帮你记下来"}</h2><p>{card.source === "preset" ? "这一版先用页面确认模拟核销。后续如果接真实合作，再换成扫码、优惠码或到店确认。" : "个人收藏卡完成后，会记录一次完成反馈，并收集少量花瓣。"}</p><div className="completion-reward"><strong>+{activity.rewardPetals}</strong><small>薰衣草花瓣</small></div><button className="primary-button wide" type="button" disabled={feedbackSubmitting} onClick={onComplete}>{feedbackSubmitting ? "记录中…" : card.source === "preset" ? "模拟核销并完成" : "已完成"}</button></section></div>}
  </div>;
}

function FeedbackInsightPanel({ insight }: { insight: FeedbackInsight }) {
  return <section className={`feedback-insight ${insight.tone}`}><div><span>反馈已学习</span><strong>{insight.actionLabel}</strong></div><dl><div><dt>短期处理</dt><dd>{insight.shortTerm}</dd></div><div><dt>长期记忆</dt><dd>{insight.longTerm}</dd></div><div><dt>权重变化</dt><dd>{insight.memoryShift}</dd></div><div><dt>再次出现</dt><dd>{insight.cooldown}</dd></div></dl></section>;
}

function Feedback({ title, impact, body, disabled, onClick }: { title: string; impact: string; body: string; disabled: boolean; onClick: () => void }) {
  return <button className="feedback-card" type="button" disabled={disabled} onClick={onClick}><span>◇</span><div><strong>{title}<em>{impact}</em></strong><small>{body}</small></div></button>;
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function calendarRange(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - mondayOffset);
  const end = new Date(start);
  end.setDate(start.getDate() + 42);
  return { start, end };
}

type GardenStage = "empty" | "sprout" | "bloom";

const gardenStageText: Record<GardenStage, string> = {
  empty: "待播种",
  sprout: "幼苗发芽",
  bloom: "薰衣草开花",
};

function gardenStageFor(balance: number, index: number): GardenStage {
  const growthUnits = Math.min(12, Math.floor(Math.max(0, balance) / 2));
  const plotUnits = Math.max(0, Math.min(3, growthUnits - index * 3));
  if (plotUnits >= 3) return "bloom";
  if (plotUnits >= 1) return "sprout";
  return "empty";
}

function PetalPool({ balance, ledger }: { balance: number; ledger: PetalLedgerEntry[] }) {
  const recent = ledger.slice(0, 3);
  const growthUnits = Math.min(12, Math.floor(Math.max(0, balance) / 2));
  const nextPetals = growthUnits >= 12 ? 0 : (growthUnits + 1) * 2 - balance;
  const plots = Array.from({ length: 4 }, (_, index) => ({ index, stage: gardenStageFor(balance, index) }));
  return <aside className="petal-pool garden-pool" aria-label="薰衣草种植区"><div className="garden-pool-head"><div><span>薰衣草种植区</span><strong>{balance}</strong><small>片薰衣草花瓣</small></div><em>{growthUnits}/12 生长进度</em></div><div className="lavender-garden">{plots.map(({ index, stage }) => <article className={`garden-plot ${stage}`} key={`${stage}-${index}`}><img src={`/art/yike/garden-${stage}-${index + 1}.png`} alt="" style={{ animationDelay: `${index * 160}ms` }} /><span>{index + 1}</span><small>{gardenStageText[stage]}</small></article>)}</div><p>{growthUnits >= 12 ? "四块土地都已经开花。后续可以接真实账本，把花瓣兑换和联名礼品放进这里。" : `每 2 片花瓣推进一格生长，再收集 ${Math.max(1, nextPetals)} 片就会出现新的变化。`}</p><div className="petal-ledger-preview">{recent.length === 0 ? <span>完成一次活动后，这里会出现第一条花瓣记录。</span> : recent.map((entry) => <article key={entry.id}><b>+{entry.amount}</b><div><strong>{entry.cardTitle}</strong><small>{entry.reason}</small></div></article>)}</div></aside>;
}

function MemoryView({ memoryNote, memorySummary, feedbackInsight, debugLog, petalBalance, petalLedger, onLoadHistory, onMemoryAction, onReset }: {
  memoryNote: string; memorySummary: MemorySummary | null; feedbackInsight: FeedbackInsight | null; debugLog: string;
  petalBalance: number; petalLedger: PetalLedgerEntry[];
  onLoadHistory: (range: { from: string; to: string }) => Promise<{ events: ActivityHistoryEvent[] }>;
  onMemoryAction: (itemKey: string, action: MemoryItemAction) => void;
  onReset: () => void;
}) {
  const now = new Date();
  const [month, setMonth] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(() => localDateKey(now));
  const [events, setEvents] = useState<ActivityHistoryEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const range = calendarRange(month);
  const from = range.start.toISOString();
  const to = range.end.toISOString();

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) {
        setHistoryLoading(true);
        setHistoryError("");
      }
      return onLoadHistory({ from, to });
    }).then((response) => {
      if (!cancelled) setEvents(response.events);
    }).catch((error) => {
      if (!cancelled) setHistoryError(error instanceof Error ? error.message : "历史记录读取失败");
    }).finally(() => {
      if (!cancelled) setHistoryLoading(false);
    });
    return () => { cancelled = true; };
  }, [from, onLoadHistory, retryKey, to]);

  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(range.start);
    date.setDate(range.start.getDate() + index);
    return date;
  });
  const eventsByDate = events.reduce<Record<string, ActivityHistoryEvent[]>>((result, event) => {
    const key = localDateKey(new Date(event.occurred_at));
    result[key] = [...(result[key] ?? []), event];
    return result;
  }, {});
  const selectedEvents = eventsByDate[selectedDate] ?? [];
  const summaryCalendar = memorySummary?.feedback_calendar;
  const preference = memorySummary?.long_term_preference;
  const memoryItems = memorySummary?.memory_items ?? [];
  const moveMonth = (offset: number) => {
    const next = new Date(month.getFullYear(), month.getMonth() + offset, 1);
    setMonth(next);
    setSelectedDate(localDateKey(next));
  };

  return <div className="view memory-view"><div className="eyebrow">MEMORY · 由你做主</div><div className="page-title"><div><img className="page-title-handwritten" src="/art/yike/handwritten-memory.png" alt="小宜记得什么" /><p>小宜只记住能让下一次更合适的小偏好。你随时可以查看、改一改，或让它忘掉。</p></div></div>
    <div className="memory-top-row">
    <section className="memory-calendar"><img className="calendar-shell-frame" src="/art/yike/calendar-stamp-lavender.png" alt="" /><div className="calendar-content"><div className="calendar-head"><button type="button" onClick={() => moveMonth(-1)} aria-label="上个月">←</button><div><span>拾贝日历</span><h2>{month.getFullYear()} 年 {month.getMonth() + 1} 月</h2></div><button type="button" onClick={() => moveMonth(1)} aria-label="下个月">→</button></div><div className="calendar-weekdays" aria-hidden="true">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{days.map((date) => { const key = localDateKey(date); const dayEvents = eventsByDate[key] ?? []; const outside = date.getMonth() !== month.getMonth(); return <button type="button" key={key} className={`${outside ? "outside" : ""} ${selectedDate === key ? "selected" : ""}`} onClick={() => setSelectedDate(key)} aria-label={`${date.getMonth() + 1}月${date.getDate()}日，${dayEvents.length}条记录`}><span>{date.getDate()}</span><i>{dayEvents.slice(0, 3).map((event) => <b key={event.event_id} className={event.kind} />)}</i></button>; })}</div></div></section>
    <PetalPool balance={petalBalance} ledger={petalLedger} />
    </div>
    <section className="day-memory"><div className="day-memory-title"><div><span>{selectedDate}</span><h2>这一天拾到的贝壳</h2></div>{events.some((event) => event.is_demo) && <b>演示记录</b>}</div>{historyLoading ? <p className="calendar-message">正在从海湾里读取记录…</p> : historyError ? <div className="calendar-message error"><p>暂时无法读取：{historyError}</p><button type="button" onClick={() => setRetryKey((value) => value + 1)}>重试</button></div> : selectedEvents.length === 0 ? <p className="calendar-message">这天海面很安静，没有留下新的记录。</p> : <div className="day-event-list">{selectedEvents.map((event) => { const category = categoryFromContract[event.content_category]; const shell = shellForCategory(category); return <article key={event.event_id}><img src={shell.image} alt="" /><div><span>{event.kind === "draw" ? "抽到一张" : feedbackActionText[event.action ?? "accept"]}</span><strong>{event.title}</strong><small>{new Date(event.occurred_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} · {category}</small></div></article>; })}</div>}</section>
    <div className="memory-grid"><section className="memory-card blue"><span>这个月的小小回响</span><h2>{summaryCalendar ? `这个月捡到了 ${summaryCalendar.pearl_count} 颗小珍珠` : memoryNote}</h2><p>{summaryCalendar ? `${summaryCalendar.month_label} · 完成 ${summaryCalendar.completed_count} 次，正向反馈 ${summaryCalendar.positive_count} 次。` : feedbackInsight ? `${feedbackInsight.shortTerm}；${feedbackInsight.cooldown}。` : "你可以随时撤回，系统不会据此建立人格或健康标签。"}</p></section><section className="memory-card"><span>长期偏好</span><h2>{preference?.headline ?? (feedbackInsight ? feedbackInsight.memoryShift : "室内 · 低准备 · 45 分钟")}</h2><div className="memory-tags">{(preference?.tags ?? [{ label: "活动场景", value: "室内" }, { label: "准备程度", value: "低" }, { label: "可用时长", value: "45 分钟" }]).map((tag) => <em key={`${tag.label}-${tag.value}`}>{tag.label}：{tag.value}</em>)}</div><p>{preference?.evidence ?? (feedbackInsight ? feedbackInsight.longTerm : "这里只展示用户主动选择和可解释的行为信号。")}</p></section></div>
    <div className="memory-layout"><section className="memory-list"><div><h2>小宜目前这样理解你</h2><span>这里只放可修改的小偏好。</span></div>{memoryItems.length === 0 ? <p className="memory-empty">暂无可展示记忆，完成几次抽卡反馈后会出现在这里。</p> : memoryItems.map((item) => <article key={item.item_key} className="memory-row"><div><strong>{item.title}</strong><p>{item.description}</p><small>{item.source}{item.action_state === "kept" ? " · 已保留" : ""}</small></div><div><button type="button" onClick={() => onMemoryAction(item.item_key, "keep")}>保留</button><button type="button" onClick={() => onMemoryAction(item.item_key, "view")}>查看</button><button className="danger" type="button" onClick={() => onMemoryAction(item.item_key, "clear")}>清除</button></div></article>)}</section><aside className="memory-static"><h2>只陪你过今晚的事</h2>{(memorySummary?.non_persistent ?? [{ label: "经期不舒服", reason: "只在当次会话中使用" }, { label: "不想久站", reason: "只影响本次硬过滤" }, { label: "不想费心打扮", reason: "只用于当次准备起来麻烦吗判断" }]).map((item) => <p key={item.label}><strong>{item.label}</strong><span>{item.reason}</span></p>)}</aside></div>{feedbackInsight && <FeedbackInsightPanel insight={feedbackInsight} />}
    <details className="debug-panel"><summary><span>FRONTEND ↔ AGENT</span><b>v1.0 · 最后一次调用</b></summary><pre>{debugLog}</pre></details><button className="secondary-button reset-demo" type="button" onClick={onReset}>重置演示数据</button>
  </div>;
}
