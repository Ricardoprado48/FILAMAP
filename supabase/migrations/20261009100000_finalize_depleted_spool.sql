-- Carretel que acaba no meio da impressao (Agent 4.4.0).
--
-- Caso real de 08/10: o carretel acabou no meio da peca, a AMS seguiu no carretel reserva,
-- e o antigo continuou ativo "no AMS" com saldo fantasma.
--
-- 1) finalize_print_job aceita "depleted": true em um item de p_items. Para esse carretel,
--    depois do desconto normal:
--      - guarda em print_logs.depleted_leftover_g o saldo que sobrou no sistema (o que o
--        Filamap achava que tinha e nao existia -- so quando ha peso confirmado);
--      - zera current_weight, arquiva (archived_at), tira da impressora (bambu_*);
--      - solta o slot do AMS que ainda apontava para ele.
--    Item sem "depleted" (ou Agent antigo) -> comportamento identico ao de 20260930110000.
-- 2) print_logs ganha spool_depleted e depleted_leftover_g.
-- 3) ops_events.event_type ganha SPOOL_RUNOUT e SPOOL_DEPLETED (inclui PRINTER_HMS e
--    PRINTER_ERROR da 20261008100000, para valer em qualquer ordem de aplicacao).
--
-- ADITIVA: nenhuma linha existente muda. Agent 4.4.0 contra banco sem esta migration: a
-- chave "depleted" e ignorada (desconto igual ao de antes) e os dois eventos novos sao
-- recusados pela RPC (evento a evento).
--
-- Rollback: supabase/rollbacks/20261009100000_finalize_depleted_spool.down.sql

ALTER TABLE public.print_logs
    ADD COLUMN IF NOT EXISTS spool_depleted BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS depleted_leftover_g NUMERIC;

