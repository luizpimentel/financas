-- =============================================================================
-- SUÍTE DE TESTES pgTAP: 00001_identity_workspaces_rls.test.sql
-- =============================================================================
-- Execução remota no Supabase Cloud (sem Docker, transacional com ROLLBACK):
--   npx supabase db query --remote -f supabase/tests/00001_identity_workspaces_rls.test.sql
-- Execução local via Supabase CLI (requer Docker / PostgreSQL ativo):
--   npx supabase test db
--
-- Escopo desta suíte (Sessão Única Transacional):
--   Valida triggers, constraints deferidas, RLS forçado, isolamento entre
--   workspaces, confirmação de e-mail em auth.users, revogação de leitura e de
--   replay em idempotency_records, concorrência otimista (version), advisory
--   locks transacionais e hardening das 16 funções SECURITY DEFINER.
--
-- Nota sobre Testes Multi-Sessão / Integração Externa (documentados em SECURITY.md):
--   Disputas paralelas reais entre duas conexões TCP simultâneas (bloqueio físico
--   em SELECT ... FOR UPDATE) e chamadas HTTP reais à API GoTrue (/auth/v1/signup)
--   exigem duas conexões simultâneas / cliente HTTP externo.
--
-- Dados 100% fictícios (AGENTS.md §1.1.6).
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
SET LOCAL search_path = public, extensions, pg_temp;

SELECT plan(57);

-- -----------------------------------------------------------------------------
-- 1. PREPARAÇÃO DE IDENTIDADES FICTÍCIAS EM auth.users (Executado como postgres)
-- -----------------------------------------------------------------------------
-- Ana, Bruno, Carla e Diego possuem e-mail confirmado no servidor (email_confirmed_at preenchido).
-- Elena possui email_confirmed_at = NULL (não confirmado), mas tenta forjar
-- raw_user_meta_data com {"email_verified": true} para testar a blindagem.
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
VALUES
  ('11111111-1111-4111-8111-111111111101', 'ana.proprietaria@exemplo.test', pg_catalog.clock_timestamp(), '{"display_name": "Ana Proprietária"}'::jsonb),
  ('22222222-2222-4222-8222-222222222202', 'bruno.editor@exemplo.test', pg_catalog.clock_timestamp(), '{"display_name": "Bruno Editor"}'::jsonb),
  ('33333333-3333-4333-8333-333333333303', 'carla.leitora@exemplo.test', pg_catalog.clock_timestamp(), '{"display_name": "Carla Leitora"}'::jsonb),
  ('44444444-4444-4444-8444-444444444404', 'diego.externo@exemplo.test', pg_catalog.clock_timestamp(), '{"display_name": "Diego Externo"}'::jsonb),
  ('55555555-5555-4555-8555-555555555505', 'elena.naoconfirmada@exemplo.test', NULL, '{"display_name": "Elena Não Confirmada", "email_verified": true}'::jsonb);

SELECT is(
  (SELECT COUNT(*)::int FROM public.user_profiles WHERE id IN (
    '11111111-1111-4111-8111-111111111101',
    '22222222-2222-4222-8222-222222222202',
    '33333333-3333-4333-8333-333333333303',
    '44444444-4444-4444-8444-444444444404',
    '55555555-5555-4555-8555-555555555505'
  )),
  5,
  'Trigger tg_handle_new_auth_user sincroniza os 5 perfis automaticamente em public.user_profiles'
);

-- Verifica no catálogo do PostgreSQL que todas as 16 funções SECURITY DEFINER possuem prosecdef = true e search_path fixo
SELECT is(
  (
    SELECT COUNT(*)::int
    FROM pg_catalog.pg_proc p
    INNER JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'private')
      AND p.prosecdef = true
      AND pg_catalog.array_to_string(p.proconfig, ',') LIKE '%search_path=public, pg_temp%'
  ),
  16,
  'Catálogo pg_proc confirma 16 funções SECURITY DEFINER com search_path=public, pg_temp'
);

