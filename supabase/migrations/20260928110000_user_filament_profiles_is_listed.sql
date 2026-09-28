-- Perfis de filamento: quais aparecem na lista do "Novo Carretel".
--
-- O Bambu Studio guarda os presets numa pasta por canal (BambuStudio,
-- BambuStudioBeta). Ao trocar de canal, a pasta antiga fica parada com
-- cópias dos mesmos produtos sob outros filament_id (renomear um preset
-- também gera filament_id novo). O Agent marca is_listed = true só nos
-- perfis da pasta em uso; os demais ficam guardados (carretéis, AMS e nuvem
-- Bambu podem referenciar esses IDs), fora da lista.
--
-- Rollback: supabase/rollbacks/20260928110000_user_filament_profiles_is_listed.down.sql

ALTER TABLE public.user_filament_profiles
    ADD COLUMN IF NOT EXISTS is_listed BOOLEAN NOT NULL DEFAULT true;
