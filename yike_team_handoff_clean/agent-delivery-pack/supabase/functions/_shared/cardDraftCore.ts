import type { Card } from "./recommendationCore.ts";

export type DraftInputType = "text" | "image" | "mixed";
export type DraftMode = "model";

export type CardDraftPayload = {
  user_id: string;
  input_type: DraftInputType;
  text?: string | null;
  image_url?: string | null;
  image_base64?: string | null;
  image_mime_type?: string | null;
  mode?: DraftMode;
};

export type CardDraft = Omit<Card, "card_id" | "source_type" | "status" | "created_at" | "updated_at"> & {
  draft_id?: string;
  source_type: "personal";
  status: "draft";
  recognition_mode: DraftMode;
  confidence: Record<string, number>;
};

export async function buildCardDraft(payload: CardDraftPayload): Promise<CardDraft> {
  const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiApiKey) {
    throw new Error("OPENAI_API_KEY is required for real card recognition");
  }

  const draft = await recognizeWithOpenAI(payload, openaiApiKey);

  return normalizeDraft({
    ...applyCategoryCorrections(draft, payload),
    user_id: payload.user_id,
    source_type: "personal",
    status: "draft",
    recognition_mode: "model"
  });
}

function applyCategoryCorrections(draft: Partial<CardDraft>, payload: CardDraftPayload): Partial<CardDraft> {
  const text = [
    draft.title,
    draft.subtitle,
    draft.description,
    ...(draft.mood_tags ?? []),
    payload.text
  ].filter(Boolean).join(" ");

  const category = inferCategoryFromText(text);
  if (!category) return draft;

  return {
    ...draft,
    content_category: category,
    confidence: {
      ...(draft.confidence ?? {}),
      content_category: Math.min(Number(draft.confidence?.content_category ?? 0.72), 0.82)
    }
  };
}

async function recognizeWithOpenAI(payload: CardDraftPayload, apiKey: string): Promise<Partial<CardDraft>> {
  const content: Array<Record<string, unknown>> = [
    {
      type: "input_text",
      text: [
        "请把用户上传或粘贴的娱乐收藏整理成宜刻娱乐卡草稿。",
        "只处理休闲、娱乐、兴趣消费内容；不要生成成长任务、课程计划或待办。",
        "title 必须是用户可执行的动作短语，例如图片是美甲款式时写“做美甲”或“做法式美甲”，不要写“看看这张收藏里的娱乐内容”这类泛化标题。",
        "如果图片来自社交平台截图，请结合图片主体、标题、标签和可见文案判断用户收藏意图。",
        "无法判断的字段请用 unknown 或 0，并放入 missing_fields。",
        "必须输出 JSON，字段名与 schema 保持一致。"
      ].join("\n")
    }
  ];

  if (payload.text) {
    content.push({ type: "input_text", text: payload.text });
  }
  if (payload.image_url) {
    content.push({ type: "input_image", image_url: payload.image_url });
  } else if (payload.image_base64) {
    const mimeType = payload.image_mime_type ?? "image/png";
    content.push({ type: "input_image", image_url: `data:${mimeType};base64,${payload.image_base64}` });
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: Deno.env.get("OPENAI_CARD_DRAFT_MODEL") ?? "gpt-5",
      input: [{ role: "user", content }],
      text: {
        format: {
          type: "json_schema",
          name: "yike_card_draft",
          strict: true,
          schema: cardDraftSchema()
        }
      }
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`openai_card_draft_failed: ${message}`);
  }

  const data = await response.json();
  const outputText = data.output_text ?? data.output?.flatMap((item: any) => item.content ?? [])
    .find((item: any) => item.type === "output_text")?.text;

  if (!outputText) throw new Error("openai_card_draft_empty_output");
  return JSON.parse(outputText);
}