-- -----------------------------------------------------------------------------
-- 2. TESTE DE INVARIANTE DE PROPRIETÁRIO OBRIGATÓRIO (Sem Owner -> Rejeitado)
-- -----------------------------------------------------------------------------
SAVEPOINT sp_orphan_workspace;
SET CONSTRAINTS tg_check_workspace_owner_on_workspace IMMEDIATE;
SELECT throws_ok(
  $$
    INSERT INTO public.financial_workspaces (id, name, created_by)
    VALUES (
      '99999999-9999-4999-8999-999999999999',
      'Workspace Órfão Inválido',
      '11111111-1111-4111-8111-111111111101'
    )
  $$,
  '23514',
  NULL,
  'Workspace nunca pode ficar sem proprietário ativo ao validar a constraint deferida'
);
ROLLBACK TO SAVEPOINT sp_orphan_workspace;

-- -----------------------------------------------------------------------------
-- 3. REJEIÇÃO DE USUÁRIO NÃO AUTENTICADO (ROLE anon)
-- -----------------------------------------------------------------------------
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.email', '', true);

SELECT throws_ok(
  $$ SELECT public.create_workspace_with_initial_setup('Tentativa Anon', 'a0000000-0000-4000-8000-000000000001') $$,
  '42501',
  NULL,
  'Role anon tem execução revogada em create_workspace_with_initial_setup'
);

SELECT throws_ok(
  $$ SELECT * FROM public.financial_workspaces $$,
  '42501',
  NULL,
  'Role anon não possui permissão de SELECT em public.financial_workspaces'
);

-- Mesmo como role authenticated, se auth.uid() for nulo, a RPC deve rejeitar
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.create_workspace_with_initial_setup('Sem JWT Sub', 'a0000000-0000-4000-8000-000000000002') $$,
  '42501',
  NULL,
  'Usuário sem auth.uid() é rejeitado com UNAUTHENTICATED na criação de workspace'
);

-- -----------------------------------------------------------------------------
-- 4. CRIAÇÃO ATÔMICA DE WORKSPACE E IDEMPOTÊNCIA (ANA = OWNER)
-- -----------------------------------------------------------------------------
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111101","email":"ana.proprietaria@exemplo.test","role":"authenticated"}',
  true
);
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111101', true);
SELECT set_config('request.jwt.claim.email', 'ana.proprietaria@exemplo.test', true);

SELECT lives_ok(
  $$
    SELECT set_config(
      'test.ana_ws_json',
      public.create_workspace_with_initial_setup(
        'Casa Família Silva',
        'b0000000-0000-4000-8000-000000000001'
      )::text,
      true
    )
  $$,
  'Usuária autenticada (Ana) cria workspace atomicamente via create_workspace_with_initial_setup'
);

SELECT is(
  (current_setting('test.ana_ws_json', true)::jsonb ->> 'role'),
  'owner',
  'Retorno da criação do workspace define Ana como owner'
);

SELECT is(
  (SELECT COUNT(*)::int FROM public.financial_workspaces),
  1,
  'Ana visualiza exatamente 1 workspace ativo via RLS'
);

SELECT is(
  (SELECT role FROM public.workspace_members WHERE user_id = '11111111-1111-4111-8111-111111111101'),
  'owner',
  'Registro em public.workspace_members confirma Ana como owner ativa'
);

-- Idempotência: mesma chave + mesmo payload -> retorna o mesmo workspace_id sem duplicar
SELECT is(
  (
    public.create_workspace_with_initial_setup(
      'Casa Família Silva',
      'b0000000-0000-4000-8000-000000000001'
    ) ->> 'workspace_id'
  ),
  (current_setting('test.ana_ws_json', true)::jsonb ->> 'workspace_id'),
  'Idempotência: repetição com mesma chave e mesmo payload retorna o mesmo workspace_id'
);

SELECT is(
  (SELECT COUNT(*)::int FROM public.financial_workspaces),
  1,
  'Idempotência: nenhum workspace duplicado foi criado na repetição'
);

