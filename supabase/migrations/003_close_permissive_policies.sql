-- 003_close_permissive_policies.sql
-- A migração 002 adicionou políticas corretas (owner_all: auth.uid() = user_id),
-- mas políticas antigas, permissivas ("qual: true"), continuavam ativas nas
-- mesmas tabelas -- como políticas de RLS são combinadas com OR, a política
-- aberta para o papel "anon" (e outra, igualmente aberta, para "authenticated")
-- anulava a proteção: qualquer request com a anon key, sem login nenhum,
-- continuava lendo/escrevendo tudo. Esta migração remove essas políticas
-- permissivas remanescentes, deixando só a política restrita por dono.
--
-- Não altera nenhuma lógica de cálculo de consumo/peso de filamento.

-- ams_slots
DROP POLICY IF EXISTS "Authenticated access ams_slots" ON public.ams_slots;
DROP POLICY IF EXISTS "Permitir leitura e escrita para anon em ams_slots" ON public.ams_slots;
DROP POLICY IF EXISTS "own ams_slots" ON public.ams_slots;

-- catalog_items
DROP POLICY IF EXISTS "Authenticated access catalog_items" ON public.catalog_items;
DROP POLICY IF EXISTS "own catalog_items" ON public.catalog_items;

-- filament_presets (mantém leitura para autenticados via read_authenticated;
-- remove escrita/leitura aberta ao público)
DROP POLICY IF EXISTS "Authenticated access filament_presets" ON public.filament_presets;
DROP POLICY IF EXISTS "Permitir atualização de filament_presets" ON public.filament_presets;
DROP POLICY IF EXISTS "Permitir inserção de filament_presets" ON public.filament_presets;
DROP POLICY IF EXISTS "Permitir leitura de filament_presets" ON public.filament_presets;

-- print_jobs (tabela legada sem uso -- fica sem nenhuma policy, ou seja, bloqueada)
DROP POLICY IF EXISTS "Permitir leitura e escrita para anon em print_jobs" ON public.print_jobs;

-- print_logs
DROP POLICY IF EXISTS "Authenticated access print_logs" ON public.print_logs;
DROP POLICY IF EXISTS "Permitir inserção de print_logs" ON public.print_logs;
DROP POLICY IF EXISTS "Permitir leitura de print_logs" ON public.print_logs;
DROP POLICY IF EXISTS "own print_logs" ON public.print_logs;

-- printers
DROP POLICY IF EXISTS "Authenticated access printers" ON public.printers;
DROP POLICY IF EXISTS "Permitir leitura e escrita para anon em printers" ON public.printers;
DROP POLICY IF EXISTS "own printers" ON public.printers;

-- spools
DROP POLICY IF EXISTS "Authenticated access spools" ON public.spools;
DROP POLICY IF EXISTS "Permitir leitura e escrita para anon em spools" ON public.spools;
DROP POLICY IF EXISTS "own spools" ON public.spools;
