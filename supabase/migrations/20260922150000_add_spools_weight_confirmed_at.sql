-- Filamap
-- Fase "gestão dos spools físicos": marca quando o peso real de um carretel
-- foi de fato confirmado pelo usuário (pesagem/edição manual), em vez de
-- estar apenas no valor padrão da coluna (1000/1000/200, vindo de
-- 001_initial_schema.sql) ou do valor placeholder criado ao vincular uma
-- tag NFC desconhecida a um slot do AMS.
--
-- Uso: um carretel "precisa de pesagem" quando veio do Cloud Spool Sync
-- (bambu_spool_id preenchido) e ainda não teve weight_confirmed_at setado
-- -- current_weight/initial_weight/spool_tare_weight nesse caso são só o
-- default da coluna, nunca uma pesagem real (buildSpoolInsertRow em
-- bambuCloudSpoolSync.ts não envia esses campos no INSERT de propósito).

ALTER TABLE public.spools
    ADD COLUMN IF NOT EXISTS weight_confirmed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.spools.weight_confirmed_at IS
'Quando o usuário confirmou peso real (pesagem ou edição manual) deste carretel pela última vez. NULL = ainda usando peso padrão/placeholder, nunca conferido -- ex.: carretel recém-sincronizado da Bambu Cloud, ainda não pesado.';

-- Backfill: só carretéis SEM origem Bambu (bambu_spool_id NULL) são
-- considerados confirmados retroativamente -- esses já existiam antes desta
-- coluna e já eram editáveis/visíveis na tela de Estoque, então não é uma
-- regressão marcá-los como "ok". Carretéis com bambu_spool_id preenchido
-- ficam de propósito com weight_confirmed_at NULL: o peso deles hoje é
-- apenas o default da coluna, nunca uma pesagem real, e a tela nova deve
-- sinalizar isso como pendente.
UPDATE public.spools
SET weight_confirmed_at = COALESCE(nfc_written_at, updated_at)
WHERE bambu_spool_id IS NULL
  AND weight_confirmed_at IS NULL;
