# Architecture Contract — r-agent2

Este documento define as regras arquiteturais fundamentais do projeto.

Ele existe para garantir consistência entre código, documentação e automações geradas por IA.

## Categoria do sistema

O `r-agent2` é uma **Autonomous Operations Platform**.

Arquiteturalmente, funciona como um **Operational Operating System** para negócios de serviço.

## Núcleo arquitetural

O sistema converge para um **Service Operations Kernel**.

Esse kernel representa o conjunto mínimo e estável de capacidades que sustenta todos os domínios operacionais:

- entidades operacionais
- eventos canônicos
- projeções de estado
- decisão operacional
- ação executável
- outcome observável
- memória e feedback

## Loop operacional obrigatório

Todo comportamento operacional deve seguir, sempre que possível, o ciclo:

`event -> state -> decision -> action -> outcome`

ou, conceitualmente:

`Observe -> Project State -> Decide -> Execute -> Learn`

## Camadas arquiteturais

### Event Backbone

Responsável por capturar, normalizar e propagar eventos operacionais.

Exemplos:

- `conversation.received`
- `ticket.created`
- `booking.cancelled`
- `sla.risk_detected`

### Operational State

Responsável por projetar estado operacional a partir de eventos.

Exemplos de projeção esperada:

- `ContactState`
- `TicketState`
- `ConversationState`
- `BookingState`
- `QueueState`

### Operational Brain

Camada responsável por determinar a **Next Best Operational Action**.

Componentes relacionados:

- `OperationalDecisionEngine`
- `RecommendationEngine`
- `SignalDetectionService`
- `AutonomousScheduling`

### Automation Runtime

Responsável por executar decisões.

Inclui:

- `Playbooks`
- `Flow runtime`
- `Quick actions`
- integrações

### AI Layer

Fornece capacidades de inteligência operacional:

- classificação
- copiloto
- geração
- RAG
- recomendação
- previsão

### Operational Memory

Armazena outcomes e feedback para aprendizagem e reuso.

## Domínios operacionais

A plataforma coordena múltiplos domínios:

- CRM
- Support
- Conversations
- Scheduling
- Queues
- Voice
- Orders
- Tasks
- Revenue actions

## Templates verticais

A plataforma pode ser especializada por vertical:

- `beauty`
- `fitness`
- `food`
- `services`

## Regras arquiteturais

1. Novos comportamentos devem nascer de **eventos operacionais explícitos**.
2. O estado usado para decisão deve ser **projetado, consultável e explicável**.
3. A decisão deve ser **separada da execução**.
4. A execução deve produzir **outcome observável**.
5. Outcomes relevantes devem alimentar **memória operacional**.
6. Templates verticais devem especializar comportamento sem bifurcar o core.
7. O runtime de flow não deve substituir a camada de decisão.

## O que este contrato quer evitar

- arquitetura paralela fora do modelo operacional
- controllers ou rotas concentrando regra de decisão
- execução sem outcome observável
- múltiplos significados concorrentes para o mesmo tipo de evento
- crescimento do produto como módulos isolados sem loop operacional comum

## Objetivo da arquitetura

Garantir que o sistema funcione como um **Operational Operating System**, onde a operação do negócio ocorre dentro da plataforma e decisões operacionais podem ser assistidas ou automatizadas sobre um núcleo comum.
