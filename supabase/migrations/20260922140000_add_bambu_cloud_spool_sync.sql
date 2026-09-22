-- Filamap
-- Cloud Spool Sync: liga os spools físicos retornados por
-- bambu_network_get_filament_spools (bridge C++) aos carretéis do Filamap.
--
-- Identidade:
--   - Perfil lógico (produto/material): filamentId da Bambu.
--     Já coberto pela UNIQUE (user_id, source, source_key) de
--     user_filament_profiles (20260922133000) -- este sync só usa
--     source = 'bambu_cloud' em vez de 'bambu_studio', sem migration nova
--     para a tabela de perfis.
--   - Spool físico: `id` da Bambu. Vários spools podem compartilhar o
--     mesmo filamentId, então filamentId NUNCA pode ser o unique de
--     spools -- por isso a nova coluna bambu_spool_id abaixo, com unique
--     próprio por usuário.

ALTER TABLE public.spools
    ADD COLUMN IF NOT EXISTS bambu_spool_id TEXT;

-- Localização física reportada pela Bambu -- atualizada automaticamente a
-- cada sync (regra 9). NUNCA inclui peso, NFC ou outro dado controlado
-- pelo Filamap (regra 10) -- isso fica de fora de propósito.
ALTER TABLE public.spools
    ADD COLUMN IF NOT EXISTS bambu_in_printer BOOLEAN;

ALTER TABLE public.spools
    ADD COLUMN IF NOT EXISTS bambu_dev_id TEXT;

ALTER TABLE public.spools
    ADD COLUMN IF NOT EXISTS bambu_device_name TEXT;

ALTER TABLE public.spools
    ADD COLUMN IF NOT EXISTS bambu_ams_sn TEXT;

ALTER TABLE public.spools
    ADD COLUMN IF NOT EXISTS bambu_ams_id TEXT;

ALTER TABLE public.spools
    ADD COLUMN IF NOT EXISTS bambu_slot_id TEXT;

-- Demais campos da resposta da Bambu sem coluna dedicada (RFID, colors,
-- netWeight, totalNetWeight, note, category, createType, depleted,
-- createdAt/updatedAt da Bambu) -- preservados para rastreabilidade, sem
-- forçar schema em cima de um payload de terceiro.
ALTER TABLE public.spools
    ADD COLUMN IF NOT EXISTS bambu_source_metadata JSONB
    NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.spools
    ADD COLUMN IF NOT EXISTS bambu_synced_at TIMESTAMPTZ;

-- Unique por usuário -- NULL (spools sem origem Bambu) não conflita entre
-- si no Postgres, então carretéis cadastrados manualmente continuam livres.
DROP INDEX IF EXISTS idx_spools_bambu_spool_id_unique;

CREATE UNIQUE INDEX idx_spools_bambu_spool_id_unique
    ON public.spools(user_id, bambu_spool_id)
    WHERE bambu_spool_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_spools_bambu_spool_id
    ON public.spools(bambu_spool_id)
    WHERE bambu_spool_id IS NOT NULL;

COMMENT ON COLUMN public.spools.bambu_spool_id IS
'Identidade do spool físico na Bambu (campo "id" de bambu_network_get_filament_spools). Não confundir com filamentId, que identifica o perfil/produto e pode se repetir em vários spools.';

COMMENT ON COLUMN public.spools.bambu_source_metadata IS
'Campos brutos da Bambu sem coluna dedicada (RFID, colors, netWeight, totalNetWeight, note, category, createType, depleted, createdAt/updatedAt da Bambu). Somente leitura do ponto de vista do Filamap -- nunca contém peso real, consumo ou NFC.';
