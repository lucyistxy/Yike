"use client";

/* eslint-disable @next/next/no-img-element -- 本地海獭资源与用户上传预览不需要远程图片优化 */

import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createAgentGateway } from "../lib/agent";
import { clearAuthSession, persistAuthSession } from "../lib/agent/http-gateway";
import type { ActivityHistoryEvent, Card as ContractCard, ContentCategory, DrawContext, FeedbackAction, FeedbackResult, MemoryItemAction, MemorySummary, UserProfile, WeatherContext } from "../lib/contracts/v1";

type View = "home" | "pool" | "add" | "memory" | "result";
type Source = "personal" | "preset";
type SourceScope = Source | "both";
type Level = "low" | "medium" | "high";
type Mood = "random" | "relax" | "active" | "quiet";
type DrawPhase = "idle" | "holding" | "lifting" | "waiting" | "revealing" | "settled";

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

const navItems: Array<{ id: Exclude<View, "result">; label: string; icon: string }> = [
  { id: "home", label: "此刻", icon: "⌂" },
  { id: "pool", label: "卡池", icon: "◇" },
  { id: "add", label: "添加", icon: "+" },
  { id: "memory", label: "记忆", icon: "✦" },
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const levelText = { low: "低", medium: "中", high: "高" };
const sourceText = { personal: "我的卡", preset: "产品推荐", both: "两者" };
const moodText = { random: "随便抽抽", relax: "彻底放松", active: "想有点活力", quiet: "安静独处" };
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const realAgentEnabled = Boolean(process.env.NEXT_PUBLIC_YIKE_AGENT_BASE_URL);

const categoryToContract: Record<string, ContentCategory> = { 书籍: "book", 电影: "movie", 剧集: "series", 美食: "food", 展览: "exhibition", 游戏: "game", 手作: "craft", 散步: "walk", 其他: "other", 播客: "other" };
const categoryFromContract: Record<ContentCategory, string> = { book: "书籍", movie: "电影", series: "剧集", food: "美食", exhibition: "展览", game: "游戏", craft: "手作", walk: "散步", other: "其他" };
const shellCategories: Array<{ category: string; contract: ContentCategory; image: string; note: string }> = [
  { category: "书籍", contract: "book", image: "/art/yike/shell-scallop.webp", note: "一页一页展开" },
  { category: "电影", contract: "movie", image: "/art/yike/shell-nautilus.webp", note: "让故事慢慢旋转" },
  { category: "剧集", contract: "series", image: "/art/yike/shell-cowrie.webp", note: "留住连续的期待" },
  { category: "美食", contract: "food", image: "/art/yike/shell-pearl.webp", note: "收藏一口好滋味" },
  { category: "展览", contract: "exhibition", image: "/art/yike/shell-cream-conch.webp", note: "把灵感带回海湾" },
  { category: "游戏", contract: "game", image: "/art/yike/shell-spiral-conch.webp", note: "进入一个小世界" },
  { category: "手作", contract: "craft", image: "/art/yike/shell-sand-dollar.webp", note: "在手心慢慢成形" },
  { category: "散步", contract: "walk", image: "/art/yike/shell-limpet.webp", note: "沿着风去走一走" },
  { category: "其他", contract: "other", image: "/art/yike/shell-murex.webp", note: "还没被命名的惊喜" },
];
const feedbackActionText: Record<FeedbackAction, string> = { accept: "就它", complete: "已完成", reroll: "换一张", not_suitable: "当下不合适", later: "以后再说", dislike: "不喜欢" };
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

function formatDelta(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
}

function buildFeedbackInsight(card: Card, response: FeedbackResult): FeedbackInsight {
  const signal = response.learning_signal;
  const rawCategory = signal?.category;
  const learnedCategory = rawCategory && rawCategory in categoryFromContract ? categoryFromContract[rawCategory as ContentCategory] : card.category;
  const memoryShift = !signal
    ? "长期偏好未返回"
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
    notice: "已读取本地时间，登录后可读取天气",
  };
}

function weatherText(weather: WeatherContext | null) {
  if (!weather) return "天气待读取";
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
    return "当前时间已经足够宽，可能是来源、出门范围或卡片冷却状态限制了候选。可以同时看看产品推荐，或把行动范围改成均可。";
  }
  return "这些条件有点严格。可以把可用时间放宽一点，或同时看看产品推荐。";
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
  return <span className={`source-badge ${source}`}>{source === "personal" ? "我的卡" : "产品推荐"}</span>;
}

function EmptyState({ title, body, action, onAction }: { title: string; body: string; action?: string; onAction?: () => void }) {
  return <div className="empty-state"><img className="empty-shell-art" src="/art/yike/shell-pearl.webp" alt="" /><h3>{title}</h3><p>{body}</p>{action && <button className="secondary-button" onClick={onAction}>{action}</button>}</div>;
}

function shellForCategory(category: string) {
  return shellCategories.find((item) => item.category === category) ?? shellCategories[shellCategories.length - 1];
}

