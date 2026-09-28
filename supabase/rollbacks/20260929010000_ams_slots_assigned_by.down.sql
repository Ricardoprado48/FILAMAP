-- Rollback de 20260929010000_ams_slots_assigned_by.sql. O Agent e a Web
-- toleram a ausência das colunas (voltam ao comportamento anterior).
ALTER TABLE public.ams_slots DROP CONSTRAINT IF EXISTS ams_slots_assigned_by_check;
ALTER TABLE public.ams_slots DROP COLUMN IF EXISTS assigned_at;
ALTER TABLE public.ams_slots DROP COLUMN IF EXISTS assigned_by;