-- Idempotência: mesma chave + payload diferente -> erro
SELECT throws_ok(
  $$
    SELECT public.create_workspace_with_initial_setup(
      'Outro Nome Diferente',
      'b0000000-0000-4000-8000-000000000001'
    )
  $$,
  '22023',
  NULL,
  'Idempotência: reutilizar a mesma chave com payload diferente falha com erro 22023'
);

-- -----------------------------------------------------------------------------
-- 5. AUDITORIA REGISTRADA E BLINDAGEM CONTRA FALSIFICAÇÃO POR CLIENTES
-- -----------------------------------------------------------------------------
SELECT is(
  (SELECT COUNT(*)::int FROM public.audit_events WHERE action = 'workspace_created'),
  1,
  'Evento de auditoria workspace_created foi registrado exatamente 1 vez'
);

SELECT throws_ok(
  $$
    INSERT INTO public.audit_events (
      workspace_id, actor_user_id, entity_type, entity_id, action, summary_text
    ) VALUES (
      (current_setting('test.ana_ws_json', true)::jsonb ->> 'workspace_id')::uuid,
      '11111111-1111-4111-8111-111111111101',
      'financial_workspace',
      (current_setting('test.ana_ws_json', true)::jsonb ->> 'workspace_id')::uuid,
      'fake_event',
      'Tentativa de falsificar auditoria pelo cliente'
    )
  $$,
  '42501',
  NULL,
  'Cliente autenticado não pode executar INSERT direto em public.audit_events'
);

SELECT throws_ok(
  $$ UPDATE public.audit_events SET summary_text = 'Adulterado' $$,
  '42501',
  NULL,
  'Cliente autenticado não pode executar UPDATE em public.audit_events'
);

SELECT throws_ok(
  $$ DELETE FROM public.audit_events $$,
  '42501',
  NULL,
  'Cliente autenticado não pode executar DELETE em public.audit_events'
);

SELECT throws_ok(
  $$
    SELECT private.append_audit_event(
      (current_setting('test.ana_ws_json', true)::jsonb ->> 'workspace_id')::uuid,
      '11111111-1111-4111-8111-111111111101',
      'financial_workspace',
      (current_setting('test.ana_ws_json', true)::jsonb ->> 'workspace_id')::uuid,
      'fake_rpc_event',
      'Tentativa direta no schema private'
    )
  $$,
  '42501',
  NULL,
  'Cliente autenticado não possui acesso ao schema private nem a private.append_audit_event'
);

SELECT throws_ok(
  $$
    SELECT private.assert_workspace_role(
      (current_setting('test.ana_ws_json', true)::jsonb ->> 'workspace_id')::uuid,
      ARRAY['owner']
    )
  $$,
  '42501',
  NULL,
  'Cliente autenticado não possui permissão para invocar private.assert_workspace_role diretamente'
);

-- -----------------------------------------------------------------------------
-- 6. ISOLAMENTO ENTRE WORKSPACES (USUÁRIO EXTERNO DIEGO NÃO ACESSA NADA)
-- -----------------------------------------------------------------------------
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"44444444-4444-4444-8444-444444444404","email":"diego.externo@exemplo.test","role":"authenticated"}',
  true
);
SELECT set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444404', true);
SELECT set_config('request.jwt.claim.email', 'diego.externo@exemplo.test', true);

SELECT is(
  (SELECT COUNT(*)::int FROM public.financial_workspaces),
  0,
  'Usuário externo (Diego) vê 0 workspaces no SELECT filtrado por RLS'
);

SELECT is(
  (SELECT COUNT(*)::int FROM public.workspace_members),
  0,
  'Usuário externo (Diego) vê 0 participantes no SELECT filtrado por RLS'
);

SELECT is(
  (SELECT COUNT(*)::int FROM public.audit_events),
  0,
  'Usuário externo (Diego) vê 0 eventos de auditoria no SELECT filtrado por RLS'
);

