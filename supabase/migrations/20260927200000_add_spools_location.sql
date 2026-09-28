-- Filamap
-- Fase I: Jornada de Entrada de Filamento + Localização Física
-- Adiciona coluna de localização física/spot do carretel fora da impressora
-- (ex.: Prateleira A1, Gaveta 2, Caixa Seca 01, Rack B).
-- Preenchida manualmente ou via leitura NFC de tag de spot.
-- Fonte única da verdade para localização fora da impressora.

ALTER TABLE public.spools
    ADD COLUMN IF NOT EXISTS location TEXT;

CREATE INDEX IF NOT EXISTS idx_spools_location
    ON public.spools(user_id, location);

COMMENT ON COLUMN public.spools.location IS
'Localização física de armazenamento do carretel fora da impressora (ex.: Prateleira A1, Gaveta 2, Caixa Seca 01, Rack B). Atualizada manualmente ou via leitura NFC de tag de spot.';
