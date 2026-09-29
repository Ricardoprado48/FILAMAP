-- Central de Observabilidade (PACOTE_CONSTRUCAO_OBSERVABILIDADE_FILAMAP_V1, secoes 4-8 e 12).
-- ADITIVA: nenhuma tabela existente e alterada. A central OBSERVA; nao decide estoque,
-- identidade, peso nem finalize. Nenhuma funcao daqui e chamada pelo fluxo critico.
--
-- Escrita: SOMENTE pela RPC ingest_ops_events (SECURITY DEFINER), que forca user_id = auth.uid().
-- Leitura: SOMENTE admin (ops_admins). Tester nao le nem os proprios eventos (decisao D4).
-- Retencao 30 dias (D3) por purga oportunista na propria RPC; cota 300 eventos/dia/instalacao (D2).
--
-- Rollback: supabase/rollbacks/20261001100000_ops_observability.down.sql

-- ---------------------------------------------------------------- tabelas

CREATE TABLE public.ops_admins (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.ops_installations (
    installation_id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('agent', 'web')),
    machine_hint TEXT CHECK (length(machine_hint) <= 32),
    app_version TEXT CHECK (length(app_version) <= 40),
    printer_id UUID,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    previous_machine_hint TEXT CHECK (length(previous_machine_hint) <= 32),
    status JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(status) <= 4096)
);

COMMENT ON COLUMN public.ops_installations.last_seen_at IS 'Relogio do SERVIDOR na ultima chamada da instalacao.';
COMMENT ON COLUMN public.ops_installations.previous_machine_hint IS 'Preenchido quando o mesmo installation_id aparece com outra maquina (possivel pasta clonada).';

CREATE TABLE public.ops_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    installation_id UUID NOT NULL REFERENCES public.ops_installations(installation_id) ON DELETE CASCADE,
    client_event_id UUID NOT NULL,
    boot_id UUID NOT NULL,
    seq INTEGER NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    app_version TEXT CHECK (length(app_version) <= 40),
    event_type TEXT NOT NULL CHECK (event_type IN (
        'AGENT_STARTED', 'AGENT_STOPPED', 'AGENT_CRASH_RECOVERED',
        'MQTT_CONNECTED', 'MQTT_DISCONNECTED', 'MQTT_ERROR',
        'PRINTER_ONLINE', 'PRINTER_OFFLINE',
        'TELEMETRY_DEGRADED', 'TELEMETRY_RESTORED',
        'SESSION_LOST', 'SESSION_RECOVERED',
        'BAMBU_SYNC_FAILED', 'BAMBU_SYNC_RECOVERED',
        'PROFILE_SYNC_FAILED', 'PROFILE_SYNC_RECOVERED',
        'INBOX_ITEM_CREATED',
        'JOB_DETECTED', 'JOB_FINISHED', 'JOB_FAILED',
        'FTPS_FAILED',
        'FINALIZE_QUEUED', 'FINALIZE_RETRY', 'FINALIZE_COMPLETED', 'FINALIZE_FAILED',
        'SPOOL_AMBIGUOUS',
        'UNHANDLED_REJECTION', 'AGENT_ERROR',
        'WEB_ERROR', 'SUPPORT_REQUEST'
    )),
    severity TEXT NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'ERROR', 'CRITICAL')),
    component TEXT NOT NULL CHECK (length(component) <= 40),
    printer_id UUID,
    job_id UUID,
    spool_id UUID,
    error_code TEXT CHECK (length(error_code) <= 80),
    fingerprint TEXT CHECK (length(fingerprint) <= 40),
    message TEXT CHECK (length(message) <= 500),
    repeat_count INTEGER NOT NULL DEFAULT 1 CHECK (repeat_count >= 1),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(metadata) <= 4096),
    UNIQUE (installation_id, client_event_id)
);

-- printer_id/job_id/spool_id sem FK de proposito: evento nunca pode falhar por referencia apagada.

