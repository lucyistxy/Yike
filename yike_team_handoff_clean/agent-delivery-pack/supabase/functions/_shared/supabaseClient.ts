import { createClient } from "npm:@supabase/supabase-js@2";

export function createRequestClient(req: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are required");
  }

  const authorization = req.headers.get("Authorization") ?? "";

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: authorization ? { Authorization: authorization } : {}
    },
    auth: {
      persistSession: false
    }
  });
}

export function createServiceClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false
    }
  });
}

export function requestHeaders() {
  return {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, x-client-info, apikey, content-type"
  };
}

export async function requireUserId(supabase: ReturnType<typeof createRequestClient>, expectedUserId?: string) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new Error("auth_required");
  }
  if (expectedUserId && data.user.id !== expectedUserId) {
    throw new Error("user_id_mismatch");
  }
  return data.user.id;
}
