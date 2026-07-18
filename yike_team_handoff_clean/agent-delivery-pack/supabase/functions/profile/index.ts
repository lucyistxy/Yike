import { getUserProfile, upsertUserProfile } from "../_shared/repository.ts";
import { createRequestClient, requestHeaders, requireUserId } from "../_shared/supabaseClient.ts";

type ProfileRequest = {
  user_id: string;
  onboarding_completed?: boolean;
  explicit_profile?: Record<string, unknown>;
  preference_memory?: Record<string, unknown>;
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
      return json(await getUserProfile(supabase, userId));
    }

    if (req.method !== "POST" && req.method !== "PATCH") {
      return json({ error: "method_not_allowed" }, 405);
    }

    const payload = await req.json() as ProfileRequest;
    if (!payload.user_id) throw new Error("user_id is required");

    await requireUserId(supabase, payload.user_id);
    return json(await upsertUserProfile(supabase, payload.user_id, {
      explicit_profile: payload.explicit_profile ?? {},
      preference_memory: payload.preference_memory ?? {},
      onboarding_completed: payload.onboarding_completed
    }));
  } catch (error) {
    return json({
      error: "profile_failed",
      message: error instanceof Error ? error.message : "Unknown error"
    }, 400);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers });
}
