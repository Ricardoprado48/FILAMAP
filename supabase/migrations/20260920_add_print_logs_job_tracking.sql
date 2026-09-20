-- Suporte a: (1) consumo multicolor real (uma linha de print_logs por
-- slot/spool efetivamente usado no job, não só o slot inicial), (2)
-- finalização idempotente/atômica via função Postgres única, e (3) a
-- política de 4 níveis de qualidade de coleta (consumption_quality).
--
-- Alvo é public.print_logs -- a tabela REAL usada pelo Agent e pelo Web
-- App (ver desktop-agent/src/index.ts e web-app/src/App.tsx, ambos usam
-- .from("print_logs")). NÃO é public.print_jobs: essa é uma tabela
-- legada, sem uso hoje (comentário explícito em
-- 002_rls_hardening.sql:35 -- "RLS sem policy = bloqueio total").
--
-- Nota de divergência encontrada nesta investigação (não corrigida aqui,
-- fora de escopo, reportada para o usuário decidir): a migration
-- 20260918_add_consumption_quality.sql já tentou adicionar essa mesma
-- coluna, mas (a) alterou public.print_jobs em vez de public.print_logs,
-- e (b) seu bloco DO usa "DO \$\$ ... END \$\$;" com barras invertidas
-- antes dos cifrões, que não é sintaxe válida de dollar-quoting do
-- Postgres (o delimitador precisa ser o par de cifrões sem barra entre
-- eles) -- essa migration, como está commitada, não roda com sucesso
-- num banco novo.

-- 1. job_id: chave de idempotência, gerada pelo Agent (crypto.randomUUID())
--    no início de cada job e persistida em agent-state.json -- ver
--    investigação (a) no relatório: não há campo de task/job id confirmado
--    no payload MQTT real da Bambu Lab neste código, então o Agent gera o
--    seu próprio. NULL em linhas antigas (pré-existentes a esta migration).
ALTER TABLE public.print_logs
  ADD COLUMN IF NOT EXISTS job_id UUID;

-- 2. consumption_quality: substitui o uso informal de needs_weighing pela
--    política de 4 níveis (exact / estimated_filename / estimated_duration
--    / unknown). needs_weighing continua existindo e sendo gravado
--    (compat com a lista "pendente de pesagem" já implementada no
--    frontend) -- passa a ser derivado como (consumption_quality = 'unknown').
ALTER TABLE public.print_logs
  ADD COLUMN IF NOT EXISTS consumption_quality TEXT DEFAULT 'unknown';

COMMENT ON COLUMN public.print_logs.consumption_quality IS 'Nível de confiança do consumo registrado nesta linha: exact (slice_info.config real), estimated_filename (peso no nome do arquivo), estimated_duration (duração x vazão genérica), unknown (nenhum dado -- não desconta).';

-- 3. orphan_slot: true quando o job identificou esse slot como usado mas
--    ams_slots não tinha spool_id associado (carretel nunca fez check-in
--    naquele slot) -- ver investigação (c). Nesse caso spool_id fica NULL
--    e NENHUM desconto é aplicado; a linha existe só para auditoria/alerta.
ALTER TABLE public.print_logs
  ADD COLUMN IF NOT EXISTS orphan_slot BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.print_logs.orphan_slot IS 'true quando o slot foi identificado como usado pelo job mas não havia spool_id associado em ams_slots no momento da finalização -- linha só informativa, sem desconto de estoque.';

-- 4. Índice único (job_id, spool_id): parte do mecanismo de idempotência.
--    Uma segunda tentativa de processar o mesmo job para o mesmo spool não
--    consegue inserir de novo. NULL é tratado pelo Postgres como distinto
--    de qualquer outro valor (inclusive outro NULL), então múltiplas linhas
--    antigas com job_id NULL, e múltiplos slots órfãos (spool_id NULL) no
--    mesmo job, continuam permitidos sem violar a constraint.
CREATE UNIQUE INDEX IF NOT EXISTS print_logs_job_spool_uniq
  ON public.print_logs (job_id, spool_id);

-- 5. Função Postgres única para finalizar um job inteiro numa transação
--    atômica: idempotência (já processado? não faz nada), verificação de
--    dono de cada spool, desconto de peso, inserção de todas as linhas de
--    log. Segue o padrão de public.deduct_spool_filament (002_rls_hardening.sql):
--    SECURITY DEFINER + search_path fixo + checagem de auth.uid().
--
--    p_items é um array JSONB de objetos:
--    { "spool_id": uuid|null, "slot_index": int, "grams": numeric,
--      "consumption_quality": text, "orphan_slot": bool }
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
BEGIN
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

        IF v_spool_id IS NOT NULL THEN
            -- Verifica dono antes de descontar -- mesma checagem de
            -- deduct_spool_filament. Um spool_id que não pertence ao
            -- usuário autenticado aborta a função inteira (RAISE
            -- EXCEPTION desfaz tudo o que já rodou nesta chamada).
            SELECT user_id INTO v_owner FROM public.spools WHERE id = v_spool_id;
            IF v_owner IS NULL OR v_owner <> auth.uid() THEN
                RAISE EXCEPTION 'Spool % não encontrado ou não pertence ao usuário autenticado', v_spool_id;
            END IF;

            IF v_grams > 0 THEN
                UPDATE public.spools
                SET current_weight = GREATEST(0, current_weight - v_grams),
                    updated_at = NOW()
                WHERE id = v_spool_id;
            END IF;
        END IF;

        INSERT INTO public.print_logs (
            job_id, printer_id, spool_id, slot_index, subtask_name,
            filament_used_g, print_duration_minutes, status,
            consumption_quality, orphan_slot, needs_weighing,
            user_id, completed_at
        ) VALUES (
            p_job_id, p_printer_id, v_spool_id, v_slot_index, p_subtask_name,
            v_grams, p_print_duration_minutes, p_status,
            v_quality, v_orphan, (v_quality = 'unknown'),
            auth.uid(), NOW()
        );
    END LOOP;

    RETURN QUERY SELECT * FROM public.print_logs WHERE job_id = p_job_id;
END;
$$;