export function normalizeDraft(draft: Partial<CardDraft>): CardDraft {
  const normalized = {
    user_id: draft.user_id ?? "",
    source_type: "personal" as const,
    title: draft.title?.trim() || "待确认的娱乐收藏",
    subtitle: draft.subtitle ?? null,
    description: draft.description ?? null,
    content_category: normalizeCategory(draft.content_category),
    mood_tags: draft.mood_tags ?? [],
    duration_min: Number(draft.duration_min ?? 0),
    duration_max: Number(draft.duration_max ?? 0),
    energy_level: normalizeEnum(draft.energy_level, ["low", "medium", "high", "unknown"], "unknown"),
    indoor_outdoor: normalizeEnum(draft.indoor_outdoor, ["indoor", "outdoor", "flexible", "unknown"], "unknown"),
    prep_cost: normalizeEnum(draft.prep_cost, ["low", "medium", "high", "unknown"], "unknown"),
    people: normalizeEnum(draft.people, ["solo", "pair", "group", "flexible", "unknown"], "unknown"),
    budget_level: normalizeEnum(draft.budget_level, ["free", "low", "medium", "high", "unknown"], "unknown"),
    location_type: draft.location_type ?? "unknown",
    distance_level: draft.distance_level ?? "unknown",
    reservation_required: draft.reservation_required ?? null,
    ticket_required: draft.ticket_required ?? null,
    weather_dependency: draft.weather_dependency ?? "unknown",
    constraint_tags: draft.constraint_tags ?? [],
    eligible_for_draw: false,
    missing_fields: [] as string[],
    status: "draft" as const,
    recognition_mode: "model",
    confidence: draft.confidence ?? {}
  };

  normalized.missing_fields = computeMissingFields(normalized);
  normalized.eligible_for_draw = normalized.missing_fields.length === 0;
  return normalized;
}

export function computeMissingFields(draft: Pick<CardDraft, "duration_min" | "duration_max" | "energy_level" | "indoor_outdoor" | "prep_cost">) {
  const missing: string[] = [];
  if (!draft.duration_min || !draft.duration_max) missing.push("duration_min", "duration_max");
  if (draft.energy_level === "unknown") missing.push("energy_level");
  if (draft.indoor_outdoor === "unknown") missing.push("indoor_outdoor");
  if (draft.prep_cost === "unknown") missing.push("prep_cost");
  return [...new Set(missing)];
}

function normalizeCategory(value?: string) {
  const allowed = ["movie", "series", "book", "music", "restaurant", "cafe", "exhibition", "game", "craft", "walk", "shopping", "event", "social", "home_activity", "other"];
  return allowed.includes(value ?? "") ? value! : "other";
}

function inferCategoryFromText(text: string) {
  const normalized = text.toLowerCase();
  if (/(咖啡|拿铁|美式|奶茶|饮品|甜品|蛋糕|面包|brunch|下午茶|cafe|coffee)/i.test(normalized)) return "cafe";
  if (/(去吃|吃|餐厅|饭店|小吃|夜宵|水饺|饺子|海胆|火锅|烧烤|烤肉|寿司|拉面|面馆|粤菜|川菜|日料|韩餐|西餐|菜馆|探店|美食|饭|餐|饱|点菜|外食|restaurant|food)/i.test(normalized)) return "restaurant";
  return null;
}

function normalizeEnum<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback;
}

function cardDraftSchema() {
  const confidenceFields = [
    "title",
    "content_category",
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
    "weather_dependency"
  ];

  return {
    type: "object",
    additionalProperties: false,
    required: [
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
      "missing_fields",
      "confidence"
    ],
    properties: {
      title: { type: "string" },
      subtitle: { type: ["string", "null"] },
      description: { type: ["string", "null"] },
      content_category: { type: "string", enum: ["movie", "series", "book", "music", "restaurant", "cafe", "exhibition", "game", "craft", "walk", "shopping", "event", "social", "home_activity", "other"] },
      mood_tags: { type: "array", items: { type: "string" } },
      duration_min: { type: "number" },
      duration_max: { type: "number" },
      energy_level: { type: "string", enum: ["low", "medium", "high", "unknown"] },
      indoor_outdoor: { type: "string", enum: ["indoor", "outdoor", "flexible", "unknown"] },
      prep_cost: { type: "string", enum: ["low", "medium", "high", "unknown"] },
      people: { type: "string", enum: ["solo", "pair", "group", "flexible", "unknown"] },
      budget_level: { type: "string", enum: ["free", "low", "medium", "high", "unknown"] },
      location_type: { type: "string" },
      distance_level: { type: "string" },
      reservation_required: { type: ["boolean", "null"] },
      ticket_required: { type: ["boolean", "null"] },
      weather_dependency: { type: "string" },
      constraint_tags: { type: "array", items: { type: "string" } },
      missing_fields: { type: "array", items: { type: "string" } },
      confidence: {
        type: "object",
        additionalProperties: false,
        required: confidenceFields,
        properties: Object.fromEntries(confidenceFields.map((field) => [
          field,
          { type: "number", minimum: 0, maximum: 1 }
        ]))
      }
    }
  };
}
