-- Rollback de 20261004100000_signup_invites.sql.
-- Contas criadas por convite continuam existindo (ficam em auth.users).
-- Se o cadastro publico foi desligado (disable_signup), ele continua desligado:
-- religar e decisao separada (painel do Supabase > Authentication).

DROP FUNCTION IF EXISTS public.record_signup_invite_use(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.release_signup_invite(UUID);
DROP FUNCTION IF EXISTS public.reserve_signup_invite(TEXT);
DROP FUNCTION IF EXISTS public.revoke_signup_invite(UUID);
DROP FUNCTION IF EXISTS public.list_signup_invites();
DROP FUNCTION IF EXISTS public.create_signup_invite(TEXT, INTEGER, INTEGER);
DROP TABLE IF EXISTS public.signup_invite_uses;
DROP TABLE IF EXISTS public.signup_invites;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261004100000';
