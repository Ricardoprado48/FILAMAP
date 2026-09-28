-- F1 / M3 (IMPACTO_ARQUITETURA_ESTOQUE_FILAMAP_V2 secao 6): finalize_print_job grava o SNAPSHOT
-- da identidade do filamento no momento da impressao (decisao D6: o historico nao e reescrito
-- quando o produto muda de nome depois).
--
-- Unica mudanca em relacao a 20260928000000_harden_finalize_print_job.sql:
--   - le spools + filament_products do spool identificado;
--   - grava filament_product_id e *_snapshot no INSERT de print_logs.
-- Calculo, desconto (so com weight_confirmed_at), dono, idempotencia e grants: INALTERADOS.
-- Snapshot = dado registrado no instante (produto; na falta dele, colunas do proprio spool).
-- Spool nao identificado (orfao) -> snapshot NULL (regra R4: sem inferencia).
-- Roda no servidor: vale para qualquer versao do Agent.
--
-- Rollback: supabase/rollbacks/20260930110000_finalize_print_job_snapshot.down.sql

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
        END IF;

        v_needs_weighing := (v_quality = 'unknown')
            OR (v_spool_id IS NOT NULL AND v_weight_confirmed_at IS NULL);

        INSERT INTO public.print_logs (
            job_id, printer_id, spool_id, slot_index, subtask_name,
            filament_used_g, print_duration_minutes, status,
            consumption_quality, orphan_slot, needs_weighing,
            user_id, completed_at,
            filament_product_id, product_name_snapshot, brand_snapshot, material_snapshot, color_snapshot
        ) VALUES (
            p_job_id, p_printer_id, v_spool_id, v_slot_index, p_subtask_name,
            v_grams, p_print_duration_minutes, p_status,
            v_quality, v_orphan, v_needs_weighing,
            auth.uid(), NOW(),
            v_product_id, v_name_snap, v_brand_snap, v_material_snap, v_color_snap
        );
    END LOOP;

    RETURN QUERY SELECT * FROM public.print_logs WHERE job_id = p_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_print_job(UUID, UUID, TEXT, INTEGER, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_print_job(UUID, UUID, TEXT, INTEGER, TEXT, JSONB) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
