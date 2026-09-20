-- 005_reconciliation_schema.sql
-- Reconciliação complementar do schema Filamap.
-- Idempotente e segura em banco novo ou existente.

ALTER TABLE public.spools
    ADD COLUMN IF NOT EXISTS price_paid NUMERIC DEFAULT 0;

ALTER TABLE public.printers
    ADD COLUMN IF NOT EXISTS current_task TEXT;

ALTER TABLE public.printers
    ADD COLUMN IF NOT EXISTS print_progress INTEGER DEFAULT 0;

ALTER TABLE public.printers
    ADD COLUMN IF NOT EXISTS remaining_time_min INTEGER DEFAULT 0;

ALTER TABLE public.printers
    ADD COLUMN IF NOT EXISTS current_layer INTEGER DEFAULT 0;

ALTER TABLE public.printers
    ADD COLUMN IF NOT EXISTS total_layers INTEGER DEFAULT 0;

ALTER TABLE public.printers
    ADD COLUMN IF NOT EXISTS nozzle_temp NUMERIC DEFAULT 0;

ALTER TABLE public.printers
    ADD COLUMN IF NOT EXISTS bed_temp NUMERIC DEFAULT 0;

ALTER TABLE public.printers
    ADD COLUMN IF NOT EXISTS nozzle_target_temp NUMERIC DEFAULT 0;

ALTER TABLE public.printers
    ADD COLUMN IF NOT EXISTS bed_target_temp NUMERIC DEFAULT 0;

ALTER TABLE public.printers
    ADD COLUMN IF NOT EXISTS last_online TIMESTAMPTZ;

ALTER TABLE public.printers
    ADD COLUMN IF NOT EXISTS gcode_state TEXT;

ALTER TABLE public.printers
    ADD COLUMN IF NOT EXISTS active_slot_index INTEGER;

ALTER TABLE public.printers
    ADD COLUMN IF NOT EXISTS filament_slice_info JSONB;
