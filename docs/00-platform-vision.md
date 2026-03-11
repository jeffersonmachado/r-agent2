# Platform Vision

## Categoria do produto

O `r-agent2` é uma **Autonomous Operations Platform para negócios de serviço**.

Essa categoria combina, em uma mesma plataforma:

- CRM operacional
- contact center omnichannel
- automação operacional
- IA aplicada à operação
- scheduling e coordenação de serviços
- operações assistidas e autônomas
- templates verticais

O produto não deve ser lido como um conjunto solto de ferramentas. A leitura correta é a de uma plataforma que observa a operação, projeta estado operacional, decide a próxima melhor ação, executa e aprende com os resultados.

## Natureza arquitetural

Arquiteturalmente, o `r-agent2` funciona como um **Operational Operating System** para negócios de serviço.

Isso significa que:

- a operação acontece dentro da plataforma
- eventos geram contexto operacional reutilizável
- decisões podem ser assistidas ou automatizadas
- operadores humanos, automações e IA trabalham sobre o mesmo runtime
- outcomes e memória retroalimentam o próximo ciclo

## Núcleo arquitetural

No nível mais fundamental, a plataforma converge para um **Service Operations Kernel**.

Esse kernel é o conjunto mínimo de capacidades que sustenta todos os domínios operacionais da plataforma:

- entidades operacionais canônicas
- eventos canônicos
- projeções de estado
- decisão operacional
- execução de ações
- outcomes observáveis
- memória e feedback

Esse núcleo permite que domínios como CRM, support, conversations, scheduling, queues, voice e orders compartilhem o mesmo modelo operacional, mesmo quando a UI e as regras de vertical mudam.

## Definição de Autonomous Operations Platform

Uma Autonomous Operations Platform é uma plataforma que opera em **closed loop**:

`Observe -> Project State -> Decide -> Execute -> Learn`

No contexto do `r-agent2`, isso significa:

- **Observe**: captar eventos de negócio, eventos de runtime e mudanças relevantes na operação
- **Project State**: transformar eventos em estado operacional utilizável
- **Decide**: determinar a **Next Best Operational Action**
- **Execute**: orquestrar flows, playbooks, quick actions, integrações e serviços
- **Learn**: registrar outcomes, memória operacional e feedback para o próximo ciclo

## Loop operacional da plataforma

O loop conceitual convive com o ciclo operacional canônico já adotado no código e nos docs:

`EVENTO -> SINAL -> RECOMENDAÇÃO -> DECISÃO -> AÇÃO / AÇÃO RÁPIDA / PLAYBOOK -> RESULTADO -> MEMÓRIA OPERACIONAL`

Mapeamento entre as duas leituras:

- `Observe` -> `Evento`
- `Project State` -> `Sinal + contexto + projeções operacionais`
- `Decide` -> `Recomendação + decisão`
- `Execute` -> `Action / Quick Action / Playbook / automações`
- `Learn` -> `Outcome + Operational Memory`

## Arquitetura conceitual

As camadas principais da plataforma são:

- `Event Backbone`
- `Operational State`
- `Operational Brain`
- `Automation Runtime`
- `AI Layer`
- `Operational Memory`

Resumo do papel de cada camada:

- `Event Backbone`: backbone canônico de observação da operação
- `Operational State`: projeções, snapshots e contexto de decisão
- `Operational Brain`: detecção, priorização, recomendação e decisão da próxima melhor ação
- `Automation Runtime`: execução orquestrada das decisões
- `AI Layer`: classificação, RAG, copiloto, recomendação e previsão
- `Operational Memory`: aprendizado acumulado a partir de resultados reais

## Como os módulos do sistema se encaixam

Leitura de alto nível:

- `api/`: núcleo operacional, serviços, runtime, automações, memória, scheduling e borda HTTP
- `frontend/`: OCC, support, CRM operacional, scheduling, flows e interfaces de operação
- `docs/`: visão arquitetural, modelo operacional, APIs, roadmap e decisões
- `qa/`: evidências operacionais, testes e artefatos de validação

