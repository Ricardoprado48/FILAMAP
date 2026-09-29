-- Rollback da Central de Observabilidade. Nao toca em nenhuma tabela pre-existente.
DROP FUNCTION IF EXISTS public.keepalive();
DROP FUNCTION IF EXISTS public.ops_health();
DROP FUNCTION IF EXISTS public.ops_purge_expired();
DROP FUNCTION IF EXISTS public.ingest_ops_events(JSONB, JSONB);
DROP TABLE IF EXISTS public.ops_events;
DROP TABLE IF EXISTS public.ops_installations;
DROP TABLE IF EXISTS public.ops_admins;
DROP FUNCTION IF EXISTS public.ops_is_admin();
DROP FUNCTION IF EXISTS public.ops_try_int(TEXT);
DROP FUNCTION IF EXISTS public.ops_try_uuid(TEXT);
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261001100000';