SELECT is(
  (SELECT COUNT(*)::int FROM public.user_profiles WHERE id = '11111111-1111-4111-8111-111111111101'),
  0,
  'Usuário externo (Diego) não visualiza o perfil de Ana em public.user_profiles via RLS'
);

-- Tentativa de auto-inserção direta em workspace_members conhecendo o workspace_id
SELECT throws_ok(
  $$
    INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
    VALUES (
      (current_setting('test.ana_ws_json', true)::jsonb ->> 'workspace_id')::uuid,
      '44444444-4444-4444-8444-444444444404',
      'owner',
      'active'
    )
  $$,
  '42501',
  NULL,
  'Usuário externo não pode se auto-associar a um workspace conhecendo seu ID'
);

-- Tentativa de criar convite no workspace de Ana sendo usuário externo
SELECT throws_ok(
  $$
    SELECT public.create_workspace_invitation(
      (current_setting('test.ana_ws_json', true)::jsonb ->> 'workspace_id')::uuid,
      'invasor@exemplo.test',
      'editor',
      'c0000000-0000-4000-8000-000000000001',
      7
    )
  $$,
  '42501',
  NULL,
  'Usuário externo é bloqueado por assert_workspace_role ao tentar criar convite no workspace alheio'
);

-- -----------------------------------------------------------------------------
-- 7. CONVITES SEGUROS: EMISSÃO PELO OWNER, BLOQUEIO DE USO INDEVIDO E ACEITAÇÃO
-- -----------------------------------------------------------------------------
-- Volta para Ana (Owner)
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111101","email":"ana.proprietaria@exemplo.test","role":"authenticated"}',
  true
);
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111101', true);
SELECT set_config('request.jwt.claim.email', 'ana.proprietaria@exemplo.test', true);

-- Não permite convidar como 'owner'
SELECT throws_ok(
  $$
    SELECT public.create_workspace_invitation(
      (current_setting('test.ana_ws_json', true)::jsonb ->> 'workspace_id')::uuid,
      'bruno.editor@exemplo.test',
      'owner',
      'c0000000-0000-4000-8000-000000000002',
      7
    )
  $$,
  '22023',
  NULL,
  'Convite para o papel owner é rejeitado (apenas editor ou viewer são permitidos)'
);

-- Emite convite para Bruno (editor), Carla (viewer) e Elena (viewer, e-mail não confirmado) em instruções individuais
SELECT lives_ok(
  $$
    SELECT set_config(
      'test.invite_bruno_json',
      public.create_workspace_invitation(
        (current_setting('test.ana_ws_json', true)::jsonb ->> 'workspace_id')::uuid,
        'bruno.editor@exemplo.test',
        'editor',
        'c0000000-0000-4000-8000-000000000003',
        7
      )::text,
      true
    )
  $$,
  'Owner (Ana) emite convite para Bruno (editor)'
);

SELECT lives_ok(
  $$
    SELECT set_config(
      'test.invite_carla_json',
      public.create_workspace_invitation(
        (current_setting('test.ana_ws_json', true)::jsonb ->> 'workspace_id')::uuid,
        'carla.leitora@exemplo.test',
        'viewer',
        'c0000000-0000-4000-8000-000000000004',
        7
      )::text,
      true
    )
  $$,
  'Owner (Ana) emite convite para Carla (viewer)'
);

SELECT lives_ok(
  $$
    SELECT set_config(
      'test.invite_elena_json',
      public.create_workspace_invitation(
        (current_setting('test.ana_ws_json', true)::jsonb ->> 'workspace_id')::uuid,
        'elena.naoconfirmada@exemplo.test',
        'viewer',
        'c0000000-0000-4000-8000-000000000005',
        7
      )::text,
      true
    )
  $$,
  'Owner (Ana) emite convite para Elena (viewer)'
);

