import { buildCardDraft, type CardDraftPayload } from "../_shared/cardDraftCore.ts";
import { createCardDraft, uploadCardAsset } from "../_shared/repository.ts";
import { createRequestClient, createServiceClient, requestHeaders, requireUserId } from "../_shared/supabaseClient.ts";

const headers = requestHeaders();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const payload = await req.json() as CardDraftPayload;
    validatePayload(payload);

    const supabase = createRequestClient(req);
    await requireUserId(supabase, payload.user_id);
    const serviceSupabase = createServiceClient();

    const draft = await buildCardDraft(payload);
    const uploadedAsset = payload.image_base64
      ? await uploadCardAsset(serviceSupabase, payload.user_id, {
        image_base64: payload.image_base64,
        image_mime_type: payload.image_mime_type
      })
      : null;
    const sourceAsset = buildSourceAsset(payload, uploadedAsset);
    const saved = await createCardDraft(supabase, payload.user_id, payload.input_type, sourceAsset, draft);

    const draftWithId = {
      ...draft,
      draft_id: saved.draft_id,
      source_asset: sourceAsset,
      image_path: uploadedAsset?.image_path ?? null,
      image_url: uploadedAsset?.image_url ?? payload.image_url ?? null
    };

    return json({
      draft_id: saved.draft_id,
      draft: draftWithId,
      draft_card: draftWithId,
      field_confidence: Object.entries(draft.confidence ?? {}).map(([field, confidence]) => ({
        field,
        confidence
      })),
      missing_fields: draft.missing_fields,
      duplicate_candidates: []
    });
  } catch (error) {
    return json({
      error: "card_draft_failed",
      message: error instanceof Error ? error.message : "Unknown error"
    }, 400);
  }
});

function validatePayload(payload: CardDraftPayload) {
  if (!payload.user_id) throw new Error("user_id is required");
  if (!payload.input_type) throw new Error("input_type is required");
  if (!payload.text && !payload.image_url && !payload.image_base64) {
    throw new Error("text, image_url, or image_base64 is required");
  }
}

function buildSourceAsset(payload: CardDraftPayload, uploadedAsset: Record<string, unknown> | null) {
  return {
    input_type: payload.input_type,
    text_preview: payload.text ? payload.text.slice(0, 500) : null,
    image_url: payload.image_url ?? null,
    image_path: uploadedAsset?.image_path ?? null,
    has_image_base64: Boolean(payload.image_base64),
    image_mime_type: payload.image_mime_type ?? null
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers });
}
