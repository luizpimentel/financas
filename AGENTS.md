# AGENTS.md — Diretrizes Permanentes de Engenharia, Arquitetura e Segurança

Este documento define as **regras obrigatórias e inegociáveis** para qualquer agente de IA ou desenvolvedor que atue neste repositório. Nenhuma implementação, refatoração ou migração pode violar estas diretrizes.

---

## 1. Visão e Escopo do Produto

- **Produto:** Aplicativo mobile (Android e iOS) de gestão financeira pessoal e compartilhada em tempo real (`FinancialWorkspace`), inspirado funcional e visualmente no *Minhas Finanças*.
- **Idioma e Moeda:** Português do Brasil (`pt-BR`) e Real Brasileiro (`BRL`).
- **Stack Oficial:**
  - **Mobile:** React Native + Expo + TypeScript (`strict: true`) + Expo Router + React Hook Form + Zod + TanStack Query + Zustand (apenas estado global mínimo de UI/sessão) + SQLite local (`expo-sqlite` + Drizzle ORM).
  - **Backend:** Supabase (PostgreSQL 15+, Supabase Auth, Row Level Security, Supabase Realtime, PostgreSQL Functions/RPC transacionais).

### 1.1 Restrições Estritas de Escopo (Proibido Implementar)
1. **Zero Inteligência Artificial:** Não usar LLMs, chatbots, OCR por IA ou categorização por IA.
2. **Zero Gráficos:** Não instalar bibliotecas de gráficos e não renderizar gráficos de linha, barra, pizza, rosca ou evolução de saldo. Relatórios devem usar exclusivamente listas, cards, tabelas e percentuais textuais.
3. **Zero Orçamentos e Metas:** Não implementar módulos de orçamento mensal ou metas financeiras nesta versão.
4. **Zero Operações Bancárias Reais / Open Finance:** Não integrar APIs bancárias automáticas nem executar PIX/pagamentos reais.
5. **Zero Recursos Comerciais:** Não implementar planos pagos, assinaturas, paywalls, anúncios ou painel administrativo comercial.
6. **Proteção de Dados das Capturas:** Jamais utilizar nomes, valores ou lançamentos pessoais visíveis nas capturas de referência como seed, mock ou fixture de testes.

---

## 2. Regras Arquiteturais Fundamentais

1. **Fonte Única da Verdade:** O PostgreSQL (Supabase) é a única fonte oficial do estado contábil. O SQLite local é exclusivamente um cache autorizado dos dados do `workspace_id` ativo e repositório de rascunhos locais (`local_drafts`).
2. **Operações Críticas Confirmadas pelo Servidor:** Lançamentos oficiais, efetivações, transferências, compras em cartão, pagamentos de faturas e importações exigem confirmação transacional do PostgreSQL. Sem conectividade, o app permite leitura do cache SQLite e gravação de rascunhos locais (`local_drafts`), sem declarar a operação como efetivada.
3. **Proibição de Lógica Contábil Divergente:** O frontend nunca grava saldos consolidados diretamente no banco. Os cálculos de domínio em TypeScript (`src/domain`) servem para pré-visualização imediata e devem espelhar exatamente as regras executadas pelas RPCs no PostgreSQL.
4. **Desenvolvimento Incremental e Controlado:** Executar uma tarefa/subfase por vez conforme aprovado pelo usuário, validando tipos, lint e testes automatizados antes de avançar.

---

## 3. Integridade Monetária e Regras Contábeis

1. **Proibição Absoluta de Ponto Flutuante (`float` / `double`):**
   - Todos os valores monetários devem ser representados, trafegados e armazenados como **inteiros em centavos (`_cents`)**.
   - No PostgreSQL: `BIGINT NOT NULL`.
   - No TypeScript: inteiros validados (`Number.isSafeInteger`) ou `bigint`, convertidos a partir de strings numéricas sem jamais usar `parseFloat(v) * 100`.
2. **Separação entre Regime de Competência (Consumo no Cartão) e Regime de Caixa (Contas):**
   - Compras no cartão de crédito (`credit_card_purchases` / `credit_card_installments`) **NUNCA** reduzem diretamente o saldo atual de uma conta bancária.
   - O **Saldo Atual** da conta bancária só é alterado por:
     - `transactions` com `status = 'settled'` (`income`, `expense`, `balance_adjustment`);
     - `transfers` com `status = 'settled'`;
     - `invoice_payments` com `status = 'settled'`.
   - O **Saldo Previsto** da conta bancária projeta até o horizonte selecionado: o saldo efetivado + receitas/despesas/transferências pendentes + o **saldo restante em aberto (`remaining_amount_cents`) das faturas vinculadas àquela conta**, evitando dupla subtração entre compras de cartão e pagamento de fatura.
3. **Distribuição Exata de Centavos em Parcelamentos:**
   - Para valor total $T$ (em centavos) em $N$ parcelas: $Q = \lfloor T / N \rfloor$ e $R = T \bmod N$.
   - As primeiras $R$ parcelas recebem $Q + 1$ centavos e as $N - R$ parcelas restantes recebem $Q$ centavos, garantindo $\sum_{i=1}^{N} \text{parcela}(i) = T$.
