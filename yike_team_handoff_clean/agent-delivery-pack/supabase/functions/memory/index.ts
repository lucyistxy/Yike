import { buildMemorySummary, updateMemoryItemOverride, type MemoryItemAction } from "../_shared/memorySummary.ts";
import { createRequestClient, requestHeaders, requireUserId } from "../_shared/supabaseClient.ts";

type MemoryActionPayload = {
  user_id: string;
  item_key: string;
  action: MemoryItemAction;
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
      return json(await buildMemorySummary(supabase, userId));
    }

    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const payload = await req.json() as MemoryActionPayload;
    if (!payload.user_id) throw new Error("user_id is required");
    if (!payload.item_key) throw new Error("item_key is required");
    if (!payload.action) throw new Error("action is required");

    await requireUserId(supabase, payload.user_id);
    const result = await updateMemoryItemOverride(supabase, payload.user_id, payload.item_key, payload.action);
    const summary = await buildMemorySummary(supabase, payload.user_id);
    const item = summary.memory_items.find((memoryItem) => memoryItem.item_key === payload.item_key) ?? null;

    return json({
      ok: true,
      ...result,
      item,
      summary
    });
  } catch (error) {
    return json({
      error: "memory_failed",
      message: error instanceof Error ? error.message : "Unknown error"
    }, 400);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers });
}
