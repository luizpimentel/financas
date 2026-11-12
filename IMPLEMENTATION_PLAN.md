# IMPLEMENTATION_PLAN.md

Plano Mestre v2.1 (versão completa no artefato de planejamento aprovado). Este arquivo registra o **estado real** das tarefas. Regras permanentes: [AGENTS.md](./AGENTS.md).

Execução estritamente incremental: uma tarefa por vez, com aprovação explícita antes da seguinte.

## Fase 1 — Fundação, Auth e Workspaces

| Tarefa | Descrição | Estado |
| :--- | :--- | :--- |
| **T1.1** | Fundação Expo + TS strict + Vitest + ESLint + `Money.ts` | **Concluída** (ver abaixo) |
| T1.2 | Design System escuro e componentes base | Não iniciada |
| T1.3 | Migração SQL `00001` (identidade, workspaces, auditoria) + guia Supabase | Não iniciada |
| T1.4 | Cliente Supabase seguro + cache SQLite/Drizzle | Não iniciada |
| T1.5 | Fluxo de autenticação | Não iniciada |
| T1.6 | Onboarding atômico e convites | Não iniciada |

## T1.1 — Estado detalhado

Concluído:
- Configuração: `package.json`, `tsconfig.json` (`strict`, `noUncheckedIndexedAccess`, `paths` `@/*` sem `baseUrl`), `app.json`, `vitest.config.mts`, `eslint.config.js`, `.gitignore`, `.env.example`.
- Estrutura de diretórios `src/` conforme o plano (`.gitkeep` nos vazios).
- `src/domain/money/Money.ts` e `src/domain/money/__tests__/Money.test.ts` (55 casos de teste aprovados).
- Layout e tela inicial mínima do Expo Router (`src/app/_layout.tsx`, `src/app/index.tsx`).
- `README.md` e este arquivo.
- Dependências: Expo SDK 58, Expo Router, `react-dom` 19.3.0 (alinhado ao SDK), ESLint, `eslint-config-expo`, Vitest.

Critérios de aceite (resultados reais registrados no relatório da tarefa):
- [x] `npx tsc --noEmit` sem erros (exit 0)
- [x] `npm run test:unit` aprovado (55/55 testes aprovados em `Money.test.ts`)
- [x] `npm run lint` sem erros (exit 0)
- [x] `npx expo-doctor` sem falhas (20/20 verificações aprovadas)
- [x] Expo inicializa (Metro Bundler compilou 1.124 módulos de `src/app` com sucesso)

Fora do escopo da T1.1 (não implementado): autenticação, Supabase/migrações, banco de dados, dashboard, cartões, receitas/despesas.

## Registro de incidente (T1.1)

A primeira instalação do ESLint/Vitest falhou: `react-dom@19.3.1` (peer `react ^19.3.1`) conflitava com `react@19.3.0` fixado pelo SDK 58 (ERESOLVE), agravado por pouco espaço em disco (~1,5 GB) e pouca RAM livre no Windows. Correção: `npx expo install react-dom` (19.3.0, versão do SDK) e liberação de espaço em disco. Sem `--force` nem `--legacy-peer-deps`.

## Próximas fases (somente após conclusão da Fase 1)

Fase 2 Contas e Categorias · Fase 3 Receitas/Despesas/Transferências/Backup · Fase 4 Cartões e Faturas · Fase 5 Recorrências · Fase 6 Importação OFX/CSV · Fase 7 Dashboard/Relatórios · Fase 8 Complementares · Fase 9 Estabilização.