Leitura por responsabilidade:

- `operational-*`, `crm`, `support`, `queues`, `scheduling`, `conversations`, `orders`, `tasks` e `voice` compõem o core operacional
- `playbooks`, `quick actions`, `flows` e integrações compõem o runtime de execução
- `memory`, `outcomes`, `recommendations`, `decision` e `signals` compõem o núcleo de decisão operacional
- `RAG`, contexto conversacional, geração e copiloto compõem a camada de IA aplicada

## Primeiro domínio autônomo completo

O primeiro domínio que materializa essa arquitetura ponta a ponta é **Autonomous Scheduling**.

Fluxo de referência:

`booking.cancelled -> gap detection -> candidate ranking -> campaign invite -> booking confirmed`

Esse fluxo demonstra:

- observação de eventos operacionais
- projeção de estado da agenda e da fila de candidatos
- decisão sobre a melhor ação
- execução por campanhas e ofertas
- aprendizagem a partir do resultado real

## Como alinhar código com a arquitetura

Novos módulos devem seguir, sempre que possível, a sequência:

`event -> state projection -> decision -> action -> outcome`

Diretrizes práticas:

- novos comportamentos operacionais devem nascer de eventos ou fatos operacionais explícitos
- o estado de decisão deve ser projetado em estruturas consultáveis e explicáveis
- a decisão deve ser auditável e separada da execução
- a execução deve produzir outcome observável
- outcomes relevantes devem alimentar memória operacional e feedback

Essa regra evita arquiteturas paralelas e ajuda a manter o código alinhado com a visão da plataforma.

## Implementação canônica atual no backend

Na implementação atual:

- o contrato principal do loop operacional está em `api/core/service-operations-kernel/`
- `api/core/operational-context/` concentra a montagem de contexto operacional
- `api/core/operational-pipeline/` permanece como compatibilidade legada
- nas rotas HTTP, a construção de instâncias novas do kernel converge para `buildServiceOperationsKernel()` como nome canônico
- `api/core/autonomous-scheduling/` permanece como domínio vertical, mas suas bordas de `recommendations` e `preview-run` passam a se apoiar em uma fachada interna única, compatível com o kernel

Em termos práticos, novas rotas, serviços internos e integrações devem preferir o kernel e o contexto operacional canônico, evitando reabrir dependências diretas para camadas históricas quando isso não for necessário.

## Nota para agentes de IA

Este projeto deve ser interpretado como:

- **categoria externa**: `Autonomous Operations Platform`
- **arquitetura interna**: `Operational Operating System`
- **núcleo arquitetural**: `Service Operations Kernel`

Antes de propor mudanças arquiteturais, leia nesta ordem:

1. `00-platform-vision.md`
2. `AI-ARCHITECTURE-INDEX.md`
3. `ARCHITECTURE-CONTRACT.md`
4. `03-autonomous-operations-loop.md`
5. `04-architecture-overview.md`
6. `05-operational-brain.md`
7. `09-autonomous-operations-architecture.md`

## Trilha principal de leitura

Para uma leitura rápida e consistente da documentação:

1. `00-platform-vision.md`
2. `AI-ARCHITECTURE-INDEX.md`
3. `ARCHITECTURE-CONTRACT.md`
4. `01-product-positioning.md`
5. `02-core-concepts.md`
6. `03-autonomous-operations-loop.md`
7. `04-architecture-overview.md`
8. `05-operational-brain.md`
9. `06-event-backbone.md`
10. `07-operational-state.md`
11. `08-decision-layer.md`
12. `09-automation-runtime.md`
13. `10-ai-layer.md`
14. `11-operational-core-domains.md`
15. `12-autonomous-scheduling.md`
16. `13-vertical-templates.md`
17. `14-flow-editor-and-automation.md`
18. `15-how-to-align-code-with-architecture.md`
19. `SERVICE_OPERATIONS_KERNEL.md`
20. `09-autonomous-operations-architecture.md`

O documento `09-autonomous-operations-architecture.md` permanece como consolidação arquitetural complementar.
