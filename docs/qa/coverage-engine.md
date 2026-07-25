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
| `journeyLinks.js` | Ligação jornada ↔ cenários do mesh (sem I/O): `resolveDomainAliases`, `journeyMatchesDomain`, `buildJourneyScenarioLinks` (aliases de domínio + arquivos verticais + convenção de nome) |
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

## Ligação jornada ↔ execução (journeyLinkage)

A jornada só é VALIDATED quando há cenário executado e passando ligado a ela.
A ligação usa somente dados versionados, em cascata (`buildGateItems`,
parâmetros opcionais `aliases` e `journeyScenarioLinks` — sem eles o
comportamento é o original de `includes` por domínio):

1. **Cenários ligados com execução conhecida** (`journeyScenarioLinks`,
   montado por `journeyLinks.buildJourneyScenarioLinks`): estado = agregação
   dos estados dos cenários ligados; cenário ligado sem execução conta como
   UNCOVERED na agregação (um passed + um não executado → VISITED, nunca
   VALIDATED; um failed → FAILED).
2. **Fallback por domínio**: id da jornada contém o domínio do mesh OU seu
   canônico via aliases (`journeyLinks.journeyMatchesDomain`).
3. **UNCOVERED** caso contrário.

Fontes dos links (todas versionadas):

- **Aliases de domínio** (`config/qa-waves-registry.json` → `domainAliases`,
  alias → canônico): o mesh usa domínios PT (`mercado`, `servicos`,
  `clinica`) e as jornadas canônicas usam EN (`market_default_journey`,
  `services_default_journey`, `clinic_default_journey`). O domínio é
  normalizado para o canônico antes do `includes`
  (`canon('clinica')='clinic'` → `'clinic_default_journey'` casa).
- **(a) Arquivos verticais** (`qa-waves/journey-coverage/*.json`, source
  `journey-coverage`): cenários com status ligável (`active` ou `approved` —
  `deprecated` nunca liga) cujo id EXISTE no meshRegistry. Ex.:
  `market_default_journey` → `business-market-flow-node`,
  `business-market-scr-01`.
- **(b) Convenção de nome** (source `scenario-name`): para jornada presente
  num arquivo vertical de vertical V, cenários do mesh cujo id contém o id da
  jornada como TOKEN delimitado por `-`/`_` (ex.: `fitness-matricula-checkin`
  → jornada `checkin`; `fitness-matricula-agendamento-ui` → `agendamento`).
  Regra anti-falso-positivo: o token nunca casa dentro de palavra maior
  (`checkin` não casa em `academia-checkins`). O domínio correspondente à
  vertical (via aliases: clinic→clinica) é PREFERÊNCIA, não requisito —
  quando há candidato no domínio preferido só ele liga; exceção documentada:
  `fitness-matricula-leads` vive no domínio `omnichannel` e liga mesmo assim.

Precedência: quando (a) existe para a jornada, o link é a UNIÃO de (a)+(b)
com source `journey-coverage`; senão, usa-se (b). A CLI
(`validate-coverage-gate.js`) registra o resumo em `inputs.journeyLinks`
(total de jornadas ligadas por fonte). Os arquivos verticais são versionados,
então o modo snapshot (CI) funciona igual.

Jornadas ainda UNCOVERED (sem cenário executado ligado — sem link
artificial): `support_ticket_flow`, `booking_flow` e `payment_charge_flow`
(nenhuma entrada em arquivo vertical, nenhum cenário do mesh com o token e
nenhum domínio correspondente).

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
(`minimumJourneyCoverage=85.2`, `minimumTechnicalCoverage=73.3`,
`minimumWeightedCoverage=83.8` — medido 85.7/73.8/84.3 menos 0.5 de folga).
Esses pisos **só podem subir, nunca descer**: qualquer regressão abaixo do
baseline bloqueia o gate. As regras críticas permanecem 100/0, intocáveis.
O campo `_ratchet` no JSON documenta a política (chaves `_` são ignoradas
pelo resolvedor).

Overrides por env (prefixo `COVERAGE_GATE_`, SCREAMING_SNAKE_CASE;
precedência env > arquivo > defaults). Ex.:
`COVERAGE_GATE_MINIMUM_JOURNEY_COVERAGE=90`.

