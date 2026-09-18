-- 004_fix_ams_slots_user_id.sql
-- Corrige uma divergência entre o histórico de migrations e o banco real:
-- a 002_rls_hardening.sql faz "ALTER COLUMN user_id SET DEFAULT auth.uid()"
-- e cria a policy "owner_all" em cima de ams_slots.user_id, mas nenhuma
-- migration deste repositório jamais CRIA essa coluna (diferente de
-- spools/printers, que já nascem com ela em 001, e de print_logs/
-- catalog_items, que ganham "ADD COLUMN IF NOT EXISTS" na própria 002).
--
-- Em produção isso só funcionou porque a coluna foi adicionada manualmente
-- pelo dashboard do Supabase antes da 002 rodar. Se este conjunto de
-- migrations for aplicado do zero em outro projeto (recuperação de
-- desastre, homologação, etc.), a 002 falha em ams_slots e o RLS pode
-- não ser aplicado corretamente.
--
-- Esta migration é idempotente e não altera nenhuma lógica de negócio:
-- ela só faz o arquivo de migrations refletir o estado real do banco.

ALTER TABLE public.ams_slots
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.ams_slots
  ALTER COLUMN user_id SET DEFAULT auth.uid();

-- Backfill defensivo: qualquer slot que porventura tenha ficado sem user_id
-- herda o dono da impressora associada.
UPDATE public.ams_slots AS slots
SET user_id = printers.user_id
FROM public.printers
WHERE slots.printer_id = printers.id
  AND slots.user_id IS NULL;
