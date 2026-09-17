-- Extensão para geração de UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. TABELA DE CARRETÉIS
CREATE TABLE IF NOT EXISTS public.spools (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    nfc_uid VARCHAR(64) UNIQUE,
    brand VARCHAR(64) NOT NULL,
    material VARCHAR(32) NOT NULL,
    color_name VARCHAR(64),
    color_hex VARCHAR(9),
    spool_tare_weight NUMERIC(6,2) DEFAULT 200.00,
    initial_weight NUMERIC(6,2) NOT NULL DEFAULT 1000.00,
    current_weight NUMERIC(6,2) NOT NULL DEFAULT 1000.00,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. TABELA DE IMPRESSORAS
CREATE TABLE IF NOT EXISTS public.printers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    serial VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(64),
    model VARCHAR(32) DEFAULT 'A1',
    ip_address VARCHAR(45),
    is_online BOOLEAN DEFAULT false,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. ASSOCIAÇÃO DOS SLOTS DO AMS
CREATE TABLE IF NOT EXISTS public.ams_slots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    printer_id UUID REFERENCES public.printers(id) ON DELETE CASCADE,
    slot_index INT NOT NULL CHECK (slot_index BETWEEN 0 AND 3),
    spool_id UUID REFERENCES public.spools(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(printer_id, slot_index)
);

-- 4. HISTÓRICO DE JOBS E DESCONTOS
CREATE TABLE IF NOT EXISTS public.print_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    printer_id UUID REFERENCES public.printers(id) ON DELETE CASCADE,
    spool_id UUID REFERENCES public.spools(id) ON DELETE SET NULL,
    subtask_name VARCHAR(255),
    grams_consumed NUMERIC(6,2) NOT NULL,
    status VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. FUNÇÃO RPC PARA ABATIMENTO ATÔMICO DE SALDO
CREATE OR REPLACE FUNCTION public.deduct_spool_filament(
    p_spool_id UUID,
    p_grams_consumed NUMERIC
)
RETURNS NUMERIC AS $$
DECLARE
    v_new_weight NUMERIC;
BEGIN
    UPDATE public.spools
    SET current_weight = GREATEST(0, current_weight - p_grams_consumed),
        updated_at = NOW()
    WHERE id = p_spool_id
    RETURNING current_weight INTO v_new_weight;

    RETURN v_new_weight;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
