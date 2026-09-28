// Edge Function agent-pair: troca um código de pareamento (gerado na Web)
// por uma sessão Supabase própria do computador onde o Desktop Agent roda.
//
// Deploy SEM verificação de JWT (o Agent ainda não tem sessão):
//   supabase functions deploy agent-pair --no-verify-jwt --use-api
//
// Fluxo:
// 1. consume_agent_pairing_code (atômico, uso único, 10 min) -> user_id
// 2. admin.generateLink(magiclink) -> hashed_token (nenhum e-mail é enviado)
// 3. verifyOtp(token_hash) -> sessão NOVA e independente (auth.sessions)
// 4. agent_devices <- (user_id, session_id do JWT, nome do computador)
// A senha do usuário nunca passa por aqui nem pelo Agent.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sessionIdFromAccessToken(accessToken: string): string | null {
  try {
    const payload = accessToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=")));
    return typeof claims.session_id === "string" ? claims.session_id : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  let body: { code?: unknown; device_name?: unknown; agent_version?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_body" });
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";
  const deviceName = typeof body.device_name === "string" ? body.device_name.trim().slice(0, 80) : "";
  const agentVersion = typeof body.agent_version === "string" ? body.agent_version.trim().slice(0, 40) : null;
  if (code.length < 10 || code.length > 20 || !deviceName) {
    return json(400, { error: "invalid_request" });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userId, error: consumeError } = await admin.rpc("consume_agent_pairing_code", { p_code: code });
  if (consumeError) {
    console.error("consume_agent_pairing_code falhou:", consumeError.message);
    return json(500, { error: "server_error" });
  }
  if (!userId) return json(400, { error: "invalid_code" });

  const { data: userData, error: userError } = await admin.auth.admin.getUserById(userId as string);
  const email = userData?.user?.email;
  if (userError || !email) {
    console.error("getUserById falhou:", userError?.message);
    return json(500, { error: "server_error" });
  }

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    console.error("generateLink falhou:", linkError?.message);
    return json(500, { error: "server_error" });
  }

  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  const session = verified?.session;
  if (verifyError || !session) {
    console.error("verifyOtp falhou:", verifyError?.message);
    return json(500, { error: "server_error" });
  }

  const sessionId = sessionIdFromAccessToken(session.access_token);
  if (!sessionId) return json(500, { error: "server_error" });

  const { data: device, error: deviceError } = await admin
    .from("agent_devices")
    .insert({
      user_id: userId,
      session_id: sessionId,
      device_name: deviceName,
      agent_version: agentVersion,
      last_seen_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (deviceError || !device) {
    console.error("insert agent_devices falhou:", deviceError?.message);
    return json(500, { error: "server_error" });
  }

  return json(200, {
    device_id: device.id,
    user_id: userId,
    email,
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
  });
});
