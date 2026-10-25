-- Orcamento por placas (Web): o item do catalogo guarda as placas fatiadas que compoem o
-- produto (tempo, gramas por cor, unidades que cada placa atende, observacao) e as
-- observacoes livres do produto.
-- ADITIVA: duas colunas novas, opcionais. Nenhuma linha existente muda. Web antiga ignora;
-- Web nova contra banco sem esta migration salva o resto e avisa que placas/observacoes
-- nao foram guardadas.
--
-- Rollback: supabase/rollbacks/20261025100000_catalog_quote_plates.down.sql

ALTER TABLE public.catalog_items
    ADD COLUMN IF NOT EXISTS notes TEXT,
    ADD COLUMN IF NOT EXISTS plates JSONB;

ALTER TABLE public.catalog_items DROP CONSTRAINT IF EXISTS catalog_items_plates_is_array;
ALTER TABLE public.catalog_items ADD CONSTRAINT catalog_items_plates_is_array
    CHECK (plates IS NULL OR jsonb_typeof(plates) = 'array');

NOTIFY pgrst, 'reload schema';
