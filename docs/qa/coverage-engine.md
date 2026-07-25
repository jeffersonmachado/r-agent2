# Coverage Engine — inventário, rastreabilidade, evidências e gate

Este documento descreve o motor de cobertura implementado em `qa/coverage/`,
a CLI de gate em `scripts/governance/validate-coverage-gate.js`, a análise de
impacto em `scripts/analyze-impact.js` e o demo em
`scripts/demo-coverage-scenarios.js`. Documenta apenas o que existe
implementado no repositório.

## Visão geral

Fluxo: **inventário → grafo de rastreabilidade → estados de cobertura →
evidências → métricas → gate GO/NO_GO → análise de impacto**.

```
config/system-inventory.json ─┐
qa-mesh/meshRegistry.json ────┤
qa-mesh/go-no-go-report.json ─┼─► coverageGate.evaluateCoverageGate ─► reports/coverage-gate-report.json
qa-mesh/meshHistory/*.json ───┤
reports/visibility-policy-report.json ─┘
```

## Componentes (`qa/coverage/`)

| Módulo | Papel |
|---|---|
| `fingerprints.js` | `fingerprintObject`/`canonicalStringify`/`sha256` — SHA-256 sobre serialização canônica (chaves ordenadas, sem timestamps) |
| `coverageStates.js` | Enum de estados + `resolveItemState` (precedência NOT_APPLICABLE > ORPHANED > STALE > BLOCKED > FAILED > VALIDATED > VISITED > UNCOVERED) |
| `traceabilityGraph.js` | `TraceabilityGraph` (declareEdge/observeEdge/computeEdgeStatuses/findOrphans/markStale/propagateImpact) e `CRITICALITY_WEIGHTS` {CRITICAL:5, HIGH:3, NORMAL:1} |
| `coverageCalculator.js` | Métricas puras: visitedCoverage, validatedCoverage, successRate, weightedCoverage, dimensionCoverage, criticalSummary, waveScore (presets `business-journey`, `database-integrity`, `security`) |
| `evidenceStore.js` | Evidence store append-only JSONL com hash chain SHA-256 (`append`/`markStale`/`verify`) e redaction de chaves sensíveis |
| `gateThresholds.js` | Thresholds default + resolução de overrides (arquivo JSON + env) |
| `coverageGate.js` | Motor puro do gate (sem I/O): `evaluateCoverageGate`, `buildGateItems` |
| `impactAnalysis.js` | `buildInventoryGraph` + `computeImpact` (grafo inventário↔jornadas/ondas e propagação de impacto) |

## Inventário

Gerado por `npm run inventory:build` (`scripts/build-system-inventory.js`,
engine em `api/services/qa/inventory/inventoryEngine.js`) em
`config/system-inventory.json`. Estado atual: 2632 itens (671 APIs, 150
páginas, 155 models + tables/fields/relations), 521 órfãos. Cada item tem
`id`, `kind`, `classification` (PRODUCTION/SUPPORT/DEVELOPMENT),
`linkStatus` (LINKED/ORPHANED), `linkedJourneys`/`linkedDomains` ou
`technicalWave`, e `fingerprint` estrutural (linking não participa do
fingerprint).

## Estados e mapeamento de execução

O gate (`coverageGate.js`) avalia três famílias de itens:

- `journey:<id>` — jornadas de `config/journey-contracts.json`;
- `outcome:<scenarioId>` — um outcome por cenário do meshRegistry;
- itens do inventário (dimensão = kind; `table` → `model`).

Mapeamento de status de execução do mesh → estado:

| Status mesh | Estado |
|---|---|
| `passed` | VALIDATED |
| `passed_via_fallback` | VISITED (não conta como validado; fallback também não conta como sucesso no successRate) |
| `failed`, `flaky` | FAILED |
| `skipped`, `environment_missing`, `infra_error` | BLOCKED |
| cenário nunca executado | UNCOVERED |
| item `linkStatus: ORPHANED` | ORPHANED |
| item com fingerprint alterado (`staleItemIds`) | REVALIDATION_REQUIRED (evidência correspondente STALE) |

