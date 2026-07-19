import { loadActivityHistory } from "../_shared/repository.ts";
import { createRequestClient, requestHeaders, requireUserId } from "../_shared/supabaseClient.ts";

const headers = requestHeaders();
const MAX_RANGE_MS = 62 * 24 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  try {
    const url = new URL(req.url);
    const userId = url.searchParams.get("user_id") ?? "";
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";
    if (!userId) throw new Error("user_id is required");

    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
      throw new Error("valid from and to ISO timestamps are required");
    }
    if (toMs - fromMs > MAX_RANGE_MS) throw new Error("date range must not exceed 62 days");

    const supabase = createRequestClient(req);
    await requireUserId(supabase, userId);
    return json(await loadActivityHistory(supabase, userId, new Date(fromMs).toISOString(), new Date(toMs).toISOString()));
  } catch (error) {
    return json({
      error: "activity_history_failed",
      message: error instanceof Error ? error.message : "Unknown error"
    }, 400);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers });
}
