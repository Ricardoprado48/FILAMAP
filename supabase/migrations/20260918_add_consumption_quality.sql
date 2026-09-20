-- ATENÇÃO: migration legada e superada -- ver header de
-- 20260920_add_print_logs_job_tracking.sql. Esta migration erra o alvo:
-- altera public.print_jobs (tabela legada, sem nenhum uso no código --
-- confirmado, nenhuma referência em web-app/src ou desktop-agent/src),
-- quando a tabela real usada pelo Agent e pelo Web App é public.print_logs.
-- consumption_quality em print_logs foi adicionada corretamente por
-- 20260920_add_print_logs_job_tracking.sql. Mantida aqui só corrigindo os
-- dois erros de sintaxe reais (dollar-quoting com barra invertida inválida,
-- e "END IF" sem ";") para não quebrar uma aplicação em lote das migrations
-- -- o efeito prático desta migration hoje é inofensivo (só toca a tabela
-- print_jobs, sem uso).
ALTER TABLE public.print_jobs
ADD COLUMN IF NOT EXISTS consumption_quality TEXT DEFAULT 'unknown';

-- Comentário explicativo na coluna
COMMENT ON COLUMN public.print_jobs.consumption_quality IS 'Nível de qualidade do consumo: exact, estimated_filename, estimated_duration, unknown';

-- Opcional: migra dados antigos de needs_weighing se a coluna ainda existir
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='print_jobs' and column_name='needs_weighing') THEN
        UPDATE public.print_jobs
        SET consumption_quality = CASE
            WHEN needs_weighing = true THEN 'unknown'
            ELSE 'exact'
        END
        WHERE consumption_quality IS NULL OR consumption_quality = 'unknown';
    END IF;
END $$;