Decisão: GO se nenhum check falhar; NO_GO com `reasons[]` listando
`{check, threshold, actual, items}` (ids dos responsáveis, até 20 + contador
de omitidos).

### Snapshot para CI

`qa-mesh/meshRegistry.json` e `qa-mesh/meshHistory/` são arquivos de runtime
(gitignored) e não existem num checkout limpo. Para o CI, o gate usa o
snapshot versionado `config/coverage-gate-baseline.json` (cenários + último
status por cenário), gerado por `npm run coverage-gate:snapshot` a partir dos
dados vivos. Com o registry vivo presente, o comportamento é inalterado;
sem ele e sem snapshot válido, o gate falha explicitamente (exit 1). Regere o
snapshot a cada release ou mudança da execução canônica do mesh — ele é o
baseline de cobertura do pipeline.

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

## Database Integrity Wave

`scripts/governance/db-integrity-wave.js` (npm `wave:db-integrity`) executa a
validação real dos 155 itens `model:` do inventário, com motor puro em
`qa/coverage/dbIntegrityWave.js` (sem I/O — recebe dados e resolve estados).

Tiers por model:

- **TIER ESTÁTICO (sempre):** `modelFileParses` (arquivo parseia via
  modelScanner, sem require/DB), `tableNameDefined`, `primaryKeyDefined`
  (PK explícita, campo `id` ou PK implícita do Sequelize), `migrationFound`
  (referência à tabela em `api/db/migrations/*.js` — `createTable('<table>'`,
  ocorrência quotada do tableName ou `CREATE TABLE [IF NOT EXISTS] <table>`
  em SQL bruto — ou no DDL versionado `migrations/*.sql`; matches listados),
  `tenantScope`
  (OBSERVAÇÃO: ausência de tenant_id/tenant_key vira warning `absent`, nunca
  falha — models globais legítimos existem) e `timestampsDefined` (falha só
  se `timestamps: false` sem campos created/updated).
- **TIER LIVE (somente com DB):** conexão via `api/db/sequelize.js` (config do
  projeto; nunca credenciais hardcoded; timeout curto de 5s) e 3 queries
  agregadas no information_schema: `tableExistsInDb`,
  `modelColumnsExistInDb` (field→column com conversão camelCase→snake_case) e
  `primaryKeyExistsInDb`.

Isenções justificadas: `config/db-integrity-exemptions.json` (versionado) pode
marcar uma assertiva de um model como NOT_APPLICABLE —
`{ "<ModelName>": { "assertion", "reason", "approvedBy", "date" } }`. Com os 4
campos obrigatórios preenchidos e a assertiva existente, ela passa a contar
como `passed` (não derruba VALIDATED) e a isenção aparece no relatório
(`exemptions.applied`, auditável). Isenção sem campos obrigatórios ou para
assertiva inexistente é IGNORADA (`exemptions.ignored`) e a assertiva continua
falhando — isenção nunca esconde lacuna.

Estado final por model (precedência FAILED > VISITED > VALIDATED): qualquer
assertiva falha → FAILED (com a lista de assertivas falhas); estático passa
sem DB → VISITED (`dbAvailable=false`, razão registrada — nunca VALIDATED sem
live); estático + live passam → VALIDATED.

Saídas:

- evidências append-only (uma por model) em
  `qa/evidence/db-integrity-wave.jsonl` via `createEvidenceStore` (hash chain
  verificada ao final; diretório gitignored);
- relatório versionado `reports/db-integrity-report.json`
  (`{generatedAt, dbAvailable, totals, exemptions, perModel}`) — exceção no `.gitignore`
  (`!reports/db-integrity-report.json`), mesmo padrão do tenant report.

Integração ao gate: `validate-coverage-gate.js` lê o relatório (se existir;
ausente → comportamento inalterado) e aplica o estado de cada model a TODOS
os itens do inventário daquele model (`model:`, `table:` e `field:` com
`item.model === <nome>`, mesma grafia do scanner; `relation:` fica fora) como
`technicalExecutions` do `evaluateCoverageGate` — parâmetro opcional e
retrocompatível de `buildGateItems`, aplicado apenas a itens sem domínio
ligado (itens ligados a jornadas continuam governados pelo mesh; stale ainda
sobrepõe). A fonte fica registrada em `inputs.dbIntegritySource`; com
`dbAvailable=false` o relatório do gate anota `inputs.dbIntegrityNote`.

