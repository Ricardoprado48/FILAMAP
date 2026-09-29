-- Cadastro por convite (piloto fechado, sem SMTP).
--
-- Antes: cada tester exigia o Ricardo criar a conta no painel do Supabase e
-- mandar login e senha. O e-mail padrão do Supabase só entrega para a equipe do
-- projeto, então cadastro aberto com confirmação por e-mail não funciona.
--
-- Agora: o admin gera um convite na Central (código de 10 caracteres, N usos,
-- validade em dias). O tester abre o link, escolhe e-mail e senha, e a Edge
-- Function signup-invite cria a conta já confirmada (service_role). O cadastro
-- público do Supabase fica DESLIGADO (disable_signup), então só entra quem tem
-- convite. Para a venda: ligar cadastro aberto + SMTP próprio; esta tabela
-- continua servindo para convites/promoções.
--
-- No banco fica só o SHA-256 do código. Rollback:
-- supabase/rollbacks/20261004100000_signup_invites.down.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.signup_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code_hash TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
    max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses BETWEEN 1 AND 50),
    used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
    expires_at TIMESTAMPTZ NOT NULL,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.signup_invite_uses (
    invite_id UUID NOT NULL REFERENCES public.signup_invites(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (invite_id, user_id)
);

-- Ninguém lê ou grava direto: só as funções abaixo.
ALTER TABLE public.signup_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signup_invite_uses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.signup_invites, public.signup_invite_uses FROM PUBLIC, anon, authenticated;

-- Admin (Central): gera um convite. Devolve o código em claro UMA vez.
CREATE OR REPLACE FUNCTION public.create_signup_invite(p_label TEXT, p_max_uses INTEGER DEFAULT 1, p_days INTEGER DEFAULT 14)
RETURNS TABLE (code TEXT, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_alphabet CONSTANT TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    v_bytes BYTEA;
    v_raw TEXT := '';
    v_expires TIMESTAMPTZ;
    i INTEGER;
BEGIN
    IF NOT public.ops_is_admin() THEN
        RAISE EXCEPTION 'Somente admin gera convites' USING ERRCODE = '42501';
    END IF;
    IF p_days IS NULL OR p_days < 1 OR p_days > 90 THEN
        RAISE EXCEPTION 'Validade deve ser de 1 a 90 dias' USING ERRCODE = '22023';
    END IF;
    v_expires := now() + make_interval(days => p_days);

    v_bytes := gen_random_bytes(10);
    FOR i IN 0..9 LOOP
        v_raw := v_raw || substr(v_alphabet, (get_byte(v_bytes, i) % length(v_alphabet)) + 1, 1);
    END LOOP;

    INSERT INTO public.signup_invites (code_hash, label, max_uses, expires_at, created_by)
    VALUES (encode(digest(v_raw, 'sha256'), 'hex'), btrim(coalesce(p_label, '')), coalesce(p_max_uses, 1), v_expires, auth.uid());

    RETURN QUERY SELECT substr(v_raw, 1, 5) || '-' || substr(v_raw, 6, 5), v_expires;
END;
$$;

-- Admin (Central): lista os convites e quem entrou por cada um.
CREATE OR REPLACE FUNCTION public.list_signup_invites()
RETURNS TABLE (id UUID, label TEXT, max_uses INTEGER, used_count INTEGER, expires_at TIMESTAMPTZ,
               created_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ, emails TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.ops_is_admin() THEN
        RAISE EXCEPTION 'Somente admin lista convites' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT i.id, i.label, i.max_uses, i.used_count, i.expires_at, i.created_at, i.revoked_at,
           (SELECT string_agg(u.email, ', ' ORDER BY u.used_at) FROM public.signup_invite_uses u WHERE u.invite_id = i.id)
    FROM public.signup_invites i
    ORDER BY i.created_at DESC
    LIMIT 200;
END;
$$;

-- Admin (Central): cancela um convite (quem já entrou continua com a conta).
CREATE OR REPLACE FUNCTION public.revoke_signup_invite(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.ops_is_admin() THEN
        RAISE EXCEPTION 'Somente admin cancela convites' USING ERRCODE = '42501';
    END IF;
    UPDATE public.signup_invites SET revoked_at = coalesce(revoked_at, now()) WHERE id = p_id;
END;
$$;

-- Edge Function signup-invite (service_role): reserva um uso de forma atômica.
-- Devolve o id do convite, ou nada se inválido, vencido, cancelado ou esgotado.
CREATE OR REPLACE FUNCTION public.reserve_signup_invite(p_code TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_normalized TEXT := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
    v_id UUID;
BEGIN
    UPDATE public.signup_invites
    SET used_count = used_count + 1
    WHERE code_hash = encode(digest(v_normalized, 'sha256'), 'hex')
      AND revoked_at IS NULL
      AND expires_at > now()
      AND used_count < max_uses
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

-- Edge Function: devolve o uso reservado quando a criação da conta falha.
CREATE OR REPLACE FUNCTION public.release_signup_invite(p_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.signup_invites SET used_count = greatest(used_count - 1, 0) WHERE id = p_id;
$$;

-- Edge Function: registra quem entrou por qual convite.
CREATE OR REPLACE FUNCTION public.record_signup_invite_use(p_id UUID, p_user UUID, p_email TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    INSERT INTO public.signup_invite_uses (invite_id, user_id, email) VALUES (p_id, p_user, left(p_email, 254))
    ON CONFLICT DO NOTHING;
$$;

REVOKE ALL ON FUNCTION public.create_signup_invite(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_signup_invites() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_signup_invite(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_signup_invite(TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_signup_invites() TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_signup_invite(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.reserve_signup_invite(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_signup_invite(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_signup_invite_use(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_signup_invite(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_signup_invite(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_signup_invite_use(UUID, UUID, TEXT) TO service_role;
