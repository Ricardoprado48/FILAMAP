-- Adiciona a coluna consumption_quality na tabela print_jobs se não existir
ALTER TABLE public.print_jobs 
ADD COLUMN IF NOT EXISTS consumption_quality TEXT DEFAULT 'unknown';

-- Comentário explicativo na coluna
COMMENT ON COLUMN public.print_jobs.consumption_quality IS 'Nível de qualidade do consumo: exact, estimated_filename, estimated_duration, unknown';

-- Opcional: migra dados antigos de needs_weighing se a coluna ainda existir
DO \$\$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='print_jobs' and column_name='needs_weighing') THEN
        UPDATE public.print_jobs 
        SET consumption_quality = CASE 
            WHEN needs_weighing = true THEN 'unknown'
            ELSE 'exact'
        END
        WHERE consumption_quality IS NULL OR consumption_quality = 'unknown';
    END IF
END \$\$;
