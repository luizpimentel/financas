-- =============================================================================
-- MIGRAÇÃO 00001: IDENTIDADE, WORKSPACES COMPARTILHADOS, SEGURANÇA (RLS) E AUDITORIA
-- =============================================================================
-- Projeto: Finanças Mobile (Android & iOS) — pt-BR / BRL (centavos inteiros)
-- Fase 1 (Tarefa T1.3A): Fundação de Banco de Dados, Controle de Acesso e Auditoria
-- Compatibilidade: PostgreSQL 15+ / Supabase (Auth, PostgREST, RLS)
-- Regras: AGENTS.md §§ 2, 4, 5 e 6 | IMPLEMENTATION_PLAN.md v2.1 §§ 9, 10, 11, 13–16
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. EXTENSÕES E COMPATIBILIDADE DE AMBIENTE (SUPABASE / POSTGRESQL PURO)
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  -- Garante a existência dos roles padrões do Supabase caso a migração rode
  -- em uma instância PostgreSQL de teste isolada (no Supabase já existem).
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;

  -- Em instâncias PostgreSQL de teste sem o container GoTrue, cria estrutura
  -- mínima compatível de auth.users, auth.uid() e auth.jwt(). No Supabase real,
  -- estes objetos já existem e o bloco condicional é ignorado.
  IF to_regnamespace('auth') IS NULL THEN
    EXECUTE 'CREATE SCHEMA auth';
  END IF;

  IF to_regclass('auth.users') IS NULL THEN
    EXECUTE $sql$
      CREATE TABLE auth.users (
        id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
        email TEXT,
        email_confirmed_at TIMESTAMPTZ,
        raw_app_meta_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        raw_user_meta_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp()
      )
    $sql$;
  END IF;

  IF to_regprocedure('auth.jwt()') IS NULL THEN
    EXECUTE $sql$
      CREATE FUNCTION auth.jwt()
      RETURNS JSONB
      LANGUAGE sql
      STABLE
      AS $fn$
        SELECT COALESCE(
          NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb,
          jsonb_build_object(
            'sub', NULLIF(pg_catalog.current_setting('request.jwt.claim.sub', true), ''),
            'email', NULLIF(pg_catalog.current_setting('request.jwt.claim.email', true), ''),
            'role', NULLIF(pg_catalog.current_setting('request.jwt.claim.role', true), '')
          )
        );
      $fn$
    $sql$;
  END IF;

  IF to_regprocedure('auth.uid()') IS NULL THEN
    EXECUTE $sql$
      CREATE FUNCTION auth.uid()
      RETURNS UUID
      LANGUAGE sql
      STABLE
      AS $fn$
        SELECT COALESCE(
          NULLIF(pg_catalog.current_setting('request.jwt.claim.sub', true), ''),
          (NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
        )::uuid;
      $fn$
    $sql$;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 1. HARDENING DE SCHEMAS E PRIVILÉGIOS PADRÃO (AGENTS.md §4.2 e §4.3)
-- -----------------------------------------------------------------------------
-- O schema "private" NUNCA é exposto ao PostgREST e nenhuma role de cliente
-- possui permissão de USAGE ou EXECUTE sobre seus objetos.
CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Impede que funções futuras em public ou private sejam executáveis por PUBLIC/anon por padrão
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA private
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. FUNÇÃO E TRIGGER UNIVERSAL DE UPDATED_AT MONOTÔNICO E VERSIONAMENTO
-- -----------------------------------------------------------------------------
-- Utiliza clock_timestamp() para avançar monotônicamente mesmo dentro da mesma
-- transação em lote e incrementa version = OLD.version + 1 em todo UPDATE.
CREATE OR REPLACE FUNCTION private.tg_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := pg_catalog.clock_timestamp();
  IF TG_OP = 'UPDATE' THEN
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.tg_touch_updated_at() FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. TABELAS DE IDENTIDADE, WORKSPACES, CONVITES, IDEMPOTÊNCIA, AUDITORIA E SYNC
-- -----------------------------------------------------------------------------

-- 3.1 Perfis de Usuário (public.user_profiles)
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL CHECK (pg_catalog.char_length(pg_catalog.btrim(display_name)) BETWEEN 1 AND 80),
  email TEXT NOT NULL CHECK (
    email = pg_catalog.lower(pg_catalog.btrim(email))
    AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    AND pg_catalog.char_length(email) <= 254
  ),
  avatar_url TEXT CHECK (avatar_url IS NULL OR pg_catalog.char_length(pg_catalog.btrim(avatar_url)) BETWEEN 1 AND 512),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_email
  ON public.user_profiles (email);

CREATE INDEX IF NOT EXISTS idx_user_profiles_sync_cursor
  ON public.user_profiles (updated_at ASC, id ASC);

DROP TRIGGER IF EXISTS tg_user_profiles_touch_updated_at ON public.user_profiles;
CREATE TRIGGER tg_user_profiles_touch_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION private.tg_touch_updated_at();

-- Trigger para sincronizar automaticamente auth.users -> public.user_profiles
CREATE OR REPLACE FUNCTION private.tg_handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email TEXT;
  v_display_name TEXT;
BEGIN
  v_email := pg_catalog.lower(pg_catalog.btrim(COALESCE(NEW.email, '')));
  IF v_email = '' OR pg_catalog.position('@' IN v_email) <= 1 THEN
    v_email := NEW.id::text || '@local.invalid';
  END IF;

  v_display_name := pg_catalog.btrim(COALESCE(
    NEW.raw_user_meta_data ->> 'display_name',
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'name',
    pg_catalog.split_part(v_email, '@', 1),
    'Usuário'
  ));

  IF v_display_name = '' THEN
    v_display_name := 'Usuário';
  END IF;

  v_display_name := pg_catalog.left(v_display_name, 80);

  INSERT INTO public.user_profiles (id, display_name, email)
  VALUES (NEW.id, v_display_name, v_email)
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        display_name = CASE
          WHEN public.user_profiles.display_name = '' THEN EXCLUDED.display_name
          ELSE public.user_profiles.display_name
        END
  WHERE public.user_profiles.email IS DISTINCT FROM EXCLUDED.email;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.tg_handle_new_auth_user() FROM PUBLIC, anon, authenticated;

-- No Supabase Cloud, o serviço GoTrue opera com o role `supabase_auth_admin` ao
-- inserir/atualizar `auth.users`. Concede permissão mínima para que o trigger
-- em `auth.users` invoque `private.tg_handle_new_auth_user` e `private.tg_touch_updated_at`.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    GRANT USAGE ON SCHEMA private TO supabase_auth_admin;
    GRANT EXECUTE ON FUNCTION private.tg_handle_new_auth_user() TO supabase_auth_admin;
    GRANT EXECUTE ON FUNCTION private.tg_touch_updated_at() TO supabase_auth_admin;
  END IF;
END
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_or_updated ON auth.users;
CREATE TRIGGER on_auth_user_created_or_updated
  AFTER INSERT OR UPDATE OF email, raw_user_meta_data ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION private.tg_handle_new_auth_user();

-- 3.2 Ambientes Financeiros Compartilhados (public.financial_workspaces)
CREATE TABLE IF NOT EXISTS public.financial_workspaces (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  name TEXT NOT NULL CHECK (pg_catalog.char_length(pg_catalog.btrim(name)) BETWEEN 1 AND 80),
  currency_code TEXT NOT NULL DEFAULT 'BRL' CHECK (currency_code = 'BRL'),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  archived_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_financial_workspaces_created_by
  ON public.financial_workspaces (created_by);

CREATE INDEX IF NOT EXISTS idx_financial_workspaces_sync_cursor
  ON public.financial_workspaces (id ASC, updated_at ASC);

DROP TRIGGER IF EXISTS tg_financial_workspaces_touch_updated_at ON public.financial_workspaces;
CREATE TRIGGER tg_financial_workspaces_touch_updated_at
  BEFORE UPDATE ON public.financial_workspaces
  FOR EACH ROW
  EXECUTE FUNCTION private.tg_touch_updated_at();

-- 3.3 Participantes do Workspace (public.workspace_members)
CREATE TABLE IF NOT EXISTS public.workspace_members (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.financial_workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT uq_workspace_members_workspace_user UNIQUE (workspace_id, user_id),
  CONSTRAINT chk_workspace_members_revocation_state CHECK (
    (status = 'active' AND revoked_at IS NULL AND revoked_by IS NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL)
  ),
  CONSTRAINT chk_workspace_owner_cannot_be_revoked CHECK (
    NOT (role = 'owner' AND status = 'revoked')
  )
);

-- Regra 9.1 do Plano Mestre: exatamente 1 proprietário ativo por workspace
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_single_active_owner
  ON public.workspace_members (workspace_id)
  WHERE role = 'owner' AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_workspace_members_user_active
  ON public.workspace_members (user_id, workspace_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_workspace_members_sync_cursor
  ON public.workspace_members (workspace_id, updated_at ASC, id ASC);

DROP TRIGGER IF EXISTS tg_workspace_members_touch_updated_at ON public.workspace_members;
CREATE TRIGGER tg_workspace_members_touch_updated_at
  BEFORE UPDATE ON public.workspace_members
  FOR EACH ROW
  EXECUTE FUNCTION private.tg_touch_updated_at();

-- Constraint Trigger Deferida: garante que nenhum workspace exista ao fim da
-- transação sem exatamente 1 proprietário ativo (impede workspace órfão).
CREATE OR REPLACE FUNCTION private.tg_enforce_workspace_has_active_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_workspace_id UUID;
  v_workspace_exists BOOLEAN;
  v_active_owner_count INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'financial_workspaces' THEN
    v_workspace_id := COALESCE(NEW.id, OLD.id);
  ELSE
    v_workspace_id := COALESCE(NEW.workspace_id, OLD.workspace_id);
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.financial_workspaces fw
    WHERE fw.id = v_workspace_id
  ) INTO v_workspace_exists;

  -- Se o workspace foi removido em cascata na transação, nada a validar
  IF NOT v_workspace_exists THEN
    RETURN NULL;
  END IF;

  SELECT COUNT(*)::integer
  INTO v_active_owner_count
  FROM public.workspace_members wm
  WHERE wm.workspace_id = v_workspace_id
    AND wm.role = 'owner'
    AND wm.status = 'active';

  IF v_active_owner_count <> 1 THEN
    RAISE EXCEPTION 'WORKSPACE_OWNER_INVARIANT_VIOLATION: Workspace % must have exactly 1 active owner (found %)',
      v_workspace_id, v_active_owner_count
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.tg_enforce_workspace_has_active_owner() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tg_check_workspace_owner_on_workspace ON public.financial_workspaces;
CREATE CONSTRAINT TRIGGER tg_check_workspace_owner_on_workspace
  AFTER INSERT ON public.financial_workspaces
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION private.tg_enforce_workspace_has_active_owner();

DROP TRIGGER IF EXISTS tg_check_workspace_owner_on_members ON public.workspace_members;
CREATE CONSTRAINT TRIGGER tg_check_workspace_owner_on_members
  AFTER INSERT OR UPDATE OR DELETE ON public.workspace_members
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION private.tg_enforce_workspace_has_active_owner();

-- 3.4 Convites para o Workspace (public.workspace_invitations)
-- Armazena exclusivamente o hash SHA-256 do token (nunca o token em texto puro).
CREATE TABLE IF NOT EXISTS public.workspace_invitations (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.financial_workspaces(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL CHECK (
    invited_email = pg_catalog.lower(pg_catalog.btrim(invited_email))
    AND invited_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    AND pg_catalog.char_length(invited_email) <= 254
  ),
  role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  accepted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT chk_workspace_invitations_status_timestamps CHECK (
    (status = 'pending' AND accepted_at IS NULL AND accepted_by IS NULL AND revoked_at IS NULL)
    OR (status = 'accepted' AND accepted_at IS NOT NULL AND accepted_by IS NOT NULL AND revoked_at IS NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL AND accepted_at IS NULL)
    OR (status = 'expired' AND accepted_at IS NULL)
  ),
  CONSTRAINT chk_workspace_invitations_expires_after_create CHECK (expires_at > created_at)
);

-- Impede múltiplos convites pendentes simultâneos para o mesmo e-mail no mesmo workspace
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_invitations_pending_email
  ON public.workspace_invitations (workspace_id, invited_email)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_workspace_invitations_sync_cursor
  ON public.workspace_invitations (workspace_id, updated_at ASC, id ASC);

DROP TRIGGER IF EXISTS tg_workspace_invitations_touch_updated_at ON public.workspace_invitations;
CREATE TRIGGER tg_workspace_invitations_touch_updated_at
  BEFORE UPDATE ON public.workspace_invitations
  FOR EACH ROW
  EXECUTE FUNCTION private.tg_touch_updated_at();

-- 3.5 Registros de Idempotência (public.idempotency_records)
CREATE TABLE IF NOT EXISTS public.idempotency_records (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idempotency_key UUID NOT NULL,
  workspace_id UUID REFERENCES public.financial_workspaces(id) ON DELETE CASCADE,
  operation_name TEXT NOT NULL CHECK (pg_catalog.char_length(pg_catalog.btrim(operation_name)) BETWEEN 1 AND 120),
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  response_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (pg_catalog.clock_timestamp() + INTERVAL '7 days'),
  PRIMARY KEY (user_id, idempotency_key),
  CONSTRAINT chk_idempotency_records_expiration CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_records_workspace
  ON public.idempotency_records (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_idempotency_records_expires_at
  ON public.idempotency_records (expires_at);

-- 3.6 Eventos de Auditoria Imutáveis (public.audit_events)
CREATE TABLE IF NOT EXISTS public.audit_events (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.financial_workspaces(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  entity_type TEXT NOT NULL CHECK (pg_catalog.char_length(pg_catalog.btrim(entity_type)) BETWEEN 1 AND 80),
  entity_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (pg_catalog.char_length(pg_catalog.btrim(action)) BETWEEN 1 AND 80),
  summary_text TEXT NOT NULL CHECK (pg_catalog.char_length(pg_catalog.btrim(summary_text)) BETWEEN 1 AND 500),
  before_state JSONB,
  after_state JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_workspace_created
  ON public.audit_events (workspace_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_audit_events_sync_cursor
  ON public.audit_events (workspace_id, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_audit_events_entity
  ON public.audit_events (workspace_id, entity_type, entity_id);

-- Proteção adicional de imutabilidade (Append-Only): impede UPDATE em audit_events
-- e só permite DELETE quando o próprio workspace pai está sendo excluído em cascata.
CREATE OR REPLACE FUNCTION private.tg_protect_audit_events_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'AUDIT_LOG_IMMUTABLE: Audit events cannot be modified'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- Só permite remoção se o workspace pai não existir mais (ON DELETE CASCADE)
    IF EXISTS (
      SELECT 1
      FROM public.financial_workspaces fw
      WHERE fw.id = OLD.workspace_id
    ) THEN
      RAISE EXCEPTION 'AUDIT_LOG_IMMUTABLE: Audit events cannot be deleted directly'
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.tg_protect_audit_events_immutability() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tg_audit_events_immutable ON public.audit_events;
CREATE TRIGGER tg_audit_events_immutable
  BEFORE UPDATE OR DELETE ON public.audit_events
  FOR EACH ROW
  EXECUTE FUNCTION private.tg_protect_audit_events_immutability();

-- 3.7 Tombstones de Sincronização Incremental (public.sync_tombstones)
CREATE TABLE IF NOT EXISTS public.sync_tombstones (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.financial_workspaces(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (pg_catalog.char_length(pg_catalog.btrim(entity_type)) BETWEEN 1 AND 80),
  entity_id UUID NOT NULL,
  deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_sync_tombstones_cursor
  ON public.sync_tombstones (workspace_id, deleted_at ASC, id ASC);

-- -----------------------------------------------------------------------------
-- 4. FUNÇÕES DE SEGURANÇA, PAPÉIS E AUDITORIA (AGENTS.md §4.2, §4.3 e §5.1)
-- -----------------------------------------------------------------------------

-- 4.1 Verificação Booleana de Papel Ativo no Workspace (para RLS e consultas)
-- Definida em LANGUAGE plpgsql + SECURITY DEFINER para impedir inlining pelo
-- planejador SQL e evitar recursão na política RLS de workspace_members.
CREATE OR REPLACE FUNCTION public.has_workspace_role(
  p_workspace_id UUID,
  p_allowed_roles TEXT[]
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL OR p_workspace_id IS NULL OR p_allowed_roles IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    INNER JOIN public.financial_workspaces fw
      ON fw.id = wm.workspace_id
    WHERE wm.workspace_id = p_workspace_id
      AND wm.user_id = v_user_id
      AND wm.status = 'active'
      AND wm.role = ANY(p_allowed_roles)
      AND fw.archived_at IS NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.has_workspace_role(UUID, TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_workspace_role(UUID, TEXT[]) TO authenticated, service_role;

-- 4.2 Asserção Obrigatória de Papel Ativo (1ª instrução das RPCs de negócio)
CREATE OR REPLACE FUNCTION private.assert_workspace_role(
  p_workspace_id UUID,
  p_allowed_roles TEXT[]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Authentication required'
      USING ERRCODE = '42501';
  END IF;

  IF p_workspace_id IS NULL OR NOT public.has_workspace_role(p_workspace_id, p_allowed_roles) THEN
    RAISE EXCEPTION 'WORKSPACE_ACCESS_DENIED: Insufficient permissions for workspace %', p_workspace_id
      USING ERRCODE = '42501';
  END IF;

  RETURN v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION private.assert_workspace_role(UUID, TEXT[]) FROM PUBLIC, anon, authenticated;

-- 4.3 Gravação Protegida de Eventos de Auditoria (exclusiva para o servidor)
CREATE OR REPLACE FUNCTION private.append_audit_event(
  p_workspace_id UUID,
  p_actor_user_id UUID,
  p_entity_type TEXT,
  p_entity_id UUID,
  p_action TEXT,
  p_summary_text TEXT,
  p_before_state JSONB DEFAULT NULL,
  p_after_state JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_authenticated_uid UUID := auth.uid();
  v_event_id UUID;
BEGIN
  IF v_authenticated_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Cannot append audit event without authenticated actor'
      USING ERRCODE = '42501';
  END IF;

  IF p_actor_user_id IS NULL OR p_actor_user_id IS DISTINCT FROM v_authenticated_uid THEN
    RAISE EXCEPTION 'AUDIT_ACTOR_MISMATCH: Actor user ID must match authenticated user'
      USING ERRCODE = '42501';
  END IF;

  IF p_workspace_id IS NULL OR p_entity_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_AUDIT_EVENT_TARGET: Workspace and entity IDs are required'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.audit_events (
    workspace_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    summary_text,
    before_state,
    after_state
  ) VALUES (
    p_workspace_id,
    p_actor_user_id,
    pg_catalog.btrim(p_entity_type),
    p_entity_id,
    pg_catalog.btrim(p_action),
    pg_catalog.btrim(p_summary_text),
    p_before_state,
    p_after_state
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

REVOKE ALL ON FUNCTION private.append_audit_event(UUID, UUID, TEXT, UUID, TEXT, TEXT, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;

-- 4.4 Helper Interno de Idempotência e Lock Transacional (AGENTS.md §5.1)
CREATE OR REPLACE FUNCTION private.acquire_idempotency_lock_and_get(
  p_user_id UUID,
  p_idempotency_key UUID,
  p_workspace_id UUID,
  p_operation_name TEXT,
  p_request_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_record public.idempotency_records%ROWTYPE;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: User ID required for idempotency check'
      USING ERRCODE = '42501';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'INVALID_IDEMPOTENCY_KEY: p_idempotency_key is required'
      USING ERRCODE = '22023';
  END IF;

  -- Lock transacional por usuário + chave (e também por workspace + chave quando aplicável)
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('idem_user:' || p_user_id::text || ':' || p_idempotency_key::text)
  );

  IF p_workspace_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext(p_workspace_id::text || ':' || p_idempotency_key::text)
    );
  END IF;

  SELECT *
  INTO v_record
  FROM public.idempotency_records ir
  WHERE ir.user_id = p_user_id
    AND ir.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Se o registro anterior já expirou, remove para permitir novo processamento
  IF v_record.expires_at <= pg_catalog.clock_timestamp() THEN
    DELETE FROM public.idempotency_records
    WHERE user_id = p_user_id
      AND idempotency_key = p_idempotency_key;
    RETURN NULL;
  END IF;

  -- Se a mesma chave foi reutilizada para outra operação ou com parâmetros diferentes, rejeita!
  IF v_record.operation_name <> p_operation_name
     OR v_record.request_hash <> p_request_hash
     OR (p_workspace_id IS NOT NULL AND v_record.workspace_id IS DISTINCT FROM p_workspace_id)
  THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD: Key % was already used with different parameters for %',
      p_idempotency_key, v_record.operation_name
      USING ERRCODE = '22023';
  END IF;

  RETURN v_record.response_payload;
END;
$$;

REVOKE ALL ON FUNCTION private.acquire_idempotency_lock_and_get(UUID, UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. PRIVILÉGIOS DE TABELA E POLÍTICAS ROW LEVEL SECURITY (RLS)
-- -----------------------------------------------------------------------------

-- Revoga todas as permissões diretas de clientes em todas as tabelas da migração
REVOKE ALL ON TABLE
  public.user_profiles,
  public.financial_workspaces,
  public.workspace_members,
  public.workspace_invitations,
  public.idempotency_records,
  public.audit_events,
  public.sync_tombstones
FROM PUBLIC, anon, authenticated;

-- Concede SELECT apenas para authenticated (filtrado por RLS)
GRANT SELECT ON TABLE
  public.user_profiles,
  public.financial_workspaces,
  public.workspace_members,
  public.workspace_invitations,
  public.idempotency_records,
  public.audit_events,
  public.sync_tombstones
TO authenticated;

-- Habilita e força RLS em todas as 7 tabelas
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles FORCE ROW LEVEL SECURITY;

ALTER TABLE public.financial_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_workspaces FORCE ROW LEVEL SECURITY;

ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members FORCE ROW LEVEL SECURITY;

ALTER TABLE public.workspace_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_invitations FORCE ROW LEVEL SECURITY;

ALTER TABLE public.idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_records FORCE ROW LEVEL SECURITY;

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events FORCE ROW LEVEL SECURITY;

ALTER TABLE public.sync_tombstones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_tombstones FORCE ROW LEVEL SECURITY;

-- Função auxiliar (PL/pgSQL para impedir inlining) para verificar se dois usuários compartilham algum workspace ativo
CREATE OR REPLACE FUNCTION public.shares_active_workspace_with(p_target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL OR p_target_user_id IS NULL THEN
    RETURN false;
  END IF;

  IF p_target_user_id = v_user_id THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.workspace_members wm_self
    INNER JOIN public.workspace_members wm_other
      ON wm_other.workspace_id = wm_self.workspace_id
    INNER JOIN public.financial_workspaces fw
      ON fw.id = wm_self.workspace_id
    WHERE wm_self.user_id = v_user_id
      AND wm_self.status = 'active'
      AND wm_other.user_id = p_target_user_id
      AND wm_other.status = 'active'
      AND fw.archived_at IS NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.shares_active_workspace_with(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shares_active_workspace_with(UUID) TO authenticated, service_role;

-- 5.1 Políticas RLS: public.user_profiles
DROP POLICY IF EXISTS user_profiles_select_policy ON public.user_profiles;
CREATE POLICY user_profiles_select_policy
  ON public.user_profiles
  FOR SELECT
  TO authenticated
  USING (public.shares_active_workspace_with(id));

-- 5.2 Políticas RLS: public.financial_workspaces
DROP POLICY IF EXISTS financial_workspaces_select_policy ON public.financial_workspaces;
CREATE POLICY financial_workspaces_select_policy
  ON public.financial_workspaces
  FOR SELECT
  TO authenticated
  USING (public.has_workspace_role(id, ARRAY['owner', 'editor', 'viewer']));

-- 5.3 Políticas RLS: public.workspace_members
DROP POLICY IF EXISTS workspace_members_select_policy ON public.workspace_members;
CREATE POLICY workspace_members_select_policy
  ON public.workspace_members
  FOR SELECT
  TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner', 'editor', 'viewer']));

-- 5.4 Políticas RLS: public.workspace_invitations
-- Visualizado pelos membros ativos do workspace OU pelo destinatário autenticado do convite pendente
DROP POLICY IF EXISTS workspace_invitations_select_policy ON public.workspace_invitations;
CREATE POLICY workspace_invitations_select_policy
  ON public.workspace_invitations
  FOR SELECT
  TO authenticated
  USING (
    public.has_workspace_role(workspace_id, ARRAY['owner', 'editor', 'viewer'])
    OR (
      status = 'pending'
      AND invited_email = pg_catalog.lower(pg_catalog.btrim(COALESCE(auth.jwt() ->> 'email', '')))
    )
  );

-- 5.5 Políticas RLS: public.idempotency_records
-- Restringe a leitura ao próprio autor E, quando o registro estiver vinculado a um
-- workspace, exige participação ativa e papel compatível com a operação no workspace.
-- Assim, participantes removidos (status = 'revoked') ou sem permissão perdem
-- imediatamente o acesso de leitura a respostas históricas em idempotency_records.
DROP POLICY IF EXISTS idempotency_records_select_self_policy ON public.idempotency_records;
CREATE POLICY idempotency_records_select_self_policy
  ON public.idempotency_records
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    AND (
      workspace_id IS NULL
      OR (
        operation_name = 'accept_workspace_invitation'
        AND public.has_workspace_role(workspace_id, ARRAY['owner', 'editor', 'viewer'])
      )
      OR (
        operation_name IN (
          'create_workspace_with_initial_setup',
          'create_workspace_invitation',
          'revoke_workspace_invitation',
          'remove_workspace_member',
          'update_workspace_member_role'
        )
        AND public.has_workspace_role(workspace_id, ARRAY['owner'])
      )
      OR (
        operation_name NOT IN (
          'accept_workspace_invitation',
          'create_workspace_with_initial_setup',
          'create_workspace_invitation',
          'revoke_workspace_invitation',
          'remove_workspace_member',
          'update_workspace_member_role'
        )
        AND public.has_workspace_role(workspace_id, ARRAY['owner', 'editor'])
      )
    )
  );

-- 5.6 Políticas RLS: public.audit_events (Somente leitura para participantes ativos)
DROP POLICY IF EXISTS audit_events_select_policy ON public.audit_events;
CREATE POLICY audit_events_select_policy
  ON public.audit_events
  FOR SELECT
  TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner', 'editor', 'viewer']));

-- 5.7 Políticas RLS: public.sync_tombstones (Somente leitura para participantes ativos)
DROP POLICY IF EXISTS sync_tombstones_select_policy ON public.sync_tombstones;
CREATE POLICY sync_tombstones_select_policy
  ON public.sync_tombstones
  FOR SELECT
  TO authenticated
  USING (public.has_workspace_role(workspace_id, ARRAY['owner', 'editor', 'viewer']));

-- 5.8 Políticas para o role proprietário das funções SECURITY DEFINER (CURRENT_USER / service_role)
-- Garante que mesmo com FORCE ROW LEVEL SECURITY ativo (e caso o owner da função
-- não possua BYPASSRLS em um ambiente de teste customizado), as funções internas
-- SECURITY DEFINER operem sem recursão, enquanto clientes (anon/authenticated)
-- permanecem 100% restritos às políticas TO authenticated acima.
DROP POLICY IF EXISTS internal_definer_user_profiles_policy ON public.user_profiles;
CREATE POLICY internal_definer_user_profiles_policy
  ON public.user_profiles
  FOR ALL
  TO CURRENT_USER, service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS internal_definer_workspaces_policy ON public.financial_workspaces;
CREATE POLICY internal_definer_workspaces_policy
  ON public.financial_workspaces
  FOR ALL
  TO CURRENT_USER, service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS internal_definer_members_policy ON public.workspace_members;
CREATE POLICY internal_definer_members_policy
  ON public.workspace_members
  FOR ALL
  TO CURRENT_USER, service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS internal_definer_invitations_policy ON public.workspace_invitations;
CREATE POLICY internal_definer_invitations_policy
  ON public.workspace_invitations
  FOR ALL
  TO CURRENT_USER, service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS internal_definer_idempotency_policy ON public.idempotency_records;
CREATE POLICY internal_definer_idempotency_policy
  ON public.idempotency_records
  FOR ALL
  TO CURRENT_USER, service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS internal_definer_audit_policy ON public.audit_events;
CREATE POLICY internal_definer_audit_policy
  ON public.audit_events
  FOR ALL
  TO CURRENT_USER, service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS internal_definer_tombstones_policy ON public.sync_tombstones;
CREATE POLICY internal_definer_tombstones_policy
  ON public.sync_tombstones
  FOR ALL
  TO CURRENT_USER, service_role
  USING (true)
  WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 6. RPCs TRANSACIONAIS DE ONBOARDING, CONVITES E PARTICIPANTES
-- -----------------------------------------------------------------------------

-- 6.1 Criação Atômica do Workspace no Onboarding (IMPLEMENTATION_PLAN.md §16.4)
CREATE OR REPLACE FUNCTION public.create_workspace_with_initial_setup(
  p_workspace_name TEXT,
  p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_user_email TEXT;
  v_clean_name TEXT;
  v_request_hash TEXT;
  v_existing_response JSONB;
  v_workspace_id UUID;
  v_member_id UUID;
  v_result JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Authentication required'
      USING ERRCODE = '42501';
  END IF;

  v_clean_name := pg_catalog.btrim(COALESCE(p_workspace_name, ''));
  IF pg_catalog.char_length(v_clean_name) < 1 OR pg_catalog.char_length(v_clean_name) > 80 THEN
    RAISE EXCEPTION 'INVALID_WORKSPACE_NAME: Workspace name must have between 1 and 80 characters'
      USING ERRCODE = '22023';
  END IF;

  v_request_hash := pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to('create_workspace_with_initial_setup:' || v_clean_name, 'UTF8')
    ),
    'hex'
  );

  v_existing_response := private.acquire_idempotency_lock_and_get(
    v_user_id,
    p_idempotency_key,
    NULL,
    'create_workspace_with_initial_setup',
    v_request_hash
  );

  IF v_existing_response IS NOT NULL THEN
    IF NOT public.has_workspace_role(
      (v_existing_response ->> 'workspace_id')::uuid,
      ARRAY['owner']
    ) THEN
      RAISE EXCEPTION 'WORKSPACE_ACCESS_DENIED: Workspace from idempotent creation is no longer active or accessible'
        USING ERRCODE = '42501';
    END IF;
    RETURN v_existing_response;
  END IF;

  -- Obtém o e-mail autenticado a partir do JWT ou de auth.users
  v_user_email := pg_catalog.lower(pg_catalog.btrim(COALESCE(auth.jwt() ->> 'email', '')));
  IF v_user_email = '' OR pg_catalog.position('@' IN v_user_email) <= 1 THEN
    SELECT pg_catalog.lower(pg_catalog.btrim(COALESCE(u.email, '')))
    INTO v_user_email
    FROM auth.users u
    WHERE u.id = v_user_id;
  END IF;

  IF COALESCE(v_user_email, '') = '' OR pg_catalog.position('@' IN v_user_email) <= 1 THEN
    v_user_email := v_user_id::text || '@local.invalid';
  END IF;

  -- Garante perfil do usuário criador
  INSERT INTO public.user_profiles (id, display_name, email)
  VALUES (
    v_user_id,
    pg_catalog.left(COALESCE(NULLIF(pg_catalog.split_part(v_user_email, '@', 1), ''), 'Usuário'), 80),
    v_user_email
  )
  ON CONFLICT (id) DO NOTHING;

  -- 1. Cria o Workspace Financeiro
  INSERT INTO public.financial_workspaces (name, currency_code, created_by)
  VALUES (v_clean_name, 'BRL', v_user_id)
  RETURNING id INTO v_workspace_id;

  -- 2. Registra o criador como único Owner ativo
  INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
  VALUES (v_workspace_id, v_user_id, 'owner', 'active')
  RETURNING id INTO v_member_id;

  -- 3. Registra auditoria via função privada blindada
  PERFORM private.append_audit_event(
    v_workspace_id,
    v_user_id,
    'financial_workspace',
    v_workspace_id,
    'workspace_created',
    pg_catalog.format('Ambiente financeiro "%s" criado', v_clean_name),
    NULL,
    jsonb_build_object(
      'workspace_id', v_workspace_id,
      'member_id', v_member_id,
      'name', v_clean_name,
      'currency_code', 'BRL',
      'owner_id', v_user_id
    )
  );

  v_result := jsonb_build_object(
    'workspace_id', v_workspace_id,
    'member_id', v_member_id,
    'name', v_clean_name,
    'currency_code', 'BRL',
    'role', 'owner'
  );

  INSERT INTO public.idempotency_records (
    user_id,
    idempotency_key,
    workspace_id,
    operation_name,
    request_hash,
    response_payload
  ) VALUES (
    v_user_id,
    p_idempotency_key,
    v_workspace_id,
    'create_workspace_with_initial_setup',
    v_request_hash,
    v_result
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.create_workspace_with_initial_setup(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_workspace_with_initial_setup(TEXT, UUID) TO authenticated;

-- 6.2 Emissão de Convite de Participação (Exclusivo do Owner)
CREATE OR REPLACE FUNCTION public.create_workspace_invitation(
  p_workspace_id UUID,
  p_invited_email TEXT,
  p_role TEXT,
  p_idempotency_key UUID,
  p_expires_in_days INTEGER DEFAULT 7
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id UUID;
  v_clean_email TEXT;
  v_clean_role TEXT;
  v_effective_days INTEGER;
  v_request_hash TEXT;
  v_existing_response JSONB;
  v_raw_token TEXT;
  v_token_hash TEXT;
  v_expires_at TIMESTAMPTZ;
  v_invitation_id UUID;
  v_result JSONB;
BEGIN
  -- 1ª instrução obrigatória: valida autenticação e papel de 'owner' no workspace
  v_actor_id := private.assert_workspace_role(p_workspace_id, ARRAY['owner']);

  v_clean_email := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_invited_email, '')));
  IF v_clean_email = ''
     OR pg_catalog.position('@' IN v_clean_email) <= 1
     OR pg_catalog.position('.' IN pg_catalog.split_part(v_clean_email, '@', 2)) <= 1
     OR pg_catalog.char_length(v_clean_email) > 254
     OR v_clean_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  THEN
    RAISE EXCEPTION 'INVALID_INVITED_EMAIL: A valid destination email is required'
      USING ERRCODE = '22023';
  END IF;

  v_clean_role := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_role, '')));
  IF v_clean_role NOT IN ('editor', 'viewer') THEN
    RAISE EXCEPTION 'INVALID_INVITATION_ROLE: Invitation role must be editor or viewer'
      USING ERRCODE = '22023';
  END IF;

  v_effective_days := COALESCE(p_expires_in_days, 7);
  IF v_effective_days < 1 OR v_effective_days > 30 THEN
    RAISE EXCEPTION 'INVALID_EXPIRATION_DAYS: Expiration must be between 1 and 30 days'
      USING ERRCODE = '22023';
  END IF;

  v_request_hash := pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(
        pg_catalog.format(
          'create_workspace_invitation:%s:%s:%s:%s',
          p_workspace_id,
          v_clean_email,
          v_clean_role,
          v_effective_days
        ),
        'UTF8'
      )
    ),
    'hex'
  );

  v_existing_response := private.acquire_idempotency_lock_and_get(
    v_actor_id,
    p_idempotency_key,
    p_workspace_id,
    'create_workspace_invitation',
    v_request_hash
  );

  IF v_existing_response IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.workspace_invitations wi
      WHERE wi.id = (v_existing_response ->> 'invitation_id')::uuid
        AND wi.workspace_id = p_workspace_id
        AND wi.status = 'pending'
        AND wi.expires_at > pg_catalog.clock_timestamp()
    ) THEN
      RAISE EXCEPTION 'IDEMPOTENCY_STATE_CHANGED: Invitation created with this key is no longer pending'
        USING ERRCODE = '40001';
    END IF;
    RETURN v_existing_response;
  END IF;

  -- Impede convidar alguém que já é membro ativo do workspace
  IF EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    INNER JOIN public.user_profiles up
      ON up.id = wm.user_id
    WHERE wm.workspace_id = p_workspace_id
      AND wm.status = 'active'
      AND up.email = v_clean_email
  ) THEN
    RAISE EXCEPTION 'MEMBER_ALREADY_ACTIVE: User with email % is already an active member of this workspace',
      v_clean_email
      USING ERRCODE = '23505';
  END IF;

  -- Marca como expirados eventuais convites pendentes cujo prazo já venceu
  UPDATE public.workspace_invitations wi
  SET status = 'expired'
  WHERE wi.workspace_id = p_workspace_id
    AND wi.invited_email = v_clean_email
    AND wi.status = 'pending'
    AND wi.expires_at <= pg_catalog.clock_timestamp();

  -- Verifica se já existe convite pendente dentro da validade para o mesmo e-mail
  IF EXISTS (
    SELECT 1
    FROM public.workspace_invitations wi
    WHERE wi.workspace_id = p_workspace_id
      AND wi.invited_email = v_clean_email
      AND wi.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'INVITATION_ALREADY_PENDING: An active invitation already exists for %',
      v_clean_email
      USING ERRCODE = '23505';
  END IF;

  -- Gera token bruto imprevisível (64 caracteres hexadecimais) e seu hash SHA-256
  v_raw_token := pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '')
              || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');

  v_token_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(v_raw_token, 'UTF8')),
    'hex'
  );

  v_expires_at := pg_catalog.clock_timestamp() + pg_catalog.make_interval(days => v_effective_days);

  INSERT INTO public.workspace_invitations (
    workspace_id,
    invited_email,
    role,
    token_hash,
    status,
    invited_by,
    expires_at
  ) VALUES (
    p_workspace_id,
    v_clean_email,
    v_clean_role,
    v_token_hash,
    'pending',
    v_actor_id,
    v_expires_at
  )
  RETURNING id INTO v_invitation_id;

  -- Registra evento de auditoria (sem expor v_raw_token no log!)
  PERFORM private.append_audit_event(
    p_workspace_id,
    v_actor_id,
    'workspace_invitation',
    v_invitation_id,
    'workspace_invitation_created',
    pg_catalog.format('Convite enviado para %s com papel "%s"', v_clean_email, v_clean_role),
    NULL,
    jsonb_build_object(
      'invitation_id', v_invitation_id,
      'workspace_id', p_workspace_id,
      'invited_email', v_clean_email,
      'role', v_clean_role,
      'expires_at', v_expires_at
    )
  );

  v_result := jsonb_build_object(
    'invitation_id', v_invitation_id,
    'workspace_id', p_workspace_id,
    'invited_email', v_clean_email,
    'role', v_clean_role,
    'status', 'pending',
    'expires_at', v_expires_at,
    'raw_token', v_raw_token
  );

  INSERT INTO public.idempotency_records (
    user_id,
    idempotency_key,
    workspace_id,
    operation_name,
    request_hash,
    response_payload
  ) VALUES (
    v_actor_id,
    p_idempotency_key,
    p_workspace_id,
    'create_workspace_invitation',
    v_request_hash,
    v_result
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.create_workspace_invitation(UUID, TEXT, TEXT, UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_workspace_invitation(UUID, TEXT, TEXT, UUID, INTEGER) TO authenticated;

-- 6.3 Aceitação Segura de Convite pelo Usuário Convidado
CREATE OR REPLACE FUNCTION public.accept_workspace_invitation(
  p_raw_token TEXT,
  p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_user_email TEXT;
  v_jwt_email TEXT;
  v_email_confirmed_at TIMESTAMPTZ;
  v_clean_token TEXT;
  v_token_hash TEXT;
  v_request_hash TEXT;
  v_existing_response JSONB;
  v_invitation public.workspace_invitations%ROWTYPE;
  v_member public.workspace_members%ROWTYPE;
  v_member_id UUID;
  v_accepted_at TIMESTAMPTZ;
  v_result JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Authentication required'
      USING ERRCODE = '42501';
  END IF;

  -- Valida identidade e confirmação de e-mail diretamente em auth.users (servidor).
  -- Nunca confia apenas no JWT nem em raw_user_meta_data editável pelo cliente.
  SELECT
    pg_catalog.lower(pg_catalog.btrim(COALESCE(u.email, ''))),
    u.email_confirmed_at
  INTO
    v_user_email,
    v_email_confirmed_at
  FROM auth.users u
  WHERE u.id = v_user_id;

  IF NOT FOUND OR v_user_email = '' THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Authenticated user record not found in auth.users'
      USING ERRCODE = '42501';
  END IF;

  v_jwt_email := pg_catalog.lower(pg_catalog.btrim(COALESCE(auth.jwt() ->> 'email', '')));
  IF v_jwt_email <> '' AND v_jwt_email <> v_user_email THEN
    RAISE EXCEPTION 'INVITATION_EMAIL_MISMATCH: JWT email claim does not match authenticated user email'
      USING ERRCODE = '42501';
  END IF;

  IF v_email_confirmed_at IS NULL OR v_email_confirmed_at > pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'EMAIL_NOT_CONFIRMED: A verified email address is required to accept workspace invitations'
      USING ERRCODE = '42501';
  END IF;

  v_clean_token := pg_catalog.btrim(COALESCE(p_raw_token, ''));
  IF pg_catalog.char_length(v_clean_token) < 32 THEN
    RAISE EXCEPTION 'INVALID_INVITATION_TOKEN: Token is missing or malformed'
      USING ERRCODE = '22023';
  END IF;

  v_token_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(v_clean_token, 'UTF8')),
    'hex'
  );

  v_request_hash := pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to('accept_workspace_invitation:' || v_token_hash, 'UTF8')
    ),
    'hex'
  );

  v_existing_response := private.acquire_idempotency_lock_and_get(
    v_user_id,
    p_idempotency_key,
    NULL,
    'accept_workspace_invitation',
    v_request_hash
  );

  -- Bloqueia a linha do convite para evitar aceitação concorrente
  SELECT *
  INTO v_invitation
  FROM public.workspace_invitations wi
  WHERE wi.token_hash = v_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND_OR_INVALID: Invitation token is invalid'
      USING ERRCODE = '42501';
  END IF;

  -- Se houver resposta idempotente prévia, valida se a autorização resultante
  -- continua ativa no workspace atual antes de retornar o payload em cache!
  IF v_existing_response IS NOT NULL THEN
    IF v_invitation.status <> 'accepted' OR v_invitation.accepted_by IS DISTINCT FROM v_user_id THEN
      RAISE EXCEPTION 'INVITATION_STATE_CHANGED: Invitation is no longer accepted by this user'
        USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.financial_workspaces fw
      WHERE fw.id = v_invitation.workspace_id
        AND fw.archived_at IS NULL
    ) THEN
      RAISE EXCEPTION 'WORKSPACE_ARCHIVED: Target workspace is no longer active'
        USING ERRCODE = '42501';
    END IF;

    SELECT *
    INTO v_member
    FROM public.workspace_members wm
    WHERE wm.workspace_id = v_invitation.workspace_id
      AND wm.user_id = v_user_id;

    IF NOT FOUND OR v_member.status <> 'active' OR v_member.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'WORKSPACE_ACCESS_REVOKED: Membership granted by this invitation has been revoked'
        USING ERRCODE = '42501';
    END IF;

    RETURN jsonb_set(v_existing_response, '{role}', to_jsonb(v_member.role));
  END IF;

  IF v_invitation.status = 'revoked' THEN
    RAISE EXCEPTION 'INVITATION_REVOKED: This invitation has been revoked'
      USING ERRCODE = '42501';
  END IF;

  IF v_invitation.status = 'accepted' THEN
    RAISE EXCEPTION 'INVITATION_ALREADY_USED: This invitation has already been accepted'
      USING ERRCODE = '42501';
  END IF;

  IF v_invitation.status <> 'pending' OR v_invitation.expires_at <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'INVITATION_EXPIRED: This invitation has expired'
      USING ERRCODE = '42501';
  END IF;

  -- Verifica se o workspace continua ativo
  IF NOT EXISTS (
    SELECT 1
    FROM public.financial_workspaces fw
    WHERE fw.id = v_invitation.workspace_id
      AND fw.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'WORKSPACE_ARCHIVED: Target workspace is no longer active'
      USING ERRCODE = '42501';
  END IF;

  IF v_user_email <> v_invitation.invited_email THEN
    RAISE EXCEPTION 'INVITATION_EMAIL_MISMATCH: Authenticated user email does not match invited email'
      USING ERRCODE = '42501';
  END IF;

  -- Garante perfil do usuário convidado
  INSERT INTO public.user_profiles (id, display_name, email)
  VALUES (
    v_user_id,
    pg_catalog.left(COALESCE(NULLIF(pg_catalog.split_part(v_user_email, '@', 1), ''), 'Usuário'), 80),
    v_user_email
  )
  ON CONFLICT (id) DO NOTHING;

  -- Verifica se o usuário já é membro ativo
  IF EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = v_invitation.workspace_id
      AND wm.user_id = v_user_id
      AND wm.status = 'active'
  ) THEN
    RAISE EXCEPTION 'MEMBER_ALREADY_ACTIVE: User is already an active member of this workspace'
      USING ERRCODE = '23505';
  END IF;

  v_accepted_at := pg_catalog.clock_timestamp();

  -- Insere ou reativa participação (caso tenha sido revogado anteriormente e recebido NOVO convite)
  INSERT INTO public.workspace_members (
    workspace_id,
    user_id,
    role,
    status,
    invited_by,
    joined_at
  ) VALUES (
    v_invitation.workspace_id,
    v_user_id,
    v_invitation.role,
    'active',
    v_invitation.invited_by,
    v_accepted_at
  )
  ON CONFLICT (workspace_id, user_id) DO UPDATE
    SET role = EXCLUDED.role,
        status = 'active',
        invited_by = EXCLUDED.invited_by,
        joined_at = v_accepted_at,
        revoked_at = NULL,
        revoked_by = NULL
  RETURNING id INTO v_member_id;

  -- Marca o convite como aceito
  UPDATE public.workspace_invitations
  SET status = 'accepted',
      accepted_by = v_user_id,
      accepted_at = v_accepted_at
  WHERE id = v_invitation.id;

  -- Registra evento de auditoria
  PERFORM private.append_audit_event(
    v_invitation.workspace_id,
    v_user_id,
    'workspace_member',
    v_member_id,
    'workspace_invitation_accepted',
    pg_catalog.format('Participante %s ingressou no workspace como "%s"', v_user_email, v_invitation.role),
    NULL,
    jsonb_build_object(
      'workspace_id', v_invitation.workspace_id,
      'member_id', v_member_id,
      'invitation_id', v_invitation.id,
      'user_id', v_user_id,
      'role', v_invitation.role
    )
  );

  v_result := jsonb_build_object(
    'workspace_id', v_invitation.workspace_id,
    'member_id', v_member_id,
    'invitation_id', v_invitation.id,
    'role', v_invitation.role,
    'status', 'active'
  );

  INSERT INTO public.idempotency_records (
    user_id,
    idempotency_key,
    workspace_id,
    operation_name,
    request_hash,
    response_payload
  ) VALUES (
    v_user_id,
    p_idempotency_key,
    v_invitation.workspace_id,
    'accept_workspace_invitation',
    v_request_hash,
    v_result
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_workspace_invitation(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_workspace_invitation(TEXT, UUID) TO authenticated;

-- 6.4 Revogação de Convite Pendente (Exclusivo do Owner)
CREATE OR REPLACE FUNCTION public.revoke_workspace_invitation(
  p_workspace_id UUID,
  p_invitation_id UUID,
  p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id UUID;
  v_request_hash TEXT;
  v_existing_response JSONB;
  v_invitation public.workspace_invitations%ROWTYPE;
  v_revoked_at TIMESTAMPTZ;
  v_result JSONB;
BEGIN
  v_actor_id := private.assert_workspace_role(p_workspace_id, ARRAY['owner']);

  IF p_invitation_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_INVITATION_ID: Invitation ID is required'
      USING ERRCODE = '22023';
  END IF;

  v_request_hash := pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(
        pg_catalog.format('revoke_workspace_invitation:%s:%s', p_workspace_id, p_invitation_id),
        'UTF8'
      )
    ),
    'hex'
  );

  v_existing_response := private.acquire_idempotency_lock_and_get(
    v_actor_id,
    p_idempotency_key,
    p_workspace_id,
    'revoke_workspace_invitation',
    v_request_hash
  );

  SELECT *
  INTO v_invitation
  FROM public.workspace_invitations wi
  WHERE wi.id = p_invitation_id
    AND wi.workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND: Invitation does not exist in this workspace'
      USING ERRCODE = '42501';
  END IF;

  IF v_existing_response IS NOT NULL THEN
    IF v_invitation.status <> 'revoked' THEN
      RAISE EXCEPTION 'IDEMPOTENCY_STATE_CHANGED: Invitation state changed after this revocation key was processed'
        USING ERRCODE = '40001';
    END IF;
    RETURN v_existing_response;
  END IF;

  IF v_invitation.status <> 'pending' THEN
    RAISE EXCEPTION 'INVITATION_NOT_PENDING: Only pending invitations can be revoked (current status: %)',
      v_invitation.status
      USING ERRCODE = '22023';
  END IF;

  v_revoked_at := pg_catalog.clock_timestamp();

  UPDATE public.workspace_invitations
  SET status = 'revoked',
      revoked_at = v_revoked_at,
      revoked_by = v_actor_id
  WHERE id = v_invitation.id;

  PERFORM private.append_audit_event(
    p_workspace_id,
    v_actor_id,
    'workspace_invitation',
    v_invitation.id,
    'workspace_invitation_revoked',
    pg_catalog.format('Convite para %s revogado', v_invitation.invited_email),
    jsonb_build_object('status', v_invitation.status, 'invited_email', v_invitation.invited_email),
    jsonb_build_object('status', 'revoked', 'revoked_at', v_revoked_at, 'revoked_by', v_actor_id)
  );

  v_result := jsonb_build_object(
    'invitation_id', v_invitation.id,
    'workspace_id', p_workspace_id,
    'invited_email', v_invitation.invited_email,
    'status', 'revoked',
    'revoked_at', v_revoked_at
  );

  INSERT INTO public.idempotency_records (
    user_id,
    idempotency_key,
    workspace_id,
    operation_name,
    request_hash,
    response_payload
  ) VALUES (
    v_actor_id,
    p_idempotency_key,
    p_workspace_id,
    'revoke_workspace_invitation',
    v_request_hash,
    v_result
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_workspace_invitation(UUID, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_workspace_invitation(UUID, UUID, UUID) TO authenticated;

-- 6.5 Remoção / Revogação de Participante do Workspace (Exclusivo do Owner)
CREATE OR REPLACE FUNCTION public.remove_workspace_member(
  p_workspace_id UUID,
  p_target_user_id UUID,
  p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id UUID;
  v_request_hash TEXT;
  v_existing_response JSONB;
  v_member public.workspace_members%ROWTYPE;
  v_revoked_at TIMESTAMPTZ;
  v_result JSONB;
BEGIN
  v_actor_id := private.assert_workspace_role(p_workspace_id, ARRAY['owner']);

  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_TARGET_USER: Target user ID is required'
      USING ERRCODE = '22023';
  END IF;

  v_request_hash := pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(
        pg_catalog.format('remove_workspace_member:%s:%s', p_workspace_id, p_target_user_id),
        'UTF8'
      )
    ),
    'hex'
  );

  v_existing_response := private.acquire_idempotency_lock_and_get(
    v_actor_id,
    p_idempotency_key,
    p_workspace_id,
    'remove_workspace_member',
    v_request_hash
  );

  SELECT *
  INTO v_member
  FROM public.workspace_members wm
  WHERE wm.workspace_id = p_workspace_id
    AND wm.user_id = p_target_user_id
  FOR UPDATE;

  IF v_existing_response IS NOT NULL THEN
    IF NOT FOUND OR v_member.status <> 'revoked' THEN
      RAISE EXCEPTION 'IDEMPOTENCY_STATE_CHANGED: Member state changed after this removal key was processed'
        USING ERRCODE = '40001';
    END IF;
    RETURN v_existing_response;
  END IF;

  IF NOT FOUND OR v_member.status <> 'active' THEN
    RAISE EXCEPTION 'MEMBER_NOT_ACTIVE: Target user is not an active member of this workspace'
      USING ERRCODE = '22023';
  END IF;

  -- Regra 9.1: o proprietário (owner) jamais pode ser removido
  IF v_member.role = 'owner' OR p_target_user_id = v_actor_id THEN
    RAISE EXCEPTION 'CANNOT_REMOVE_WORKSPACE_OWNER: The workspace owner cannot be removed'
      USING ERRCODE = '42501';
  END IF;

  v_revoked_at := pg_catalog.clock_timestamp();

  UPDATE public.workspace_members
  SET status = 'revoked',
      revoked_at = v_revoked_at,
      revoked_by = v_actor_id
  WHERE id = v_member.id;

  PERFORM private.append_audit_event(
    p_workspace_id,
    v_actor_id,
    'workspace_member',
    v_member.id,
    'workspace_member_removed',
    pg_catalog.format('Acesso do participante %s (papel "%s") revogado', p_target_user_id, v_member.role),
    jsonb_build_object(
      'member_id', v_member.id,
      'user_id', v_member.user_id,
      'role', v_member.role,
      'status', v_member.status
    ),
    jsonb_build_object(
      'member_id', v_member.id,
      'user_id', v_member.user_id,
      'role', v_member.role,
      'status', 'revoked',
      'revoked_at', v_revoked_at,
      'revoked_by', v_actor_id
    )
  );

  v_result := jsonb_build_object(
    'workspace_id', p_workspace_id,
    'member_id', v_member.id,
    'removed_user_id', v_member.user_id,
    'previous_role', v_member.role,
    'status', 'revoked',
    'revoked_at', v_revoked_at
  );

  INSERT INTO public.idempotency_records (
    user_id,
    idempotency_key,
    workspace_id,
    operation_name,
    request_hash,
    response_payload
  ) VALUES (
    v_actor_id,
    p_idempotency_key,
    p_workspace_id,
    'remove_workspace_member',
    v_request_hash,
    v_result
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_workspace_member(UUID, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_workspace_member(UUID, UUID, UUID) TO authenticated;

-- 6.6 Alteração de Papel de Participante (editor <-> viewer) com Controle de Versão (Owner)
CREATE OR REPLACE FUNCTION public.update_workspace_member_role(
  p_workspace_id UUID,
  p_target_user_id UUID,
  p_new_role TEXT,
  p_expected_version INTEGER,
  p_idempotency_key UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id UUID;
  v_clean_role TEXT;
  v_request_hash TEXT;
  v_existing_response JSONB;
  v_member public.workspace_members%ROWTYPE;
  v_updated_version INTEGER;
  v_result JSONB;
BEGIN
  v_actor_id := private.assert_workspace_role(p_workspace_id, ARRAY['owner']);

  v_clean_role := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_new_role, '')));
  IF v_clean_role NOT IN ('editor', 'viewer') THEN
    RAISE EXCEPTION 'INVALID_MEMBER_ROLE: Target role must be editor or viewer'
      USING ERRCODE = '22023';
  END IF;

  IF p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'INVALID_EXPECTED_VERSION: p_expected_version must be a positive integer'
      USING ERRCODE = '22023';
  END IF;

  v_request_hash := pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(
        pg_catalog.format(
          'update_workspace_member_role:%s:%s:%s:%s',
          p_workspace_id,
          p_target_user_id,
          v_clean_role,
          p_expected_version
        ),
        'UTF8'
      )
    ),
    'hex'
  );

  v_existing_response := private.acquire_idempotency_lock_and_get(
    v_actor_id,
    p_idempotency_key,
    p_workspace_id,
    'update_workspace_member_role',
    v_request_hash
  );

  SELECT *
  INTO v_member
  FROM public.workspace_members wm
  WHERE wm.workspace_id = p_workspace_id
    AND wm.user_id = p_target_user_id
  FOR UPDATE;

  IF v_existing_response IS NOT NULL THEN
    IF NOT FOUND
       OR v_member.status <> 'active'
       OR v_member.role <> v_clean_role
       OR v_member.version <> (v_existing_response ->> 'version')::integer
    THEN
      RAISE EXCEPTION 'IDEMPOTENCY_STATE_CHANGED: Member state or version changed after this idempotency key was processed'
        USING ERRCODE = '40001';
    END IF;
    RETURN v_existing_response;
  END IF;

  IF NOT FOUND OR v_member.status <> 'active' THEN
    RAISE EXCEPTION 'MEMBER_NOT_ACTIVE: Target user is not an active member of this workspace'
      USING ERRCODE = '22023';
  END IF;

  IF v_member.role = 'owner' OR p_target_user_id = v_actor_id THEN
    RAISE EXCEPTION 'CANNOT_CHANGE_OWNER_ROLE: The workspace owner role cannot be modified'
      USING ERRCODE = '42501';
  END IF;

  -- Controle de Concorrência Otimista (AGENTS.md §5.2)
  IF v_member.version <> p_expected_version THEN
    RAISE EXCEPTION 'CONFLICT_VERSION_MISMATCH: Expected version %, found version %',
      p_expected_version, v_member.version
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.workspace_members
  SET role = v_clean_role
  WHERE id = v_member.id
  RETURNING version INTO v_updated_version;

  PERFORM private.append_audit_event(
    p_workspace_id,
    v_actor_id,
    'workspace_member',
    v_member.id,
    'workspace_member_role_updated',
    pg_catalog.format('Papel do participante %s alterado de "%s" para "%s"', p_target_user_id, v_member.role, v_clean_role),
    jsonb_build_object('role', v_member.role, 'version', v_member.version),
    jsonb_build_object('role', v_clean_role, 'version', v_updated_version)
  );

  v_result := jsonb_build_object(
    'workspace_id', p_workspace_id,
    'member_id', v_member.id,
    'user_id', v_member.user_id,
    'previous_role', v_member.role,
    'role', v_clean_role,
    'version', v_updated_version
  );

  INSERT INTO public.idempotency_records (
    user_id,
    idempotency_key,
    workspace_id,
    operation_name,
    request_hash,
    response_payload
  ) VALUES (
    v_actor_id,
    p_idempotency_key,
    p_workspace_id,
    'update_workspace_member_role',
    v_request_hash,
    v_result
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.update_workspace_member_role(UUID, UUID, TEXT, INTEGER, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_workspace_member_role(UUID, UUID, TEXT, INTEGER, UUID) TO authenticated;

-- 6.7 Listagem dos Workspaces Ativos do Usuário Autenticado (Sincronização e Reconexão)
CREATE OR REPLACE FUNCTION public.get_my_active_workspaces()
RETURNS TABLE (
  workspace_id UUID,
  workspace_name TEXT,
  currency_code TEXT,
  member_id UUID,
  member_role TEXT,
  member_status TEXT,
  joined_at TIMESTAMPTZ,
  workspace_version INTEGER,
  workspace_updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: Authentication required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    fw.id AS workspace_id,
    fw.name AS workspace_name,
    fw.currency_code,
    wm.id AS member_id,
    wm.role AS member_role,
    wm.status AS member_status,
    wm.joined_at,
    fw.version AS workspace_version,
    fw.updated_at AS workspace_updated_at
  FROM public.workspace_members wm
  INNER JOIN public.financial_workspaces fw
    ON fw.id = wm.workspace_id
  WHERE wm.user_id = v_user_id
    AND wm.status = 'active'
    AND fw.archived_at IS NULL
  ORDER BY fw.created_at ASC, fw.id ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_active_workspaces() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_active_workspaces() TO authenticated;

COMMIT;