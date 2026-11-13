# SECURITY.md — Arquitetura de Segurança, RLS, Auditoria e Guia de Provisionamento Supabase

Este documento descreve os controles de segurança implementados na migração [20261112000001_identity_workspaces_audit.sql](./supabase/migrations/20261112000001_identity_workspaces_audit.sql), o modelo de permissões por workspace, as garantias de integridade dos logs de auditoria e o guia prático para configurar e validar o Supabase localmente ou em projeto remoto de desenvolvimento.

---

## 1. Princípios de Segurança em Profundidade (Defense in Depth)

O backend foi desenhado assumindo que **qualquer requisição vinda do cliente mobile ou da API PostgREST é potencialmente hostil**:

1. **Zero Confiança em Filtros do Cliente:** Nenhuma consulta ou mutação confia em `workspace_id` ou `user_id` enviado pelo cliente sem cruzar com `auth.uid()` no servidor.
2. **Dupla Barreira de Escrita (Privilégios SQL + RLS Forçado):**
   - No nível de privilégios PostgreSQL (`GRANT`/`REVOKE`), os papéis de cliente (`PUBLIC`, `anon`, `authenticated`) têm `INSERT`, `UPDATE` e `DELETE` **revogados** em todas as tabelas estruturais (`financial_workspaces`, `workspace_members`, `workspace_invitations`, `idempotency_records`, `audit_events`, `sync_tombstones`).
   - No nível de linhas, todas as tabelas possuem `ENABLE ROW LEVEL SECURITY` e `FORCE ROW LEVEL SECURITY`.
   - Toda mutação de negócio ocorre exclusivamente via **RPCs transacionais** (`SECURITY DEFINER`) que validam autenticação, papel ativo, versão e idempotência antes de tocar nas tabelas.
3. **Isolamento do Schema `private`:**
   - Funções sensíveis (`private.assert_workspace_role`, `private.append_audit_event`, `private.acquire_idempotency_lock_and_get`) e funções de trigger residem no schema `private`.
   - O schema `private` **não é exposto** no `supabase/config.toml` (`schemas = ["public", "graphql_public"]`) e possui `REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated`.

---

## 2. Matriz de Papéis e Permissões por Workspace

Cada registro em `public.workspace_members` possui `role IN ('owner', 'editor', 'viewer')` e `status IN ('active', 'revoked')`:

| Operação / Recurso | `owner` (Ativo) | `editor` (Ativo) | `viewer` (Ativo) | `revoked` / Externo | `anon` |
| :--- | :---: | :---: | :---: | :---: | :---: |
| Consultar workspace, membros e histórico (`SELECT`) | Permitido | Permitido | Permitido | **Bloqueado** | **Bloqueado** |
| Operações financeiras futuras (Fases 2–6) | Permitido | Permitido | **Bloqueado** | **Bloqueado** | **Bloqueado** |
| Emitir convites (`create_workspace_invitation`) | Permitido (`editor`/`viewer`) | **Bloqueado** | **Bloqueado** | **Bloqueado** | **Bloqueado** |
| Revogar convites (`revoke_workspace_invitation`) | Permitido | **Bloqueado** | **Bloqueado** | **Bloqueado** | **Bloqueado** |
| Alterar papel de membro (`update_workspace_member_role`) | Permitido (`editor` ↔ `viewer`) | **Bloqueado** | **Bloqueado** | **Bloqueado** | **Bloqueado** |
| Remover participante (`remove_workspace_member`) | Permitido (exceto `owner`) | **Bloqueado** | **Bloqueado** | **Bloqueado** | **Bloqueado** |
| Inserir/alterar/apagar `audit_events` diretamente | **Bloqueado** | **Bloqueado** | **Bloqueado** | **Bloqueado** | **Bloqueado** |

### Garantias de Propriedade (`owner`)
- **Proprietário Único Ativo:** O índice único parcial `idx_workspace_single_active_owner ON public.workspace_members (workspace_id) WHERE role = 'owner' AND status = 'active'` impede que qualquer bug ou condição de corrida crie um segundo `owner` ativo.
- **Proibição de Workspace Órfão:** Os constraint triggers deferidos `tg_check_workspace_owner_on_workspace` e `tg_check_workspace_owner_on_members` (`DEFERRABLE INITIALLY DEFERRED`) verificam ao final de toda transação que o workspace possui exatamente 1 `owner` ativo.
- **Impossibilidade de Auto-Remoção ou Rebaixamento do Owner:** Tanto a constraint `chk_workspace_owner_cannot_be_revoked` quanto as RPCs `remove_workspace_member` e `update_workspace_member_role` bloqueiam qualquer tentativa de remover ou alterar o papel do `owner`.

