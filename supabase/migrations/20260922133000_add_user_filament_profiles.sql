-- Filamap
-- Perfis pessoais de filamento detectados automaticamente no Bambu Studio.
--
-- Um perfil representa o produto/material cadastrado no Bambu Studio.
-- Um ou mais carretéis físicos (spools) podem apontar para o mesmo perfil.
--
-- Exemplo:
--   perfil: + PLA VERDE SILK VOOLT3D
--     -> spool NFC A
--     -> spool NFC B

CREATE TABLE IF NOT EXISTS public.user_filament_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL
        REFERENCES auth.users(id)
        ON DELETE CASCADE
        DEFAULT auth.uid(),

    -- Origem do cadastro.
    source TEXT NOT NULL
        DEFAULT 'bambu_studio',

    -- Identificador estável do filamento no Bambu Studio.
    -- Para presets base pessoais, o Desktop Agent usa filament_id.
    -- Presets calibrados sem filament_id não criam novos perfis.
    source_key TEXT NOT NULL,

    -- Nome completo encontrado no Bambu Studio.
    source_profile_name TEXT NOT NULL,

    -- Nome organizado mostrado no Filamap.
    -- Ex.: + PLA VERDE SILK VOOLT3D
    display_name TEXT NOT NULL,

    material VARCHAR(32) NOT NULL,

    color_name VARCHAR(64),

    model_name VARCHAR(64),

    brand VARCHAR(64),

    -- Metadados relevantes preservados do preset original.
    source_metadata JSONB NOT NULL
        DEFAULT '{}'::jsonb,

    first_seen_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW(),

    last_seen_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW(),

    created_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW(),

    CONSTRAINT user_filament_profiles_source_unique
        UNIQUE (user_id, source, source_key),

    -- Necessário para o FK composto usado por spools.
    CONSTRAINT user_filament_profiles_id_user_unique
        UNIQUE (id, user_id)
);


-- Um carretel físico pode apontar para um perfil pessoal.
ALTER TABLE public.spools
    ADD COLUMN IF NOT EXISTS filament_profile_id UUID;


-- Garante que um spool só possa apontar para um perfil do mesmo usuário.
ALTER TABLE public.spools
    DROP CONSTRAINT IF EXISTS spools_filament_profile_owner_fk;

ALTER TABLE public.spools
    ADD CONSTRAINT spools_filament_profile_owner_fk
    FOREIGN KEY (filament_profile_id, user_id)
    REFERENCES public.user_filament_profiles(id, user_id)
    ON DELETE SET NULL (filament_profile_id);


-- Índices
CREATE INDEX IF NOT EXISTS idx_user_filament_profiles_user_id
    ON public.user_filament_profiles(user_id);

CREATE INDEX IF NOT EXISTS idx_user_filament_profiles_last_seen
    ON public.user_filament_profiles(user_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_spools_filament_profile_id
    ON public.spools(filament_profile_id);


-- Segurança
ALTER TABLE public.user_filament_profiles
    ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "owner_all"
    ON public.user_filament_profiles;

CREATE POLICY "owner_all"
    ON public.user_filament_profiles
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);


COMMENT ON TABLE public.user_filament_profiles IS
'Perfis pessoais de filamento detectados pelo Desktop Agent no Bambu Studio. Um perfil pode ser associado a vários carretéis físicos.';

COMMENT ON COLUMN public.user_filament_profiles.source_key IS
'filament_id do preset base pessoal do Bambu Studio, usado pelo Desktop Agent para sincronizar o mesmo filamento sem duplicação.';

COMMENT ON COLUMN public.user_filament_profiles.display_name IS
'Nome organizado exibido pelo Filamap, por exemplo + PLA VERDE SILK VOOLT3D.';

COMMENT ON COLUMN public.user_filament_profiles.source_metadata IS
'Metadados relevantes preservados do preset original do Bambu Studio.';

COMMENT ON COLUMN public.spools.filament_profile_id IS
'Perfil pessoal de filamento associado a este carretel físico.';