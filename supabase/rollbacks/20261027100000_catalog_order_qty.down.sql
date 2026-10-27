-- Rollback do orcamento por encomenda: tira order_qty de catalog_items.
-- Os itens continuam com os valores por peca; so esquecem a quantidade da encomenda.
ALTER TABLE public.catalog_items DROP CONSTRAINT IF EXISTS catalog_items_order_qty_positive;
ALTER TABLE public.catalog_items DROP COLUMN IF EXISTS order_qty;

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261027100000';

NOTIFY pgrst, 'reload schema';