-- Concorrência / Unicidade: bloqueia segundo convite pendente para o mesmo e-mail com outra chave
SELECT throws_ok(
  $$
    SELECT public.create_workspace_invitation(
      (current_setting('test.ana_ws_json', true)::jsonb ->> 'workspace_id')::uuid,
      'bruno.editor@exemplo.test',
      'editor',
      'c0000000-0000-4000-8000-000000000006',
      7
    )
  $$,
  '23505',
  NULL,
  'Segundo convite pendente simultâneo para o mesmo e-mail é bloqueado com INVITATION_ALREADY_PENDING (23505)'
);

-- Verifica que o banco de dados não armazena o raw_token, apenas seu hash SHA-256
SELECT is(
  (
    SELECT COUNT(*)::int
    FROM public.workspace_invitations
    WHERE token_hash = (current_setting('test.invite_bruno_json', true)::jsonb ->> 'raw_token')
  ),
  0,
  'A tabela workspace_invitations nunca armazena o token bruto em texto puro'
);

-- Elena (usuária com email_confirmed_at = NULL, mas raw_user_meta_data forjado) tenta aceitar convite
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"55555555-5555-4555-8555-555555555505","email":"elena.naoconfirmada@exemplo.test","role":"authenticated"}',
  true
);
SELECT set_config('request.jwt.claim.sub', '55555555-5555-4555-8555-555555555505', true);
SELECT set_config('request.jwt.claim.email', 'elena.naoconfirmada@exemplo.test', true);

SELECT throws_ok(
  $$
    SELECT public.accept_workspace_invitation(
      (current_setting('test.invite_elena_json', true)::jsonb ->> 'raw_token'),
      'd0000000-0000-4000-8000-000000000000'
    )
  $$,
  '42501',
  NULL,
  'Conta com email_confirmed_at nulo em auth.users é bloqueada em accept_workspace_invitation mesmo com raw_user_meta_data forjado'
);

-- Diego (usuário externo com outro e-mail) tenta usar o token vazado de Bruno
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"44444444-4444-4444-8444-444444444404","email":"diego.externo@exemplo.test","role":"authenticated"}',
  true
);
SELECT set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444404', true);
SELECT set_config('request.jwt.claim.email', 'diego.externo@exemplo.test', true);

SELECT throws_ok(
  $$
    SELECT public.accept_workspace_invitation(
      (current_setting('test.invite_bruno_json', true)::jsonb ->> 'raw_token'),
      'd0000000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  NULL,
  'Token de convite não pode ser aceito por usuário autenticado com e-mail diferente do convidado'
);

-- Bruno aceita seu convite
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222202","email":"bruno.editor@exemplo.test","role":"authenticated"}',
  true
);
SELECT set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222202', true);
SELECT set_config('request.jwt.claim.email', 'bruno.editor@exemplo.test', true);

SELECT is(
  (
    public.accept_workspace_invitation(
      (current_setting('test.invite_bruno_json', true)::jsonb ->> 'raw_token'),
      'd0000000-0000-4000-8000-000000000002'
    ) ->> 'role'
  ),
  'editor',
  'Bruno aceita convite válido e ingressa como editor ativo'
);

-- Enquanto ativo no workspace, Bruno consegue consultar seu próprio registro em idempotency_records
SELECT is(
  (
    SELECT COUNT(*)::int
    FROM public.idempotency_records
    WHERE idempotency_key = 'd0000000-0000-4000-8000-000000000002'
  ),
  1,
  'Membro ativo (Bruno) consulta seu próprio registro de idempotência do workspace'
);

-- Tentativa de reutilizar o mesmo convite já aceito com outra chave de idempotência
SELECT throws_ok(
  $$
    SELECT public.accept_workspace_invitation(
      (current_setting('test.invite_bruno_json', true)::jsonb ->> 'raw_token'),
      'd0000000-0000-4000-8000-000000000003'
    )
  $$,
  '42501',
  NULL,
  'Convite já aceito não pode ser reutilizado em nova chamada'
);

-- Carla aceita seu convite como viewer
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"33333333-3333-4333-8333-333333333303","email":"carla.leitora@exemplo.test","role":"authenticated"}',
  true
);
SELECT set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333303', true);
SELECT set_config('request.jwt.claim.email', 'carla.leitora@exemplo.test', true);

