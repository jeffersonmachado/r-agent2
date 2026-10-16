# AGENTS.md — RAP / r-agent2 (Results Autonomous Platform)

Antes de qualquer alteração, leia e aplique a Constituição canônica em `governance/RAP_AGENT_CONSTITUTION.md`. Este arquivo é apenas um adaptador operacional; a política completa não deve ser duplicada aqui.

Este repositório é AI-native. Todo agente deve usar `AI_MEMORY/` como primeira camada de memória operacional e preservar a governança existente.

## Visão geral do projeto

RAP (Results Autonomous Platform) é uma plataforma multi-tenant de operações autônomas: eventos operacionais se tornam estado de projeto/cliente, decisões, execuções, aprendizado, evidências de QA e governança de release.

Loop central: **Observe → Project State → Decide → Execute → Learn** (eventos → estado → decisão → execução → aprendizado).

O pacote npm raiz chama-se `chatbot-engine` (nome histórico): engine de fluxos de chatbot em Node.js com execução determinística e replay. Sobre ela foram construídas as camadas de Agent OS, Cognitive Core, QA Mesh/Waves e governança de release.

O **Cognitive Core** (2026-06-12) é o núcleo obrigatório de inteligência da plataforma; agentes (Agent OS) são camada opcional sobre ele. Código em `src/core/cognitive/` (pipeline INPUT → CONTEXT → INTENT → PLAN → EXECUTE → VALIDATE → LEARN, com engines `context-engine`, `intent-engine`, `action-planner`, `execution-engine`, `validation-engine`, `learning-engine`, `tool-registry` e `cognitive-orchestrator`); docs canônicas em `docs/cognitive-core/`.

## Memória operacional obrigatória (startup)

1. Ler `AI_MEMORY/architecture.md`, `AI_MEMORY/project-map.md`, `AI_MEMORY/project-runtime-map.md`, `AI_MEMORY/operational-rules.md` e o arquivo de memória específico da área alterada.
2. Consultar `docs/governance/PLATFORM_STATUS.md` antes de qualquer afirmação sobre release/governança.
3. Inspecionar a documentação existente antes de criar novos docs (`docs/00_DOCUMENTACAO_INDEX.md` e `docs/governance/00_DOCUMENTATION_INDEX.md` são os índices canônicos).
4. Preservar mudanças do usuário/worktree; não reverter arquivos não relacionados.
5. Rodar (ou preservar) os gates executáveis relevantes antes de declarar conclusão.

## Stack tecnológica

- **Runtime:** Node.js >= 20.19 ou >= 22.12, npm >= 10 (ver `engines` em `package.json`).
- **Backend (`api/`):** Express 4, CommonJS com `'use strict'`, Sequelize 6 + `pg` 8 (PostgreSQL 16 com pgvector; `mysql2` também presente como dependência), `ioredis` 5 (Redis), `ws` (WebSocket), Umzug para migrations, rate limiting via `rate-limiter-flexible` + Redis (`infra/rate-limit/`). Entry point: `api/server.js` (`npm start`, porta 3001).
- **Frontend (`frontend/`):** pacote `chatbot-flow-editor` — React 18, ES modules, Vite 7 + Vitest (config canônica `vite.config.mjs` / `vitest.config.mjs`), Rete 2.x (editor visual de fluxos), bpmn-js 18, Tailwind 4, PWA. Dev server Vite na porta 5173 (com `VITE_CACHE_DIR=/tmp/r-agent2-vite`).
- **Engine (`engine/`):** núcleo determinístico da engine de fluxos — funções puras, zero I/O direto (compilação, execução de steps, replay, simulador, validador, registry de nós).
- **RAG (`rag-service/`):** serviço Python separado — FastAPI + Uvicorn (porta 8001; 8000 no compose), sentence-transformers (all-MiniLM-L6-v2, torch CPU), pgvector como vector store, OpenAI opcional. Testes com pytest (`rag-service/pytest.ini`, venv em `rag-service/venv`). Segregação de domínios obrigatória (OPERATIONAL vs SYSTEM): colunas `domain`/`classification`/`sensitivity` em `rag_documents`/`rag_chunks`, filtro no SQL antes da busca vetorial, Domain Router em `api/services/rag/domainRouter.js`, auth serviço-a-serviço via `RAG_INTERNAL_TOKEN` (header `X-RAG-Internal-Token`). Doc canônica: `docs/rag/domain-segregation.md`.
- **RPA (`core/rpa/`):** gravação/replay/player determinísticos com Playwright, CLI em `core/rpa/cli.js`.
- **Mobile:** a decisão de arquitetura é **PWA** (sem app nativo); o diretório placeholder `apps/mobile/` (que continha apenas um `node_modules` órfão sem `package.json`) foi removido em 2026-09-07. Não o recrie sem uma decisão de arquitetura nova.
- **Infra:** Docker Compose (produção), systemd (redis + rag-service), Apache como reverse proxy. **Nunca introduzir PM2.**
- **Versões da stack:** a referência canônica das versões declaradas é `AI_MEMORY/stack-versions.md`; quando a stack mudar, rode `npm run stack:versions:sync` e commit o doc + `reports/stack-versions-report.json`. Valide com `npm run validate:stack-versions`.
- **Dependência externa de pacote:** `@results/auth` é dependência `file:../../packages/auth`; o Jest inclui `/opt/results/packages` em `roots` (ver `jest.config.cjs`). Em clones fora de `/opt/results/ria/`, garantir que o diretório irmão `packages/` exista. `vendor/auth/` é a cópia versionada desse pacote usada pelo CI (o workflow copia `vendor/auth` → `../../packages/auth` antes do `npm ci`); ao alterar o pacote em `/opt/results/packages/auth`, sincronizar `vendor/auth/`.
- **Pacote `@results/whatsapp-qr-bridge`:** núcleo do bridge WhatsApp QR (`api/services/whatsappQrBridgeService.js` é apenas o adaptador: tenant_settings, tickets/mídia, WS, sync contra settings). Dependência `file:../packages/whatsapp-qr-bridge` (fonte em `/opt/results/ria/packages/whatsapp-qr-bridge`); `vendor/whatsapp-qr-bridge/` é a cópia versionada usada pelo CI/Docker — ao alterar o pacote, sincronizar o vendor. O `npm ci` do pacote (dependência `qrcode`) é feito no workflow e no `api/Dockerfile` porque o require do pacote resolve a partir do path real, fora do `node_modules` da API.

