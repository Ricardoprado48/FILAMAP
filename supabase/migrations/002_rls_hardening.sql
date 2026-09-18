-- 002_rls_hardening.sql
-- Habilita Row Level Security em todas as tabelas expostas pela API REST do Supabase
-- e corrige a RPC deduct_spool_filament para validar o dono do carretel.
--
-- Contexto: auditoria de segurança identificou que, apesar da tela de login existir
-- no app, NENHUMA tabela tinha RLS habilitado -- qualquer pessoa com a anon key
-- (publica, embutida no bundle JS) conseguia ler/escrever todos os dados via
-- chamada direta a API REST, sem autenticar.
--
-- Este arquivo NAO altera nenhuma logica de calculo de consumo/peso de filamento.

-- 1. Garante que user_id seja preenchido automaticamente pelo usuario autenticado
--    (defensivo -- os dados ja vem sendo populados corretamente hoje, mas reforça
--    a garantia a nivel de banco independente do client).
ALTER TABLE public.spools ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.printers ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.ams_slots ALTER COLUMN user_id SET DEFAULT auth.uid();

-- print_logs e catalog_items nao fazem parte da migração 001 original (foram
-- criadas depois direto no dashboard) -- garante a coluna user_id antes de
-- habilitar RLS nelas.
ALTER TABLE public.print_logs ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.print_logs ALTER COLUMN user_id SET DEFAULT auth.uid();

ALTER TABLE public.catalog_items ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.catalog_items ALTER COLUMN user_id SET DEFAULT auth.uid();

-- 2. Habilita RLS em todas as tabelas expostas pela API
ALTER TABLE public.spools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.printers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ams_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.filament_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_jobs ENABLE ROW LEVEL SECURITY; -- tabela legada, sem uso hoje; RLS sem policy = bloqueio total

-- 3. Politicas: cada usuario so acessa (SELECT/INSERT/UPDATE/DELETE) os proprios registros
DROP POLICY IF EXISTS "owner_all" ON public.spools;
CREATE POLICY "owner_all" ON public.spools
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "owner_all" ON public.printers;
CREATE POLICY "owner_all" ON public.printers
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "owner_all" ON public.ams_slots;
CREATE POLICY "owner_all" ON public.ams_slots
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "owner_all" ON public.print_logs;
CREATE POLICY "owner_all" ON public.print_logs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "owner_all" ON public.catalog_items;
CREATE POLICY "owner_all" ON public.catalog_items
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- filament_presets: biblioteca de referencia compartilhada (sem dono individual) --
-- leitura liberada para qualquer usuario autenticado; escrita bloqueada por padrão
-- (os scripts de seed usam a anon key hoje -- se precisar reativa-los, rodar
-- autenticado ou usar a service_role key, nunca a anon key).
DROP POLICY IF EXISTS "read_authenticated" ON public.filament_presets;
CREATE POLICY "read_authenticated" ON public.filament_presets
  FOR SELECT USING (auth.role() = 'authenticated');

-- 4. Corrige a RPC deduct_spool_filament (SECURITY DEFINER) para validar que
--    o chamador e dono do carretel antes de abater saldo -- hoje ela aceita
--    qualquer spool_id sem checagem, contornando RLS por ser SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.deduct_spool_filament(
    p_spool_id UUID,
    p_grams_consumed NUMERIC
)
RETURNS NUMERIC AS $$
DECLARE
    v_new_weight NUMERIC;
BEGIN
    UPDATE public.spools
    SET current_weight = GREATEST(0, current_weight - p_grams_consumed),
        updated_at = NOW()
    WHERE id = p_spool_id
      AND user_id = auth.uid()
    RETURNING current_weight INTO v_new_weight;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Carretel não encontrado ou não pertence ao usuário autenticado';
    END IF;

    RETURN v_new_weight;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
