# Event Backbone

## Papel do backbone de eventos

O backbone de eventos é a espinha dorsal de observação da plataforma.

Ele é responsável por:

- registrar eventos
- normalizar semântica
- preservar rastreabilidade
- alimentar automações
- alimentar projeções de estado
- disparar avaliações de decisão

## Componentes principais

- `eventLedgerService`
- `OperationalEventBus`
- `OperationalEventsService`
- `OperationalEventWriter`
- contratos de normalização de inbound events

## Elementos-chave

### Event ledger

Camada de persistência e consulta dos eventos canônicos.

### Event normalization

Camada que transforma eventos de origem heterogênea em contratos utilizáveis.

### Event bus

Camada de publicação e assinatura para processamento operacional.

### Event triggers

Pontes que convertem eventos em sinais, recomendações, automações e execuções.

## Exemplos de eventos

- `conversation.received`
- `ticket.created`
- `booking.cancelled`
- `booking.gap_detected`
- `contact.inactive`
- `sla.risk_detected`

## O que um novo evento deve carregar

- tipo canônico
- timestamp
- origem
- tenant
- entidade relacionada
- payload suficiente para projeção de estado e auditoria

## Relação com a arquitetura

O backbone de eventos é a camada `Observe` do loop:

`Observe -> Project State -> Decide -> Execute -> Learn`
