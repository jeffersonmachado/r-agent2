# Operational Brain

## O que é

O **Operational Brain** é a camada que determina a **Next Best Operational Action**.

Ele não é um único serviço. É a composição dos componentes que:

- interpretam eventos
- detectam sinais
- geram recomendações
- priorizam ações
- escolhem estratégia operacional
- conectam decisão e execução

## Componentes principais

- `OperationalDecisionEngine`
- `RecommendationEngine`
- `SignalDetectionService`
- `AutonomousScheduling`
- `Playbooks`
- `QuickActionExecutor`

## Papel de cada componente

### SignalDetectionService

Transforma fatos e contexto em sinais operacionais.

### RecommendationEngine

Transforma sinais em opções acionáveis e recomendadas.

### OperationalDecisionEngine

Torna a decisão explícita, auditável e priorizada.

### AutonomousScheduling

Funciona como um cérebro especializado para o domínio de agenda e preenchimento de gaps.

### Playbooks

Materializam estratégias operacionais mais longas e repetíveis.

### QuickActionExecutor

É a borda de execução rápida da decisão operacional.

## Saídas possíveis do Operational Brain

- recommendation
- automation
- playbook
- assistive action
- campaign
- no-op

## Relação com outras camadas

- recebe insumos do `Event Backbone`
- usa contexto de `Operational State`
- delega execução para `Automation Runtime`
- aprende por `Outcome + Memory`
