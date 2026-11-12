# Finanças

Aplicativo mobile (Android e iOS) de gestão financeira pessoal e compartilhada, em português do Brasil (BRL).

> Estado atual: **Fase 1 — T1.1** (fundação do projeto). Autenticação, banco de dados e telas financeiras ainda **não** foram implementados.
> Regras permanentes de engenharia: veja [AGENTS.md](./AGENTS.md). Plano e estado das tarefas: [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md).

## Tecnologias

- React Native + Expo SDK 58 + Expo Router
- TypeScript (`strict`, `noUncheckedIndexedAccess`)
- Vitest (testes unitários do domínio)
- ESLint (`eslint-config-expo`)
- Planejado nas próximas tarefas: Supabase (PostgreSQL, Auth, RLS, Realtime), SQLite local (Drizzle), TanStack Query, React Hook Form, Zod.

## Requisitos

- Node.js 22+ e npm 10+
- Pelo menos ~5 GB livres em disco e 2 GB de RAM livres durante `npm install`
- Para testar no celular: app **Expo Go** (Android/iOS) na mesma rede Wi-Fi do computador

## Instalação

```bash
npm install
```

Se `npm install` acusar conflito de peer dependencies, **não** use `--force`; verifique se `react` e `react-dom` estão na mesma versão exigida pelo SDK (`npx expo install --check`).

## Execução

```bash
npm start            # abre o Metro bundler (QR code)
npm run android      # emulador/dispositivo Android
npm run ios          # simulador iOS (somente macOS)
```

No celular: abra o Expo Go e escaneie o QR code exibido no terminal. A tela inicial deve mostrar "Finanças — Fundação do projeto (T1.1)".

## Verificações de qualidade

```bash
npm run typecheck    # tsc --noEmit
npm run test:unit    # vitest run
npm run lint         # eslint .
npx expo-doctor      # saúde do projeto Expo
```

## Configuração

Copie `.env.example` para `.env` somente quando o Supabase for provisionado (T1.3/T1.4). Use apenas a chave pública (anon). **Nunca** coloque a `service_role` key no app.

## Estrutura

```
src/
  app/            rotas Expo Router
  components/     componentes reutilizáveis
  features/       módulos por funcionalidade
  domain/         regras puras (ex.: money/Money.ts — centavos inteiros)
  services/  infrastructure/  database/  sync/  theme/  utils/  tests/
```

Valores monetários são sempre **inteiros em centavos**; nunca use ponto flutuante (AGENTS.md §3).

