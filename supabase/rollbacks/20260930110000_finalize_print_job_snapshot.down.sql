-- Rollback de 20260930110000_finalize_print_job_snapshot.sql: restaura EXATAMENTE a funcao de
-- 20260928000000_harden_finalize_print_job.sql (copiada do arquivo original). Aplicar ANTES do
-- rollback de 20260930100000 (que remove as colunas de snapshot).

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
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'finalize_print_job exige usuário autenticado' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.printers WHERE id = p_printer_id AND user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'Impressora % não encontrada ou não pertence ao usuário autenticado', p_printer_id
            USING ERRCODE = '42501';
    END IF;

    -- Idempotência: se já existe QUALQUER linha com este job_id, o job
    -- inteiro já foi processado antes (a função só insere linhas de um
    -- job de uma vez, dentro desta mesma transação) -- não repete nada.
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
        v_weight_confirmed_at := NULL;

        IF v_spool_id IS NOT NULL THEN
            -- Verifica dono antes de descontar -- mesma checagem de
            -- deduct_spool_filament. Um spool_id que não pertence ao
            -- usuário autenticado aborta a função inteira (RAISE
            -- EXCEPTION desfaz tudo o que já rodou nesta chamada).
            SELECT user_id, weight_confirmed_at
              INTO v_owner, v_weight_confirmed_at
              FROM public.spools WHERE id = v_spool_id;
            IF v_owner IS NULL OR v_owner <> auth.uid() THEN
                RAISE EXCEPTION 'Spool % não encontrado ou não pertence ao usuário autenticado', v_spool_id;
            END IF;

            -- Regra 3: current_weight só é abatido quando existe pesagem
            -- real confirmada (weight_confirmed_at preenchido). Sem isso,
            -- current_weight ainda é o default da coluna (nunca uma
            -- medição real -- ver 20260922140000_add_bambu_cloud_spool_sync.sql
            -- e 20260922150000_add_spools_weight_confirmed_at.sql) e
            -- descontar dele produziria um saldo falso.
            IF v_grams > 0 AND v_weight_confirmed_at IS NOT NULL THEN
                UPDATE public.spools
                SET current_weight = GREATEST(0, current_weight - v_grams),
                    updated_at = NOW()
                WHERE id = v_spool_id;
            END IF;
        END IF;

        -- needs_weighing passa a cobrir dois motivos independentes: (a)
        -- consumption_quality = 'unknown' (nenhum dado confiável de
        -- consumo, como já era) e (b) spool identificado mas ainda sem
        -- peso confirmado (novo) -- em ambos os casos current_weight não
        -- muda nesta linha, então a tela de Estoque (getPendingWeighingLogs)
        -- deve continuar sinalizando a pendência.
        v_needs_weighing := (v_quality = 'unknown')
            OR (v_spool_id IS NOT NULL AND v_weight_confirmed_at IS NULL);

        INSERT INTO public.print_logs (
            job_id, printer_id, spool_id, slot_index, subtask_name,
            filament_used_g, print_duration_minutes, status,
            consumption_quality, orphan_slot, needs_weighing,
            user_id, completed_at
        ) VALUES (
            p_job_id, p_printer_id, v_spool_id, v_slot_index, p_subtask_name,
            v_grams, p_print_duration_minutes, p_status,
            v_quality, v_orphan, v_needs_weighing,
            auth.uid(), NOW()
        );
    END LOOP;

    RETURN QUERY SELECT * FROM public.print_logs WHERE job_id = p_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_print_job(UUID, UUID, TEXT, INTEGER, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_print_job(UUID, UUID, TEXT, INTEGER, TEXT, JSONB) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
