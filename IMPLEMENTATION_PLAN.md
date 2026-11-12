# IMPLEMENTATION_PLAN.md

Plano Mestre v2.1 (versão completa no artefato de planejamento aprovado). Este arquivo registra o **estado real** das tarefas. Regras permanentes: [AGENTS.md](./AGENTS.md). Documentação do Design System: [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md).

Execução estritamente incremental: uma tarefa por vez, com aprovação explícita antes da seguinte.

## Fase 1 — Fundação, Auth e Workspaces

| Tarefa | Descrição | Estado |
| :--- | :--- | :--- |
| **T1.1** | Fundação Expo + TS strict + Vitest + ESLint + `Money.ts` | **Concluída** |
| **T1.2** | Design System escuro e componentes base de UI financeira | **Concluída** (ver abaixo) |
| T1.3 | Migração SQL `00001` (identidade, workspaces, auditoria) + guia Supabase | Não iniciada |
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
- Total acumulado na suíte unitária: **4 arquivos de teste, 82 casos de teste aprovados (55 de `Money.test.ts` + 27 de componentes/UI), 0 falhas**.

Critérios de aceite verificados na T1.2:
- [x] `npx tsc --noEmit` sem erros (exit 0)
- [x] `npm run test:unit` aprovado (82/82 testes aprovados)
- [x] `npm run lint` sem erros (exit 0)
- [x] `npx expo-doctor` sem falhas (20/20 verificações aprovadas)
- [x] Compilação do bundle Android aprovada (`943 modules`)
- [x] Compilação do bundle iOS aprovada (`1.145 modules`)

---

## Pendências da Fase 1 (Próximas Tarefas)

- **T1.3:** Migração SQL `00001_identity_workspaces_audit.sql`, documentação `DATABASE.md` / `SECURITY.md` e guia de provisionamento Supabase.
- **T1.4:** Cliente Supabase seguro (`Expo SecureStore`) e cache local SQLite (`Drizzle ORM`).
- **T1.5:** Fluxo de autenticação (`sign-in`, `sign-up`, `forgot-password`).
- **T1.6:** Onboarding atômico (`setup-workspace`) e fluxo de convites/participantes.

## Próximas fases (somente após conclusão da Fase 1)

Fase 2 Contas e Categorias · Fase 3 Receitas/Despesas/Transferências/Backup · Fase 4 Cartões e Faturas · Fase 5 Recorrências · Fase 6 Importação OFX/CSV · Fase 7 Dashboard/Relatórios · Fase 8 Complementares · Fase 9 Estabilização.