Criticidade do mesh: `blocking` → CRITICAL, `high` → HIGH, `medium`/`standard`
→ NORMAL, propagada aos itens do inventário ligados ao domínio do cenário
(maior criticidade vence).

Agregação de um grupo (jornada/domínio): FAILED > BLOCKED > UNCOVERED
(parcialmente executado → VISITED; nada executado → UNCOVERED) > VALIDATED.

## Métricas

- **visitedCoverage / validatedCoverage**: % de itens elegíveis (exceto
  NOT_APPLICABLE) em estados VISITED+VALIDATED+FAILED / apenas VALIDATED.
- **successRate**: % de execuções concluídas com `passed` (fallback conta
  como não-sucesso).
- **weightedCoverage**: Σ(peso × validado) / Σ(pesos), pesos por criticidade.
- **dimensionCoverage**: visited/validated/weighted por dimensão.
- **journeyCoverage**: validatedCoverage das jornadas; **technicalCoverage**:
  validatedCoverage dos itens técnicos (apis/páginas/models).
- **waveScore**: score consolidado via preset `business-journey`.

## Thresholds e gate

Defaults (`qa/coverage/gateThresholds.js`):

```
criticalJourneysValidated=100    criticalOutcomesValidated=100
criticalApiContractsValidated=100
uncoveredCriticalItems=0         failedCriticalItems=0
orphanedCriticalItems=0          staleCriticalEvidence=0
visibilityViolations=0           tenantIsolationViolations=0
minimumJourneyCoverage=85        minimumTechnicalCoverage=80
minimumWeightedCoverage=85
```

`config/coverage-gate-thresholds.json` aplica a política **ratchet** sobre os
3 pisos não críticos: baseline medido em 2026-07-25
(`minimumJourneyCoverage=38`, `minimumTechnicalCoverage=15`,
`minimumWeightedCoverage=49` — folga mínima sobre 38.1/15.6/49.3). Esses
pisos **só podem subir, nunca descer**: qualquer regressão abaixo do baseline
bloqueia o gate. As regras críticas permanecem 100/0, intocáveis. O campo
`_ratchet` no JSON documenta a política (chaves `_` são ignoradas pelo
resolvedor).

Overrides por env (prefixo `COVERAGE_GATE_`, SCREAMING_SNAKE_CASE;
precedência env > arquivo > defaults). Ex.:
`COVERAGE_GATE_MINIMUM_JOURNEY_COVERAGE=90`.

Decisão: GO se nenhum check falhar; NO_GO com `reasons[]` listando
`{check, threshold, actual, items}` (ids dos responsáveis, até 20 + contador
de omitidos).

## Isolamento de tenant (fonte real)

`scripts/governance/tenant-isolation-report.js` (npm
`report:tenant-isolation`) executa via Jest `tests/tenant/`,
`api/middleware/__tests__/tenantValidation.test.js`,
`tests/unit/exportServiceTenantIsolation.test.js` e
`tests/unit/departmentsServiceTenantIsolation.test.js` (`--ci --json`) e grava
`reports/tenant-isolation-report.json` com `{generatedAt, suites, testsTotal,
testsPassed, testsFailed, testsPending, violations, failingSuites}` —
`violations` = nº de testes falhos; exit 1 se > 0. `--skip-run` apenas relê o
último relatório. As suítes de integração se auto-pulam sem PostgreSQL
(contam como `testsPending`, nunca como falha).

O gate consome o relatório: se ausente ou mais velho que 24h, executa o
script (salvo com `COVERAGE_GATE_SKIP_TENANT_RUN=1`, que usa o relatório em
disco). Sem relatório algum: `source: 'missing'` e 0 violações (conservador,
para não quebrar ambientes sem DB). Relatório com `violations > 0` alimenta
`tenantIsolationViolations` e bloqueia. O relatório baseline (gerado
localmente com DB) é versionado — exceção no `.gitignore`
(`!reports/tenant-isolation-report.json`).

