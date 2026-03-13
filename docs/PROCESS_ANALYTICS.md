# Process Analytics

## Visão geral

O analytics de processo agora é derivado do event log durável em `process_execution_events`.

Camadas principais:

- `api/core/process-analytics/processAnalyticsService.js`
- `api/core/process-analytics/processBottleneckService.js`
- `api/core/process-analytics/processVersionComparisonService.js`

## Métricas suportadas

### Por processo

- total de execuções
- taxa de sucesso
- taxa de falha
- duração média
- duração p95

### Por nó

- entradas
- saídas
- duração média
- erros
- fallbacks

### Por gateway

- total de decisões
- distribuição por caminho (`chosenNext`)

## Gargalos

`ProcessBottleneckService` ordena os nós por `averageDurationMs` e destaca os principais candidatos a gargalo.

## Comparação por versão

`ProcessVersionComparisonService` calcula delta de:

- volume
- sucesso/falha
- duração média
- p95

## Fonte de verdade

A fonte de verdade é o event log do runtime durável. A observability em memória continua existindo, mas o analytics deve preferir eventos persistidos.
