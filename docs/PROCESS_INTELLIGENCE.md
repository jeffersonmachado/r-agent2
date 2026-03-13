# Process Intelligence

## Visão geral

A camada de inteligência usa analytics + simulation para produzir recomendações automáticas.

Serviços:

- `api/core/process-intelligence/processGapAnalysisService.js`
- `api/core/process-intelligence/processRecommendationService.js`
- `api/core/process-intelligence/processOptimizationService.js`

## Tipos de gap

- ausência de fallback em nós críticos
- complexidade alta
- gargalos recorrentes

## Recomendações atuais

- adicionar fallback
- reduzir complexidade via subprocessos
- consolidar gateways com excesso de ramificações
- revisar timeout
- avaliar troca de IA por regra
- avaliar troca de regra por IA

## Observação

As recomendações são heurísticas. Elas servem como suporte arquitetural e operacional, não como decisão automática obrigatória.
