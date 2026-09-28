-- Credencial por dispositivo do Desktop Agent (item 9 do plano de produção).
--
-- Antes: o Agent entrava com e-mail + senha do dono da conta. Não havia como
-- cortar um computador sem derrubar todos, e o cliente precisava digitar a
-- senha da conta no Agent.
--
-- Agora: a Web gera um código de pareamento curto (10 min, uso único). O
-- Agent troca o código, via Edge Function agent-pair, por uma sessão Supabase
-- PRÓPRIA (auth.sessions separada). Cada computador = uma sessão = uma linha
-- em agent_devices. Desconectar um computador apaga só a sessão dele: o
-- próximo refresh falha e, em no máximo 1h (validade do access token), o
-- Agent perde acesso. RLS das tabelas de negócio não muda: o dono continua
-- sendo auth.uid().
--
-- Rollback: supabase/rollbacks/20261002100000_agent_device_pairing.down.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.agent_pairing_codes (
    code_hash TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS agent_pairing_codes_user_idx ON public.agent_pairing_codes (user_id);

-- Só funções SECURITY DEFINER e a Edge Function (service_role) tocam aqui.
ALTER TABLE public.agent_pairing_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_pairing_codes FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.agent_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL UNIQUE,
    device_name TEXT NOT NULL,
    agent_version TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS agent_devices_user_idx ON public.agent_devices (user_id);

ALTER TABLE public.agent_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_devices FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.agent_devices TO authenticated;

DROP POLICY IF EXISTS "owner_select" ON public.agent_devices;
CREATE POLICY "owner_select" ON public.agent_devices
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

-- Web (usuário logado): gera um código. Devolve o código em claro UMA vez;
-- no banco fica só o SHA-256. Alfabeto sem 0/O/1/I/L para ditar sem erro.
CREATE OR REPLACE FUNCTION public.create_agent_pairing_code()
RETURNS TABLE (code TEXT, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_alphabet CONSTANT TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    v_bytes BYTEA;
    v_raw TEXT := '';
    v_expires TIMESTAMPTZ := now() + interval '10 minutes';
    i INTEGER;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'create_agent_pairing_code exige usuário autenticado' USING ERRCODE = '42501';
    END IF;

    -- Um código ativo por vez: gerar outro invalida os anteriores.
    DELETE FROM public.agent_pairing_codes
    WHERE user_id = auth.uid() AND (used_at IS NULL OR expires_at < now() - interval '1 day');

    v_bytes := gen_random_bytes(10);
    FOR i IN 0..9 LOOP
        v_raw := v_raw || substr(v_alphabet, (get_byte(v_bytes, i) % length(v_alphabet)) + 1, 1);
    END LOOP;

    INSERT INTO public.agent_pairing_codes (code_hash, user_id, expires_at)
    VALUES (encode(digest(v_raw, 'sha256'), 'hex'), auth.uid(), v_expires);

    RETURN QUERY SELECT substr(v_raw, 1, 5) || '-' || substr(v_raw, 6, 5), v_expires;
END;
$$;

-- Edge Function agent-pair (service_role): consome o código de forma atômica.
-- Devolve o user_id dono, ou nada se inválido/expirado/já usado.
CREATE OR REPLACE FUNCTION public.consume_agent_pairing_code(p_code TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_normalized TEXT := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
    v_user UUID;
BEGIN
    UPDATE public.agent_pairing_codes
    SET used_at = now()
    WHERE code_hash = encode(digest(v_normalized, 'sha256'), 'hex')
      AND used_at IS NULL
      AND expires_at > now()
    RETURNING user_id INTO v_user;
    RETURN v_user;
END;
$$;

-- Web: desconecta um computador. Apaga a sessão dele (refresh tokens caem em
-- cascata) e marca o dispositivo como revogado.
CREATE OR REPLACE FUNCTION public.revoke_agent_device(p_device_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_session UUID;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'revoke_agent_device exige usuário autenticado' USING ERRCODE = '42501';
    END IF;

    UPDATE public.agent_devices
    SET revoked_at = coalesce(revoked_at, now())
    WHERE id = p_device_id AND user_id = auth.uid()
    RETURNING session_id INTO v_session;

    IF v_session IS NULL THEN
        RAISE EXCEPTION 'Dispositivo % não encontrado', p_device_id USING ERRCODE = 'P0002';
    END IF;

    DELETE FROM auth.sessions WHERE id = v_session AND user_id = auth.uid();
END;
$$;

-- Agent: marca presença do dispositivo da sessão corrente. Sessões antigas
-- (login por senha, sem linha em agent_devices) simplesmente não afetam nada.
CREATE OR REPLACE FUNCTION public.touch_agent_device(p_agent_version TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_session UUID := nullif(auth.jwt() ->> 'session_id', '')::UUID;
BEGIN
    IF auth.uid() IS NULL OR v_session IS NULL THEN
        RETURN FALSE;
    END IF;

    UPDATE public.agent_devices
    SET last_seen_at = now(),
        agent_version = coalesce(p_agent_version, agent_version)
    WHERE session_id = v_session AND user_id = auth.uid() AND revoked_at IS NULL;
    RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.create_agent_pairing_code() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.consume_agent_pairing_code(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_agent_device(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.touch_agent_device(TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_agent_pairing_code() TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_agent_pairing_code(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_agent_device(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.touch_agent_device(TEXT) TO authenticated;
