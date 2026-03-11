# How to Align Code with Architecture

## Regra principal

Novos módulos devem seguir, sempre que possível, a sequência:

`event -> state -> decision -> action -> outcome`

## Interpretação prática

- **event**: tornar o fato operacional explícito
- **state**: projetar contexto suficiente para decisão
- **decision**: decidir de forma auditável e explicável
- **action**: executar por runtime, quick action, playbook, flow ou serviço
- **outcome**: registrar o que aconteceu

## Porta de entrada recomendada no código

Quando a necessidade for compor o ciclo operacional completo, a entrada recomendada passa a ser:

- `api/core/service-operations-kernel/ServiceOperationsKernel.js`

Quando houver código legado usando:

- `api/core/operational-pipeline`
- `api/core/operational-agent/OperationalCanonicalPipelineService.js`

o objetivo deve ser **delegar ao kernel**, e não reconstruir um novo pipeline paralelo.

## O que isso evita

- lógica escondida só na borda HTTP
- automações sem evento claro
- execução sem outcome
- decisões implícitas misturadas com execução
- arquiteturas paralelas fora do modelo operacional

## Checklist para novos módulos

- existe um evento ou fato operacional explícito?
- existe estado projetado suficiente para decidir?
- a decisão está separada da execução?
- a execução produz outcome observável?
- o outcome ou feedback alimenta memória operacional?

## Checklist para refatorações

- a mudança aproxima o módulo do loop `Observe -> Project State -> Decide -> Execute -> Learn`?
- a mudança reduz duplicidade entre decisão e execução?
- a mudança melhora explicabilidade operacional?
- a mudança preserva o ciclo canônico `evento -> sinal -> recomendação -> decisão -> ação -> resultado -> memória`?

## Referências

- visão do produto: `00-platform-vision.md`
- arquitetura geral: `04-architecture-overview.md`
- brain: `05-operational-brain.md`
- backbone de eventos: `06-event-backbone.md`
- estado operacional: `07-operational-state.md`
- decisão: `08-decision-layer.md`
- runtime: `09-automation-runtime.md`

## Regra específica para rotas DELETE

Rotas de exclusão não devem concentrar remoção direta de banco, cache ou filesystem na borda HTTP.

Preferir:

- `DELETE route -> service/handler canônico -> resposta`

## Método recomendado para DELETE

O método mais eficiente no projeto é escolher a estratégia de exclusão pelo tipo de recurso, em vez de aplicar o mesmo comportamento para tudo.

Fluxo recomendado:

- `DELETE route -> validate/auth -> domain delete service -> response`

Matriz de decisão:

- recurso raiz com muitas dependências e dados distribuídos
  usar `purge transacional`
- recurso operacional com histórico, auditoria ou analytics
  usar `soft delete` ou `deactivate`
- artefato técnico simples em filesystem ou storage
  usar `storage/file service`
- recurso cujo delete dispara webhook, evento ou cleanup adicional
  usar `delete handler` dedicado

## Convenção de nomes

Para manter previsibilidade:

- purge amplo: `SomethingPurgeService`
- exclusão de domínio: `domainService.deleteSomething()`
- desativação histórica: `domainService.deactivateSomething()`
- artefato em arquivo: `somethingStorageService` ou `somethingFileService`
- exclusão com efeitos colaterais de runtime: `somethingDeleteHandler`

Exemplos canônicos já existentes:

- `tenantPurgeService`
- `schedulingService.deleteBlock()`
- `flowDeleteHandler`
- `rpaReplayService`

## Checklist para implementar um novo DELETE

- a rota valida autenticação e permissão antes de delegar?
- o tipo de exclusão foi escolhido corretamente: purge, soft delete, hard delete ou handler?
- a lógica de remoção está fora da borda HTTP?
- o serviço centraliza auditoria, eventos e cleanup?
- o retorno traduz corretamente `400`, `403`, `404`, `409` e `500`?
- existe teste mínimo do serviço ou handler canônico?
- a documentação da API precisa registrar esse padrão?

Padrões aceitos:

- purge transacional explícito para recursos amplos, como tenant
- soft delete ou desativação para recursos operacionais que precisam preservar histórico
- serviço de storage para artefatos em filesystem
- serviço de domínio para recursos de negócio

Exemplos no projeto:

- `tenantPurgeService`
- `schedulingService.deleteBlock()`
- `flowDeleteHandler`
- `rpaReplayService`