## Comandos

```bash
npm run inventory:build        # regenera config/system-inventory.json (+ diff)
npm run validate:coverage-gate # gate bloqueante (exit 1 em NO_GO)
npm run report:tenant-isolation # relatório de isolamento de tenant (exit 1 se violações)
node scripts/governance/validate-coverage-gate.js --informative   # exit 0 sempre
node scripts/governance/validate-coverage-gate.js --check-fingerprints  # marca stale
npm run analyze:impact         # diff de inventário + propagação de impacto
node scripts/analyze-impact.js --base config/system-inventory.json
npm run demo:coverage          # demo dos 6 cenários (sem DB/Redis/browser)
```

O gate lê `config/system-inventory.json`, `qa-mesh/meshRegistry.json`,
atribui status por domínio a partir de `qa-mesh/go-no-go-report.json`
(somente domínios homogêneos) e sobrepõe resultados por cenário de
`qa-mesh/meshHistory/` (mais recente vence). Violações de visibilidade vêm de
`reports/visibility-policy-report.json` (o validador é executado se o
relatório não existir) e violações de isolamento de tenant de
`reports/tenant-isolation-report.json` (ver seção anterior).
`validate:visibility-policy` e `validate:coverage-gate` (nesta ordem) fecham
a cadeia `validate:governance-enforcement`. No CI
(`.github/workflows/release-governance.yml`, job `governance-core`) o step
"Coverage gate" roda `report:tenant-isolation` (fresco; integração se
auto-pula sem DB), `validate:visibility-policy` e o gate com
`COVERAGE_GATE_SKIP_TENANT_RUN=1`.

## Análise de impacto

`scripts/analyze-impact.js` reconstrói o inventário via scanners (ou aceita
`--next <arquivo>`), roda `diffInventories` contra a base (`--base`, default
`config/system-inventory.json`), monta o grafo inventário↔jornadas/ondas
(`buildInventoryGraph`) e propaga o impacto dos itens com fingerprint
alterado (`computeImpact` → `TraceabilityGraph.propagateImpact`). Saída em
`reports/impact-analysis.json`: itens com REVALIDATION_REQUIRED, jornadas e
ondas técnicas afetadas e as waves mínimas necessárias para revalidação.

## Evidências

`createEvidenceStore({filePath})`: registros JSONL append-only com
`prevHash`/`hash` encadeados (SHA-256 sobre conteúdo canônico), redaction
recursiva de chaves sensíveis e `markStale` como registro `stale-marker` (o
registro original nunca é editado). `verify()` valida a cadeia inteira.

## Resultado real atual (2026-07-25)

Sobre o inventário real do repositório, o gate reporta **GO** com o baseline
ratchet: visitedCoverage 17.3%, validatedCoverage 17.3%,
weightedCoverage 49.3%, journeyCoverage 38.1%, technicalCoverage 15.6%,
successRate 100%, críticos uncovered/failed/stale/orphaned = 0, órfãos
totais = 521 (nenhum CRITICAL), visibilityViolations=0,
tenantIsolationViolations=0 (8 suítes, 60/60 testes). Os pisos não críticos
do baseline (38/15/49) só podem subir; com os defaults nominais (85/80/85) o
gate permanece NO_GO em `minimumJourneyCoverage`,
`minimumTechnicalCoverage` e `minimumWeightedCoverage`.

## Testes

`tests/unit/coverage/` — `coverageGate.test.js` (GO/NO_GO, fallback,
thresholds via env, modo informative, órfão crítico, peso de falha CRITICAL)
e `impactAnalysis.test.js` (grafo + propagação), além das suítes dos
componentes base. Rodar: `npx jest tests/unit/coverage --ci`.
