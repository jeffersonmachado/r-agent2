# Decision Layer

## O que é

A `Decision Layer` é a camada responsável por transformar contexto operacional em resposta acionável.

Ela define a **Next Best Operational Action**.

## Tipos de saída

Uma decisão pode resultar em:

- recommendation
- automation
- playbook
- assistive action
- campaign
- no-op

## Responsabilidades

- priorizar problemas e oportunidades
- escolher estratégia operacional
- separar decisão de execução
- manter a decisão auditável

## Componentes relacionados

- `OperationalDecisionEngine`
- `RecommendationEngine`
- `SignalDetectionService`
- `autonomous-scheduling`
- `playbooks`

## Exemplos de decisões

- priorização de ticket
- sugestão de resposta
- reativação de contato
- redistribuição de fila
- oferta de horário
- execução de campanha
- ação rápida operacional

## Relação com AI e Runtime

- a IA pode enriquecer a decisão
- o runtime executa a decisão

Em outras palavras:

`Decision Layer decide`
`↓`
`Automation Runtime executa`
