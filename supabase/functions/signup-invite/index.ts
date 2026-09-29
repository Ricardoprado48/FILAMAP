// Edge Function signup-invite: cria a conta de um tester a partir de um convite.
//
// Deploy SEM verificação de JWT (quem chama ainda não tem conta):
//   supabase functions deploy signup-invite --no-verify-jwt --use-api
//
// Fluxo:
// 1. reserve_signup_invite (atômico: válido, não vencido, não cancelado, com uso livre)
// 2. admin.createUser(email, senha, email_confirm) -> conta já confirmada, sem e-mail
// 3. falhou? release_signup_invite devolve o uso
// 4. record_signup_invite_use (quem entrou por qual convite)
// O cadastro público do Supabase fica desligado: só se entra por aqui.
// A senha só passa por aqui, em HTTPS, e nunca é registrada em log.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  let body: { code?: unknown; email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_body" });
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (code.length < 10 || code.length > 20) return json(400, { error: "invalid_invite" });
  if (!EMAIL_RE.test(email) || email.length > 254) return json(400, { error: "invalid_email" });
  if (password.length < 8 || password.length > 72) return json(400, { error: "weak_password" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: inviteId, error: reserveError } = await admin.rpc("reserve_signup_invite", { p_code: code });
  if (reserveError) {
    console.error("reserve_signup_invite falhou:", reserveError.message);
    return json(500, { error: "internal" });
  }
  if (!inviteId) return json(400, { error: "invalid_invite" });

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError || !created?.user) {
    await admin.rpc("release_signup_invite", { p_id: inviteId });
    const msg = createError?.message ?? "";
    if (/already|registered|exists/i.test(msg)) return json(409, { error: "email_exists" });
    if (/password/i.test(msg)) return json(400, { error: "weak_password" });
    console.error("createUser falhou:", msg);
    return json(500, { error: "internal" });
  }

  const { error: recordError } = await admin.rpc("record_signup_invite_use", {
    p_id: inviteId,
    p_user: created.user.id,
    p_email: email,
  });
  if (recordError) console.error("record_signup_invite_use falhou:", recordError.message);

  return json(200, { ok: true });
});
