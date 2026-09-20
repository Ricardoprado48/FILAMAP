-- nfc_written_at só é preenchido quando handleWriteTag confirma uma
-- escrita física bem-sucedida via NDEFReader.write() (ver App.tsx). Um
-- spool pode ter nfc_uid sem nfc_written_at quando o valor veio de
-- importação em lote (seed_spools.ts / filamentos_bambu.json) e nenhuma
-- tag física correspondente foi gravada ainda. Linhas existentes não são
-- retroativamente preenchidas por esta migration.
ALTER TABLE public.spools
ADD COLUMN IF NOT EXISTS nfc_written_at TIMESTAMPTZ;

COMMENT ON COLUMN public.spools.nfc_written_at IS 'Timestamp da última gravação física confirmada via NDEFReader.write() em handleWriteTag. NULL = nfc_uid (se houver) ainda não foi confirmado numa tag física real.';