Resultado real (2026-07-25, primeira execução): 155 models → 139 VALIDATED,
16 FAILED legítimos. Diagnóstico e resolução dos 16 (mesma data):

- **8 `migrationFound`:** 7 tabelas eram criadas pelo DDL versionado solto
  `migrations/agent-os-2026-06-11.sql` (AiGovernanceRecord, CorporateAgent,
  JourneyRegistry, KnowledgeGraphEdge, KnowledgeGraphNode, LearningRecord,
  VerticalTemplate) e 1 por `TicketMedia.sync()` em runtime
  (api/services/ticketMediaService.js). Correção: detecção ampliada no runner
  (SQL bruto `CREATE TABLE` em migrations Umzug + DDL `migrations/*.sql`) e a
  migration aditiva `20260725000002-create-ticket-media-files.js`
  (createTableIfNotExists, alinhada ao model).
- **7 `timestampsDefined` (ProjectActivity, ProjectAttachment, ProjectComment,
  ProjectDependency, ProjectMember, ProjectTemplate, TicketTag):** design
  intencional — tabelas de junção/auditoria append-only com `created_at` via
  `DEFAULT CURRENT_TIMESTAMP` no banco e models com `updatedAt:false`
  explícito. Correção: isenções justificadas NOT_APPLICABLE em
  `config/db-integrity-exemptions.json` (auditáveis no relatório).
- **1 `primaryKeyExistsInDb` (TenantExclusion):** a migration original criou
  apenas o índice único `tenant_exclusions_unique (tenant_id, term)`; o model
  declara PK composta. Verificado no banco: 78 linhas, zero duplicatas.
  Correção: migration aditiva `20260725000001-add-tenant-exclusions-primary-key.js`
  (promove o índice único a PK via `PRIMARY KEY USING INDEX`; idempotente;
  aborta se houver duplicatas).

Resultado real pós-correções (2026-07-25, Postgres local, dbAvailable=true):
155 models → **155 VALIDATED, 0 VISITED, 0 FAILED**, 15 warnings (tenant
scope ausente) e 7 isenções NOT_APPLICABLE aplicadas. O gate subiu para
technicalCoverage 73.8 e weightedCoverage 84.0 (journeyCoverage 38.1
inalterado) e os pisos ratchet foram atualizados para 73.3/83.5 (medido − 0.5;
journey mantido em 38 porque 38.1 − 0.5 < 38 e o ratchet nunca desce).

## Comandos

```bash
npm run inventory:build        # regenera config/system-inventory.json (+ diff)
npm run validate:coverage-gate # gate bloqueante (exit 1 em NO_GO)
npm run report:tenant-isolation # relatório de isolamento de tenant (exit 1 se violações)
npm run wave:db-integrity      # Database Integrity Wave (estático + live no Postgres)
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
ratchet pós-journeyLinkage: visitedCoverage 74.3%, validatedCoverage 74.3%,
weightedCoverage 84.3%, journeyCoverage **85.7%** (18/21 jornadas VALIDATED),
technicalCoverage 73.8%, successRate 100%, waveScore 67.5, críticos
uncovered/failed/stale/orphaned = 0, órfãos totais = 521 (nenhum CRITICAL),
visibilityViolations=0, tenantIsolationViolations=0 (8 suítes, 60/60 testes).
Os pisos não críticos do baseline (85.2/73.3/83.8) só podem subir; com os
defaults nominais (85/80/85) o gate permanece NO_GO em
`minimumTechnicalCoverage` e `minimumWeightedCoverage`.

## Testes

`tests/unit/coverage/` — `coverageGate.test.js` (GO/NO_GO, fallback,
thresholds via env, modo informative, órfão crítico, peso de falha CRITICAL,
technicalExecutions da Database Integrity Wave, journeyLinkage:
aliases/links no motor), `journeyLinks.test.js` (aliases mercado↔market,
token delimitado anti-falso-positivo, link por arquivo vertical,
preferência de domínio, precedência, jornada sem link),
`dbIntegrityWave.test.js`
(fixtures em tmp: VALIDATED, FAILED por migration ausente, warning de tenant
scope, dbAvailable=false → VISITED, assertivas live) e
`impactAnalysis.test.js` (grafo + propagação), além das suítes dos
componentes base. Rodar: `npx jest tests/unit/coverage --ci`.