---

## 3. Hardening de Funções `SECURITY DEFINER`

Em conformidade estrita com o [AGENTS.md](./AGENTS.md) §4.2, todas as 16 funções da migração `00001` seguem o padrão:

1. **Declaração explícita de `search_path`:**
   ```sql
   SECURITY DEFINER
   SET search_path = public, pg_temp
   ```
   Além disso, todas as chamadas a funções nativas (`pg_catalog.clock_timestamp()`, `pg_catalog.sha256()`, `pg_catalog.btrim()`, `pg_catalog.pg_advisory_xact_lock()`) e tabelas (`public.*`, `private.*`, `auth.*`) são qualificadas por schema, impedindo ataques de *search_path hijacking* por objetos temporários.
2. **Revogação explícita de privilégios padrão:**
   - `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;`
   - `ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;`
   - Cada RPC pública possui `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION ... TO authenticated;`.
3. **Verificação imediata na 1ª instrução:**
   - RPCs vinculadas a um workspace existente executam `v_actor_id := private.assert_workspace_role(p_workspace_id, ARRAY[...]);` na primeira linha do bloco `BEGIN`.
   - RPCs de contexto do usuário (`create_workspace_with_initial_setup`, `accept_workspace_invitation`, `get_my_active_workspaces`) validam `auth.uid() IS NOT NULL` na primeira linha.

---

## 4. Proteção de Convites, Idempotência e Auditoria

### 4.1 Segurança de Convites (`workspace_invitations`)
- **Entropia e Hash Unidirecional:** O token bruto é gerado a partir do CSPRNG do PostgreSQL (`gen_random_uuid()`) com 64 caracteres hexadecimais e retornado **uma única vez** ao `owner` que emitiu o convite. A tabela `public.workspace_invitations` e os eventos de auditoria armazenam exclusivamente `token_hash = encode(sha256(raw_token), 'hex')`.
- **Vinculação ao E-mail Autenticado e Verificado no Servidor:** Na chamada `accept_workspace_invitation(p_raw_token, p_idempotency_key)`, o servidor bloqueia a linha do convite com `SELECT ... FOR UPDATE`, consulta diretamente `auth.users` (`u.email` e `u.email_confirmed_at`), exige que `email_confirmed_at IS NOT NULL AND email_confirmed_at <= clock_timestamp()` (`EMAIL_NOT_CONFIRMED`) e exige que `u.email = invited_email` (além de consistência com `auth.jwt() ->> 'email'`, sem jamais confiar em `raw_user_meta_data` editável pelo cliente). Assim, contas com e-mail não confirmado ou com outro endereço jamais conseguem aceitar o convite.
- **Prevenção de Reuso e Expiração:** Convites com `status <> 'pending'` ou `expires_at <= clock_timestamp()` são rejeitados imediatamente.

### 4.2 Idempotência, Invalidação Pós-Revogação e Concorrência (`idempotency_records`)
- Toda RPC mutável exige `p_idempotency_key UUID` e invoca `private.acquire_idempotency_lock_and_get(...)`.
- A função adquire locks transacionais `pg_advisory_xact_lock` por `(user_id, idempotency_key)` e por `(workspace_id, idempotency_key)`, serializando chamadas simultâneas (ex.: duplo clique ou reconexão de rede).
- **Validação de Autorização e Estado Atual em Replays Idempotentes:** Uma resposta gravada em `idempotency_records` nunca é tratada como autorização estática. Em `accept_workspace_invitation`, se o usuário foi removido posteriormente (`status = 'revoked'`), repetir a chamada com a mesma `p_idempotency_key` falha com `42501` (`WORKSPACE_ACCESS_REVOKED`) sem restaurar acesso nem informar status ativo. Nas demais RPCs (`create_workspace_invitation`, `revoke_workspace_invitation`, `remove_workspace_member`, `update_workspace_member_role`), se o estado da entidade mudou após a chave original, o replay falha com `40001` (`IDEMPOTENCY_STATE_CHANGED`).
- **Isolamento RLS de `idempotency_records` após Revogação:** A política `idempotency_records_select_self_policy` exige `user_id = auth.uid()` **e** participação ativa com papel compatível no `workspace_id` vinculado. Quando um membro é removido (`status = 'revoked'`), ele perde imediatamente a leitura de respostas históricas de `idempotency_records` daquele workspace.
- Se a mesma chave for reutilizada com **parâmetros diferentes** (`request_hash` ou `operation_name` divergentes), a RPC aborta com erro `22023` (`IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD`).

