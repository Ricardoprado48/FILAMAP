-- Rollback de 20260928110000. Agent e Web toleram a ausência da coluna
-- (voltam a listar todos os perfis).
ALTER TABLE public.user_filament_profiles DROP COLUMN IF EXISTS is_listed;