SELECT is(
  (
    public.accept_workspace_invitation(
      (current_setting('test.invite_carla_json', true)::jsonb ->> 'raw_token'),
      'd0000000-0000-4000-8000-000000000004'
    ) ->> 'role'
  ),
  'viewer',
  'Carla aceita convite válido e ingressa como viewer ativa'
);

-- Idempotência legítima em accept_workspace_invitation enquanto Carla permanece ativa
SELECT is(
  (
    public.accept_workspace_invitation(
      (current_setting('test.invite_carla_json', true)::jsonb ->> 'raw_token'),
      'd0000000-0000-4000-8000-000000000004'
    ) ->> 'role'
  ),
  'viewer',
  'Repetição idempotente de accept_workspace_invitation por membro ativo (Carla) retorna papel atual'
);

-- Carla não visualiza registros de idempotência pertencentes a Ana (owner)
SELECT is(
  (
    SELECT COUNT(*)::int
    FROM public.idempotency_records
    WHERE user_id = '11111111-1111-4111-8111-111111111101'
  ),
  0,
  'Viewer (Carla) não visualiza registros de idempotency_records de outro usuário (Ana)'
);

-- -----------------------------------------------------------------------------
-- 8. RESTRIÇÕES DE PAPÉIS: EDITOR E VIEWER NÃO EXECUTAM AÇÕES ADMINISTRATIVAS
-- -----------------------------------------------------------------------------
-- Como Carla (viewer), ela lê o workspace mas não pode convidar nem remover ninguém
SELECT is(
  (SELECT COUNT(*)::int FROM public.get_my_active_workspaces()),
  1,
  'Viewer (Carla) consulta seu workspace ativo via get_my_active_workspaces()'
);

SELECT is(
  (SELECT COUNT(*)::int FROM public.user_profiles WHERE id IN (
    '11111111-1111-4111-8111-111111111101',
    '33333333-3333-4333-8333-333333333303'
  )),
  2,
  'Viewer (Carla) visualiza o próprio perfil e o perfil de Ana em public.user_profiles via shares_active_workspace_with'
);

SELECT throws_ok(
  $$
    SELECT public.create_workspace_invitation(
      (current_setting('test.ana_ws_json', true)::jsonb ->> 'workspace_id')::uuid,
      'outro@exemplo.test',
      'viewer',
      'e0000000-0000-4000-8000-000000000001',
      7
    )
  $$,
  '42501',
  NULL,
  'Viewer (Carla) é impedida de emitir convites'
);

-- Como Bruno (editor), não pode emitir convites nem remover participantes
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222202","email":"bruno.editor@exemplo.test","role":"authenticated"}',
  true
);
SELECT set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222202', true);
SELECT set_config('request.jwt.claim.email', 'bruno.editor@exemplo.test', true);

SELECT throws_ok(
  $$
    SELECT public.remove_workspace_member(
      (current_setting('test.ana_ws_json', true)::jsonb ->> 'workspace_id')::uuid,
      '33333333-3333-4333-8333-333333333303',
      'e0000000-0000-4000-8000-000000000002'
    )
  $$,
  '42501',
  NULL,
  'Editor (Bruno) é impedido de remover participantes do workspace'
);

-- -----------------------------------------------------------------------------
-- 9. CONVITE EXPIRADO E REMOÇÃO DE PARTICIPANTE (REVOGAÇÃO IMEDIATA DE ACESSO)
-- -----------------------------------------------------------------------------
-- Volta para Ana (Owner): remove Bruno do workspace e tenta remover a si mesma
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111101","email":"ana.proprietaria@exemplo.test","role":"authenticated"}',
  true
);
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111101', true);
SELECT set_config('request.jwt.claim.email', 'ana.proprietaria@exemplo.test', true);

