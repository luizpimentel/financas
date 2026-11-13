# IMPLEMENTATION_PLAN.md

Plano Mestre v2.1 (versão completa no artefato de planejamento aprovado). Este arquivo registra o **estado real** das tarefas. Regras permanentes: [AGENTS.md](./AGENTS.md). Documentação do Design System: [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md). Documentação de Banco e Segurança: [DATABASE.md](./DATABASE.md) e [SECURITY.md](./SECURITY.md).

Execução estritamente incremental: uma tarefa por vez, com aprovação explícita antes da seguinte.

## Fase 1 — Fundação, Auth e Workspaces

| Tarefa | Descrição | Estado |
| :--- | :--- | :--- |
| **T1.1** | Fundação Expo + TS strict + Vitest + ESLint + `Money.ts` | **Concluída** |
| **T1.2** | Design System escuro e componentes base de UI financeira | **Concluída** (ver abaixo) |
| **T1.3A** | Arquivos SQL (`00001`), políticas RLS, RPCs, suíte pgTAP e documentação (`DATABASE.md` / `SECURITY.md`) | **Implementada, mas não validada em banco** (ver abaixo) |
| T1.3B | Validação da migração `00001` e execução dos 41 testes pgTAP em banco PostgreSQL/Supabase ativo | Pendente (aguardando ambiente PostgreSQL/Supabase) |
| T1.4 | Cliente Supabase seguro + cache SQLite/Drizzle | Não iniciada |
| T1.5 | Fluxo de autenticação | Não iniciada |
| T1.6 | Onboarding atômico e convites | Não iniciada |

---

## T1.1 — Estado detalhado (Concluída)

Concluído:
- Configuração: `package.json`, `tsconfig.json` (`strict`, `noUncheckedIndexedAccess`, `paths` `@/*` sem `baseUrl`), `app.json`, `vitest.config.mts`, `eslint.config.js`, `.gitignore`, `.env.example`.
- Estrutura de diretórios `src/` conforme o plano.
- `src/domain/money/Money.ts` e `src/domain/money/__tests__/Money.test.ts` (55 casos de teste aprovados).
- Layout e tela inicial mínima do Expo Router (`src/app/_layout.tsx`, `src/app/index.tsx`).
- `README.md` e este arquivo.
- Dependências: Expo SDK 58, Expo Router, `react-dom` 19.3.0 (alinhado ao SDK), ESLint, `eslint-config-expo`, Vitest.

Critérios de aceite verificados:
- [x] `npx tsc --noEmit` sem erros (exit 0)
- [x] `npm run test:unit` aprovado (55/55 testes aprovados em `Money.test.ts`)
- [x] `npm run lint` sem erros (exit 0)
- [x] `npx expo-doctor` sem falhas (20/20 verificações aprovadas)
- [x] Expo inicializa (Metro Bundler compilou `src/app` com sucesso)

---

## T1.2 — Estado detalhado (Concluída)

### Tokens e Tema Escuro (`src/theme/`)
- `src/theme/colors.ts`: Paleta e tokens semânticos (`background`, `text`, `financial`, `state`, `border`, `divider`, `button`).
- `src/theme/typography.ts`: Escala tipográfica completa com `fontVariant: ['tabular-nums']` em todos os estilos monetários (`moneyDisplay`, `moneyLarge`, `moneyMedium`, `moneySmall`).
- `src/theme/tokens.ts`: Escala de espaçamentos (`4px` a `32px`), raios de borda, tamanhos de ícone, alturas mínimas de toque (`44px+`) e estados de opacidade.
- `src/theme/index.ts`: Exportação unificada do tema.