CREATE INDEX ops_events_install_occurred_idx ON public.ops_events (installation_id, occurred_at DESC);
CREATE INDEX ops_events_user_received_idx ON public.ops_events (user_id, received_at DESC);
CREATE INDEX ops_events_install_received_idx ON public.ops_events (installation_id, received_at);
CREATE INDEX ops_events_errors_idx ON public.ops_events (received_at) WHERE severity IN ('ERROR', 'CRITICAL');
CREATE INDEX ops_installations_user_idx ON public.ops_installations (user_id);

-- ---------------------------------------------------------------- funcoes

CREATE OR REPLACE FUNCTION public.ops_is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.ops_admins WHERE user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.ops_try_uuid(p TEXT)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
    IF p IS NULL OR p = '' THEN
        RETURN NULL;
    END IF;
    RETURN p::UUID;
EXCEPTION WHEN others THEN
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.ingest_ops_events(p_installation JSONB, p_events JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_install UUID;
    v_owner UUID;
    v_hint TEXT;
    v_old_hint TEXT;
    v_kind TEXT;
    v_today INTEGER;
    v_room INTEGER;
    v_ev JSONB;
    v_n INTEGER := 0;
    v_accepted INTEGER := 0;
    v_duplicated INTEGER := 0;
    v_dropped INTEGER := 0;
    v_rejected INTEGER := 0;
    v_rows INTEGER;
    c_quota CONSTANT INTEGER := 300;
    c_batch CONSTANT INTEGER := 50;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'no_session');
    END IF;

    v_install := ops_try_uuid(p_installation->>'installation_id');
    v_kind := p_installation->>'kind';
    IF v_install IS NULL OR v_kind IS NULL OR v_kind NOT IN ('agent', 'web') THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'bad_installation');
    END IF;

    SELECT user_id, machine_hint INTO v_owner, v_old_hint
    FROM ops_installations WHERE installation_id = v_install;
    IF v_owner IS NOT NULL AND v_owner <> v_uid THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'installation_owned_by_other_user');
    END IF;

    v_hint := left(p_installation->>'machine_hint', 32);

    INSERT INTO ops_installations AS i (installation_id, user_id, kind, machine_hint, app_version, printer_id, status)
    VALUES (
        v_install, v_uid, v_kind, v_hint,
        left(p_installation->>'app_version', 40),
        -- so aceita impressora do proprio usuario
        (SELECT pr.id FROM printers pr WHERE pr.id = ops_try_uuid(p_installation->>'printer_id') AND pr.user_id = v_uid),
        CASE WHEN jsonb_typeof(p_installation->'status') = 'object'
              AND pg_column_size(p_installation->'status') <= 4096
             THEN p_installation->'status' ELSE '{}'::jsonb END
    )
    ON CONFLICT (installation_id) DO UPDATE SET
        last_seen_at = now(),
        app_version = COALESCE(EXCLUDED.app_version, i.app_version),
        printer_id = COALESCE(EXCLUDED.printer_id, i.printer_id),
        machine_hint = COALESCE(EXCLUDED.machine_hint, i.machine_hint),
        previous_machine_hint = CASE
            WHEN EXCLUDED.machine_hint IS NOT NULL AND i.machine_hint IS NOT NULL
                 AND EXCLUDED.machine_hint <> i.machine_hint
            THEN i.machine_hint ELSE i.previous_machine_hint END,
        status = CASE WHEN EXCLUDED.status = '{}'::jsonb THEN i.status ELSE EXCLUDED.status END;

    IF jsonb_typeof(p_events) = 'array' THEN
        SELECT count(*) INTO v_today FROM ops_events
        WHERE installation_id = v_install AND received_at >= date_trunc('day', now());
        v_room := GREATEST(c_quota - v_today, 0);

        FOR v_ev IN SELECT value FROM jsonb_array_elements(p_events) LOOP
            v_n := v_n + 1;
            IF v_n > c_batch OR v_accepted >= v_room THEN
                v_dropped := v_dropped + 1;
                CONTINUE;
            END IF;
            BEGIN
                INSERT INTO ops_events (
                    user_id, installation_id, client_event_id, boot_id, seq, occurred_at, app_version,
                    event_type, severity, component, printer_id, job_id, spool_id,
                    error_code, fingerprint, message, repeat_count, metadata
                ) VALUES (
                    v_uid, v_install,
                    (v_ev->>'client_event_id')::UUID,
                    (v_ev->>'boot_id')::UUID,
                    (v_ev->>'seq')::INTEGER,
                    (v_ev->>'occurred_at')::TIMESTAMPTZ,
                    left(p_installation->>'app_version', 40),
                    v_ev->>'event_type',
                    v_ev->>'severity',
                    v_ev->>'component',
                    ops_try_uuid(v_ev->>'printer_id'),
                    ops_try_uuid(v_ev->>'job_id'),
                    ops_try_uuid(v_ev->>'spool_id'),
                    left(v_ev->>'error_code', 80),
                    left(v_ev->>'fingerprint', 40),
                    left(v_ev->>'message', 500),
                    GREATEST(COALESCE((v_ev->>'repeat_count')::INTEGER, 1), 1),
                    CASE WHEN jsonb_typeof(v_ev->'metadata') = 'object' THEN v_ev->'metadata' ELSE '{}'::jsonb END
                )
                ON CONFLICT (installation_id, client_event_id) DO NOTHING;
                GET DIAGNOSTICS v_rows = ROW_COUNT;
                IF v_rows = 1 THEN
                    v_accepted := v_accepted + 1;
                ELSE
                    v_duplicated := v_duplicated + 1;
                END IF;
            EXCEPTION WHEN others THEN
                -- evento invalido (tipo fora do catalogo, metadata > 4 KB, campo obrigatorio ausente):
                -- descarta so ele; o lote segue.
                v_rejected := v_rejected + 1;
            END;
        END LOOP;
    END IF;

    DELETE FROM ops_events WHERE id IN (
        SELECT id FROM ops_events
        WHERE installation_id = v_install AND received_at < now() - INTERVAL '30 days'
        LIMIT 500
    );

    RETURN jsonb_build_object(
        'ok', true, 'accepted', v_accepted, 'duplicated', v_duplicated,
        'dropped', v_dropped, 'rejected', v_rejected
    );
