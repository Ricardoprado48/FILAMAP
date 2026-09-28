-- HOTFIX (aplicado manualmente na producao em 2026-09-28 17:43Z, registrado aqui).
-- O Agent (commit 75f64ac, finalizeJob em desktop-agent/src/index.ts) consulta
-- spools.tray_info_idx; a coluna nao existia -> 42703 -> fechamento de toda
-- impressao abortado e reenfileirado. Coluna aditiva, nullable, sem default.
--
-- Rollback: ALTER TABLE public.spools DROP COLUMN IF EXISTS tray_info_idx;

ALTER TABLE public.spools ADD COLUMN IF NOT EXISTS tray_info_idx TEXT;
NOTIFY pgrst, 'reload schema';
