# Architecture Overview

## Mapa textual da arquitetura

```text
Event Backbone
       ↓
Operational State
       ↓
Operational Brain
       ↓
Automation Runtime
       ↓
Outcome + Memory
```

## Visão de alto nível

O `r-agent2` é organizado como uma plataforma orientada a operações, não como um conjunto isolado de features.

As camadas principais são:

- `Event Backbone`
- `Operational State`
- `Operational Brain`
- `Automation Runtime`
- `AI Layer`
- `Operational Memory`

## Como os módulos do sistema se conectam

### Event Backbone

Recebe, normaliza, persiste e publica eventos operacionais.

### Operational State

Transforma eventos em estado consultável e contexto de decisão.

### Operational Brain

Detecta sinais, gera recomendações, escolhe decisões e define a próxima melhor ação.

### Automation Runtime

Executa a decisão por flows, playbooks, quick actions, integrações e serviços.

### Outcome + Memory

Registra o resultado e retroalimenta a memória operacional.

### AI Layer

Enriquece observação, estado, recomendação e execução com classificação, RAG, geração e recomendação.

## Mapa entre arquitetura e código

| Camada | Implementação |
| --- | --- |
| Event Backbone | `eventLedgerService`, `OperationalEventBus`, `OperationalEventsService`, `OperationalEventWriter` |
| Operational State | `OCCOperationalStateRepository`, `operational-state`, `contextBuilder`, `conversationContextService` |
| Operational Brain | `SignalDetectionService`, `RecommendationEngine`, `OperationalDecisionEngine`, `autonomous-scheduling`, `playbooks` |
| Automation Runtime | `PlaybookRunner`, `QuickActionExecutor`, `flowEventTriggerService`, `messageProcessor`, `voiceRuntimeService` |
| AI Layer | `conversationContextService`, `conversationMemoryService`, `faqGeneratorService`, fluxos com RAG e copiloto |
| Outcome + Memory | `OperationalOutcomeEngine`, `OperationalMemoryService` |

## Regra estrutural para borda HTTP

Na arquitetura atual, a borda HTTP deve permanecer fina.

Isso vale especialmente para rotas `DELETE`:

- a rota valida e delega
- o serviço ou handler decide a política real de exclusão
- purge, desativação, remoção física e efeitos colaterais não devem ficar embutidos no endpoint

Esse padrão mantém a arquitetura coerente com o modelo:

`event -> state -> decision -> action -> outcome`

## Documentos relacionados

- visão do produto: `00-platform-vision.md`
- conceitos centrais: `02-core-concepts.md`
- arquitetura detalhada complementar: `09-autonomous-operations-architecture.md`