### Utilitários e Componentes Implementados (`src/utils/` e `src/components/ui/`)
- `src/utils/monthPeriod.ts`: Navegação e formatação determinística de mês/ano sem uso de `new Date()`.
- `src/components/ui/AppHeader.tsx`: Cabeçalho reutilizável com título, subtítulo opcional, botão voltar opcional, ações à direita e suporte à Safe Area.
- `src/components/ui/MonthNavigator.tsx`: Seletor mensal (`‹ Mês Ano ›`) com avanço/retrocesso entre anos.
- `src/components/ui/MoneyText.tsx`: Exibição formatada em BRL a partir de centavos inteiros (`Cents`), variantes semânticas, sinal `+` opcional e modo `masked`.
- `src/components/ui/MoneyInput.tsx`: Campo monetário em centavos com digitação da direita para a esquerda (`1` → `R$ 0,01`, `2` → `R$ 0,12`, `3` → `R$ 1,23`, `4` → `R$ 12,34`), exclusão (`Backspace`), colagem de valores pt-BR, validação de limite máximo e zero ponto flutuante.
- `src/components/ui/SyncStatusIndicator.tsx`: Indicador visual demonstrativo para `synced`, `syncing`, `offline`, `cached` e `error`.
- `src/components/ui/EmptyState.tsx`: Estado vazio com ícone, título, descrição e ação opcional.
- `src/components/ui/ErrorState.tsx`: Estado de erro com ícone, mensagem, detalhes opcionais e botão de tentar novamente.
- `src/components/ui/ConfirmationDialog.tsx`: Diálogo modal reutilizável com suporte a variante destrutiva e feedback tátil.
- `src/app/index.tsx`: Catálogo interativo temporário para demonstração e validação no dispositivo Android/iOS com dados 100% fictícios.
- `DESIGN_SYSTEM.md`: Documentação técnica completa dos tokens e componentes.

### Testes Automatizados e Validações da T1.2
- Infraestrutura de testes de componentes React Native no Vitest (`src/tests/rnTestHarness.tsx`, `src/tests/mocks/react-native.tsx`, `src/tests/mocks/react-native-safe-area-context.tsx`, `src/tests/react-dom-server.d.ts`).
- `src/components/ui/__tests__/MoneyText.test.tsx`: 9 casos de teste aprovados.
- `src/components/ui/__tests__/MoneyInput.test.tsx`: 9 casos de teste aprovados.
- `src/components/ui/__tests__/CoreComponents.test.tsx`: 9 casos de teste aprovados.

Critérios de aceite verificados na T1.2:
- [x] `npx tsc --noEmit` sem erros (exit 0)
- [x] `npm run test:unit` aprovado (82/82 testes aprovados na T1.2)
- [x] `npm run lint` sem erros (exit 0)
- [x] `npx expo-doctor` sem falhas (20/20 verificações aprovadas)
- [x] Compilação do bundle Android aprovada (`943 modules`)
- [x] Compilação do bundle iOS aprovada (`1.145 modules`)

---

## T1.3A — Estado detalhado (Implementada, mas não validada em banco)

### Arquivos Criados na T1.3A / Preparados na T1.3B
- `supabase/config.toml`: Configuração local da Supabase CLI isolando o schema `private` fora dos schemas expostos ao PostgREST (`schemas = ["public", "graphql_public"]`).
- `supabase/migrations/20261112000001_identity_workspaces_audit.sql` *(renomeada de `00001_identity_workspaces_audit.sql` na T1.3B para o formato oficial de timestamp de 14 dígitos da Supabase CLI v3.1.0, preservando 100% do conteúdo)*:
  - Schema `private` com `REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated` e `ALTER DEFAULT PRIVILEGES` revogando execução pública de funções.
  - 7 tabelas com chaves primárias, chaves estrangeiras, `CHECK` constraints, índices de sincronização `(workspace_id, updated_at ASC, id ASC)`, `ENABLE ROW LEVEL SECURITY` e `FORCE ROW LEVEL SECURITY`:
    1. `public.user_profiles`
    2. `public.financial_workspaces`
    3. `public.workspace_members` (com `idx_workspace_single_active_owner` e triggers deferidos contra workspace órfão)
    4. `public.workspace_invitations` (com `token_hash` SHA-256 e índice único parcial de convites pendentes por e-mail)
    5. `public.idempotency_records`
    6. `public.audit_events` (`SELECT` apenas para `authenticated` + trigger append-only `tg_audit_events_immutable`)
    7. `public.sync_tombstones`
  - Funções internas e de segurança (`SECURITY DEFINER`, `SET search_path = public, pg_temp`, `REVOKE/GRANT` explícitos):
    - `public.has_workspace_role`, `public.shares_active_workspace_with`, `private.assert_workspace_role`, `private.append_audit_event`, `private.acquire_idempotency_lock_and_get`, `private.tg_touch_updated_at`, `private.tg_handle_new_auth_user`, `private.tg_enforce_workspace_has_active_owner`, `private.tg_protect_audit_events_immutability`.
  - RPCs transacionais de negócio:
    - `public.create_workspace_with_initial_setup`
    - `public.create_workspace_invitation`
    - `public.accept_workspace_invitation`
    - `public.revoke_workspace_invitation`
    - `public.remove_workspace_member`
    - `public.update_workspace_member_role`
    - `public.get_my_active_workspaces`