## Organização do código e camadas estritas

Camadas (nunca misturar):

- `frontend/` → UI, transformação de formato e validação de UX apenas. Nunca contém lógica de negócio.
- `api/` → boundary HTTP. Registro de rotas em `api/app/registerRoutes.js` e `api/app/routeRegistry.js`; composição em `api/composition/{core,platform,extended}`.
- `api/modules/*` → módulos de rotas delimitados (~75 módulos: auth, workspace, CRM, inbox, queue, pbx, rag-documents, qa, qa-mesh, qa-waves, process-runtime, agent-os, agent-registry, knowledge-graph, journey-registry, rap-learn, ai-governance, agent-marketplace, vertical-templates etc.).
- `api/services/` → ~160 serviços de domínio/aplicação que orquestram casos de uso.
- `engine/` → núcleo determinístico da engine de fluxos (sem I/O).
- `src/core/cognitive/` → Cognitive Core (núcleo de inteligência; Tool Registry delega a serviços existentes, nunca executa direto).
- `rag-service/` → serviço Python separado.

Outros diretórios relevantes:

- `core/rpa/` → CLI, recorder, player, replay determinístico e recuperação de RPA.
- `qa/`, `qa-mesh/`, `qa-waves/` → runner de QA, malha de cenários (registry, runner, scheduler, go/no-go) e cobertura por ondas. São insumos de governança de release, não extras opcionais. Criticidade de jornadas (blocking/severidade) é declarativa: fonte única em `config/journey-criticality.json`, resolvida via `qa/contracts/journeyCriticality.js` — nunca hardcodar listas de jornadas em código.
- `qa/coverage/` → Coverage Engine: fingerprints SHA-256 canônicos, estados de cobertura (UNCOVERED→VALIDATED/STALE/ORPHANED etc.), grafo de rastreabilidade, calculadora (visitada/validada/sucesso/ponderada), Evidence Store append-only com hash chain + redaction, motor do coverage gate e análise de impacto. Inventário automático versionado em `api/services/qa/inventory/` (saída: `config/system-inventory.json`). Doc canônica: `docs/qa/coverage-engine.md`.
- `governance/` → engines e relatórios de prova: self-proving, integridade de replay, validação de pacote, tamper detection, readiness.
- `pipeline/` → validação completa, release gate e autocorreção (`pipeline/runFullValidation.js`, `pipeline/entrypoints/`).
- `tools/system/` → comandos oficiais do ciclo de vida do sistema (bootstrap, validate, release, deploy, release-gate, go-no-go etc.).
- `config/`, `contracts/` → registries de capacidades/jornadas e contratos JSON (versões em `contracts/versions.json`).
- `migrations/` → DDL SQL (ex.: `agent-os-2026-06-11.sql`); migrations da API em `api/db/migrate.js`.
- `scripts/` → automação de bootstrap, release, deploy, smokes e governança (`scripts/governance/` contém os validadores bloqueantes).
- `tests/` → suítes Jest (unit, flow, integration, contracts, governance, ci, runtime, organizational, stress, rate-limit, rpa, security etc.).
- `reports/` → relatórios oficiais de governança em JSON (ver seção de governança).

### Legado

- Os diretórios legados `frontend_backup/`, `backups/`, `remote-dumps/`, `remote-dumps2/`, `scripts/legacy/` e o script `scripts/legacy-ripabx-inventory.js` foram **removidos do repositório** (2026-08-14). Não os recrie. As exclusões inertes que os citavam (`.gitignore`, `.npmignore`, `.dockerignore`, blocklists de release, walkers de governança) foram limpas em 2026-09-07; as referências remanescentes a `backups/` são guardas vivas (`scripts/backup-postgres.sh` escreve em `./backups/postgres`).
- Docs históricos em `dev Documentos/` são históricos, salvo quando um índice canônico os referencia — mas o diretório é lido pela API viva de dev-management e **não** deve ser removido.