### 4.3 Imutabilidade da Auditoria (`audit_events`)
- Clientes autenticados possuem apenas permissão de `SELECT` filtrada por RLS (`public.has_workspace_role(workspace_id, ARRAY['owner', 'editor', 'viewer'])`).
- Escritas só ocorrem via `private.append_audit_event(...)`, que exige `p_actor_user_id = auth.uid()` (impedindo personificação de outro usuário).
- O trigger `tg_audit_events_immutable` (`BEFORE UPDATE OR DELETE ON public.audit_events`) bloqueia qualquer alteração ou exclusão direta de linhas de auditoria, mesmo por funções privilegiadas.

---

## 5. Guia de Configuração do Supabase, Migrações e Variáveis de Ambiente

### 5.1 Distinção Crítica entre Chaves Públicas e Segredos Administrativos

| Variável | Onde pode existir | Permissão / Impacto |
| :--- | :--- | :--- |
| `EXPO_PUBLIC_SUPABASE_URL` | App mobile (`.env`), testes locais | URL pública do endpoint da API Supabase |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | App mobile (`.env`), testes locais | Chave pública (`anon`). Sempre sujeita ao JWT do usuário e às políticas **RLS** |
| `SUPABASE_SERVICE_ROLE_KEY` | **NUNCA no app mobile, `.env` do Expo ou repositório Git** | Segredo administrativo com `BYPASSRLS` total. Seu vazamento compromete todos os workspaces |
| `SUPABASE_DB_PASSWORD` / `SUPABASE_ACCESS_TOKEN` | Apenas no terminal do desenvolvedor / cofre de CI | Credenciais administrativas da CLI |

### 5.2 Como Instalar / Executar a Supabase CLI no Projeto

Você não precisa instalar a Supabase CLI globalmente; ela pode ser executada sob demanda via `npx supabase` quando o ambiente de banco estiver ativo:

```bash
# Verificar versão da Supabase CLI
npx --yes supabase --version
```

### 5.3 Opção A — Executar Migrações e Testes Localmente (Requer Docker Desktop Ativo)

> [!WARNING]
> **Atenção ao Consumo de Memória RAM (Máquinas com 8 GB de RAM):**
> A stack local completa do Supabase sobe múltiplos contêineres Docker (Postgres, GoTrue, PostgREST, Realtime, Storage, Studio, Kong), consumindo entre **2,5 GB e 4 GB de RAM**. Feche navegadores pesados e emuladores antes de iniciar o Docker.

1. Inicie o **Docker Desktop** no Windows e aguarde o motor Linux inicializar (`docker info`).
2. Na raiz do projeto, inicie os serviços locais (podendo excluir serviços não utilizados na Fase 1 para economizar RAM):
   ```bash
   npx supabase start -x studio,imgproxy,inbucket,edge-runtime,logflare,vector,supavisor
   ```
3. Aplique/reaplique as migrações locais:
   ```bash
   npx supabase db reset --local
   ```
4. Execute a suíte de testes de banco e RLS (pgTAP):
   ```bash
   npx supabase test db
   ```
5. Ao terminar os testes de banco, pare os contêineres para liberar memória RAM antes de abrir o emulador Android:
   ```bash
   npx supabase stop
   ```

### 5.4 Opção B — Configurar um Projeto Remoto de Desenvolvimento no Supabase Cloud (Sem Peso Local do Docker)

Para máquinas com 8 GB de RAM, um projeto gratuito de desenvolvimento no Supabase Cloud permite desenvolver no celular/emulador sem rodar Docker localmente:

1. Acesse https://supabase.com/dashboard e crie um novo projeto de desenvolvimento (região recomendada: **South America (São Paulo — `sa-east-1`)**).
2. Em **Authentication → Providers → Email**, mantenha o provedor de e-mail habilitado.
3. Em **Project Settings → API**, copie:
   - **Project URL** → `EXPO_PUBLIC_SUPABASE_URL`
   - **Project API Keys (`anon` `public`)** → `EXPO_PUBLIC_SUPABASE_ANON_KEY`