CREATE OR REPLACE FUNCTION public.finalize_print_job(
    p_job_id UUID,
    p_printer_id UUID,
    p_subtask_name TEXT,
    p_print_duration_minutes INTEGER,
    p_status TEXT,
    p_items JSONB
)
RETURNS SETOF public.print_logs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_item JSONB;
    v_spool_id UUID;
    v_slot_index INTEGER;
    v_grams NUMERIC;
    v_quality TEXT;
    v_orphan BOOLEAN;
    v_owner UUID;
    v_weight_confirmed_at TIMESTAMPTZ;
    v_needs_weighing BOOLEAN;
    v_product_id UUID;
    v_name_snap TEXT;
    v_brand_snap TEXT;
    v_material_snap TEXT;
    v_color_snap TEXT;
    v_depleted BOOLEAN;
    v_leftover NUMERIC;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'finalize_print_job exige usuario autenticado' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.printers WHERE id = p_printer_id AND user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'Impressora % nao encontrada ou nao pertence ao usuario autenticado', p_printer_id
            USING ERRCODE = '42501';
    END IF;

    -- Idempotencia: se ja existe QUALQUER linha com este job_id, o job inteiro ja foi processado.
    IF EXISTS (SELECT 1 FROM public.print_logs WHERE job_id = p_job_id) THEN
        RETURN QUERY SELECT * FROM public.print_logs WHERE job_id = p_job_id;
        RETURN;
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_spool_id := NULLIF(v_item->>'spool_id', '')::UUID;
        v_slot_index := (v_item->>'slot_index')::INTEGER;
        v_grams := COALESCE((v_item->>'grams')::NUMERIC, 0);
        v_quality := COALESCE(v_item->>'consumption_quality', 'unknown');
        v_orphan := COALESCE((v_item->>'orphan_slot')::BOOLEAN, false);
        v_depleted := COALESCE((v_item->>'depleted')::BOOLEAN, false) AND v_spool_id IS NOT NULL;
        v_leftover := NULL;
        v_weight_confirmed_at := NULL;
        v_product_id := NULL;
        v_name_snap := NULL;
        v_brand_snap := NULL;
        v_material_snap := NULL;
        v_color_snap := NULL;

        IF v_spool_id IS NOT NULL THEN
            SELECT s.user_id, s.weight_confirmed_at, s.filament_product_id,
                   p.name,
                   COALESCE(p.brand, s.brand),
                   COALESCE(p.material, s.material),
                   COALESCE(p.color_name, s.color_name)
              INTO v_owner, v_weight_confirmed_at, v_product_id,
                   v_name_snap, v_brand_snap, v_material_snap, v_color_snap
              FROM public.spools s
              LEFT JOIN public.filament_products p ON p.id = s.filament_product_id
             WHERE s.id = v_spool_id;
            IF v_owner IS NULL OR v_owner <> auth.uid() THEN
                RAISE EXCEPTION 'Spool % nao encontrado ou nao pertence ao usuario autenticado', v_spool_id;
            END IF;

            -- current_weight so e abatido com pesagem real confirmada (regra inalterada).
            IF v_grams > 0 AND v_weight_confirmed_at IS NOT NULL THEN
                UPDATE public.spools
                SET current_weight = GREATEST(0, current_weight - v_grams),
                    updated_at = NOW()
                WHERE id = v_spool_id;
            END IF;

            -- Carretel acabou fisicamente durante o job: o que sobrou no sistema nao existe.
            IF v_depleted THEN
                IF v_weight_confirmed_at IS NOT NULL THEN
                    SELECT current_weight INTO v_leftover FROM public.spools WHERE id = v_spool_id;
                END IF;
                UPDATE public.spools
                SET current_weight = 0,
                    archived_at = COALESCE(archived_at, NOW()),
                    bambu_in_printer = false,
                    bambu_slot_id = NULL,
                    bambu_dev_id = NULL,
                    updated_at = NOW()
                WHERE id = v_spool_id;
                UPDATE public.ams_slots
                SET spool_id = NULL,
                    assigned_by = 'agent',
                    assigned_at = NOW(),
                    updated_at = NOW()
                WHERE printer_id = p_printer_id AND spool_id = v_spool_id;
            END IF;
        END IF;

        v_needs_weighing := (v_quality = 'unknown')
            OR (v_spool_id IS NOT NULL AND v_weight_confirmed_at IS NULL AND NOT v_depleted);

        INSERT INTO public.print_logs (
            job_id, printer_id, spool_id, slot_index, subtask_name,
            filament_used_g, print_duration_minutes, status,
            consumption_quality, orphan_slot, needs_weighing,
            user_id, completed_at,
            filament_product_id, product_name_snapshot, brand_snapshot, material_snapshot, color_snapshot,
            spool_depleted, depleted_leftover_g
        ) VALUES (
            p_job_id, p_printer_id, v_spool_id, v_slot_index, p_subtask_name,
            v_grams, p_print_duration_minutes, p_status,
            v_quality, v_orphan, v_needs_weighing,
            auth.uid(), NOW(),
            v_product_id, v_name_snap, v_brand_snap, v_material_snap, v_color_snap,
            v_depleted, v_leftover
        );
    END LOOP;

    RETURN QUERY SELECT * FROM public.print_logs WHERE job_id = p_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_print_job(UUID, UUID, TEXT, INTEGER, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_print_job(UUID, UUID, TEXT, INTEGER, TEXT, JSONB) TO authenticated, service_role;

ALTER TABLE public.ops_events DROP CONSTRAINT IF EXISTS ops_events_event_type_check;

ALTER TABLE public.ops_events ADD CONSTRAINT ops_events_event_type_check CHECK (event_type IN (
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
    'PRINTER_HMS', 'PRINTER_ERROR',
    'FINALIZE_QUEUED', 'FINALIZE_RETRY', 'FINALIZE_COMPLETED', 'FINALIZE_FAILED',
    'SPOOL_AMBIGUOUS', 'SPOOL_RUNOUT', 'SPOOL_DEPLETED',
    'UNHANDLED_REJECTION', 'AGENT_ERROR',
    'WEB_ERROR', 'SUPPORT_REQUEST'
));

NOTIFY pgrst, 'reload schema';
