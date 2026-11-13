/// <reference types="node" />
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Verificação estática de contrato de banco de dados e invariantes de segurança (T1.3A).
 *
 * IMPORTANTE:
 * Esta suíte valida estaticamente a estrutura, constraints, políticas RLS,
 * `SECURITY DEFINER`, `SET search_path` e `REVOKE/GRANT` da migração `00001` e
 * a integridade da suíte pgTAP (`00001_identity_workspaces_rls.test.sql`).
 *
 * Ela NÃO substitui a execução real da suíte pgTAP contra uma instância ativa
 * do PostgreSQL/Supabase (prevista para a etapa T1.3B).
 */

const ROOT_DIR = resolve(__dirname, '../../..');
const CONFIG_PATH = resolve(ROOT_DIR, 'supabase/config.toml');
const MIGRATION_FILENAME = '20261112000001_identity_workspaces_audit.sql';
const MIGRATION_00001_PATH = resolve(
  ROOT_DIR,
  `supabase/migrations/${MIGRATION_FILENAME}`,
);
const PGTAP_00001_PATH = resolve(
  ROOT_DIR,
  'supabase/tests/00001_identity_workspaces_rls.test.sql',
);

const REQUIRED_TABLES = [
  'user_profiles',
  'financial_workspaces',
  'workspace_members',
  'workspace_invitations',
  'idempotency_records',
  'audit_events',
  'sync_tombstones',
] as const;

const REQUIRED_PUBLIC_RPCS = [
  'has_workspace_role',
  'shares_active_workspace_with',
  'create_workspace_with_initial_setup',
  'create_workspace_invitation',
  'accept_workspace_invitation',
  'revoke_workspace_invitation',
  'remove_workspace_member',
  'update_workspace_member_role',
  'get_my_active_workspaces',
] as const;

const REQUIRED_PRIVATE_FUNCTIONS = [
  'tg_touch_updated_at',
  'tg_handle_new_auth_user',
  'tg_enforce_workspace_has_active_owner',
  'tg_protect_audit_events_immutability',
  'assert_workspace_role',
  'append_audit_event',
  'acquire_idempotency_lock_and_get',
] as const;

