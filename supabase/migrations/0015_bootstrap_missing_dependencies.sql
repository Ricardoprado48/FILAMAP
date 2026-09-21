-- 0015_bootstrap_missing_dependencies.sql
-- Garante que os objetos usados pelas migrations 002/003 existam
-- antes da aplicação das políticas/RLS.
-- Idempotente: seguro em banco novo e no banco remoto atual.
--
-- IMPORTANTE (fresh install): por ordenação lexical de arquivos, este
-- arquivo roda ANTES de 001_initial_schema.sql. Por isso ele NÃO pode
-- depender de nada criado em 001 (extensão uuid-ossp, public.printers,
-- public.spools, public.ams_slots):
--  - CREATE EXTENSION abaixo garante uuid_generate_v4() mesmo rodando
--    primeiro (idempotente, no-op se 001 já rodou antes num banco
--    existente).
--  - print_logs.printer_id/spool_id NÃO têm REFERENCES inline aqui
--    (public.printers/public.spools ainda não existem neste ponto) --
--    as FKs são adicionadas depois por
--    20260921000000_add_print_logs_fk_and_ams_backfill.sql, uma vez
--    que printers/spools já existem.
--  - As operações sobre public.ams_slots (coluna user_id) foram
--    removidas daqui: a tabela ainda não existe neste ponto. A coluna
--    passou a ser criada em 001_initial_schema.sql (logo após o
--    CREATE TABLE ams_slots), pois 002_rls_hardening.sql já depende
--    dela existir. O backfill de dados foi movido para
--    20260921000000_add_print_logs_fk_and_ams_backfill.sql.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

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

-- printer_id/spool_id ficam sem REFERENCES inline propositalmente: as
-- tabelas public.printers/public.spools ainda não existem neste ponto
-- (só nascem em 001_initial_schema.sql, que roda depois deste
-- arquivo). As FKs equivalentes são adicionadas por
-- 20260921000000_add_print_logs_fk_and_ams_backfill.sql.
CREATE TABLE IF NOT EXISTS public.print_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    printer_id UUID,
    spool_id UUID,
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