## Comandos de build, teste e release

Pré-requisitos: Node 20.19+/22.12+, npm 10+, PostgreSQL e Redis acessíveis. Rodar `npm install` (ou `npm ci`) antes de qualquer validação Jest (o ZIP de origem exclui `node_modules`).

### Fluxo oficial do sistema

```bash
npm ci
npm run system:bootstrap     # cria .env e api/data/config.json a partir dos examples
npm run system:validate
npm run system:release       # pipeline completo: validação + gate + packaging + manifestos
npm run system:deploy        # dry-run por padrão; deploy real exige SYSTEM_DEPLOY_EXECUTE=1
```

### Build e dev

- `npm run build` → backend (`scripts/build-backend.sh`) + frontend.
- `npm run dev` / `npm run dev:api` / `npm run dev:frontend` (frontend via Vite, porta 5173; API na 3001).
- `npm start` → `node api/server.js`.
- `npm run rag:dev` → uvicorn com reload na porta 8000.
- `npm run db:migrate` / `npm run db:migrate:status` (Umzug via `api/db/migrate.js`).

### Testes

- `npm test` → `test:unit` + `test:flow` + `test:rpa:jest`.
- `npm run test:unit` → `jest tests/unit` (rodar após toda alteração de domínio).
- `npm run test:flow` → testes E2E de fluxo (`tests/flow` + `engine/__tests__`; até 2026-07 rodava só `tests/flow`, que não contém arquivos `*.test.js` — gate vacuoso corrigido).
- `npm run test:rpa:jest` → testes RPA sem browser (flags `RPA_SKIP_BROWSER_TESTS`/`SKIP_RPA_INTEGRATION_TESTS`).
- `npm run test:system` → contratos, governança, CI, runtime, organizacional, stress e rate-limit.
- `npm run test:vertical:proof` → prova das verticais Beauty/Fitness (unit + integration + `scripts/vertical-e2e-validate.js`).
- Frontend: `npm run frontend:test` (Vitest, config `frontend/vitest.config.mjs`) e `npm run frontend:test:e2e` (Playwright, em `frontend-e2e/`).
- RAG: `pytest` dentro de `rag-service/` (usando o venv local).
- Smokes: diversos `test:*:smoke` (voice, pbx, whatsapp, inbox, demo, bpmn etc.) via `scripts/`.
- Jest: config em `jest.config.cjs` (timeout 10s, `bail: 1`, ambiente node, roots em `engine/`, `api/`, `tests/`, `qa/`, `qa-mesh/`, `lib/` e `/opt/results/packages`; `tests/rpa/` ignorado por padrão).

### Governança executável (bloqueante)

Documentação não é suficiente. Use os validadores bloqueantes em `scripts/governance/`:

- `npm run validate:ai-memory`, `validate:runtime`, `validate:browser-evidence`, `validate:qa-governance`, `validate:replay-governance`, `validate:release-governance`, `validate:dist`, `validate:agent-adherence`, `validate:self-proving`, `validate:cleanup`, `validate:operational-rules`, `validate:coverage-completeness`, `validate:business-needs`, `validate:governance-summary`, `validate:visibility-policy`, `validate:experience-segregation`, `validate:release-hygiene` (higiene do release físico final: sem `verify-result.json` pré-gerado/stale no envelope, sem artefatos de outro release/runId/sourceFingerprint, sem arquivos temporários/runtime empacotados; relatório em `reports/release-hygiene-report.json`), `validate:final-status-projection` (consistência das projeções da decisão canônica: `docs/governance/_platform-status-source.json`, `dev/platform-readiness/latest.json`, `docs/governance/ENTERPRISE_READINESS.md`, `docs/governance/PLATFORM_STATUS.md` e `docs/architecture/RAP_MASTER_SCORECARD.md` devem refletir `final-readiness-report`/`final-governance-report`/`rap-master-scorecard`; falha com `FINAL_STATUS_PROJECTION_STALE`; relatório em `reports/final-status-projection-report.json`; as 5 projeções são regeneradas deterministicamente pelo produtor canônico único `npm run generate:final-status-projections` — nunca editadas independentemente), `validate:experience-api-segregation` (segregação server-side: `WORKSPACE_ROUTE_CLASSIFICATIONS` no módulo puro `api/modules/workspace/workspace.route-classifications.js` (zero requires, carregável offline sem node_modules) consumido por `api/modules/workspace/workspace.routes.js`, com enforcement `getClassificationForAgent`+403 `classification_forbidden` no controller, guards DEVELOPMENT de qa-waves/qa-mesh e RPA técnico, guard SUPPORT de replay/leitura RPA; contadores `productionTechnicalLeaks`/`supportEngineeringLeaks`/`directUrlBypasses` devem ser 0; relatório em `reports/experience-api-segregation-report.json` + cópia canônica packageRequired em `governance/experience-api-segregation-report.json`, verificada offline pelo gate `payload_experience_api_segregation` do verify-payload-governance), `validate:remote-provenance` (proveniência REMOTA do source, fail-closed antes do SEAL_GO: commit/tree do release devem existir no remote — tip de branch remoto ou ancestro do tip — com tag de release imutável quando `--require-tag`; relatório em `reports/source-remote-provenance-report.json` + cópia canônica packageRequired em `governance/source-remote-provenance-report.json`, verificada offline com hash binding pelo gate `manifest_provenance` do verify-payload-governance; a tag é criada fora do pipeline por `scripts/create-release-tag.sh`, nunca com push automatizado no two-pass), `validate:release-dag` (DAG do release: `governance/release-dag.js` + `release-state-machine.js`; nenhum gate pode exigir artefato de fase POSTERIOR à sua — violação = `RELEASE_PHASE_ORDER_VIOLATION`; ciclo = `RELEASE_DEPENDENCY_CYCLE` abortado ANTES de qualquer mutação de pacote, com caminho completo no relatório; artefato com `embedsOwnHash=true` = `RELEASE_SELF_REFERENTIAL_ARTIFACT`; relatório em `reports/release-dag-report.json`), `validate:release-artifact-identity` (identidade/lineage dos artefatos físicos: candidato `artifactType=CANDIDATE` em `dist/candidate/` nunca rotulado DELIVERED/PUBLISHED/FINAL; payload `DELIVERED_PAYLOAD` com `parentCandidateHash`/`finalPayloadHash` conferidos contra os BYTES reais; `runId`/`sourceCommit`/`sourceFingerprint` idênticos entre candidato, entregue e run corrente — artefato de outro run = `FOREIGN_RUN_ARTIFACT`; sem payload no disco a verificação é `PENDING_PHASE` (exit 0), nunca FAIL de conteúdo; relatório em `reports/release-artifact-identity-report.json`), `validate:route-mounts` (coerência estática entre os `*Router` instanciados em `api/app/registerRoutes.js` e os `routers.*` montados em `api/app/routeRegistry.js`: router fora da lista NÃO é montado e responde 404 sem erro de boot; relatório em `reports/route-mount-report.json`), `validate:coverage-gate`.
- Validadores adicionados no ciclo de recertificação 2026-09-19 (também bloqueantes, no agregado): `validate:benchmark-certification-consistency` (autoridade única de certificação de benchmark em `scripts/governance/lib/benchmarkCertificationAuthority.js` — os gates semantic-version/persisted-corpus/phase-model consomem o MESMO conjunto de verticais certificadas derivado pelo Sufficiency Engine, nunca o campo declarado `sample.claim`, que nenhum produtor grava; checks `BENCHMARK_CERTIFICATION_CROSS_CONSISTENCY` e `BENCHMARK_CERTIFICATION_NON_VACUOUS`: vertical certificada com zero auditoria = FAIL; relatório em `reports/benchmark-certification-consistency-report.json`), `validate:pbx-ami-secret` (nenhum segredo AMI funcional/default versionado — `manager.conf` NASCE renderizado de `manager.conf.template` por `pbx/asterisk/asterisk-start.sh` via envsubst com `AMI_SECRET`/`AMI_BINDADDR`, ACL deny-first preservada; checks `PBX_AMI_NO_DEFAULT_SECRET`/`PBX_AMI_NO_PLAINTEXT_SECRET`/`PBX_AMI_ACL`; relatório em `reports/pbx-ami-secret-report.json`), `validate:mcp-research-docker-e2e` (E2E Docker real do mcp-research: container healthy, rede `rap-internal` Internal=true medida em runtime, `tools/list` + `tools/call` + `GET /health` reais de dentro da rede, egress, probes NEGATIVOS contra Postgres/Redis/Asterisk operacionais, credencial AMI legada não pode autenticar, `--with-restart` prova recovery; sem Docker o status é `REQUIRES_DOCKER_RUNTIME` — não é prova: `scripts/governance/verify-mcp-research-docker-e2e-pass.js` torna o gate OBRIGATÓRIO no seal (release final não existe sem relatório PASS); relatório em `reports/mcp-research-docker-e2e-report.json`).
- Validadores adicionais: `validate:ai-memory-consistency`, `validate:layer-conventions`, `validate:invariants`.
  `validate:layer-conventions` continua **não bloqueante por decisão de projeto** (fora do agregado). Estado medido em 2026-09-13 (após a limpeza de camadas): **118 hard errors / 118 issues — TODOS na classe `engine/` (pureza)**, zero issues em `api/`. Backlog anterior: 123 erros / 287 issues.
  O que JÁ foi corrigido (não reabrir):
    - 164 `console.*` em `api/` → `api/utils/logger` (e `api/utils/bootstrapLog.js`, log sem dependências, para `api/utils/config.js`, que a cadeia do logger requer e que não pode depender dele);
    - 4 ESM exports fora do backend: `api/core/featureFlags.js` (consumido só por testes do frontend) movido para `lib/featureFlags.js`;
    - 1 falso positivo da regra de fallback em memória: `api/services/systemStatusService.js` apenas REPORTA a política (`config.get('fallbacks.rateLimitRedisToMemory')`, fail-closed em produção) — o fallback existente é de RATE LIMITING, não de persistência (`infra/rate-limit`). Contrato da regra fixado em `tests/unit/governance/layerConventionsPersistenceRule.test.js` (nos dois sentidos).
  O que RESTA (classe `engine/`): 46 `new Date`, 24 `fs`/`require(fs)`, 23 `console.*`, 13 `process.*`, 7 timers, 5 `Math.random`, distribuídos em 32 arquivos. Correção exige (a) INJEÇÃO de relógio/aleatório/logger/scheduler nos módulos de fluxo (`engine/nodes/*`, `engine/runner.js`, `engine/executeStep.js`, `engine/validator.js`, `engine/flowSimulation.js`) e (b) MOVER para `api/services/` os módulos que são I/O por natureza (`engine/services/persistenceServices.js`, `engine/services/fileRagService.js`, `engine/services/humanLiveAdapter.js`, `engine/ai/aiTelemetry.js`, `engine/qa/qaTelemetry.js`, `engine/chaosTesting.js`, `engine/fallbackController.js`). Não é refactor mecânico: `new Date`/`Math.random` em `engine/` afetam determinismo de replay (gate bloqueante) e `engine/` é compartilhado com o frontend — exige regressão de replay + build do frontend a cada arquivo movido. **Nunca "corrigir" parcialmente nem baixar a regra para fechar o gate.**
