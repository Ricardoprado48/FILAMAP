-- Migration 005: Reconcilia��o do Schema Real do Filamap
-- Data: 2026-09-18

-- 1. Garantir extens�es necess�rias
create extension if not exists "uuid-ossp";

-- 2. Tabela de Cat�logo de Pe�as (utilizada pelo Simulador/Or�amento)
create table if not exists public.catalog_items (
    id uuid default uuid_generate_v4() primary key,
    user_id uuid references auth.users(id) on delete cascade not null,
    name text not null,
    material text not null,
    weight_g numeric default 0,
    print_hours numeric default 0,
    accessories_cost numeric default 0,
    production_cost numeric default 0,
    sale_price numeric default 0,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. Tabela de Logs de Impress�o (utilizada pelo Agent e Web App)
create table if not exists public.print_logs (
    id uuid default uuid_generate_v4() primary key,
    user_id uuid references auth.users(id) on delete cascade not null,
    printer_id uuid references public.printers(id) on delete set null,
    spool_id uuid references public.spools(id) on delete set null,
    slot_index integer,
    subtask_name text,
    filament_used_g numeric default 0,
    print_duration_minutes integer default 0,
    status text not null,
    needs_weighing boolean default false,
    completed_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 4. Adicionar colunas faltantes na tabela spools (ex: price_paid)
do $$
begin
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'spools' and column_name = 'price_paid') then
        alter table public.spools add column price_paid numeric default 0;
    end if;
end $$;

-- 5. Adicionar colunas de telemetria estendida na tabela printers (usadas pelo Agent)
do $$
begin
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'printers' and column_name = 'current_task') then
        alter table public.printers add column current_task text;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'printers' and column_name = 'print_progress') then
        alter table public.printers add column print_progress integer default 0;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'printers' and column_name = 'remaining_time_min') then
        alter table public.printers add column remaining_time_min integer default 0;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'printers' and column_name = 'current_layer') then
        alter table public.printers add column current_layer integer default 0;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'printers' and column_name = 'total_layers') then
        alter table public.printers add column total_layers integer default 0;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'printers' and column_name = 'nozzle_temp') then
        alter table public.printers add column nozzle_temp numeric default 0;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'printers' and column_name = 'bed_temp') then
        alter table public.printers add column bed_temp numeric default 0;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'printers' and column_name = 'gcode_state') then
        alter table public.printers add column gcode_state text;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'printers' and column_name = 'active_slot_index') then
        alter table public.printers add column active_slot_index integer;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'printers' and column_name = 'filament_slice_info') then
        alter table public.printers add column filament_slice_info jsonb;
    end if;
end $$;

-- 6. Habilitar RLS (Row Level Security) nas novas tabelas
alter table public.catalog_items enable row level security;
alter table public.print_logs enable row level security;

-- 7. Criar Policies de RLS para catalog_items
create policy "Users can manage their own catalog_items"
    on public.catalog_items
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

-- 8. Criar Policies de RLS para print_logs
create policy "Users can manage their own print_logs"
    on public.print_logs
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
