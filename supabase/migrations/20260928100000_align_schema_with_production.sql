-- Registra no código ajustes que existem na PRODUÇÃO mas nunca viraram
-- migration (tabelas criadas/alteradas pelo painel antes das migrations;
-- como as migrations usam CREATE TABLE IF NOT EXISTS, elas não reescreveram
-- esses detalhes). Detectado em 2026-09-28 comparando produção com um banco
-- novo criado só pelas migrations (FILAMAP-TESTE).
--
-- Na produção é no-op (os valores já são estes). Em banco novo, deixa o
-- schema idêntico ao de produção.

ALTER TABLE public.catalog_items    ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.filament_presets ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.print_logs       ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE public.printers
    ALTER COLUMN active_slot_index SET DEFAULT 0,
    ALTER COLUMN gcode_state SET DEFAULT 'IDLE',
    ALTER COLUMN last_online SET DEFAULT now(),
    ALTER COLUMN bed_temp TYPE double precision USING bed_temp::double precision,
    ALTER COLUMN bed_target_temp TYPE double precision USING bed_target_temp::double precision,
    ALTER COLUMN nozzle_temp TYPE double precision USING nozzle_temp::double precision,
    ALTER COLUMN nozzle_target_temp TYPE double precision USING nozzle_target_temp::double precision;

-- Placeholder herdado da produção (carretel criado por tag desconhecida).
-- Mantido igual à produção aqui; revisão do valor é item separado.
ALTER TABLE public.spools ALTER COLUMN price_paid SET DEFAULT 85.00;