- Coverage e visibilidade: `npm run validate:coverage-gate` (gate bloqueante de cobertura — visitada/validada/ponderada + thresholds de críticos; pisos não críticos seguem política ratchet: baseline 2026-07-25, só sobem; `--informative` para modo não bloqueante; relatório em `reports/coverage-gate-report.json`), `npm run wave:db-integrity` (Database Integrity Wave: valida os models do inventário no Postgres real — tiers estático+live, relatório versionado `reports/db-integrity-report.json` consumido pelo gate como fonte de execução técnica), `npm run wave:api-surface` (API Surface Wave: probes HTTP reais contra o servidor vivo para cada rota `api:` do inventário — existência da rota via header `x-api-route-fallback`, enforcement de auth e de classificação SUPPORT/DEVELOPMENT com política de probe seguro (métodos mutáveis recebem probe anônimo e, em rotas SUPPORT/DEVELOPMENT com auth declarada, também probe com papel PRODUCTION — `requireClassification` rejeita antes do handler; em rota PRODUCTION mutável o probe autenticado é proibido porque executaria efeito real); endpoints públicos por design — login, webhooks de provedor com assinatura HMAC, captura pública com token+rate limit — recebem estado terminal NOT_APPLICABLE via isenção `publicByDesign`, honrada apenas quando nenhum probe é executável; isenções justificadas e auditáveis em `config/api-surface-exemptions.json`; relatório versionado `reports/api-surface-report.json` consumido pelo gate como fonte de execução técnica), `npm run wave:page-surface` (Page Surface Wave: probes reais de navegação com Playwright contra o frontend vivo para cada página `page:` do inventário — enforcement de auth em páginas guardadas, enforcement de classificação SUPPORT/DEVELOPMENT e carregamento são sem erros de console; isenções justificadas em `config/page-surface-exemptions.json`; relatório versionado `reports/page-surface-report.json` consumido pelo gate como fonte de execução técnica), `npm run report:tenant-isolation` (fonte real de `tenantIsolationViolations`: suítes Jest de tenant → `reports/tenant-isolation-report.json`, versionado como exceção do `.gitignore`), `npm run validate:visibility-policy` (separação PRODUCTION/SUPPORT/DEVELOPMENT no menu e nas APIs de QA/RPA), `npm run inventory:build` (regenera `config/system-inventory.json` com diff), `npm run analyze:impact` (impacto de mudanças do inventário no grafo), `npm run demo:coverage` (6 cenários executáveis do Coverage Engine).
- Frescor das evidências de wave: relatórios das três waves técnicas sem `generatedAt` ou mais velhos que 7 dias (override `COVERAGE_GATE_WAVE_REPORT_MAX_AGE_MS`) têm seus estados VALIDATED degradados para STALE no coverage gate — evidência vencida não conta como cobertura válida (`applyWaveReportStaleness` em `scripts/governance/validate-coverage-gate.js`; regressão em `tests/unit/coverage/coverageGateStaleness.test.js`). Refresh automatizado semanal (domingo ~03:17 UTC) e sob demanda via `.github/workflows/wave-reports.yml` (stack viva efêmera, commit `[skip ci]` apenas se houver mudança).
- `npm run validate:governance-enforcement` é o **gate agregado**. Se qualquer validador falhar, a tarefa não está release-green; reporte a falha com a evidência gerada em `reports/*.json`.
- `npm run qa:mesh` → malha canônica de cenários (go/no-go em `qa-mesh/go-no-go-report.json`).
- Relatórios oficiais ficam em `reports/*.json`; `reports/governance-score.json` é a única fonte para `overallGovernance`.