END;
$$;

-- Purga geral (instalacoes que pararam de enviar). So admin.
CREATE OR REPLACE FUNCTION public.ops_purge_expired()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rows INTEGER;
BEGIN
    IF NOT ops_is_admin() THEN
        RAISE EXCEPTION 'somente admin' USING ERRCODE = '42501';
    END IF;
    DELETE FROM ops_events WHERE id IN (
        SELECT id FROM ops_events WHERE received_at < now() - INTERVAL '30 days' LIMIT 5000
    );
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;


CREATE OR REPLACE FUNCTION public.ops_try_int(p TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
    RETURN p::INTEGER;
EXCEPTION WHEN others THEN
    RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------- health (secao 12)
-- Funcao (e nao view) porque precisa ler printers e auth.users de TODOS os usuarios:
-- SECURITY DEFINER com checagem de admin na primeira linha. Nao-admin recebe erro 42501.

CREATE OR REPLACE FUNCTION public.ops_health()
RETURNS TABLE (
    installation_id UUID,
    user_id UUID,
    user_email TEXT,
    kind TEXT,
    app_version TEXT,
    machine_hint TEXT,
    possible_clone BOOLEAN,
    first_seen_at TIMESTAMPTZ,
    agent_last_seen_at TIMESTAMPTZ,
    printer_last_online_at TIMESTAMPTZ,
    status JSONB,
    last_job_at TIMESTAMPTZ,
    last_finalize_at TIMESTAMPTZ,
    error_count_24h BIGINT,
    critical_count_24h BIGINT,
    inbox_pending BIGINT,
    health_status TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT ops_is_admin() THEN
        RAISE EXCEPTION 'somente admin' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    WITH base AS (
        SELECT
            i.*,
            p.last_seen_at AS printer_seen,
            u.email::TEXT AS email,
            (SELECT max(e.occurred_at) FROM ops_events e
              WHERE e.installation_id = i.installation_id AND e.event_type IN ('JOB_FINISHED', 'JOB_FAILED')) AS job_at,
            (SELECT max(e.occurred_at) FROM ops_events e
              WHERE e.installation_id = i.installation_id AND e.event_type = 'FINALIZE_COMPLETED') AS fin_at,
            (SELECT count(*) FROM ops_events e
              WHERE e.installation_id = i.installation_id AND e.severity IN ('ERROR', 'CRITICAL')
                AND e.received_at > now() - INTERVAL '24 hours') AS errs,
            (SELECT count(*) FROM ops_events e
              WHERE e.installation_id = i.installation_id AND e.severity = 'CRITICAL'
                AND e.received_at > now() - INTERVAL '24 hours') AS crits,
            (SELECT count(*) FROM spool_inbox s
              WHERE s.user_id = i.user_id AND s.status = 'pending') AS inbox
        FROM ops_installations i
        LEFT JOIN printers p ON p.id = i.printer_id
        LEFT JOIN auth.users u ON u.id = i.user_id
    )
    SELECT
        b.installation_id, b.user_id, b.email, b.kind, b.app_version, b.machine_hint,
        b.previous_machine_hint IS NOT NULL, b.first_seen_at, b.last_seen_at, b.printer_seen, b.status,
        b.job_at, b.fin_at, b.errs, b.crits, b.inbox,
        CASE
            WHEN b.kind = 'agent' AND b.last_seen_at < now() - INTERVAL '15 minutes' THEN 'OFFLINE'
            WHEN b.status->>'session' = 'lost'
              OR COALESCE(ops_try_int(b.status->>'pending_finalize_oldest_min'), 0) > 60
              OR b.crits > 0 THEN 'CRITICAL'
            WHEN (b.status->>'mqtt' = 'disconnected' AND COALESCE(ops_try_int(b.status->>'mqtt_down_min'), 0) > 10)
              OR b.status->>'bambu_sync' = 'failing'
              OR b.status->>'profile_sync' = 'failing'
              OR b.errs > 0 THEN 'DEGRADED'
            ELSE 'OK'
        END
    FROM base b
    ORDER BY b.last_seen_at DESC;
END;
$$;

-- ---------------------------------------------------------------- keepalive (plano gratis)
-- Chamado 1x/dia pelo GitHub Actions com a chave anon: uma leitura REAL no banco
-- (o Supabase Free pausa apos 7 dias sem atividade de banco). Nao expoe dado nenhum.

CREATE OR REPLACE FUNCTION public.keepalive()
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT now();
$$;

-- ---------------------------------------------------------------- RLS
-- (SELECT f()) em vez de f(): o Postgres avalia uma vez por consulta, nao por linha (padrao Supabase).

ALTER TABLE public.ops_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY ops_admins_self_read ON public.ops_admins
    FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY ops_installations_admin_read ON public.ops_installations
    FOR SELECT TO authenticated USING ((SELECT public.ops_is_admin()));
CREATE POLICY ops_events_admin_read ON public.ops_events
    FOR SELECT TO authenticated USING ((SELECT public.ops_is_admin()));
-- Sem policy de INSERT/UPDATE/DELETE: escrita so pelas funcoes SECURITY DEFINER.

-- ---------------------------------------------------------------- GRANT

REVOKE ALL ON public.ops_admins, public.ops_installations, public.ops_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ops_admins, public.ops_installations, public.ops_events TO authenticated;

REVOKE ALL ON FUNCTION public.ingest_ops_events(JSONB, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_health() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_purge_expired() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_is_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_try_uuid(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ops_try_int(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.keepalive() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.ingest_ops_events(JSONB, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_health() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_purge_expired() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_try_uuid(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_try_int(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.keepalive() TO anon, authenticated;
