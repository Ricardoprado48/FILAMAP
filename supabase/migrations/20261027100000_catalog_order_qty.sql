-- Orcamento por encomenda (Web): o item do catalogo lembra para quantas pecas o
-- orcamento foi feito. Os valores do item (gramas, horas, custo, preco) sao por peca;
-- ao reabrir, a calculadora volta a mostrar a encomenda inteira (valor x quantidade).
-- ADITIVA: uma coluna nova, opcional. Nenhuma linha existente muda (vazio = 1 peca).
--
-- Rollback: supabase/rollbacks/20261027100000_catalog_order_qty.down.sql

ALTER TABLE public.catalog_items
    ADD COLUMN IF NOT EXISTS order_qty NUMERIC;

ALTER TABLE public.catalog_items DROP CONSTRAINT IF EXISTS catalog_items_order_qty_positive;
ALTER TABLE public.catalog_items ADD CONSTRAINT catalog_items_order_qty_positive
    CHECK (order_qty IS NULL OR order_qty > 0);

NOTIFY pgrst, 'reload schema';
