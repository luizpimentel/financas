# DESIGN_SYSTEM.md — Tokens Visuais e Componentes Base (Tema Escuro)

Este documento descreve a arquitetura visual, os tokens semânticos (`src/theme/`) e os componentes reutilizáveis (`src/components/ui/`) do aplicativo financeiro mobile (Android e iOS).

---

## 1. Diretrizes Visuais e Restrições

- **Tema Escuro Nativo (`dark`):** Projetado com fundo quase preto (`#0B0D10`) e superfícies em cinza-ardósia escuro (`#16191E` e `#1F242B`), proporcionando conforto visual, economia em telas OLED e alto contraste para valores monetários.
- **Alinhamento Monetário (`tabular-nums`):** Toda tipografia monetária aplica `fontVariant: ['tabular-nums']`, garantindo alinhamento vertical de centavos e milhares em listas e extratos.
- **Acessibilidade e Redundância Visual:** Nenhum estado financeiro ou de sincronização depende exclusivamente da cor. Todo estado combina **cor semântica + símbolo/ícone + rótulo textual** e atributos `accessibilityRole` / `accessibilityLabel`.
- **Integridade Monetária:** Nenhum componente realiza cálculos com ponto flutuante (`parseFloat` proibido). Todos os componentes recebem e emitem inteiros seguros em centavos (`Cents` de `src/domain/money/Money.ts`).

---

## 2. Tokens do Tema (`src/theme/`)

### 2.1 Cores Semânticas (`src/theme/colors.ts`)

| Categoria | Token | Valor Hex | Uso Principal |
| :--- | :--- | :---: | :--- |
| **Superfícies** | `colors.background.primary` | `#0B0D10` | Fundo principal das telas |
| | `colors.background.surface` | `#16191E` | Cards, blocos de seção e campos de formulário |
| | `colors.background.surfaceSecondary` | `#1F242B` | Pills, botões secundários, modais elevados |
| | `colors.background.surfacePressed` | `#282F38` | Feedback tátil de elementos pressionados |
| | `colors.background.surfaceDisabled` | `#1A1E24` | Fundo de controles desabilitados |
| **Texto** | `colors.text.primary` | `#FFFFFF` | Títulos, valores neutros e textos principais |
| | `colors.text.secondary` | `#9BA3B0` | Subtítulos, rótulos de campo e metadados |
| | `colors.text.muted` | `#6E7683` | Legendas e textos de apoio |
| | `colors.text.disabled` | `#4B525E` | Rótulos e valores desabilitados |
| **Financeiro** | `colors.financial.income` | `#4CAF7D` | Receitas e lançamentos efetivados |
| | `colors.financial.expense` | `#E57373` | Despesas, saídas e itens vencidos |
| | `colors.financial.creditCard` | `#5C9CE6` | Cartões de crédito e faturas abertas |
| | `colors.financial.transfer` | `#90A4AE` | Transferências entre contas e cache |
| | `colors.financial.pending` | `#64B5F6` | Lançamentos pendentes e previstos |
| | `colors.financial.warning` | `#F2C94C` | Alertas e vencimentos próximos |
| **Bordas/Divisores**| `colors.border.subtle` | `#262B33` | Contorno padrão de cards e inputs |
| | `colors.border.focus` | `#5C9CE6` | Borda de campo em foco |
| | `colors.border.error` | `#E57373` | Borda de campo ou alerta em erro |
| | `colors.divider` | `#1E232A` | Linhas divisórias horizontais em listas |

### 2.2 Tipografia (`src/theme/typography.ts`)