- `supabase/tests/00001_identity_workspaces_rls.test.sql`: Suíte de 57 asserções pgTAP em sessão única (sem `PERFORM` ou múltiplas instruções em `lives_ok`/`throws_ok`) simulando `SET LOCAL ROLE anon` e `SET LOCAL ROLE authenticated` com claims JWT (`request.jwt.claim.sub`, `request.jwt.claim.email`), cobrindo confirmação de e-mail em `auth.users`, revogação de leitura e replay em `idempotency_records`, concorrência otimista (`40001`), advisory locks (`pg_locks`) e catálogo `pg_proc`.
- `src/tests/db/workspace-rls.test.ts`: Suíte de 11 testes estáticos de contrato SQL executada pelo Vitest.
- `DATABASE.md` e `SECURITY.md`: Documentação da arquitetura de banco, RLS, RPCs, riscos pendentes e guia de provisionamento Supabase CLI / Cloud.

### Diferenciação Estrita de Testes e Validações (T1.3A / T1.3B)
- **Testes implementados e executados nesta máquina:**
  - [x] `npx tsc --noEmit` sem erros (exit 0)
  - [x] `npm run test:unit` aprovado (`5` arquivos de teste, `93/93` testes aprovados: 55 `Money.test.ts` + 27 componentes UI + 11 `workspace-rls.test.ts` de verificação estática do contrato SQL e pgTAP)
  - [x] `npm run lint` sem erros (exit 0)
- **Testes implementados, mas PENDENTES de execução em banco PostgreSQL real (`T1.3B`):**
  - [ ] `supabase/tests/00001_identity_workspaces_rls.test.sql` (57 asserções pgTAP de execução real das migrações, triggers, RPCs e políticas RLS no PostgreSQL — aguardando aprovação explícita do usuário para aplicação e execução no projeto remoto `financas-dev`).

---

## Pendências da Fase 1 (Próximas Tarefas)

- **T1.3B:** Execução e validação real da migração `00001_identity_workspaces_audit.sql` e da suíte pgTAP em instância PostgreSQL/Supabase ativa.
- **T1.4:** Cliente Supabase seguro (`Expo SecureStore`) e cache local SQLite (`Drizzle ORM`).
- **T1.5:** Fluxo de autenticação (`sign-in`, `sign-up`, `forgot-password`).
- **T1.6:** Onboarding atômico (`setup-workspace`) e fluxo de convites/participantes.

## Próximas fases (somente após conclusão da Fase 1)

Fase 2 Contas e Categorias · Fase 3 Receitas/Despesas/Transferências/Backup · Fase 4 Cartões e Faturas · Fase 5 Recorrências · Fase 6 Importação OFX/CSV · Fase 7 Dashboard/Relatórios · Fase 8 Complementares · Fase 9 Estabilização.
