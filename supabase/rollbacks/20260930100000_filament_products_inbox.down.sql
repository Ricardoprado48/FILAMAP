-- Rollback de 20260930100000_filament_products_inbox.sql. Fora de migrations/ para nunca ser
-- aplicado por engano num db push. Aplicar ANTES o rollback de 20260930110000 (snapshot).
-- Atencao: brand/material voltam a NOT NULL; falha (e desfaz tudo) se existir spool com NULL.

BEGIN;

COMMENT ON TABLE public.filament_presets IS NULL;
COMMENT ON TABLE public.print_jobs IS NULL;

DROP TABLE IF EXISTS public.spools_identity_backup;
DROP TABLE IF EXISTS public.spool_inbox;

ALTER TABLE public.print_logs
    DROP COLUMN IF EXISTS snapshot_backfilled,
    DROP COLUMN IF EXISTS color_snapshot,
    DROP COLUMN IF EXISTS material_snapshot,
    DROP COLUMN IF EXISTS brand_snapshot,
    DROP COLUMN IF EXISTS product_name_snapshot,
    DROP COLUMN IF EXISTS filament_product_id;

ALTER TABLE public.spools ALTER COLUMN material SET NOT NULL;
ALTER TABLE public.spools ALTER COLUMN brand SET NOT NULL;
DROP INDEX IF EXISTS public.idx_spools_active;
DROP INDEX IF EXISTS public.idx_spools_product;
ALTER TABLE public.spools DROP CONSTRAINT IF EXISTS spools_product_owner_fk;
ALTER TABLE public.spools
    DROP COLUMN IF EXISTS archived_at,
    DROP COLUMN IF EXISTS filament_product_id;

DROP INDEX IF EXISTS public.idx_user_filament_profiles_product;
ALTER TABLE public.user_filament_profiles DROP CONSTRAINT IF EXISTS user_filament_profiles_product_owner_fk;
ALTER TABLE public.user_filament_profiles DROP COLUMN IF EXISTS filament_product_id;

DROP TABLE IF EXISTS public.filament_products;

COMMIT;

NOTIFY pgrst, 'reload schema';
