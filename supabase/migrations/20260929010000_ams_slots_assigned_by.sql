-- Escolha manual do carretel de um slot do AMS, sem tag NFC.
--
-- Antes: a Web só ligava carretel a slot lendo uma tag NFC, e a projeção do
-- Agent podia trocar o vínculo quando a nuvem Bambu apontava outro carretel.
-- Agora: a Web grava quem decidiu (assigned_by = 'user', por tag ou pela
-- lista do estoque). O Agent mantém a escolha do usuário enquanto o material
-- no AMS for compatível; só o RFID da Bambu (prova física) passa na frente.
--
-- Rollback: supabase/rollbacks/20260929010000_ams_slots_assigned_by.down.sql

ALTER TABLE public.ams_slots
    ADD COLUMN IF NOT EXISTS assigned_by TEXT,
    ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;

ALTER TABLE public.ams_slots
    DROP CONSTRAINT IF EXISTS ams_slots_assigned_by_check;
ALTER TABLE public.ams_slots
    ADD CONSTRAINT ams_slots_assigned_by_check CHECK (assigned_by IS NULL OR assigned_by IN ('user', 'agent'));
