-- 20260921000000_add_print_logs_fk_and_ams_backfill.sql
-- Completa, sem renomear/renumerar nenhuma migration já aplicada, o que
-- 0015_bootstrap_missing_dependencies.sql deixou de fazer por rodar
-- antes de 001_initial_schema.sql (public.printers/public.spools ainda
-- não existiam naquele ponto):
--
--  1. Adiciona as FKs de public.print_logs.printer_id -> public.printers
--     e public.print_logs.spool_id -> public.spools (equivalentes às
--     que existiriam se tivessem sido declaradas inline no CREATE TABLE
--     de 0015; mesmo nome de constraint que o Postgres geraria nesse
--     caso, para o schema final ficar idêntico).
--  2. Repete o backfill de public.ams_slots.user_id a partir do dono da
--     impressora associada (mesma lógica que estava em 0015; aqui roda
--     depois que 001/002/003/004 já garantiram a coluna e os dados).
--
-- Idempotente: seguro em banco novo e em banco onde isso já foi
-- aplicado por outro caminho (ex.: 0015 na sua forma antiga, antes
-- desta correção).

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'print_logs_printer_id_fkey'
    ) THEN
        ALTER TABLE public.print_logs
            ADD CONSTRAINT print_logs_printer_id_fkey
            FOREIGN KEY (printer_id) REFERENCES public.printers(id) ON DELETE SET NULL;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'print_logs_spool_id_fkey'
    ) THEN
        ALTER TABLE public.print_logs
            ADD CONSTRAINT print_logs_spool_id_fkey
            FOREIGN KEY (spool_id) REFERENCES public.spools(id) ON DELETE SET NULL;
    END IF;
END $$;

UPDATE public.ams_slots AS slots
SET user_id = printers.user_id
FROM public.printers
WHERE slots.printer_id = printers.id
  AND slots.user_id IS NULL;
