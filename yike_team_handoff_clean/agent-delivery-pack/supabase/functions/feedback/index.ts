import { feedbackEffect, type FeedbackAction } from "../_shared/recommendationCore.ts";
import { writeFeedback } from "../_shared/repository.ts";
import { createRequestClient, requestHeaders, requireUserId } from "../_shared/supabaseClient.ts";

type FeedbackPayload = {
  user_id: string;
  card_id: string;
  action: FeedbackAction;
  optional_reason?: string | null;
};

const headers = requestHeaders();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  try {
    const payload = await req.json() as FeedbackPayload;
    validatePayload(payload);

    const supabase = createRequestClient(req);
    await requireUserId(supabase, payload.user_id);
    const writeResult = await writeFeedback(supabase, payload);

    return json({
      ok: true,
      ...writeResult,
      effect: feedbackEffect(payload.action)
    });
  } catch (error) {
    return json({
      error: "feedback_failed",
      message: error instanceof Error ? error.message : "Unknown error"
    }, 400);
  }
});

function validatePayload(payload: FeedbackPayload) {
  if (!payload.user_id) throw new Error("user_id is required");
  if (!payload.card_id) throw new Error("card_id is required");
  if (!payload.action) throw new Error("action is required");
  if (!["accept", "complete", "reroll", "not_suitable", "later", "dislike", "save_preset"].includes(payload.action)) {
    throw new Error("unsupported feedback action");
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers
  });
}