SELECT throws_ok(
  $$
    SELECT public.remove_workspace_member(
      (current_setting('test.ana_ws_json', true)::jsonb ->> 'workspace_id')::uuid,
      '11111111-1111-4111-8111-111111111101',
      'f0000000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  NULL,
  'Owner (Ana) é proibida de remover a si mesma do workspace (CANNOT_REMOVE_WORKSPACE_OWNER)'
);

SELECT is(
  (
    public.remove_workspace_member(
      (current_setting('test.ana_ws_json', true)::jsonb ->> 'workspace_id')::uuid,
      '22222222-2222-4222-8222-222222222202',
      'f0000000-0000-4000-8000-000000000002'
    ) ->> 'status'
  ),
  'revoked',
  'Owner (Ana) revoga a participação de Bruno via remove_workspace_member'
);

-- Verifica que Bruno perdeu imediatamente o acesso ao workspace, ao idempotency_records e ao replay de idempotência!
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222202","email":"bruno.editor@exemplo.test","role":"authenticated"}',
  true
);
SELECT set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222202', true);
SELECT set_config('request.jwt.claim.email', 'bruno.editor@exemplo.test', true);

SELECT is(
  (SELECT COUNT(*)::int FROM public.get_my_active_workspaces()),
  0,
  'Membro removido (Bruno) perde imediatamente acesso ao workspace em get_my_active_workspaces() e RLS'
);

SELECT is(
  (SELECT COUNT(*)::int FROM public.idempotency_records),
  0,
  'Membro removido (Bruno) perde imediatamente acesso de leitura a idempotency_records do workspace revogado'
);

SELECT throws_ok(
  $$
    SELECT public.accept_workspace_invitation(
      (current_setting('test.invite_bruno_json', true)::jsonb ->> 'raw_token'),
      'd0000000-0000-4000-8000-000000000002'
    )
  $$,
  '42501',
  NULL,
  'Repetição de accept_workspace_invitation com a mesma chave de idempotência após remoção do membro é bloqueada com WORKSPACE_ACCESS_REVOKED (42501)'
);

SELECT is(
  (SELECT COUNT(*)::int FROM public.get_my_active_workspaces()),
  0,
  'Repetição bloqueada de accept_workspace_invitation não restaura o acesso de Bruno ao workspace'
);

-- -----------------------------------------------------------------------------
-- 10. REVOGAÇÃO DE CONVITE, EXPIRAÇÃO E CONTROLE DE CONCORRÊNCIA OTIMISTA
-- -----------------------------------------------------------------------------
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111101","email":"ana.proprietaria@exemplo.test","role":"authenticated"}',
  true
);
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111101', true);
SELECT set_config('request.jwt.claim.email', 'ana.proprietaria@exemplo.test', true);

-- Alteração de papel da Carla (viewer -> editor) com versionamento otimista
SELECT throws_ok(
  $$
    SELECT public.update_workspace_member_role(
      (current_setting('test.ana_ws_json', true)::jsonb ->> 'workspace_id')::uuid,
      '33333333-3333-4333-8333-333333333303',
      'editor',
      99,
      'f0000000-0000-4000-8000-000000000003'
    )
  $$,
  '40001',
  NULL,
  'update_workspace_member_role rejeita p_expected_version divergente com CONFLICT_VERSION_MISMATCH (40001)'
);

SELECT is(
  (
    public.update_workspace_member_role(
      (current_setting('test.ana_ws_json', true)::jsonb ->> 'workspace_id')::uuid,
      '33333333-3333-4333-8333-333333333303',
      'editor',
      1,
      'f0000000-0000-4000-8000-000000000004'
    ) ->> 'version'
  )::int,
  2,
  'update_workspace_member_role atualiza papel da Carla e incrementa version para 2'
);

-- Emite convite para Diego e em seguida o revoga (em asserções SQL puras separadas, sem PERFORM)
SELECT lives_ok(
  $$
    SELECT set_config(
      'test.invite_diego_json',
      public.create_workspace_invitation(
        (current_setting('test.ana_ws_json', true)::jsonb ->> 'workspace_id')::uuid,
        'diego.externo@exemplo.test',
        'viewer',
        'f0000000-0000-4000-8000-000000000005',
        7
      )::text,
      true
    )
  $$,
  'Owner (Ana) cria convite para Diego'
);