function BrandLockup({ compact = false }: { compact?: boolean }) {
  return <div className={`brand-lockup art-brand ${compact ? "compact" : ""}`}><img src="/art/yike/logo-yike.webp" alt="Yike 宜刻" /></div>;
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
  const [debugLog, setDebugLog] = useState("等待第一次 Agent 调用");
  const [inputText, setInputText] = useState("");
  const [imageName, setImageName] = useState("");
  const [imagePreview, setImagePreview] = useState("");
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [parseStep, setParseStep] = useState<"input" | "reading" | "organizing" | "draft">("input");
  const [draft, setDraft] = useState<Card | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [cloudReady, setCloudReady] = useState(!realAgentEnabled);
  const [onboardingSaving, setOnboardingSaving] = useState(false);
  const [ambient, setAmbient] = useState<AmbientContext>({
    localTime: "--:--",
    hour: 0,
    timezone: "Asia/Shanghai",
    weather: null,
    loading: false,
    notice: "正在读取本地时间",
  });
  const [careNotice, setCareNotice] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const gatewayRef = useRef(createAgentGateway());
  const authPreview = useSyncExternalStore(subscribeAuthPreview, readAuthPreview, readServerAuthPreview);
  const isSignedIn = authPreview !== "未登录";
  const drawing = drawPhase !== "idle" && drawPhase !== "settled";

  useEffect(() => {
    const cards = localStorage.getItem("yike-personal-cards");
    const savedContext = localStorage.getItem("yike-context");
    // 从浏览器存储恢复初始演示数据，只在挂载时执行一次。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (cards && !(realAgentEnabled && readLocalValue("yike-user-id"))) setPersonalCards(JSON.parse(cards));
    if (savedContext) setContext({ ...DEFAULT_CONTEXT, ...JSON.parse(savedContext), constraints: [] });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setAmbient(makeAmbientContext()), 0);
    return () => window.clearTimeout(timer);
  }, []);

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

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }, []);

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
      setProfile(profile);
      setMemorySummary(cloudMemory);
      if (profile.explicit_profile?.default_available_time) {
        setContext((value) => ({
          ...value,
          time: Number(profile.explicit_profile.default_available_time) || value.time,
          energy: profile.explicit_profile?.default_energy_level === "medium" || profile.explicit_profile?.default_energy_level === "high" ? profile.explicit_profile.default_energy_level : value.energy,
          outing: profile.explicit_profile?.indoor_outdoor_preference === "outdoor" ? "can_go_out" : profile.explicit_profile?.indoor_outdoor_preference === "indoor" ? "stay_in" : value.outing,
        }));
      }
      const memoryText = cloudMemory.long_term_preference?.headline || summarizePreferenceMemory(profile);
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
  }, [showToast]);

  const refreshAmbientContext = useCallback(async () => {
    const base = makeAmbientContext();
    setAmbient({ ...base, loading: true });
    if (realAgentEnabled && (!readLocalValue("yike-user-id") || !readLocalValue("yike-user-access-token"))) {
      setAmbient({ ...base, loading: false, notice: "已读取本地时间，登录后可读取天气" });
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
        notice: weather.source === "fallback" ? "已读取本地时间，开启定位后可读取气温" : "已读取此刻时间和天气",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "天气读取失败";
      setAmbient({ ...base, loading: false, notice: "已读取本地时间，天气暂时不可用" });
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

  const contextSummary = `${context.time} 分钟 · ${context.outing === "stay_in" ? "不出门" : "可出门"} · ${levelText[context.energy]}精力`;

  const loadActivityHistory = useCallback(async ({ from, to }: { from: string; to: string }) => {
    return gatewayRef.current.getActivityHistory({ from, to });
  }, []);

  const performDraw = async (isExchange = false) => {
    if (drawing) return;
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
      setView("home");
      showToast("连续换了三次，试着换一个条件吧");
      return;
    }
    await performDraw(true);
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
      showToast("已保存到我的卡池");
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存失败";
      setDebugLog(JSON.stringify({ method: "saveCard", error: message }, null, 2));
      showToast(message);
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
    setFeedbackSubmitting(true);
    try {
      const response = await gatewayRef.current.submitFeedback({ card_id: result.id, action: gatewayAction });
      const insight = buildFeedbackInsight(result, response);
      setFeedbackInsight(insight);
      setMemoryNote(`${insight.actionLabel}：${insight.memoryShift}`);
      setDebugLog(JSON.stringify({ method: "submitFeedback", request: { card_id: result.id, action: gatewayAction }, response }, null, 2));
      if (result.source === "personal") {
        setResult({ ...result, status: response.status });
        setPersonalCards((cards) => cards.map((card) => card.id === result.id ? { ...card, status: response.status } : card));
      }
      setFeedbackOpen(action === "accept");
      showToast(action === "accept" ? "已确认，就从这张开始" : "反馈已记录");
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

  const go = (next: Exclude<View, "result">) => {
    setView(next);
    setNoCandidate(false);
  };

  const authRequired = realAgentEnabled;
  const needsOnboarding = authRequired && isSignedIn && cloudReady && profile?.onboarding_completed === false;
  const appReady = !authRequired || (isSignedIn && cloudReady && !needsOnboarding);

  return (
    <main className="app-shell">
      <aside className="desktop-sidebar">
        <BrandLockup />
        {appReady && <nav aria-label="主导航">{navItems.map((item) => <button key={item.id} className={view === item.id ? "current" : ""} onClick={() => go(item.id)}><span>{item.icon}</span>{item.label}</button>)}</nav>}
        <div className="sidebar-companion"><p>今天辛苦啦，今晚只拾一件刚刚好的事。</p></div>
      </aside>

      <section className="main-stage">
        <header className="mobile-header"><BrandLockup compact /><button className="avatar-button" onClick={() => go("memory")}>小宜</button></header>
        {authRequired && !isSignedIn && <AuthLanding onToast={showToast} onDebug={setDebugLog} />}
        {authRequired && isSignedIn && !cloudReady && <LoadingView title="正在恢复你的卡池和记忆" body="正在读取 Supabase 里的个人卡池、记忆和偏好权重。" />}
        {needsOnboarding && <OnboardingView saving={onboardingSaving} onSave={saveOnboarding} />}
        {appReady && realAgentEnabled && <AuthPanel
          onToast={showToast}
          onDebug={setDebugLog}
          onSignedOut={() => {
            setPersonalCards([]);
            setResult(null);
            setFeedbackInsight(null);
            setMemoryNote("已退出登录");
          }}
        />}

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
          fileInputRef={fileInputRef}
          setInputText={setInputText}
          setDraft={setDraft}
          onImage={handleImage}
          onParse={parseCard}
          onSave={saveDraft}
        />}

        {appReady && view === "pool" && <PoolView cards={personalCards} onAdd={() => go("add")} onArchive={archiveCard} onDelete={deleteCard} />}

        {appReady && view === "memory" && <MemoryView memoryNote={memoryNote} memorySummary={memorySummary} feedbackInsight={feedbackInsight} debugLog={debugLog} onLoadHistory={loadActivityHistory} onMemoryAction={updateMemoryItem} onReset={() => { setPersonalCards([]); setContext(DEFAULT_CONTEXT); setRecentIds([]); setFeedbackInsight(null); setMemoryNote("还没有新的反馈"); setMemorySummary(null); showToast("演示数据已重置"); }} />}

        {appReady && view === "result" && result && <ResultView
          card={result}
          reasons={reasons}
          revealing={drawPhase === "revealing"}
          feedbackOpen={feedbackOpen}
          feedbackSubmitting={feedbackSubmitting}
          feedbackInsight={feedbackInsight}
          careNotice={careNotice}
          ambient={ambient}
          setFeedbackOpen={setFeedbackOpen}
          onAccept={() => submitFeedback("accept")}
          onExchange={exchange}
          onContext={() => { setView("home"); setDrawerOpen(true); }}
          onFeedback={submitFeedback}
          onCopy={copyPreset}
        />}
      </section>

      {appReady && <PageRail view={view} cardCount={personalCards.length} context={context} contextSummary={contextSummary} ambient={ambient} onRefreshAmbient={refreshAmbientContext} setContext={setContext} />}

      {appReady && <nav className="mobile-nav" aria-label="移动端主导航">{navItems.map((item) => <button key={item.id} className={view === item.id ? "current" : ""} onClick={() => go(item.id)}><span>{item.icon}</span><small>{item.label}</small></button>)}</nav>}

      {drawerOpen && <div className="drawer-backdrop" onMouseDown={() => setDrawerOpen(false)}><div className="context-drawer" onMouseDown={(event) => event.stopPropagation()}><div className="drawer-handle" /><div className="drawer-head"><div><h2>今晚，怎么抽？</h2><p>只调整真正影响选择的条件。</p></div><button onClick={() => setDrawerOpen(false)} aria-label="关闭">×</button></div><ContextControls context={context} setContext={setContext} /><button className="primary-button" onClick={() => { setDrawerOpen(false); performDraw(false); }}>按这些条件抽一张</button></div></div>}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

function AuthLanding({ onToast, onDebug }: { onToast: (message: string) => void; onDebug: (message: string) => void }) {
  return <div className="view auth-landing"><div className="eyebrow">ACCOUNT · 开始使用</div><div className="auth-hero"><div><h1>先拥有一片自己的卡池</h1><p>登录后，截图识别、个人卡池、推荐反馈和长期记忆都会按你的账号保存。</p></div><img src="/otter-front.png" alt="欢迎进入宜刻的小宜" /></div><AuthPanel onToast={onToast} onDebug={onDebug} startExpanded /></div>;
}

function LoadingView({ title, body }: { title: string; body: string }) {
  return <div className="view loading-view"><div className="agent-progress"><div className="progress-visual"><div className="scan-line" /><span>◇</span><img src="/otter-front.png" alt="正在恢复数据的小宜" /></div><h2>{title}</h2><p>{body}</p></div></div>;
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
    <section className="onboarding-section"><h2>默认状态</h2><div className="onboarding-grid"><label><span>常见可用时间</span><select value={form.defaultAvailableTime} onChange={(event) => setForm({ ...form, defaultAvailableTime: Number(event.target.value) })}>{[15, 30, 45, 60, 120].map((time) => <option key={time} value={time}>{time} 分钟</option>)}</select></label><label><span>默认精力</span><select value={form.defaultEnergyLevel} onChange={(event) => setForm({ ...form, defaultEnergyLevel: event.target.value as Level })}><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label><label><span>室内外偏好</span><select value={form.indoorOutdoorPreference} onChange={(event) => setForm({ ...form, indoorOutdoorPreference: event.target.value as OnboardingForm["indoorOutdoorPreference"] })}><option value="flexible">都可以</option><option value="indoor">更常室内</option><option value="outdoor">愿意出门</option></select></label><label><span>常见人数</span><select value={form.defaultPeople} onChange={(event) => setForm({ ...form, defaultPeople: event.target.value as OnboardingForm["defaultPeople"] })}><option value="solo">自己</option><option value="pair">两个人</option><option value="group">多人</option><option value="flexible">都可以</option></select></label><label><span>默认预算</span><select value={form.defaultBudgetLevel} onChange={(event) => setForm({ ...form, defaultBudgetLevel: event.target.value as OnboardingForm["defaultBudgetLevel"] })}><option value="free">尽量免费</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label></div></section>
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
      const response = await fetch(`${supabaseUrl}/auth/v1/${intent === "signin" ? "token?grant_type=password" : "signup"}`, {
        method: "POST",
        headers: {
          apikey: key,
          "content-type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(data.msg ?? data.error_description ?? data.error ?? (intent === "signin" ? "登录失败" : "注册失败")));
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
      <img className="journal-reference-art" src="/art/yike/home-journal-dynamic.webp" alt="" aria-hidden="true" />
      <div className="journal-dynamic-copy">
        <p className="kicker">{journalCopy.greeting}</p>
        <h1>{journalCopy.lines.map((line) => <span key={line}>{line}</span>)}</h1>
        <p>不用翻完所有收藏。<br />告诉小宜你现在有 {context.time} 分钟、{levelText[context.energy]}精力，<br />只给你一个能马上开始的选择。</p>
      </div>
    </section>

    <div className="ambient-strip"><div><span>此刻</span><strong>{ambient.localTime}</strong></div><i /><div><span>天气</span><strong>{ambient.loading ? "读取中" : weatherText(ambient.weather)}</strong></div><p>{ambient.notice}</p></div>
    <div className="mobile-context-card"><div><span>今晚的状态</span><strong>{contextSummary}</strong></div><button onClick={onOpenContext}>调整</button></div>

    <section className="pick-section"><div className="section-heading"><div><span className="section-index">01</span><h2>今晚卡包</h2></div><p>满足硬约束后，保留一点刚刚好的惊喜。</p></div>
      <div className="source-selector"><span>从哪里抽</span><div>{(["personal", "preset", "both"] as SourceScope[]).map((source) => <Chip key={source} active={context.source === source} onClick={() => setContext((value) => ({ ...value, source }))}>{sourceText[source]}</Chip>)}</div></div>
      <button className={`card-pack draw-ritual phase-${drawPhase}`} onClick={onDraw} disabled={drawing} aria-label={drawing ? "正在抽取一张娱乐卡" : "抽一张娱乐卡"}>
        <span className="pack-stitch" />
        <span className="draw-copy"><span className="pack-label">TONIGHT&apos;S PICK</span><strong>{drawing ? "小宜正在打开贝壳…" : "轻轻拆开"}</strong><small>{contextSummary}</small></span>
        <span className="draw-stage" aria-hidden="true"><img className="draw-otter hold" src="/art/yike/otter-hold-shell.webp" alt="" /><img className="draw-otter lift" src="/art/yike/otter-lift-shell.webp" alt="" /></span>
      </button>
      <button className="primary-button draw-button" onClick={onDraw} disabled={drawing}>{drawing ? "正在匹配此刻…" : "抽一张"}</button>
    </section>

    {noCandidate && <EmptyState title="这次没有硬抽一个不合适的结果" body={noCandidateHelp(context)} action="放宽一个条件" onAction={() => setContext((value) => ({ ...value, time: Math.max(value.time, 60), source: "both", outing: "can_go_out" }))} />}
    {personalCount === 0 && <div className="cold-start"><div className="mini-shell">◇</div><div><strong>你的个人卡池还是空的</strong><p>先从产品推荐开始，或收进一张真正想做的事。</p></div><button onClick={onAdd}>添加收藏</button></div>}
  </div>;
}

function ContextControls({ context, setContext }: { context: Context; setContext: React.Dispatch<React.SetStateAction<Context>> }) {
  const toggleConstraint = (constraint: string) => setContext((value) => ({ ...value, constraints: value.constraints.includes(constraint) ? value.constraints.filter((item) => item !== constraint) : [...value.constraints, constraint] }));
  return <div className="context-controls">
    <div className="control-group"><label>可用时间</label><div className="chip-row">{[15, 30, 45, 60, 120].map((time) => <Chip key={time} active={context.time === time} onClick={() => setContext((value) => ({ ...value, time }))}>{time} 分钟</Chip>)}</div></div>
    <div className="control-group"><label>精力</label><div className="segmented">{(["low", "medium", "high"] as Level[]).map((energy) => <button key={energy} className={context.energy === energy ? "active" : ""} onClick={() => setContext((value) => ({ ...value, energy }))}>{levelText[energy]}</button>)}</div></div>
    <div className="control-group"><label>是否出门</label><div className="segmented"><button className={context.outing === "stay_in" ? "active" : ""} onClick={() => setContext((value) => ({ ...value, outing: "stay_in" }))}>不出门</button><button className={context.outing === "can_go_out" ? "active" : ""} onClick={() => setContext((value) => ({ ...value, outing: "can_go_out" }))}>可以出门</button></div></div>
    <div className="control-group"><label>状态偏好</label><div className="chip-row">{(["random", "relax", "active", "quiet"] as Mood[]).map((mood) => <Chip key={mood} active={context.mood === mood} onClick={() => setContext((value) => ({ ...value, mood }))}>{moodText[mood]}</Chip>)}</div></div>
    <div className="control-group sensitive"><div className="control-label"><label>仅本次使用</label><span>不会长期保存</span></div><div className="chip-row"><Chip subtle active={context.constraints.includes("period")} onClick={() => toggleConstraint("period")}>经期不适</Chip><Chip subtle active={context.constraints.includes("no-standing")} onClick={() => toggleConstraint("no-standing")}>不久站</Chip><Chip subtle active={context.constraints.includes("no-makeup")} onClick={() => toggleConstraint("no-makeup")}>不需妆容</Chip></div></div>
  </div>;
}

function ContextPanel({ context, contextSummary, ambient, onRefreshAmbient, setContext }: { context: Context; contextSummary: string; ambient: AmbientContext; onRefreshAmbient: () => void; setContext: React.Dispatch<React.SetStateAction<Context>> }) {
  return <aside className="desktop-context"><div className="context-title"><span>此刻上下文</span><b>LIVE</b></div><h2>{contextSummary}</h2><div className="ambient-panel"><div><span>当前时间</span><strong>{ambient.localTime}</strong></div><div><span>当地天气</span><strong>{ambient.loading ? "读取中" : weatherText(ambient.weather)}</strong></div><p>{ambient.notice}</p><button type="button" onClick={onRefreshAmbient}>刷新</button></div><p>调整会立刻影响候选集合，敏感状态不会进入长期记忆。</p><ContextControls context={context} setContext={setContext} /><div className="privacy-note"><span>✓</span><div><strong>隐私边界</strong><p>当次状态仅保留在当前浏览器会话。</p></div></div></aside>;
}

function PageRail({ view, cardCount, context, contextSummary, ambient, onRefreshAmbient, setContext }: {
  view: View; cardCount: number; context: Context; contextSummary: string; ambient: AmbientContext;
  onRefreshAmbient: () => void; setContext: React.Dispatch<React.SetStateAction<Context>>;
}) {
  if (view === "home" || view === "result") {
    return <ContextPanel context={context} contextSummary={contextSummary} ambient={ambient} onRefreshAmbient={onRefreshAmbient} setContext={setContext} />;
  }
  if (view === "pool") {
    return <aside className="desktop-context page-rail pool-rail"><div className="context-title"><span>海湾小记</span><b>ATLAS</b></div><img className="rail-shell" src="/art/yike/shell-nautilus.webp" alt="蓝色鹦鹉螺" /><h2>{cardCount} 张卡，九种贝壳</h2><p>每一种贝壳代表一类故事。选中贝壳，就能打捞对应的收藏。</p><div className="rail-note"><strong>图鉴规则</strong><span>有收藏的类别会留下数量；空图鉴也会保留位置，等你慢慢拾满。</span></div></aside>;
  }
  if (view === "add") {
    return <aside className="desktop-context page-rail capture-rail"><div className="context-title"><span>小宜会帮你整理</span><b>3 STEPS</b></div><ol className="capture-steps"><li><b>1</b><div><strong>读取内容</strong><span>识别图片或文字信息</span></div></li><li><b>2</b><div><strong>补全执行条件</strong><span>提取时长、精力和地点</span></div></li><li><b>3</b><div><strong>由你确认后保存</strong><span>确认无误，收进卡池</span></div></li></ol><img className="rail-otter" src="/art/yike/otter-companion.webp" alt="拿着贝壳的小宜" /><div className="rail-note privacy"><strong>图片仅用于本次整理</strong><span>原图默认私有，不会公开展示。</span></div></aside>;
  }
  return <aside className="desktop-context page-rail memory-rail"><div className="context-title"><span>不会被记住的事</span><b>PRIVATE</b></div><img className="rail-shell" src="/art/yike/shell-pearl.webp" alt="珍珠贝" /><h2>敏感状态只在此刻使用</h2><ul><li>经期不适</li><li>不久站</li><li>不需妆容</li></ul><p>这些条件不会写入长期记忆，也不会被推断为健康或人格标签。</p><div className="rail-note privacy"><strong>你的数据只属于你</strong><span>可查看、可管理、可撤回。</span></div></aside>;
}

function AddView({ inputText, imageName, imagePreview, parseStep, draft, fileInputRef, setInputText, setDraft, onImage, onParse, onSave }: {
  inputText: string; imageName: string; imagePreview: string; parseStep: string; draft: Card | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>; setInputText: (value: string) => void; setDraft: React.Dispatch<React.SetStateAction<Card | null>>;
  onImage: (event: ChangeEvent<HTMLInputElement>) => void; onParse: () => void; onSave: () => void;
}) {
  return <div className="view add-view"><div className="eyebrow">CAPTURE · 收进小岛</div><div className="page-title"><div><h1>把种草，变成一张能抽的卡</h1><p>截图或文字都可以。Agent 先整理，你只确认真正影响执行的字段。</p></div><span className="step-badge">约 10 秒</span></div>
    {parseStep === "input" && <div className="add-grid capture-book"><span className="book-rings" aria-hidden="true" /><button className="upload-zone" onClick={() => fileInputRef.current?.click()}>{imagePreview ? <img src={imagePreview} alt="待识别截图预览" /> : <><span className="upload-icon">＋</span><strong>上传截图或图片</strong><small>支持 PNG、JPG，原图默认私有</small></>}<input ref={fileInputRef} type="file" accept="image/*" hidden onChange={onImage} /></button><div className="text-entry"><label htmlFor="capture-text">粘贴文字或手动输入</label><textarea id="capture-text" value={inputText} onChange={(event) => setInputText(event.target.value)} placeholder="例如：周末想去看海边主题展，听说现场很安静……" /><div className="entry-meta"><span>{imageName || "也可以只输入标题"}</span><span>{inputText.length}/300</span></div></div><button className="primary-button wide" onClick={onParse}>开始整理</button></div>}
    {(parseStep === "reading" || parseStep === "organizing") && <div className="agent-progress"><div className="progress-visual"><div className="scan-line" /><img src="/art/yike/shell-pearl.webp" alt="" /><img src="/art/yike/otter-companion.webp" alt="正在工作的海獭小宜" /></div><h2>{parseStep === "reading" ? "正在看懂这份收藏…" : "正在整理执行信息…"}</h2><div className="progress-steps"><span className="done">看内容</span><i /><span className={parseStep === "organizing" ? "done" : ""}>整理字段</span><i /><span>生成草稿</span></div></div>}
    {parseStep === "draft" && draft && <div className="draft-layout"><div className="agent-summary"><img className="summary-shell" src="/art/yike/shell-pearl.webp" alt="" /><div><span>AGENT 已整理</span><h2>一张可执行的娱乐卡</h2><p>蓝色提示表示模型置信度较低，你可以随时改。</p></div><img src="/art/yike/otter-companion.webp" alt="海獭小宜" /></div><div className="draft-form"><Field label="标题" hint="已识别"><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></Field><Field label="娱乐类别" hint="请确认" uncertain><select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}><option>电影</option><option>剧集</option><option>书籍</option><option>美食</option><option>展览</option><option>游戏</option><option>手作</option><option>散步</option><option>其他</option></select></Field><Field label="预计时长" hint="请确认" uncertain><input type="number" value={draft.duration} onChange={(event) => setDraft({ ...draft, duration: Number(event.target.value) })} /><em>分钟</em></Field><Field label="精力"><select value={draft.energy} onChange={(event) => setDraft({ ...draft, energy: event.target.value as Level })}><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></Field><Field label="室内外"><select value={draft.outing} onChange={(event) => setDraft({ ...draft, outing: event.target.value as Card["outing"] })}><option value="indoor">室内</option><option value="outdoor">室外</option><option value="either">均可</option></select></Field><Field label="准备成本"><select value={draft.prep} onChange={(event) => setDraft({ ...draft, prep: event.target.value as Level })}><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></Field></div><button className="primary-button wide" onClick={onSave}>保存到我的卡池</button></div>}
  </div>;
}

function Field({ label, hint, uncertain, children }: { label: string; hint?: string; uncertain?: boolean; children: React.ReactNode }) {
  return <label className={`field-row ${uncertain ? "uncertain" : ""}`}><span><small>{label}</small>{hint && <i>{hint}</i>}</span><div>{children}</div></label>;
}

function PoolView({ cards, onAdd, onArchive, onDelete }: { cards: Card[]; onAdd: () => void; onArchive: (id: string) => void; onDelete: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [status, setStatus] = useState<"all" | Card["status"]>("all");
  const normalizedQuery = query.trim().toLowerCase();
  const counts = Object.fromEntries(shellCategories.map((item) => [item.category, cards.filter((card) => card.category === item.category).length]));
  const visible = cards.filter((card) => {
    const matchesQuery = !normalizedQuery || card.title.toLowerCase().includes(normalizedQuery) || card.category.toLowerCase().includes(normalizedQuery);
    return matchesQuery && (!selectedCategory || card.category === selectedCategory) && (status === "all" || card.status === status);
  });
  const statusOptions: Array<{ value: "all" | Card["status"]; label: string }> = [
    { value: "all", label: "全部" }, { value: "active", label: "可抽取" }, { value: "cooling", label: "稍后" }, { value: "completed", label: "已完成" }, { value: "archived", label: "已归档" },
  ];

  return <div className="view pool-view"><div className="eyebrow">COLLECTION · 我的海湾</div><div className="page-title"><div><h1>收进来的好故事</h1><p>不是待办清单，只是一片随时可以回来打捞的海湾。</p></div><button className="primary-button compact" onClick={onAdd}>＋ 添加收藏</button></div>
    <section className="shell-atlas" aria-labelledby="shell-atlas-title"><div className="atlas-heading"><div><span>贝壳图鉴</span><h2 id="shell-atlas-title">从一种贝壳开始打捞</h2></div><button type="button" className={selectedCategory ? "" : "active"} onClick={() => setSelectedCategory(null)}>查看全部</button></div><div className="shell-atlas-grid">{shellCategories.map((item) => { const count = counts[item.category] ?? 0; const selected = selectedCategory === item.category; return <button type="button" key={item.category} className={`${selected ? "selected" : ""} ${count === 0 ? "empty" : ""}`} aria-pressed={selected} onClick={() => setSelectedCategory(selected ? null : item.category)}><img src={item.image} alt={`${item.category}类别贝壳`} /><strong>{item.category}</strong><span>{count ? `${count} 张卡` : "等待收藏"}</span></button>; })}</div></section>
    <div className="pool-toolbar"><div className="search-box">⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题或类别" /></div><div className="pool-count"><strong>{cards.length}</strong><span>张我的卡</span></div></div>
    <div className="status-filters" aria-label="按状态筛选">{statusOptions.map((option) => <button type="button" key={option.value} className={status === option.value ? "active" : ""} aria-pressed={status === option.value} onClick={() => setStatus(option.value)}>{option.label}</button>)}</div>
    {cards.length === 0 ? <EmptyState title="海湾里还没有卡片" body="先收进一张真正感兴趣的娱乐收藏吧。" action="添加一张" onAction={onAdd} /> : visible.length === 0 ? <EmptyState title="这一格暂时没有卡片" body="换一枚贝壳或清空搜索条件，再打捞一次。" action="查看全部" onAction={() => { setSelectedCategory(null); setStatus("all"); setQuery(""); }} /> : <div className="card-grid atlas-card-grid">{visible.map((card) => { const shell = shellForCategory(card.category); return <article className="pool-card" key={card.id}><div className={`pool-card-art ${card.imageUrl ? "has-image" : ""}`}>{card.imageUrl ? <img src={card.imageUrl} alt={card.title} /> : <><img className="category-shell-art" src={shell.image} alt="" /><small>{card.category}</small></>}</div><div className="pool-card-body"><div><SourceBadge source={card.source} /><span className={`status-pill ${card.status}`}>{card.status === "active" ? "可抽取" : card.status === "cooling" ? "稍后" : card.status === "completed" ? "已完成" : "已归档"}</span></div><h3>{card.title}</h3><p>{card.duration} 分钟 · {card.outing === "indoor" ? "室内" : card.outing === "outdoor" ? "室外" : "均可"} · {levelText[card.prep]}准备</p><div className="pool-actions"><button>编辑</button>{card.status === "archived" ? <button className="danger" onClick={() => onDelete(card.id)}>删除</button> : <button onClick={() => onArchive(card.id)}>归档</button>}</div></div></article>; })}</div>}
  </div>;
}

function ResultView({ card, reasons, revealing, feedbackOpen, feedbackSubmitting, feedbackInsight, careNotice, ambient, setFeedbackOpen, onAccept, onExchange, onContext, onFeedback, onCopy }: {
  card: Card; reasons: string[]; revealing: boolean; feedbackOpen: boolean; feedbackSubmitting: boolean; feedbackInsight: FeedbackInsight | null; careNotice: string; ambient: AmbientContext; setFeedbackOpen: (value: boolean) => void;
  onAccept: () => void; onExchange: () => void; onContext: () => void; onFeedback: (action: "complete" | "not-suitable" | "later" | "dislike") => void; onCopy: () => void;
}) {
  return <div className={`view result-view ${revealing ? "is-revealing" : ""}`}>
    <div className="eyebrow">REVEAL · 今晚的卡</div>
    <div className="result-heading"><div><h1>今晚，就从这一件开始</h1><p>只给一张，也告诉你为什么是它。</p></div><img src="/otter-side.png" alt="为你揭晓结果的海獭小宜" /></div>
    <div className="result-reveal-stage">
      <article className={`result-card ${revealing ? "revealing" : ""}`}>
        <div className={`result-art ${card.imageUrl ? "has-image" : ""}`}>{card.imageUrl ? <img src={card.imageUrl} alt={card.title} /> : <><div className="window-shape"><span /></div><div className="cup-shape" /><div className="result-moon" /><span className="result-shell">◇</span></>}</div>
        <div className="result-content"><div className="result-badges"><SourceBadge source={card.source} /><span>{card.category}</span></div><h2>{card.title}</h2><p className="result-meta">预计 {card.duration} 分钟　·　{card.outing === "indoor" ? "室内" : card.outing === "outdoor" ? "室外" : "均可"}　·　{levelText[card.prep]}准备</p><div className="reason-block"><strong>为什么现在适合</strong>{reasons.map((reason) => <p key={reason}><span>●</span>{reason}</p>)}</div><div className="companion-line">小宜：今晚只把节奏放慢一点，也很好。</div></div>
      </article>
      {revealing && <div className="result-pearl-reveal" aria-hidden="true"><i /><img src="/art/yike/pearl-card.webp" alt="" /></div>}
    </div>
    <div className="context-trace"><span>本次参考</span><strong>{ambient.localTime} · {weatherText(ambient.weather)}</strong></div>
    {careNotice && <div className="care-notice"><span>关怀提醒</span><p>{careNotice}</p></div>}
    <div className="result-actions"><button className="primary-button" onClick={onAccept} disabled={feedbackSubmitting || revealing}>{feedbackSubmitting ? "记录中…" : "就它"}</button><div><button className="secondary-button" onClick={onExchange} disabled={feedbackSubmitting || revealing}>换一张</button><button className="secondary-button" onClick={onContext} disabled={feedbackSubmitting || revealing}>改条件</button></div>{card.source === "preset" && <button className="text-button" onClick={onCopy} disabled={feedbackSubmitting || revealing}>存成我的卡</button>}<button className="feedback-link" onClick={() => setFeedbackOpen(!feedbackOpen)} disabled={feedbackSubmitting || revealing}>{feedbackOpen ? "收起反馈" : "这张卡怎么样？"}</button></div>
    {feedbackInsight && <FeedbackInsightPanel insight={feedbackInsight} />}
    {feedbackOpen && <div className="feedback-grid"><Feedback title="已完成" impact="长期加权" body="记录真实体验，轻轻增加相似内容" disabled={feedbackSubmitting} onClick={() => onFeedback("complete")} /><Feedback title="当下不合适" impact="仅短期" body="只做短期调整，不理解为讨厌" disabled={feedbackSubmitting} onClick={() => onFeedback("not-suitable")} /><Feedback title="以后再说" impact="冷却保留" body="保留兴趣，先放回稍后口袋" disabled={feedbackSubmitting} onClick={() => onFeedback("later")} /><Feedback title="不喜欢" impact="长期降权" body="显著减少类似内容，仍可撤回" disabled={feedbackSubmitting} onClick={() => onFeedback("dislike")} /></div>}
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

function MemoryView({ memoryNote, memorySummary, feedbackInsight, debugLog, onLoadHistory, onMemoryAction, onReset }: {
  memoryNote: string; memorySummary: MemorySummary | null; feedbackInsight: FeedbackInsight | null; debugLog: string;
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

  return <div className="view memory-view"><div className="eyebrow">MEMORY · 可见且克制</div><div className="page-title"><div><h1>小宜记得什么</h1><p>偏好可以查看、修改、清除；敏感状态不会长期保存。</p></div></div>
    <section className="memory-calendar"><img className="calendar-shell-frame" src="/art/yike/calendar-shell-frame.webp" alt="" /><div className="calendar-content"><div className="calendar-head"><button type="button" onClick={() => moveMonth(-1)} aria-label="上个月">←</button><div><span>拾贝日历</span><h2>{month.getFullYear()} 年 {month.getMonth() + 1} 月</h2></div><button type="button" onClick={() => moveMonth(1)} aria-label="下个月">→</button></div><div className="calendar-weekdays" aria-hidden="true">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{days.map((date) => { const key = localDateKey(date); const dayEvents = eventsByDate[key] ?? []; const outside = date.getMonth() !== month.getMonth(); return <button type="button" key={key} className={`${outside ? "outside" : ""} ${selectedDate === key ? "selected" : ""}`} onClick={() => setSelectedDate(key)} aria-label={`${date.getMonth() + 1}月${date.getDate()}日，${dayEvents.length}条记录`}><span>{date.getDate()}</span><i>{dayEvents.slice(0, 3).map((event) => <b key={event.event_id} className={event.kind} />)}</i></button>; })}</div></div></section>
    <section className="day-memory"><div className="day-memory-title"><div><span>{selectedDate}</span><h2>这一天拾到的贝壳</h2></div>{events.some((event) => event.is_demo) && <b>演示记录</b>}</div>{historyLoading ? <p className="calendar-message">正在从海湾里读取记录…</p> : historyError ? <div className="calendar-message error"><p>暂时无法读取：{historyError}</p><button type="button" onClick={() => setRetryKey((value) => value + 1)}>重试</button></div> : selectedEvents.length === 0 ? <p className="calendar-message">这天海面很安静，没有留下新的记录。</p> : <div className="day-event-list">{selectedEvents.map((event) => { const category = categoryFromContract[event.content_category]; const shell = shellForCategory(category); return <article key={event.event_id}><img src={shell.image} alt="" /><div><span>{event.kind === "draw" ? "抽到一张" : feedbackActionText[event.action ?? "accept"]}</span><strong>{event.title}</strong><small>{new Date(event.occurred_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} · {category}</small></div></article>; })}</div>}</section>
    <div className="memory-grid"><section className="memory-card blue"><span>本次反馈 · 贝壳日历</span><h2>{summaryCalendar ? `本月拾到 ${summaryCalendar.pearl_count} 颗小珍珠` : memoryNote}</h2><p>{summaryCalendar ? `${summaryCalendar.month_label} · 完成 ${summaryCalendar.completed_count} 次，正向反馈 ${summaryCalendar.positive_count} 次。` : feedbackInsight ? `${feedbackInsight.shortTerm}；${feedbackInsight.cooldown}。` : "你可以随时撤回，系统不会据此建立人格或健康标签。"}</p></section><section className="memory-card"><span>长期偏好</span><h2>{preference?.headline ?? (feedbackInsight ? feedbackInsight.memoryShift : "室内 · 低准备 · 45 分钟")}</h2><div className="memory-tags">{(preference?.tags ?? [{ label: "活动场景", value: "室内" }, { label: "准备程度", value: "低" }, { label: "可用时长", value: "45 分钟" }]).map((tag) => <em key={`${tag.label}-${tag.value}`}>{tag.label}：{tag.value}</em>)}</div><p>{preference?.evidence ?? (feedbackInsight ? feedbackInsight.longTerm : "这里只展示用户主动选择和可解释的行为信号。")}</p></section></div>
    <div className="memory-layout"><section className="memory-list"><div><h2>记忆清单</h2><span>以下为可解释、可管理的行为信号。</span></div>{memoryItems.length === 0 ? <p className="memory-empty">暂无可展示记忆，完成几次抽卡反馈后会出现在这里。</p> : memoryItems.map((item) => <article key={item.item_key} className="memory-row"><div><strong>{item.title}</strong><p>{item.description}</p><small>{item.source}{item.action_state === "kept" ? " · 已保留" : ""}</small></div><div><button onClick={() => onMemoryAction(item.item_key, "keep")}>保留</button><button onClick={() => onMemoryAction(item.item_key, "view")}>查看</button><button className="danger" onClick={() => onMemoryAction(item.item_key, "clear")}>清除</button></div></article>)}</section><aside className="memory-static"><h2>不会被记住的事</h2>{(memorySummary?.non_persistent ?? [{ label: "经期不适", reason: "只在当次会话中使用" }, { label: "不久站", reason: "只影响本次硬过滤" }, { label: "不需妆容", reason: "只用于当次准备成本判断" }]).map((item) => <p key={item.label}><strong>{item.label}</strong><span>{item.reason}</span></p>)}</aside></div>{feedbackInsight && <FeedbackInsightPanel insight={feedbackInsight} />}
    <details className="debug-panel"><summary><span>FRONTEND ↔ AGENT</span><b>v1.0 · 最后一次调用</b></summary><pre>{debugLog}</pre></details><button className="secondary-button reset-demo" onClick={onReset}>重置演示数据</button>
  </div>;
}