describe('T1.3A — Contrato estático da migração 00001 e blindagem de segurança SQL', () => {
  it('possui os arquivos de configuração Supabase, migração 00001 e testes pgTAP', () => {
    expect(existsSync(CONFIG_PATH)).toBe(true);
    expect(existsSync(MIGRATION_00001_PATH)).toBe(true);
    expect(existsSync(PGTAP_00001_PATH)).toBe(true);
  });

  it('garante que supabase/config.toml nunca expõe o schema private no PostgREST', () => {
    const configToml = readFileSync(CONFIG_PATH, 'utf8');
    const schemasLine = configToml
      .split(/\r?\n/)
      .find((line) => line.trim().startsWith('schemas'));

    expect(schemasLine).toBeDefined();
    expect(schemasLine).toContain('"public"');
    expect(schemasLine).not.toContain('"private"');
  });

  it('envolve a migração 00001 em transação atômica (BEGIN / COMMIT) e cria o schema private protegido', () => {
    const sql = readFileSync(MIGRATION_00001_PATH, 'utf8');

    expect(sql).toMatch(/^\s*(?:--[^\n]*\n|\s)*BEGIN;/);
    expect(sql).toMatch(/COMMIT;\s*$/);
    expect(sql).toContain('CREATE SCHEMA IF NOT EXISTS private;');
    expect(sql).toContain('REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public\n  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;',
    );
    expect(sql).toContain(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA private\n  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;',
    );
  });

  it('cria todas as 7 tabelas previstas na T1.3 com ENABLE e FORCE ROW LEVEL SECURITY', () => {
    const sql = readFileSync(MIGRATION_00001_PATH, 'utf8');

    for (const table of REQUIRED_TABLES) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`);
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY;`);
    }
  });

  it('garante o índice único parcial de proprietário único ativo e o trigger deferido contra workspace órfão', () => {
    const sql = readFileSync(MIGRATION_00001_PATH, 'utf8');

    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_single_active_owner\s+ON public\.workspace_members\s*\(workspace_id\)\s+WHERE role = 'owner' AND status = 'active';/,
    );
    expect(sql).toContain('CREATE CONSTRAINT TRIGGER tg_check_workspace_owner_on_workspace');
    expect(sql).toContain('CREATE CONSTRAINT TRIGGER tg_check_workspace_owner_on_members');
    expect(sql).toContain('DEFERRABLE INITIALLY DEFERRED');
  });

  it('exige SET search_path = public, pg_temp em 100% das funções SECURITY DEFINER (AGENTS.md §4.2)', () => {
    const sql = readFileSync(MIGRATION_00001_PATH, 'utf8');

    const functionBlocks = sql.match(
      /CREATE OR REPLACE FUNCTION[\s\S]*?\$\$[\s\S]*?\$\$;/g,
    );
    expect(functionBlocks).not.toBeNull();
    expect((functionBlocks ?? []).length).toBe(
      REQUIRED_PUBLIC_RPCS.length + REQUIRED_PRIVATE_FUNCTIONS.length,
    );

    for (const block of functionBlocks ?? []) {
      expect(block).toContain('SECURITY DEFINER');
      expect(block).toContain('SET search_path = public, pg_temp');
    }
  });

  it('define todas as funções privadas e RPCs públicas com REVOKE/GRANT explícitos', () => {
    const sql = readFileSync(MIGRATION_00001_PATH, 'utf8');

    for (const fn of REQUIRED_PUBLIC_RPCS) {
      expect(sql).toContain(`CREATE OR REPLACE FUNCTION public.${fn}(`);
      expect(sql).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon;`),
      );
      expect(sql).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO authenticated`),
      );
    }

    for (const fn of REQUIRED_PRIVATE_FUNCTIONS) {
      expect(sql).toContain(`CREATE OR REPLACE FUNCTION private.${fn}(`);
      expect(sql).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION private\\.${fn}\\([^)]*\\)\\s*FROM PUBLIC, anon`),
      );
    }

    // Funções críticas de asserção e escrita de auditoria nunca podem ser executadas por authenticated
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION private.assert_workspace_role(UUID, TEXT[]) FROM PUBLIC, anon, authenticated;',
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION private\.append_audit_event\([^)]*\)\s+FROM PUBLIC, anon, authenticated;/,
    );
  });

  it('protege public.audit_events contra escrita direta de clientes e contra mutação (Append-Only)', () => {
    const sql = readFileSync(MIGRATION_00001_PATH, 'utf8');

    expect(sql).toContain('CREATE TRIGGER tg_audit_events_immutable');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON public.audit_events');
    expect(sql).toContain('CREATE POLICY audit_events_select_policy');
    // Não pode haver política FOR INSERT, FOR UPDATE ou FOR DELETE TO authenticated em audit_events
    expect(sql).not.toMatch(
      /ON public\.audit_events\s+FOR\s+(?:INSERT|UPDATE|DELETE|ALL)\s+TO\s+authenticated/i,
    );
  });

  it('valida que as RPCs administrativas de workspace exigem assert_workspace_role na 1ª instrução', () => {
    const sql = readFileSync(MIGRATION_00001_PATH, 'utf8');
    const ownerRpcs = [
      'create_workspace_invitation',
      'revoke_workspace_invitation',
      'remove_workspace_member',
      'update_workspace_member_role',
    ];

    for (const rpc of ownerRpcs) {
      const match = sql.match(
        new RegExp(
          `CREATE OR REPLACE FUNCTION public\\.${rpc}\\([\\s\\S]*?BEGIN\\s+(?:--[^\\n]*\\n\\s*)*v_actor_id := private\\.assert_workspace_role\\(p_workspace_id, ARRAY\\['owner'\\]\\);`,
        ),
      );
      expect(match).not.toBeNull();
    }
  });

  it('restringe leitura de idempotency_records a membros ativos com papel compatível e valida estado atual em replays', () => {
    const sql = readFileSync(MIGRATION_00001_PATH, 'utf8');

    expect(sql).toContain('CREATE POLICY idempotency_records_select_self_policy');
    expect(sql).toContain(
      "operation_name = 'accept_workspace_invitation'\n        AND public.has_workspace_role(workspace_id, ARRAY['owner', 'editor', 'viewer'])",
    );
    expect(sql).toContain('WORKSPACE_ACCESS_REVOKED');
    expect(sql).toContain('IDEMPOTENCY_STATE_CHANGED');
    expect(sql).toContain('EMAIL_NOT_CONFIRMED');
    expect(sql).toContain('u.email_confirmed_at');
    expect(sql).not.toContain('pg_catalog.position');
    expect(sql).toContain('pg_catalog.strpos(');
  });

  it('mantém a suíte pgTAP sincronizada com plan(57), sem PERFORM ou múltiplas instruções em lives_ok/throws_ok', () => {
    const tapSql = readFileSync(PGTAP_00001_PATH, 'utf8');

    const planMatch = tapSql.match(/SELECT\s+plan\((\d+)\);/);
    expect(planMatch).not.toBeNull();
    const plannedCount = Number(planMatch?.[1] ?? 0);
    expect(plannedCount).toBe(57);

    const assertions = tapSql.match(/SELECT\s+(?:is|lives_ok|throws_ok)\s*\(/g) ?? [];
    expect(assertions.length).toBe(plannedCount);

    // Nenhuma string SQL passada para lives_ok/throws_ok pode conter PERFORM (PL/pgSQL) nem múltiplas instruções SQL
    const dynamicSqlBlocks = Array.from(
      tapSql.matchAll(/SELECT\s+(?:lives_ok|throws_ok)\s*\(\s*\$\$([\s\S]*?)\$\$/g),
      (m) => (m[1] ?? '').trim(),
    );
    expect(dynamicSqlBlocks.length).toBeGreaterThan(0);
    for (const block of dynamicSqlBlocks) {
      expect(block).not.toMatch(/\bPERFORM\b/i);
      expect(block).not.toContain(';');
    }

    expect(tapSql).toContain('SET LOCAL ROLE anon;');
    expect(tapSql).toContain('SET LOCAL ROLE authenticated;');
    expect(tapSql).toContain('SELECT * FROM finish(true);');
  });
});
