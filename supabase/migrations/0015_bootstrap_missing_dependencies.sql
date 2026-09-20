-- 0015_bootstrap_missing_dependencies.sql
-- Garante que os objetos usados pelas migrations 002/003 existam
-- antes da aplicação das políticas/RLS.
-- Idempotente: seguro em banco novo e no banco remoto atual.

CREATE TABLE IF NOT EXISTS public.catalog_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id),
    name TEXT NOT NULL,
    material TEXT NOT NULL DEFAULT 'PLA',
    weight_g NUMERIC NOT NULL DEFAULT 0,
    print_hours NUMERIC NOT NULL DEFAULT 0,
    accessories_cost NUMERIC NOT NULL DEFAULT 0,
    production_cost NUMERIC NOT NULL DEFAULT 0,
    sale_price NUMERIC NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.filament_presets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    material TEXT NOT NULL,
    brand TEXT DEFAULT 'Bambu Studio',
    color_hex TEXT DEFAULT '#111827',
    density NUMERIC DEFAULT 1.25,
    nozzle_temperature_range TEXT,
    bed_temperature TEXT,
    source TEXT DEFAULT 'bambu_studio',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.print_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    printer_id UUID REFERENCES public.printers(id) ON DELETE SET NULL,
    spool_id UUID REFERENCES public.spools(id) ON DELETE SET NULL,
    slot_index INTEGER,
    subtask_name TEXT,
    filament_used_g NUMERIC,
    print_duration_minutes INTEGER,
    completed_at TIMESTAMPTZ DEFAULT NOW(),
    status TEXT DEFAULT 'COMPLETED',
    estimated_total_weight_g NUMERIC DEFAULT 0,
    user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
    needs_weighing BOOLEAN DEFAULT false
);

ALTER TABLE public.ams_slots
    ADD COLUMN IF NOT EXISTS user_id UUID
    REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.ams_slots
    ALTER COLUMN user_id SET DEFAULT auth.uid();

UPDATE public.ams_slots AS slots
SET user_id = printers.user_id
FROM public.printers
WHERE slots.printer_id = printers.id
  AND slots.user_id IS NULL;
