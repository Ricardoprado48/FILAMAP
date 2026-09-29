import type { SupabaseClient } from "@supabase/supabase-js";

// Cadastro por convite (piloto fechado). O admin gera o convite na Central; o
// tester abre o link e cria a própria conta pela Edge Function signup-invite.
// Ver supabase/migrations/20261004100000_signup_invites.sql.

export interface SignupInvite {
  id: string;
  label: string;
  max_uses: number;
  used_count: number;
  expires_at: string;
  created_at: string;
  revoked_at: string | null;
  emails: string | null;
}

export interface CreatedInvite {
  code: string;
  expires_at: string;
}

export type InviteStatus = "ativo" | "esgotado" | "vencido" | "cancelado";

const INVITE_PARAM = "convite";

export function inviteStatus(invite: SignupInvite, now = Date.now()): InviteStatus {
  if (invite.revoked_at) return "cancelado";
  if (Date.parse(invite.expires_at) <= now) return "vencido";
  if (invite.used_count >= invite.max_uses) return "esgotado";
  return "ativo";
}

export function inviteLink(code: string, origin: string): string {
  return `${origin.replace(/\/+$/, "")}/?${INVITE_PARAM}=${encodeURIComponent(code)}`;
}

export function inviteCodeFromSearch(search: string): string {
  const raw = new URLSearchParams(search).get(INVITE_PARAM) ?? "";
  return raw.trim().toUpperCase();
}

export function inviteMessage(code: string, origin: string, expiresAt: string): string {
  const validade = new Date(expiresAt).toLocaleDateString("pt-BR");
  return [
    "Oi! Obrigado por topar testar o Filamap.",
    "",
    `Crie sua conta por este link (vale até ${validade}):`,
    inviteLink(code, origin),
    "",
    `Se pedir, o código do convite é ${code}.`,
  ].join("\n");
}

const SIGNUP_ERRORS: Record<string, string> = {
  invalid_invite: "Convite inválido, vencido ou já usado. Peça um novo convite.",
  invalid_email: "Digite um e-mail válido.",
  weak_password: "A senha precisa ter pelo menos 8 caracteres.",
  email_exists: "Este e-mail já tem conta. Use \"Entrar\" com a sua senha.",
};

export function signupErrorMessage(code: string | undefined): string {
  return (code && SIGNUP_ERRORS[code]) || "Não foi possível criar a conta agora. Tente de novo em alguns minutos.";
}

export async function createInvite(client: SupabaseClient, label: string, maxUses: number, days: number): Promise<CreatedInvite> {
  const { data, error } = await client.rpc("create_signup_invite", { p_label: label, p_max_uses: maxUses, p_days: days });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.code) throw new Error("O servidor não devolveu o código do convite.");
  return { code: row.code, expires_at: row.expires_at };
}

export async function listInvites(client: SupabaseClient): Promise<SignupInvite[]> {
  const { data, error } = await client.rpc("list_signup_invites");
  if (error) throw error;
  return (data ?? []) as SignupInvite[];
}

export async function revokeInvite(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.rpc("revoke_signup_invite", { p_id: id });
  if (error) throw error;
}

// Cria a conta pelo convite. Devolve null se deu certo, ou a mensagem de erro.
export async function signupWithInvite(
  client: SupabaseClient,
  input: { code: string; email: string; password: string }
): Promise<string | null> {
  const { error } = await client.functions.invoke("signup-invite", { body: input });
  if (!error) return null;
  let code: string | undefined;
  try {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") code = (await ctx.json())?.error;
  } catch {
    code = undefined;
  }
  return signupErrorMessage(code);
}
