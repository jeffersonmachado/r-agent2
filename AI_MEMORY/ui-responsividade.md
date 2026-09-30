# Responsividade da UI — auditoria medida e correções (2026-09-29)

Auditoria automatizada no browser real (Playwright + `tests/helpers/playwrightAuth.js`), **20 páginas
× 3 viewports** (390, 768, 1366), com medição no DOM — não por impressão visual. Evidências em
`AI_MEMORY/evidence/responsive-audit-2026-09-29.json`, `AI_MEMORY/evidence/mobile-390/` (capturas +
`classificacao-390.json` + `colisoes-390.json`).

## O que foi medido

- **Overflow horizontal de página: 0 em 60 medições.** Nenhuma rota cria barra de rolagem horizontal
  no `documentElement`.
- **Conteúdo inalcançável: 0.** Tudo que passa da borda está dentro de um ancestral com
  `overflow-x: auto|scroll` (painéis de tabela/kanban com rolagem própria) — classificador separa
  "alcançável por rolagem" de "cortado por `overflow: hidden`".
- **Colisões entre controles** (sobreposição ≥35% entre elementos interativos) e **alvos de toque
  < 28px**: eram os defeitos reais.

## Defeito 1 — filtros esmagados no mobile (corrigido)

Causa objetiva: em `@media (max-width: 900px)` o `.support-controls` vira
`grid-template-columns: 40px 40px 40px minmax(0,1fr) 48px` — template pensado para os **botões-ícone
do cabeçalho de atendimento** (status/atualizar/notificações/nova conversa), não para os **filtros**
de Caixa de Entrada / Chamados, que usam a MESMA classe.

Medido a 390px, antes da correção:

| página | colisão |
|---|---|
| `/inbox` | input de **18px** de largura sobre outro input (53%) |
| `/cases` | select de **18px** sob o botão "Atualizar" (82%) |

Correção (`frontend/src/index.css`, bloco `@media (max-width: 640px)`): `.support-controls:has(> label)`
passa a uma coluna — cada filtro em sua linha, controle com ~210px utilizáveis; barras só com
botões-ícone (cabeçalho de atendimento) permanecem inalteradas. Sem `:has()`, a regra é ignorada
(comportamento anterior), então não há regressão possível por falta de suporte.

## Defeito 2 — widget flutuante cobrindo conteúdo (corrigido)

`AskAiWidget` (fixo em `bottom-6 left-6`) cobria controles do conteúdo: **95%** do botão "Ver
detalhes" (`/analytics`) e **69%** de uma aba da tela de configuração.

Correção em duas frentes:
1. `AskAiWidget.jsx`: em telas ≤640px o widget **nasce recolhido** (círculo de 48px) — guarda
   `matchMedia` para não quebrar jsdom.
2. `.rap-page { padding-bottom: 84px }` em ≤640px: o fim da página sai de trás do widget.

Provado por medição: rolando até o fim de `/config` e `/audit`, **nenhum controle do conteúdo**
permanece coberto. O que ainda intersecta o widget na posição inicial é conteúdo que rola (a
sobreposição é transitória) — comportamento inerente a botão flutuante.

## Ressalva honesta

- `/workspace` tem 8 elementos interativos além da borda direita a 390px, **todos dentro do
  `workspace-shell`** (rolagem horizontal própria) — alcançáveis, não é defeito.
- Sobram alvos de toque < 28px em algumas telas (2-3 por página em `/inbox`, `/cases`,
  `/analytics`, `/crm/contacts`): legibilidade de toque pode melhorar, mas não há corte nem
  sobreposição. Não foi alterado para não mexer em tamanho de botão em massa neste ciclo.
- A auditoria cobre as 20 rotas de maior uso; as demais 110 rotas do menu não foram varridas.

## Como reproduzir

Os scripts da auditoria vivem em `/tmp` (ferramenta de diagnóstico, não suíte governada). Para
repetir: subir o frontend dev (`npm run dev:frontend`), autenticar e, por rota/viewport, medir
`documentElement.scrollWidth - clientWidth`, classificar elementos fora da viewport por
`overflow-x` dos ancestrais e comparar pares de elementos interativos por interseção de retângulos.
