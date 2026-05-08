# Plano de Split de PR - QA Waves Contracts

## Contexto

A árvore local contém mudanças de múltiplos temas. Para reduzir risco de deploy e facilitar revisão, separar em PRs temáticos.

## PR 1 (recomendado primeiro): Core de Contratos e Governança

Conteúdo:
- Contratos por action type
- Executor/validator operacional
- Regras de modo operational_go vs diagnostic
- Ajustes de mesh strict mode
- Testes unitários e de integração diretamente ligados ao core

Arquivos típicos:
- api/services/qa/operationalStepExecutor.js
- api/services/qa/operationalReplayValidator.js
- qa/evidence/stepEvidenceContracts.js
- qa-mesh/meshRunner.js
- api/services/__tests__/operationalStepExecutor.test.js
- api/services/__tests__/operationalReplayValidator.strict.test.js
- qa-mesh/__tests__/meshRunner.strictMode.test.js

## PR 2: Definições de Jornada e Replay Enrichment

Conteúdo:
- Step definitions support/fitness
- Enriquecimento de payload para auditoria em replay
- Ajustes de QA Waves service/execution relacionados ao contrato

Arquivos típicos:
- api/services/qa/journeyStepDefinitions/supportTicketFlowSteps.js
- api/services/qa/journeyStepDefinitions/fitnessCheckinFlowSteps.js
- api/services/qaWavesService.js
- api/services/qaWavesExecutionService.js
- api/services/__tests__/qaWavesExecutionService.operational.test.js

## PR 3: Discovery/Auto-generation e Configuração Operacional

Conteúdo:
- Engines e scanners de discovery
- serviços de inferência e preflight
- novos arquivos de config gerados
- documentação operacional extensa

Arquivos típicos:
- api/services/qa/scanners/*
- api/services/qa/systemDiscoveryEngine.js
- api/services/qa/preflightEngine.js
- config/capabilities-registry.json
- config/capability-dependencies.json
- config/journey-contracts.json
- config/journey-preconditions.json
- config/operational-*.json
- config/state-snapshot-contracts.json
- docs/qa-waves-operational-review.md

## PR 4 (opcional): E2E/UI de Observabilidade

Conteúdo:
- specs Playwright novos/alterados
- páginas de visualização QA Gaps/Replays

Arquivos típicos:
- frontend-e2e/*.spec.ts
- frontend/src/pages/QaGapsPage.jsx
- frontend/src/pages/RpaReplaysPage.jsx

## Comandos Práticos (não destrutivos)

1. Criar branch do PR 1

- git checkout -b feat/qa-contracts-core

2. Adicionar apenas o escopo do PR 1

- git add api/services/qa/operationalStepExecutor.js qa/evidence/stepEvidenceContracts.js api/services/qa/operationalReplayValidator.js qa-mesh/meshRunner.js api/services/__tests__/operationalStepExecutor.test.js api/services/__tests__/operationalReplayValidator.strict.test.js qa-mesh/__tests__/meshRunner.strictMode.test.js

3. Validar escopo staged

- git diff --staged --name-only

4. Repetir para PR 2, PR 3 e PR 4 em branches próprios

## Observação sobre artefatos gerados

Evitar versionar relatórios operacionais grandes de execução (ex.: qa/qa-waves/operational-gaps-report.json) no PR de core. Manter apenas quando forem explicitamente parte de baseline de produto.