4. **Limite do Cartão de Crédito:**
   - O limite utilizado de um cartão é a soma de `GREATEST(total_amount_cents - paid_amount_cents, 0)` de todas as faturas abertas/fechadas/futuras daquele cartão (comprometendo o valor total das compras parceladas ainda não quitadas).

---

## 4. Segurança, RLS, `SECURITY DEFINER` e Auditoria

1. **Isolamento por Workspace (Row Level Security):**
   - Todas as tabelas do schema `public` devem ter `ENABLE ROW LEVEL SECURITY` e `FORCE ROW LEVEL SECURITY` quando aplicável.
   - Nenhuma consulta ou mutação pode confiar apenas em filtros enviados pelo cliente.
2. **Regras Rígidas para Funções `SECURITY DEFINER`:**
   - Toda função `SECURITY DEFINER` deve declarar explicitamente `SET search_path = public, pg_temp` (ou qualificar 100% dos objetos com `public.` / `private.` / `auth.`).
   - É obrigatório revogar execução pública padrão:
     ```sql
     REVOKE ALL ON FUNCTION public.<function_name>(...) FROM PUBLIC, anon;
     GRANT EXECUTE ON FUNCTION public.<function_name>(...) TO authenticated;
     ```
   - A primeira instrução de qualquer RPC `SECURITY DEFINER` deve validar `auth.uid() IS NOT NULL` e verificar participação/papel ativo no workspace via `private.assert_workspace_role(p_workspace_id, ARRAY[...])`.
3. **Proteção de Eventos de Auditoria (`audit_events`):**
   - Clientes (`anon`, `authenticated`) possuem apenas permissão de `SELECT` em `public.audit_events` (filtrada por RLS do workspace).
   - `INSERT`, `UPDATE` e `DELETE` em `public.audit_events` são **estritamente revogados** de `PUBLIC, anon, authenticated`.
   - A gravação de auditoria deve ocorrer exclusivamente via função interna `private.append_audit_event(...)` (no schema `private`, não exposto ao PostgREST e sem `GRANT EXECUTE` para `authenticated`), chamada apenas por triggers ou RPCs transacionais confiáveis no servidor usando `auth.uid()`.
4. **Segredos e Sessão:**
   - Nunca incluir `SUPABASE_SERVICE_ROLE_KEY` ou credenciais administrativas no código mobile, `.env` público ou testes cliente.
   - Armazenar tokens de sessão no mobile exclusivamente via `expo-secure-store`.
   - Limpar integralmente o cache SQLite do workspace em caso de `logout` ou revogação de membro (`status = 'revoked'`).

---

## 5. Concorrência, Idempotência e Sincronização

1. **Idempotência Obrigatória:**
   - Toda RPC que cria lançamentos, transferências, compras parceladas, pagamentos de fatura ou lotes de importação deve exigir `p_idempotency_key UUID`, protegida por `pg_advisory_xact_lock` e registrada em `public.idempotency_records`.
2. **Controle de Concorrência Otimista e Pessimista:**
   - Edições de registros existentes devem validar `version = p_expected_version` e incrementar `version = version + 1`. Nunca aplicar *Last Write Wins* silencioso.
   - Pagamentos de fatura (`register_invoice_payment`) devem bloquear a linha da fatura com `SELECT ... FOR UPDATE` e rejeitar pagamentos onde `p_amount_cents > remaining_amount_cents`.
3. **Sincronização Incremental Segura:**
   - Utilizar cursor composto `(updated_at, id)` ordenado por `updated_at ASC, id ASC` com timestamps gerados exclusivamente pelo servidor (`clock_timestamp()`).
   - Exclusões/cancelamentos/arquivamentos devem atualizar `updated_at` para propagar o estado aos dispositivos sincronizados.
4. **Deduplicação OFX/CSV Invariante à Ordem e Sobreposição:**
   - Priorizar `(account_id, external_fitid)` quando o `FITID` for válido e único.
   - Para o fallback determinístico (`deterministic_fingerprint`), calcular o índice de ocorrência (`intra_day_rank`) agrupando apenas transações idênticas **dentro do mesmo dia contábil (`posted_date`)**, tornando o hash invariante à ordem de exportação (ascendente/descendente) e à sobreposição de períodos entre arquivos.

---

## 6. Padrões de Qualidade, Migrações e Testes

1. **Ordem Topológica Estrita de Migrações SQL (`supabase/migrations/`):**
   - Nenhuma migração pode referenciar tabelas ainda não criadas. Novas chaves estrangeiras entre módulos de fases posteriores devem ser adicionadas na migração da respectiva fase via `ALTER TABLE`.
2. **Backup e Recuperação Antes de Uso Real:**
   - Manter rotina funcional de exportação/restauração de snapshot estruturado do workspace com verificação de integridade antes de liberar o sistema para dados reais.
3. **Definição de Pronto (DoD) por Tarefa:**
   - `npx tsc --noEmit` sem erros;
   - Testes unitários/integração da tarefa passando;
   - Políticas RLS e permissões verificadas;
   - Documentação correspondente atualizada.

