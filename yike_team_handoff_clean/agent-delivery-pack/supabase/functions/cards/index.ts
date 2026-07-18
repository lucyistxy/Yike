import { normalizeDraft, type CardDraft } from "../_shared/cardDraftCore.ts";
import { copyPresetCard, deleteUserCard, listCards, loadCardDraft, saveCardFromDraft, updateUserCard } from "../_shared/repository.ts";
import { createRequestClient, createServiceClient, requestHeaders, requireUserId } from "../_shared/supabaseClient.ts";

type SaveCardPayload = {
  user_id: string;
  preset_card_id?: string;
  draft_id?: string;
  draft?: Partial<CardDraft>;
  overrides?: Partial<CardDraft>;
  edits?: Record<string, unknown>;
};

type UpdateCardPayload = {
  user_id: string;
  card_id: string;
  action?: "archive" | "restore" | "cool" | "complete";
  updates?: Record<string, unknown>;
  cooling_until?: string | null;
};

type DeleteCardPayload = {
  user_id: string;
  card_id: string;
};

const headers = requestHeaders();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });

  try {
    const supabase = createRequestClient(req);

    if (req.method === "GET") {
      const url = new URL(req.url);
      const userId = url.searchParams.get("user_id") ?? "";
      if (!userId) throw new Error("user_id is required");
      await requireUserId(supabase, userId);

      const result = await listCards(supabase, userId, {
        source_scope: normalizeSourceScope(url.searchParams.get("source_scope")),
        status: url.searchParams.get("status"),
        eligible_only: url.searchParams.get("eligible_only") === "true",
        q: url.searchParams.get("q"),
        limit: Number(url.searchParams.get("limit") ?? 100)
      });

      return json(result);
    }

    if (req.method === "PATCH") {
      const payload = await req.json() as UpdateCardPayload;
      if (!payload.user_id) throw new Error("user_id is required");
      if (!payload.card_id) throw new Error("card_id is required");
      await requireUserId(supabase, payload.user_id);

      const result = await updateUserCard(supabase, payload.user_id, payload.card_id, {
        action: payload.action,
        updates: payload.updates,
        cooling_until: payload.cooling_until
      });

      return json(result);
    }

    if (req.method === "DELETE") {
      const payload = await req.json() as DeleteCardPayload;
      if (!payload.user_id) throw new Error("user_id is required");
      if (!payload.card_id) throw new Error("card_id is required");
      await requireUserId(supabase, payload.user_id);

      const serviceSupabase = createServiceClient();
      const result = await deleteUserCard(serviceSupabase, serviceSupabase, payload.user_id, payload.card_id);
      return json(result);
    }

    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const payload = await req.json() as SaveCardPayload;
    if (!payload.user_id) throw new Error("user_id is required");

    await requireUserId(supabase, payload.user_id);

    if (payload.preset_card_id) {
      const copied = await copyPresetCard(supabase, payload.user_id, payload.preset_card_id, payload.edits ?? {});
      return json(copied);
    }

    const storedDraft = payload.draft_id
      ? await loadCardDraft(supabase, payload.user_id, payload.draft_id)
      : null;

    const rawDraft = {
      ...(storedDraft?.draft ?? {}),
      ...(payload.draft ?? {}),
      ...(payload.overrides ?? {}),
      user_id: payload.user_id
    };

    const normalized = normalizeDraft(rawDraft);
    const saved = await saveCardFromDraft(
      supabase,
      payload.user_id,
      normalized,
      payload.draft_id,
      storedDraft?.source_asset ?? null
    );

    return json(saved);
  } catch (error) {
    return json({
      error: "save_card_failed",
      message: error instanceof Error ? error.message : "Unknown error"
    }, 400);
  }
});

function normalizeSourceScope(value: string | null) {
  if (value === "preset" || value === "both") return value;
  return "personal";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers });
}