4. Crie o arquivo `.env` local na raiz do projeto (já ignorado pelo `.gitignore`) a partir do `.env.example`:
   ```ini
   EXPO_PUBLIC_SUPABASE_URL=https://<seu-project-ref>.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=<sua-chave-anon-publica>
   ```
5. Para vincular e enviar a migração `00001` ao projeto remoto de desenvolvimento (quando autorizado):
   ```bash
   npx supabase login
   npx supabase link --project-ref <seu-project-ref>
   npx supabase db push --dry-run --remote
   npx supabase db push --remote
   npx supabase db query --remote -f supabase/tests/00001_identity_workspaces_rls.test.sql
   ```
   *(Jamais execute `db reset` contra projetos remotos com dados importantes).*

---

## 6. Riscos e Limitações de Segurança Pendentes de Verificação (`T1.3B` e Próximas Tarefas)

> [!IMPORTANT]
> **Transparência de Estado (`T1.3A` / `T1.3B`):**
> O código SQL da migração `00001` e a suíte pgTAP (`57` asserções em sessão única, sem `PERFORM` ou múltiplas instruções em `lives_ok`/`throws_ok`) foram implementados, auditados e verificados estaticamente pelo teste contratual em TypeScript (`src/tests/db/workspace-rls.test.ts` — `11` testes), mas **ainda não foram aplicados nem executados no banco remoto `financas-dev`** (aguardando autorização explícita do usuário).

1. **Validação Real em Motor PostgreSQL Pendente (`T1.3B`):**
   - Até que `npx supabase db push --remote` e `npx supabase db query --remote -f supabase/tests/00001_identity_workspaces_rls.test.sql` rodem as **57 asserções** de `supabase/tests/00001_identity_workspaces_rls.test.sql` contra o PostgreSQL 15+ do projeto `financas-dev`, a execução real das políticas RLS sob `SET LOCAL ROLE authenticated` / `anon` permanece **pendente de execução no banco remoto**.
2. **Separação entre Testes de Sessão Única (pgTAP) e Testes Multi-Conexão / Integração Externa:**
   - **Coberto em sessão única (`00001_identity_workspaces_rls.test.sql` — 57 asserções):** Controle de versão otimista (`40001`), aquisição de `pg_advisory_xact_lock` verificada em `pg_locks`, unicidade de proprietário ativo e de convite pendente (`23505`), rejeição de `email_confirmed_at IS NULL`, bloqueio de leitura e replay de `idempotency_records` após revogação, e verificação de `prosecdef`/`search_path` em `pg_proc`.
   - **Exige múltiplas conexões simultâneas ou API GoTrue externa:** Disputa física de bloqueio de linha (`SELECT ... FOR UPDATE` com duas transações abertas em paralelo em conexões TCP distintas) e criação real de usuário via endpoint HTTP do Supabase Auth (`/auth/v1/signup` operando com o role `supabase_auth_admin`).
2. **Verificação de E-mail no Provedor de Autenticação (`GoTrue`):**
   - A RPC `accept_workspace_invitation` confia no e-mail presente no JWT (`auth.jwt() ->> 'email'`) / `auth.users.email`. Em produção, a opção **"Confirm email"** do Supabase Auth deve estar obrigatoriamente **ativa** (`enable_confirmations = true`) para impedir que um atacante crie uma conta com o e-mail de outra pessoa sem comprová-lo.
3. **Expurgo Local após Revogação de Membro (`T1.4`):**
   - No servidor, `remove_workspace_member` bloqueia imediatamente qualquer nova leitura ou escrita via RLS. Contudo, a limpeza automática do cache SQLite local no aparelho do membro removido depende do `LocalCacheManager.purgeWorkspace(...)` que será implementado na **Tarefa `T1.4`**.
4. **Limpeza Periódica de `idempotency_records` Expirados:**
   - Registros expirados da mesma chave já são substituídos automaticamente em `private.acquire_idempotency_lock_and_get`, mas uma rotina de expurgo em lote de chaves antigas (`expires_at < clock_timestamp()`) pode ser agendada futuramente para manter a tabela enxuta.