### Release e deploy

- Autoridade única de release completo (selagem + publicação): `npm run release:seal` (ver abaixo). `npm run system:release` e `npm run zip:release` são etapas internas do pipeline de release, não o release completo.
- Caminho AI-native: `npm run validate:governance-enforcement` seguido de `npm run zip:release` quando packaging está em escopo.
- **Ciclo completo de selagem + publicação: `npm run release:seal`** (`scripts/governance/seal-release.sh`).
  Use-o em vez de encadear os passos à mão. Ele orquestra as 5 fases
  (`prepare` → `candidate` → `final` → `publish` → `consolidate`), é retomável
  (`--from <fase>`), tem plano (`npm run release:seal:plan`) e encarna as armadilhas
  que já custaram ciclos inteiros: convergir antes de tudo quando `dist/` está vazio
  (o scorecard é re-derivador e **amplifica** 16 → 34 se rodado nesse estado), tratar
  o exit 1 do candidato como sucesso esperado, passar `--manifest` ao
  `verify-remote-provenance` (sem a flag ele usa `rev-parse HEAD` e produz
  `RELEASE_TAG_CONFLICT` enganoso), ler o commit do release do **manifest**
  (`git_commit`) e nunca do banner/HEAD, e rodar a varredura agregada **antes** da
  verificação final seguida dos reparos de lineage/projeção (a varredura clobbera
  `experience-segregation-report.json` e invalida a projeção de jornada).
- `npm run zip:release` (`scripts/release-package.sh`) gera ZIP auditado + manifesto SHA-256 em `dist/`; **bloqueia** se detectar `.env`, `.token.env`, dumps ou backups; mantém apenas os 3 ZIPs mais recentes.
- `npm run runtime:clean` limpa estado transitório antes do pacote (`runtime:clean:check` falha se restar resíduo). `qa-mesh/meshHistory/` **não** é resíduo: é evidência governada exigida por `validate:qa-governance` (execução canônica), com retenção própria do mesh — o cleaner a preserva desde 2026-08-15.
- Deploy apenas a partir de artefato aprovado: `npm run system:deploy`; gate pré-deploy `npm run deploy:gate:official` (dry-run por padrão). Deploy real exige `SYSTEM_DEPLOY_EXECUTE=1` e manifesto com `audit: passed` + `goNoGo: GO`.
- Produção via Docker Compose: `docker-compose.prod.yml` (serviços: api, frontend, rag-service, postgres/pgvector, redis, asterisk). Comandos `deploy:build`, `deploy:up`, `deploy:full` etc. CI de release: `.github/workflows/release-governance.yml`.

## Convenções de código

- Backend: **CommonJS** (`require`/`module.exports`, `'use strict'`). Frontend: **ES modules**.
- Rotas frontend: fonte da verdade em `frontend/src/main.jsx`; menu em `frontend/src/navigation/menu.js` (áreas em `frontend/src/navigation/workspaceAreas.js`).
- Rotas backend: composição em `api/app/registerRoutes.js`, `api/app/routeRegistry.js` e `api/composition/*`; handlers devem delegar a serviços de domínio, sem concentrar regras.
- Módulos compartilhados do frontend vivem em `frontend/src/shared/`.
- Estado realtime via **WebSocket**; PROIBIDO `setInterval` para sincronizar estado.
- Persistência: sem fallback em memória. Falha de DB deve gerar erro explícito (`persistence_required`).
- Logger/Config: usar `api/utils/logger` e `api/utils/config` (nunca `console.log` direto). Coerção defensiva: `api/utils/defensiveCoercion`.
- Flow Editor: configs de nó sempre via `SidebarProperties`; `frontend/src/editor/nodeSchemas.js` é a fonte única para campos, portas e validação.
- Estilos: classes CSS reutilizáveis; inline apenas para valores dinâmicos.
- Siga a arquitetura e os padrões existentes antes de criar abstrações novas.
- Fontes canônicas de estilo: `CLAUDE.md`, `PROJECT_RULES.md`, `CURSOR_RULES.md` (raiz do repo).

## Validação em runtime (browser real)

- Antes de documentar comportamento web, autenticar no frontend real com `tests/helpers/playwrightAuth.js` (todos os testes de browser devem reutilizá-lo).
- Credenciais de QA local: `systemadmin` / `Admin123!`, tenant `system` — apenas para validação local, salvo indicação em contrário.
- Validar DOM, URL final, origem do menu/sidebar, permissões, erros de console e falhas de rede.
- Registrar aliases e gaps em `AI_MEMORY/runtime-navigation.md` e `AI_MEMORY/project-runtime-map.md`.

## Regras de governança e segurança

