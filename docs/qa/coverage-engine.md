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
| `evidenceStore.js` | Evidence store append-only JSONL com hash chain SHA-256 (`append`/`appendRaw`/`markStale`/`verify`) e redaction de chaves sensíveis |
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
- **(a) Declaração versionada** (`config/journey-scenario-links.json`, source
  `journey-coverage`): cenários com status ligável (`active` ou `approved` —
  `deprecated` nunca liga) cujo id EXISTE no meshRegistry. Ex.:
  `market_default_journey` → `business-market-flow-node`,
  `business-market-scr-01`. O arquivo é sincronizado a partir de
  `qa-waves/journey-coverage/*.json` com `npm run coverage-gate:links`
  (`scripts/governance/sync-journey-scenario-links.js`). O gate NÃO lê os
  arquivos verticais diretamente: eles são artefatos gerados por
  `tools/system/platform-readiness.js` (executado no `zip:release`) e eram
  reescritos com conteúdo degradado num checkout limpo sem meshRegistry,
  derrubando a journeyCoverage no CI (regressão coberta por
  `tests/unit/coverage/journeyLinksConfig.test.js`).
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
(total de jornadas ligadas por fonte). A declaração e os aliases são
versionados e nunca reescritos em runtime, então o modo snapshot (CI)
funciona igual.

Todas as 21 jornadas dos contratos estão VALIDATED. As três jornadas core
antes UNCOVERED (`support_ticket_flow`, `booking_flow`,
`payment_charge_flow`) passaram a ser cobertas pelos cenários executáveis
`CORE-FLOW-SUPPORT-TICKET`, `CORE-FLOW-BOOKING` e
`CORE-FLOW-PAYMENT-CHARGE` (`tests/rpa/business/`, ids de mesh
`business-core-flow-*`). Jornadas de sistema são cidadãs de primeira classe:
o cenário declara `journey` no catálogo business, o mesh propaga como
`journeyId` (`meshRunner.normalizeBusinessScenario`) e o platform-readiness
gera `qa-waves/journey-coverage/core.json`
(`buildSystemJourneyCoverage`) — a declaração flui para
`config/journey-scenario-links.json` via `coverage-gate:links` sem edição
manual. Verticais `manual: true` continuam suportadas pelo sync como válvula
de escape documentada.

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

### Recência do histórico do mesh

O histórico convive com dois esquemas de nome: `mesh-<ISO>.json` (runMesh
direto) e `meshq-<epochMs>-<rand>.json` (executionQueue). `loadHistory`,
`pruneOldHistory` e `pruneOldEvidence` ordenam pela DATA REAL embutida no
nome (epoch do `meshq-`, ISO do `mesh-`), com fallback para mtime — nunca
por ordem lexicográfica, que colocaria qualquer `meshq-` à frente de
qualquer `mesh-` independentemente da data (bug corrigido em 2026-07-26:
a retenção apagava as execuções do dia e `loadHistory(1)` devolvia uma
execução de dias atrás como "mais recente").

Retenção do histórico (`pruneOldHistory`): a janela de
`QA_MESH_MAX_HISTORY` (default 5) é aplicada POR CLASSE — execuções
canônicas (`isCanonicalExecution: true`) e não-canônicas têm cotas
separadas, e runs não-canônicos (scheduler "critical") nunca podam
execuções canônicas. Motivo: o coverage gate lê o histórico por cenário
como evidência de execução; a retenção cega podava o arquivo da execução
canônica quando o scheduler enchia a janela com runs parciais e o gate
oscilava GO → NO_GO sem mudança de código (bug corrigido em 2026-07-26,
regressão em `tests/governance/meshHistoryPrune.test.js`).

### API Surface Wave — política de probes e detecção de auth (2026-08-03)

A API Surface Wave (`npm run wave:api-surface`, motor puro em
`qa/coverage/apiSurfaceWave.js`) valida existência, enforcement de auth e
enforcement de classificação de cada rota `api:` do inventário com probes
HTTP reais:

- **P1 anônimo**: todos os métodos quando `authRequired=true` no inventário;
  401/403 esperado antes de qualquer efeito.
