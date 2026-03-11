# Operational State

## O que é

`Operational State` é a camada de projeções e snapshots usados para decisão operacional.

Ela transforma eventos e contexto em estado consultável.

## Exemplos de estado projetado

- `ContactState`
- `TicketState`
- `ConversationState`
- `BookingState`
- `QueueState`

Esses nomes representam tipos de projeção esperados, ainda que a implementação real esteja distribuída por repositórios, serviços e stores.

## O que entra nessa camada

- projeções do OCC
- snapshots operacionais
- contexto conversacional e operacional
- estado de recommendations, signals e playbooks
- métricas e contexto de scheduling/queue/contact

## Responsabilidades

- consolidar contexto de decisão
- tornar estado explicável
- reduzir dependência de evento bruto na camada de decisão
- permitir leitura operacional por UI, runtime e IA

## Exemplos de implementação no projeto

- `OCCOperationalStateRepository`
- `operational-state`
- `contextBuilder`
- `conversationContextService`

## Relação com o loop

Essa camada corresponde principalmente a:

`Project State`

e, no ciclo canônico:

`sinal + contexto + projeções`