| Token | Tamanho / Linha | Peso | Uso |
| :--- | :---: | :---: | :--- |
| `typography.titleLarge` | `24px / 32px` | `700` | Títulos de destaque |
| `typography.titleMedium` | `20px / 28px` | `700` | Título principal no `AppHeader` |
| `typography.titleSmall` | `18px / 24px` | `600` | Títulos de cards, seções e diálogos |
| `typography.subtitle` | `16px / 22px` | `600` | Subtítulos e navegador de mês |
| `typography.body` | `16px / 22px` | `400` | Corpo de texto padrão |
| `typography.bodySmall` | `14px / 20px` | `400` | Descrições secundárias |
| `typography.label` | `14px / 20px` | `600` | Rótulos de botões e campos |
| `typography.caption` | `12px / 16px` | `400` | Legendas e textos auxiliares |
| `typography.errorText` | `12px / 16px` | `500` | Mensagens de erro de validação |
| `typography.moneyDisplay` | `28px / 36px` | `700` | Saldo principal em destaque (`tabular-nums`) |
| `typography.moneyLarge` | `24px / 32px` | `700` | `MoneyInput` e totais de seção (`tabular-nums`) |
| `typography.moneyMedium` | `16px / 22px` | `600` | Valores em linhas de extrato (`tabular-nums`) |
| `typography.moneySmall` | `14px / 20px` | `600` | Valores secundários e previstos (`tabular-nums`) |

### 2.3 Espaçamentos e Dimensões (`src/theme/tokens.ts`)

- **Escala `spacing`:** `xs: 4`, `sm: 8`, `md: 12`, `lg: 16`, `xl: 20`, `xxl: 24`, `xxxl: 32`.
- **Raios de borda `radii`:** `xs: 6`, `sm: 8`, `md: 12`, `lg: 16`, `xl: 20`, `pill: 9999`.
- **Tamanhos de ícones `iconSizes`:** `xs: 14`, `sm: 16`, `md: 20`, `lg: 24`, `xl: 32`.
- **Dimensões mínimas de toque (`sizes`):** `minTouchTarget: 44px`, `buttonHeight: 48px`, `buttonHeightSmall: 38px`, `inputHeight: 54px`, `headerHeight: 56px`.

---

## 3. Catálogo de Componentes Base (`src/components/ui/`)

### 3.1 `AppHeader`
Cabeçalho superior com suporte automático à Safe Area (`useSafeAreaInsets`), título, subtítulo opcional, botão de voltar opcional (`onBackPress`) e área de ações à direita (`rightActions`).

### 3.2 `MonthNavigator`
Navegador mensal (`‹ Mês Ano ›`) apoiado no utilitário puro `src/utils/monthPeriod.ts`. Realiza avanço e retrocesso de meses por aritmética inteira (`year * 12 + (month - 1) + delta`), livre de bugs de fuso horário ou meses com 28/29/30/31 dias.

### 3.3 `MoneyText`
Exibição formatada de valores em centavos (`Cents`) usando `formatBRL` de `Money.ts`. Suporta variantes semânticas (`neutral`, `income`, `expense`, `creditCard`, `transfer`, `pending`, `warning`, `muted`), tamanhos (`sm`, `md`, `lg`, `display`), sinal positivo explícito (`showPlusSign`) e máscara de privacidade (`masked` → `"R$ ••••"`).

### 3.4 `MoneyInput`
Campo numérico com máscara brasileira em centavos e digitação da direita para a esquerda:
- Digitar `1` → `R$ 0,01` (`1` centavo)
- Digitar `2` → `R$ 0,12` (`12` centavos)
- Digitar `3` → `R$ 1,23` (`123` centavos)
- Digitar `4` → `R$ 12,34` (`1234` centavos)
- Apagar (`Backspace`) remove o dígito menos significativo (`R$ 12,34` → `R$ 1,23` → `R$ 0,12` → `R$ 0,01` → `R$ 0,00`).
- Suporta colagem de textos formatados em pt-BR (`"R$ 1.306,00"`, `"12,5"`), validação de limite máximo (`maxCents`) e rejeição de entradas inválidas sem uso de `parseFloat`.

### 3.5 `SyncStatusIndicator`
Indicador visual de estado de sincronização:
- `synced` (`✓ Sincronizado`)
- `syncing` (`⟳ Sincronizando...`)
- `offline` (`☁ Offline`)
- `cached` (`◈ Dados em cache`)
- `error` (`⚠ Erro de sincronização`)

### 3.6 `EmptyState` e `ErrorState`
Componentes padronizados para listas vazias e estados de erro, com ícone, título/mensagem, descrição/detalhes e botão de ação/tentar novamente opcional.

### 3.7 `ConfirmationDialog`
Modal de confirmação com suporte a ação padrão ou destrutiva (`destructive`), feedback visual ao pressionar e tratamento de fechamento pelo botão voltar do Android (`onRequestClose`).