- **P2 papel PRODUCTION**: GET/HEAD em qualquer rota e métodos mutáveis em
  rotas SUPPORT/DEVELOPMENT com auth declarada — `requireClassification`
  rejeita o papel operacional ANTES do handler, então o probe é livre de
  efeito colateral por arquitetura e qualquer resposta ≠ 401/403 é violação
  de visibilidade (antes de 2026-08-03, métodos mutáveis privilegiados
  ficavam apenas VISITED e essa violação era invisível). Em rota PRODUCTION
  mutável P2 é proibido: o papel é autorizado e executaria efeito real.
- **P3 super_admin**: apenas GET/HEAD em rotas SUPPORT/DEVELOPMENT. Em
  método mutável, `developmentReachable` é NOT_APPLICABLE por design (o
  probe executaria a mutação); a alcançabilidade por DEVELOPMENT é
  comprovada pelas rotas GET do mesmo módulo e pelos cenários de mesh.

O `authRequired` do inventário vem do scanner estático
(`api/services/qa/inventory/apiRouteScanner.js`), que resolve os idiomas
reais do projeto: controllers delegados (`controllerFor(req, res).m(...)`),
handlers por referência (`controller.m` como argumento), helpers de
permissão que implicam auth transitivamente (`ensurePermission → ensureAuth`),
módulos irmãos `*controller*`/`*utils*`/`*helpers*` (ex.: `ragRouteUtils.js`,
`beautyRouteHelpers.js`), controllers injetados por parâmetro
(`createTenantRoutes({ controller })` → `controller.js` irmão), chamadas
diretas `requireAuth(`/`ensureAuth(`/`ensureAuthenticated(`/`ensureSupportAccess(`
e merge de duplicatas por identidade normalizada de rota (`:webhookId` e
`:id` no mesmo shape são o mesmo endpoint — a evidência mais forte vence).
Quando a semântica real escapa à análise estática (auth centralizada em
handler pai, guards de token custom, auth condicional por modo), o mecanismo
oficial é `AUTH_REQUIRED_OVERRIDES` no próprio scanner — cada entrada exige
justificativa ancorada em probe ao vivo.

Rotas públicas mutáveis (login, signup, webhooks de provedores, storefront,
`/flows/validate`) permanecem VISITED por design: probe anônimo mutável
poderia causar efeito real e não há assertiva de auth a verificar — a
cobertura de negócio delas vem das jornadas de mesh.

### Frescor das evidências das waves técnicas (STALE por idade)

Os relatórios `reports/db-integrity-report.json`,
`reports/api-surface-report.json` e `reports/page-surface-report.json`
alimentam o gate como `technicalExecutions`. Até 2026-08-01 apenas o
relatório de tenant-isolation tinha política de frescor (24h); o gate
consumiu um db-integrity com 6 dias sem qualquer degradação — evidência
velha contando como VALIDATED.

Política atual (`applyWaveReportStaleness` em
`scripts/governance/validate-coverage-gate.js`): relatório sem
`generatedAt` ou mais velho que o limiar (padrão 7 dias; override
`COVERAGE_GATE_WAVE_REPORT_MAX_AGE_MS`) tem seus estados VALIDATED
degradados para STALE antes de entrar no `evaluateCoverageGate` —
deixam de contar como cobertura válida (STALE também não conta como
visitada), o gate loga um AVISO por fonte degradada e a decisão reflete
a queda (validado end-to-end: limiar de 1ms → NO_GO; relatórios frescos
→ GO). Estados não-VALIDATED (VISITED, FAILED) são preservados.
Regressão: `tests/unit/coverage/coverageGateStaleness.test.js` (6 casos).

### Cadeia imutável de execuções (`qa-mesh/executionHistoryChain.js`)

Os arquivos `meshHistory/<id>.json` são o retrato persistido de cada
execução, mas são JSON mutável e podados pela retenção. A cada execução
concluída, o `meshRunner` anexa um registro imutável em
`qa-mesh/execution-history/index.jsonl` (Evidence Store: redaction
obrigatória + hash chain SHA-256 com `prevHash`). O registro carrega
`executionId`, `executionOrigin`, `goNoGo`, métricas, `commit` (git HEAD)
e `historyFileSha256` — o SHA-256 do arquivo de histórico no momento do
fechamento, permitindo detectar adulteração posterior
(`verifyHistoryFile`). Arquivo podado pela retenção reporta
`valid: 'missing'` (ausência por retenção não é adulteração).