- QA Waves, QA Mesh, integridade de replay, validação de pacote, release gate e self-proving são **bloqueadores de release**, não sugestões.
- Nunca declarar `GO_FINAL_HARDENED` enquanto a governança canônica de mesh/release estiver `NO_GO`.
- Nunca afirmar `overallGovernance >= 95` sem que `reports/governance-score.json` exista e reporte `status=PASS`.
- Preservar `replayHash`, checksum, assinatura, tamper detection, provenance e linkage em qualquer trabalho de replay.
- Nunca converter falha de gate em narrativa de sucesso; falhas dos scripts de governança são bloqueantes.
- Não fazer fallback silencioso de runtime real para sintético quando um gate exige runtime real.
- Evidências (screenshots/traces) ficam em diretórios governados (`AI_MEMORY/evidence/`, `qa/...`), nunca em `dist/` nem em payloads de release; podar artefatos transitórios.
- `dist/` deve permanecer limpo, exceto ZIPs/manifestos de release aprovados.
- Nunca commitar/empacotar `.env`, `.token.env`, tokens, dumps, backups, `node_modules`, caches de auth do WhatsApp ou caches transitórios de autenticação de browser.
- `.env` exige `ENCRYPTION_KEY` válida; `.env` e `api/data/config.json` são criados pelo `system:bootstrap` a partir dos exemplos do repositório.
- Caminhos de runtime/evidência devem usar raízes externas ao workspace; o runtime root é resolvido automaticamente pela aplicação (`/var/lib/ragent2` em produção, `~/.local/share/ragent2-runtime` em dev); ver `docs/runtime-paths.md`.
- Docker é o modelo oficial de runtime/deploy em produção; nunca introduzir PM2. **Imagens Docker são SEMPRE construídas localmente** (workstation/CI) e transferidas ao servidor via `docker save | ssh 'docker load'` — nunca rodar `docker build`/`docker compose build` no host de produção (ver `AI_MEMORY/deployment-rules.md`).
- APIs de engenharia (QA Waves, QA Mesh) exigem `requireClassification('DEVELOPMENT')`; APIs de replay/leitura RPA (GET/DELETE `/rpa/recordings*`, GET `/rpa/execution/:id`, GET `/rpa/execution/:id/report`, `/api/test-executions/replays*`) exigem `requireClassification('SUPPORT')`; APIs de gravação/execução técnica RPA (POST `/rpa/record/start`, `/rpa/record/stop/*`, GET `/rpa/record/status/*`, POST `/rpa/execute/*`, POST `/rpa/execution/*/cancel|continue|next`) exigem DEVELOPMENT (`ensureRpaDevelopmentAccess` em `api/modules/rpa-tests/rpaRouteUtils.js`) (`api/middleware/requireClassification.js`). **Classificação é independente do tenant role** (2026-08-27): resolve por `platformClassification`/`platformRole` server-side (`users.platform_role`: support_n1/n2/n3, customer_success, platform_support → SUPPORT; engineer, qa_engineer, devops, platform_engineer, developer → DEVELOPMENT), com fallback `super_admin`→DEVELOPMENT; **tenant role `auditor` sem `platformRole` é PRODUCTION** (não ganha Platform Support automaticamente). No frontend, a página de replays (`/rpa-replays`) é acessível à classificação SUPPORT+ (menu por `classifications`, não por role); gravação/seeds/`/dev/*` seguem super_admin/DEVELOPMENT. A política canônica de rotas é `api/modules/agent-os/experience-segregation.js`, verificada por `validate:visibility-policy` (rotas/menu/APIs) e `validate:experience-segregation` (conteúdo técnico proibido em superfícies PRODUCTION do frontend; exemptions auditáveis em `config/experience-segregation-exemptions.json`). No inventário (`api/services/qa/inventory/frontendRouteScanner.js`), a classificação de páginas honra o `classifications` declarado no menu — item restrito a SUPPORT/DEVELOPMENT nunca é classificado PRODUCTION por heurística de path.
- **Inbox omnichannel ≠ Case Management** (2026-08-28): o Inbox opera sobre `ChannelConversation`/`ChannelMessage` e funciona sem tickets (`current_ticket_id` é nullable). Case Management (`/cases`, `api/services/caseService.js`) é capability opcional do tenant — fonte server-side em `tenant_settings.capabilities` via `api/services/tenantCapabilitiesService.js` (`{ inbox, caseManagement, caseCreationPolicy: manual|suggest|automatic }`), enforcement por `api/middleware/requireTenantCapability.js` (403 `capability_disabled`) e toggle em Configurações/onboarding. Capabilities canônicas `inbox.manage` e `case.manage` em `config/canonical-capabilities.json` (aliases legados `inbox.process`→`inbox.manage`, `ticket.manage`→`case.manage`; deprecações auditáveis na seção `deprecatedAliases` do mesmo arquivo — código novo nunca usa `ticket.*` nem `support.*` para Case Management/Customer Service). A Central de Atendimento legada `/support` (ticket-based) está **deprecated** e gated por `caseManagement` (menu oculto + acesso direto fail-closed com guard de capability); a superfície canônica é Inbox + Chamados. A superfície de engenharia do Workspace (tab/painel QA/RPA, `workspaceDevSurface.js`) é **DEVELOPMENT-only** — SUPPORT recebe diagnóstico apenas via PlatformSupportPage/SupportEvidenceCard. Relação N:N case↔conversas via tabela `case_conversations` (migration `20260827000002`). `/cases` é rota dual SPA+API no dev server (ver proxy em `frontend/vite.config.mjs`); em produção o tráfego de API passa pelo prefixo `/r-agent2/api/` (Apache).

