# Automation Runtime

## O que é

O `Automation Runtime` é a camada que executa decisões operacionais.

Ele conecta:

- flows
- triggers
- playbooks
- quick actions
- integrations
- serviços de domínio

## Responsabilidades

- transformar decisão em execução real
- orquestrar passos síncronos e assíncronos
- acionar integrações
- produzir outcome observável

## Componentes principais

- `PlaybookRunner`
- `QuickActionExecutor`
- `flowEventTriggerService`
- `messageProcessor`
- `voiceRuntimeService`

## Modelo de operação

`Decision Layer decide`
`↓`
`Automation Runtime executa`
`↓`
`Outcome + Memory aprendem`

## Tipos de execução

- assistida por operador
- automática
- baseada em campanha
- baseada em flow
- baseada em playbook
- baseada em quick action
