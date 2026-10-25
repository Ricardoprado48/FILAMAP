-- Rollback do orcamento por placas: tira as colunas notes/plates de catalog_items.
-- ATENCAO: apaga as placas e observacoes ja salvas nos itens do catalogo.
ALTER TABLE public.catalog_items DROP CONSTRAINT IF EXISTS catalog_items_plates_is_array;
ALTER TABLE public.catalog_items
    DROP COLUMN IF EXISTS plates,
    DROP COLUMN IF EXISTS notes;

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261025100000';

NOTIFY pgrst, 'reload schema';
