-- F1 / M1+M4 (IMPACTO_ARQUITETURA_ESTOQUE_FILAMAP_V2 secao 6). SOMENTE ADITIVA.
--
-- Modelo: PRESET EXTERNO (user_filament_profiles) -> FILAMENT_PRODUCT (id interno estavel)
--         -> SPOOL (unidade fisica) -> POSICAO -> HISTORICO (snapshot em print_logs).
-- Nuvem Bambu / RFID / tag desconhecida -> spool_inbox (sugestao; nunca autoridade).
--
-- O que NAO muda: nenhuma linha existente e alterada; nenhum peso/tara/preco/tag/slot;
-- colunas antigas de spools (brand, material, color_*) continuam existindo e preenchidas.
-- spools.brand/material deixam de ser NOT NULL (regra R3: desconhecido fica desconhecido);
-- o codigo atual sempre preenche, entao nada quebra.
--
-- Rollback: supabase/rollbacks/20260930100000_filament_products_inbox.down.sql

-- 1. Produto logico (identidade interna estavel) -------------------------------------------
CREATE TABLE IF NOT EXISTS public.filament_products (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    brand       TEXT,
    material    TEXT,
    color_name  TEXT,
    color_hex   TEXT,
    density     NUMERIC,
    origin      TEXT NOT NULL CHECK (origin IN ('bambu_studio', 'bambu_official', 'manual')),
    archived_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT filament_products_id_user_unique UNIQUE (id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS filament_products_user_name_unique
    ON public.filament_products (user_id, lower(name));

ALTER TABLE public.filament_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_all ON public.filament_products;
CREATE POLICY owner_all ON public.filament_products
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 2. Presets externos -> produto (N presets : 1 produto) ------------------------------------
ALTER TABLE public.user_filament_profiles
    ADD COLUMN IF NOT EXISTS filament_product_id UUID;
ALTER TABLE public.user_filament_profiles
    DROP CONSTRAINT IF EXISTS user_filament_profiles_product_owner_fk;
ALTER TABLE public.user_filament_profiles
    ADD CONSTRAINT user_filament_profiles_product_owner_fk
    FOREIGN KEY (filament_product_id, user_id)
    REFERENCES public.filament_products (id, user_id) ON DELETE SET NULL (filament_product_id);
CREATE INDEX IF NOT EXISTS idx_user_filament_profiles_product
    ON public.user_filament_profiles (filament_product_id);

-- 3. Spool -> produto; arquivamento em vez de DELETE -----------------------------------------
ALTER TABLE public.spools
    ADD COLUMN IF NOT EXISTS filament_product_id UUID,
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE public.spools
    DROP CONSTRAINT IF EXISTS spools_product_owner_fk;
ALTER TABLE public.spools
    ADD CONSTRAINT spools_product_owner_fk
    FOREIGN KEY (filament_product_id, user_id)
    REFERENCES public.filament_products (id, user_id) ON DELETE SET NULL (filament_product_id);
CREATE INDEX IF NOT EXISTS idx_spools_product ON public.spools (filament_product_id);
CREATE INDEX IF NOT EXISTS idx_spools_active ON public.spools (user_id) WHERE archived_at IS NULL;

ALTER TABLE public.spools ALTER COLUMN brand DROP NOT NULL;
ALTER TABLE public.spools ALTER COLUMN material DROP NOT NULL;

-- 4. Snapshot historico em print_logs (gravado pelo servidor; ver 20260930110000) -------------
ALTER TABLE public.print_logs
    ADD COLUMN IF NOT EXISTS filament_product_id   UUID,
    ADD COLUMN IF NOT EXISTS product_name_snapshot TEXT,
    ADD COLUMN IF NOT EXISTS brand_snapshot        TEXT,
    ADD COLUMN IF NOT EXISTS material_snapshot     TEXT,
    ADD COLUMN IF NOT EXISTS color_snapshot        TEXT,
    ADD COLUMN IF NOT EXISTS snapshot_backfilled   BOOLEAN NOT NULL DEFAULT false;

-- 5. Caixa de entrada (evidencia externa aguardando decisao humana) --------------------------
CREATE TABLE IF NOT EXISTS public.spool_inbox (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    source               TEXT NOT NULL CHECK (source IN ('bambu_cloud', 'rfid', 'nfc', 'preset_renamed')),
    external_id          TEXT NOT NULL,
    payload              JSONB NOT NULL DEFAULT '{}'::jsonb,
    suggested_spool_id   UUID REFERENCES public.spools(id) ON DELETE SET NULL,
    suggested_product_id UUID REFERENCES public.filament_products(id) ON DELETE SET NULL,
    status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'linked', 'created', 'ignored')),
    resolved_spool_id    UUID REFERENCES public.spools(id) ON DELETE SET NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at          TIMESTAMPTZ,
    CONSTRAINT spool_inbox_source_external_unique UNIQUE (user_id, source, external_id)
);
ALTER TABLE public.spool_inbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_all ON public.spool_inbox;
CREATE POLICY owner_all ON public.spool_inbox
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 6. Backup de identidade para o rollback da reconciliacao (F6). RLS sem policy:
--    invisivel para clientes; so SQL administrativo (backfill/rollback) le e escreve.
CREATE TABLE IF NOT EXISTS public.spools_identity_backup (
    spool_id            UUID NOT NULL,
    user_id             UUID,
    filament_profile_id UUID,
    filament_product_id UUID,
    brand               TEXT,
    material            TEXT,
    color_name          TEXT,
    color_hex           TEXT,
    backup_label        TEXT NOT NULL,
    backed_up_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (backup_label, spool_id)
);
ALTER TABLE public.spools_identity_backup ENABLE ROW LEVEL SECURITY;

-- 7. Legado congelado (decisao D5): documentado no proprio banco.
COMMENT ON TABLE public.filament_presets IS 'LEGADO CONGELADO (D5, 2026-09-28): sem escrita nova, sem dependencia nova. Remover so com evidencia de zero uso.';
COMMENT ON TABLE public.print_jobs IS 'LEGADO CONGELADO (D5, 2026-09-28): sem escrita nova, sem dependencia nova. Remover so com evidencia de zero uso.';

NOTIFY pgrst, 'reload schema';