## Estado de governança observado

Conforme `docs/governance/PLATFORM_STATUS.md` (gerado em 2026-06-12): mesh canônico **GO**, mas decisão de readiness **NO_GO:AUTONOMOUS_READY_GO** (score 83.5) — o ZIP de release não contém todos os proofs obrigatórios (`gap-proof-package-validation`). QA coverage 100%, vertical coverage 100%. Sempre reconsulte o arquivo antes de afirmações de status.

## Continuidade de missão (loop obrigatório, com enforcement executável)

A fila oficial de pendências é `AI_MEMORY/hardening-queue.json`. Ela é a única fonte
de verdade sobre "o que ainda falta" — não o histórico de commits nem a narrativa do
turno.

- Antes de começar um item, mude o status para `in_progress`.
- Ao concluir, mude para `done` gravando `commit` (hash real) e `evidence` (caminho da prova).
- Item impossível vira `blocked` com `blocked_reason` escrito — **nunca** `done` sem prova.
- Nunca encerre o turno com item `pending`/`in_progress` na fila.

Enforcement determinístico: `.github/hooks/continue-until-done.json` (script
`continue-until-done.cjs`) roda em `SessionStart` e `Stop`. No `SessionStart` injeta a
fila como contexto; no `Stop` devolve `decision: block` com o próximo item, impedindo o
encerramento enquanto houver item aberto **e houver progresso** (HEAD, worktree ou fila
mudaram) desde o último bloqueio. Sem progresso ele libera, para não entrar em loop
infinito, e há um teto de continuidades consecutivas (`MISSION_MAX_CONTINUES`, default 50).
Isso é enforcement executável, não prosa: **não remova, não relaxe e não contorne** alterando
a fila para esvaziá-la sem prova real.

## Auditoria externa: como detectar que o estado mudou

Um auditor externo que lê este repositório **via git** não enxerga a prova: `reports/*.json`
e `governance/*.json` são ignorados por política (`.gitignore` linhas 118/124). O ponto de
entrada único e versionado é:

- **`AI_MEMORY/evidence/AUDIT_ENTRYPOINT.md`** — estado corrente derivado: `auditEpoch` (sha256 do
  payload), SHA-256 de cada prova em disco, artefatos físicos do release, fila oficial e o veredito
  medido do gate agregado. O payload JSON íntegro vem embutido em bloco cercado no fim do arquivo.

Por que `.md` e não `.json`: `audit:json-persistence` (passo bloqueante do gate agregado) reprova com
`UNKNOWN` todo alvo de escrita `.json` fora da taxonomia canônica, e `AI_MEMORY/evidence/` não está
nela. Publicar um `.json` ali derruba o agregado (medido em 2026-10-16). Classificar o diretório exige
editar `governance/**` (SOURCE_ROOTS) e re-selar o release — item aberto na fila oficial.

Detectar mudança desde a última auditoria:

```bash
git log --oneline -20
git log -1 --format=%H -- AI_MEMORY/evidence/AUDIT_ENTRYPOINT.md   # commit do epoch atual
```

`auditEpoch` diferente do registrado, ou `payload.provas[].sha256` divergente do arquivo em
disco, significa que houve mudança (ou adulteração) e a auditoria deve ser refeita.
Regenerar: `node tools/audit/generate-audit-entrypoint.js [--aggregate-log <log> --aggregate-head <sha>]`.

## Checkpoints de desenvolvimento (auditoria incremental por commit)

Desenvolvimento com auditoria externa incremental acontece em **`dev/engineering-hardening`**
(nunca commit direto na `main`, nunca tag, nunca force-push). Cada correção independente vira um
checkpoint:

```bash
node tools/audit/checkpoint.js --title "area: o que mudou" --problem "problema real" \
  --tests "npx jest <teste relevante>" [--tests "<outro>"]
```

O gravador deriva branch, SHA de base, arquivos e testes (exit code, duração, sha256 da saída) do
estado real, e **se recusa a escrever se qualquer teste falhar** — não existe checkpoint verde
nascido de teste vermelho. Registro versionado: `AI_MEMORY/evidence/checkpoints.md`.
Protocolo completo: `AI_MEMORY/operational-checklists/checkpoint-protocol.md`.

Atenção: os ponteiros de fechamento na raiz (`FINAL_RAP_RELEASE_CLOSURE.json`,
`FINAL_RELEASE_CLOSURE.md`, `ENGINEERING_ROUTER_V1_*.md/json`) são **históricos/stale** — nenhum
gate os mantém e eles congelaram em 2026-09-22/24. Não os use como estado corrente.
