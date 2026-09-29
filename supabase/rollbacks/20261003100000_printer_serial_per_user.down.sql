-- Falha (de proposito) se o mesmo serial ja estiver em duas contas: resolva antes de voltar.
ALTER TABLE public.printers DROP CONSTRAINT printers_user_serial_key;
ALTER TABLE public.printers ADD CONSTRAINT printers_serial_key UNIQUE (serial);
ALTER TABLE public.printers ALTER COLUMN user_id DROP NOT NULL;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261003100000';
