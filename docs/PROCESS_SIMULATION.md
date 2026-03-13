# Process Simulation

## Visão geral

O engine de simulação de processo é estático e opera sobre a definição compilada/canônica do processo.

Serviços:

- `api/core/process-simulation/processSimulationService.js`
- `api/core/process-simulation/processComplexityService.js`

## Saídas principais

- `reachableNodes`
- `unreachableNodes`
- `terminalPaths`
- `deadPaths`
- `loops`
- `complexityScore`

## Objetivo

A simulação não executa side effects. Ela responde perguntas estruturais:

- quais nós são alcançáveis?
- existem laços/ciclos?
- existem caminhos sem saída?
- a ramificação está excessiva?
- qual o nível de complexidade do processo?

## Complexity Score

O score considera:

- quantidade de nós
- quantidade de arestas
- laços
- nós de ramificação
- nós inalcançáveis

O resultado é classificado em:

- `low`
- `medium`
- `high`