SELECT is(
  (
    public.revoke_workspace_invitation(
      (current_setting('test.ana_ws_json', true)::jsonb ->> 'workspace_id')::uuid,
      (current_setting('test.invite_diego_json', true)::jsonb ->> 'invitation_id')::uuid,
      'f0000000-0000-4000-8000-000000000006'
    ) ->> 'status'
  ),
  'revoked',
  'Owner (Ana) revoga o convite de Diego via revoke_workspace_invitation'
);

-- Repetir create_workspace_invitation com a chave antiga após a revogação não pode retornar status 'pending'
SELECT throws_ok(
  $$
    SELECT public.create_workspace_invitation(
      (current_setting('test.ana_ws_json', true)::jsonb ->> 'workspace_id')::uuid,
      'diego.externo@exemplo.test',
      'viewer',
      'f0000000-0000-4000-8000-000000000005',
      7
    )
  $$,
  '40001',
  NULL,
  'Repetição de create_workspace_invitation com chave de convite já revogado falha com IDEMPOTENCY_STATE_CHANGED (40001)'
);

-- Verifica que os advisory locks transacionais (pg_advisory_xact_lock) estão ativos em pg_locks
SELECT is(
  (
    SELECT COUNT(*) > 0
    FROM pg_catalog.pg_locks
    WHERE pid = pg_catalog.pg_backend_pid()
      AND locktype = 'advisory'
      AND granted = true
  ),
  true,
  'Advisory locks transacionais (pg_advisory_xact_lock) de idempotência estão ativos na transação'
);

-- Diego tenta aceitar o convite revogado
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"44444444-4444-4444-8444-444444444404","email":"diego.externo@exemplo.test","role":"authenticated"}',
  true
);
SELECT set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444404', true);
SELECT set_config('request.jwt.claim.email', 'diego.externo@exemplo.test', true);

SELECT throws_ok(
  $$
    SELECT public.accept_workspace_invitation(
      (current_setting('test.invite_diego_json', true)::jsonb ->> 'raw_token'),
      'f0000000-0000-4000-8000-000000000007'
    )
  $$,
  '42501',
  NULL,
  'Convite revogado é rejeitado com INVITATION_REVOKED ao tentar aceitar'
);

-- Simula convite expirado no banco (como postgres) e verifica rejeição como Diego
RESET ROLE;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111101","email":"ana.proprietaria@exemplo.test","role":"authenticated"}',
  true
);
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111101', true);
SELECT set_config('request.jwt.claim.email', 'ana.proprietaria@exemplo.test', true);

SELECT set_config(
  'test.invite_expired_json',
  public.create_workspace_invitation(
    (current_setting('test.ana_ws_json', true)::jsonb ->> 'workspace_id')::uuid,
    'diego.externo@exemplo.test',
    'viewer',
    'f0000000-0000-4000-8000-000000000008',
    1
  )::text,
  true
);

UPDATE public.workspace_invitations
SET created_at = pg_catalog.clock_timestamp() - INTERVAL '3 days',
    expires_at = pg_catalog.clock_timestamp() - INTERVAL '1 hour'
WHERE id = (current_setting('test.invite_expired_json', true)::jsonb ->> 'invitation_id')::uuid;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"44444444-4444-4444-8444-444444444404","email":"diego.externo@exemplo.test","role":"authenticated"}',
  true
);
SELECT set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444404', true);
SELECT set_config('request.jwt.claim.email', 'diego.externo@exemplo.test', true);

SELECT throws_ok(
  $$
    SELECT public.accept_workspace_invitation(
      (current_setting('test.invite_expired_json', true)::jsonb ->> 'raw_token'),
      'f0000000-0000-4000-8000-000000000009'
    )
  $$,
  '42501',
  NULL,
  'Convite expirado é rejeitado com INVITATION_EXPIRED ao tentar aceitar'
);

SELECT * FROM finish(true);
ROLLBACK;
