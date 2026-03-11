# AI Architecture Index

Este documento existe para facilitar a compreensão do projeto por agentes de IA e novos desenvolvedores.

## Categoria do sistema

O `r-agent2` é uma **Autonomous Operations Platform**.

Arquiteturalmente, ele funciona como um **Operational Operating System** para negócios de serviço.

No nível mais fundamental, ele converge para um **Service Operations Kernel**.

## Loop operacional principal

A leitura arquitetural principal é:

`Observe -> Project State -> Decide -> Execute -> Learn`

A leitura operacional canônica já adotada em partes do código e da documentação é:

`Evento -> Sinal -> Recomendação -> Decisão -> Ação / Ação Rápida / Playbook -> Resultado -> Memória Operacional`

## Camadas arquiteturais

- `Event Backbone`
- `Operational State`
- `Operational Brain`
- `Automation Runtime`
- `AI Layer`
- `Operational Memory`

## Diretórios principais

### `api/`

Núcleo operacional do sistema, serviços, runtime, decisão, memória e borda HTTP.

### `frontend/`

Interfaces operacionais como OCC, support, CRM, scheduling e flows.

### `docs/`

Visão arquitetural, modelo operacional, decisões, roadmap e guias de alinhamento.

### `qa/`

Evidências operacionais, smoke tests, artefatos de validação e provas de aderência.

## Domínios operacionais

- CRM
- Support
- Conversations
- Scheduling
- Queues
- Orders
- Tasks
- Voice

## Documentos que uma IA deve ler primeiro

1. `00-platform-vision.md`
2. `ARCHITECTURE-CONTRACT.md`
3. `03-autonomous-operations-loop.md`
4. `04-architecture-overview.md`
5. `05-operational-brain.md`
6. `09-autonomous-operations-architecture.md`
7. `15-how-to-align-code-with-architecture.md`

## Regra arquitetural fundamental

Novos comportamentos devem seguir, sempre que possível, o padrão:

`event -> state -> decision -> action -> outcome`

## O que evitar

Uma IA que trabalhe neste projeto deve evitar:

- criar lógica decisória escondida em controllers ou borda HTTP
- misturar decisão e execução no mesmo componente sem necessidade
- criar automações sem evento operacional explícito
- criar domínios paralelos fora do modelo de `event -> state -> decision -> action -> outcome`
- tratar o projeto como apenas um flow builder, helpdesk ou CRM isolado