O caminho fica fora de `meshHistory/` de propósito: o endpoint
`DELETE /api/qa-waves/executions` limpa `meshHistory/*` e não pode apagar
a cadeia. Consulta: `GET /api/qa-waves/executions/history?limit=N`
(classificação DEVELOPMENT) retorna `{ items, verification, chainPath }`.
`GET /api/qa-waves/executions` (lista operacional) faz merge do estado
vivo em memória com o histórico persistido em `meshHistory/` (origem
`qa_waves_real`), com deduplicação por `executionId` — o Map em memória
continua sendo o estado vivo do runtime (single-flight + EventEmitter),
não persistência de domínio. Testes:
`qa-mesh/__tests__/executionHistoryChain.test.js`,
`api/services/__tests__/qaWavesExecutionService.history.test.js`,
`api/services/__tests__/qaMeshService.executionOrigin.test.js`.

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
validação real dos 155 itens `model:` e dos 9 itens `relation:` do inventário,
com motor puro em `qa/coverage/dbIntegrityWave.js` (sem I/O — recebe dados e
resolve estados).

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
  projeto; nunca credenciais hardcoded; timeout curto de 5s) e 4 queries
  agregadas no information_schema: `tableExistsInDb`,
  `modelColumnsExistInDb` (field→column com conversão camelCase→snake_case),
  `primaryKeyExistsInDb` e o inventário de constraints FOREIGN KEY reais
  (usado pelas relações, abaixo).

Relações (itens `relation:` do inventário — campo FK → tabela.coluna
referenciada) são validadas na mesma wave:

- **TIER ESTÁTICO:** `sourceModelParses`, `fieldDefinedInModel` (campo FK
  declarado no model de origem — aceita o nome do atributo, ex.
  `sourceNodeId`, ou a coluna física, ex. `actor_user_id`) e
  `referencesDeclared` (references.model/key presentes no item).
- **TIER LIVE:** `sourceColumnExistsInDb`, `referencedColumnExistsInDb`
  (tabela e coluna referenciadas existem) e
  `foreignKeyConstraintExistsInDb` — constraint FOREIGN KEY real no banco
  ligando origem → referência (não basta a coluna existir).

Mesma precedência de estado dos models. Resultados em `perRelation` +
`relationTotals` no relatório; o coverage gate mapeia cada entrada
`perRelation` para o item `relation:` de mesmo id (dimensão relation do
relatório do gate).

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

- evidências append-only (uma por model, uma por relação) em
  `qa/evidence/db-integrity-wave.jsonl` via `createEvidenceStore` (hash chain
  verificada ao final; diretório gitignored);
- relatório versionado `reports/db-integrity-report.json`
  (`{generatedAt, dbAvailable, totals, relationTotals, exemptions, perModel, perRelation}`) — exceção no `.gitignore`
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

### Jornadas blocking no mesh: evidência operacional do smoke

O mesh não possui browser. Cenários ligados a jornadas blocking
(`support_ticket_flow`, `fitness_customer_checkin` — ver
`BLOCKING_JOURNEYS` em `api/services/qa/operationalStepExecutor.js`) nunca
podem ser dados como válidos com `page` nula: sem prova de browser, o
`meshRunner` falha o cenário com
`blocking_journey_requires_browser_operational_runner`
(`page_null_blocking_journey`) em vez de mascarar a ausência de evidência.

Quem produz essa prova é o smoke prod-like das QA Waves
(`scripts/smoke/qa-waves-operational-final-smoke.js`), que executa as
jornadas com Playwright real e grava
`qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json`. O mesh
CONSOME essa evidência via `qa-mesh/blockingJourneyEvidence.js`: com
evidência válida o cenário passa (adapter + prova de browser); sem ela, a
falha é mantida e o erro registra `evidenceStatus`
(`missing`/`invalid`/`stale`/`not_go`). Evidência válida exige:

- `generatedAt` dentro do frescor máximo (default 168h, mesma convenção de
  `requireFreshReplayDays: 7`; configurável por
  `MESH_BLOCKING_EVIDENCE_MAX_AGE_HOURS`);
- a jornada presente em `flows[]` com `replay.status === 'GO'`,
  `audit.valid === true`, `strictGovernance.status === 'GO'` e ao menos um
  screenshot (prova de browser real, obrigatória em jornada blocking);
- caminho configurável por `MESH_BLOCKING_EVIDENCE_PATH`.

Consequência prática: para manter o gate GO em ambiente local, rode o smoke
prod-like periodicamente; evidência expirada volta a falhar o cenário até
nova execução com browser.

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
