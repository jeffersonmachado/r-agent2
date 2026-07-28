# AGENTS.md — RAP / r-agent2 (Results Autonomous Platform)

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
- **RAG (`rag-service/`):** serviço Python separado — FastAPI + Uvicorn (porta 8000), sentence-transformers (all-MiniLM-L6-v2, torch CPU), pgvector como vector store, OpenAI opcional. Testes com pytest (`rag-service/pytest.ini`, venv em `rag-service/venv`).
- **RPA (`core/rpa/`):** gravação/replay/player determinísticos com Playwright, CLI em `core/rpa/cli.js`.
- **Mobile:** `apps/mobile/` existe mas está vazio (apenas `node_modules`).
- **Infra:** Docker Compose (produção), systemd (redis + rag-service), Apache como reverse proxy. **Nunca introduzir PM2.**
- **Dependência externa de pacote:** `@results/auth` é dependência `file:../../packages/auth`; o Jest inclui `/opt/results/packages` em `roots` (ver `jest.config.cjs`). Em clones fora de `/opt/results/ria/`, garantir que o diretório irmão `packages/` exista. `vendor/auth/` é a cópia versionada desse pacote usada pelo CI (o workflow copia `vendor/auth` → `../../packages/auth` antes do `npm ci`); ao alterar o pacote em `/opt/results/packages/auth`, sincronizar `vendor/auth/`.

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
- `qa/`, `qa-mesh/`, `qa-waves/` → runner de QA, malha de cenários (registry, runner, scheduler, go/no-go) e cobertura por ondas. São insumos de governança de release, não extras opcionais.
- `qa/coverage/` → Coverage Engine: fingerprints SHA-256 canônicos, estados de cobertura (UNCOVERED→VALIDATED/STALE/ORPHANED etc.), grafo de rastreabilidade, calculadora (visitada/validada/sucesso/ponderada), Evidence Store append-only com hash chain + redaction, motor do coverage gate e análise de impacto. Inventário automático versionado em `api/services/qa/inventory/` (saída: `config/system-inventory.json`). Doc canônica: `docs/qa/coverage-engine.md`.
- `governance/` → engines e relatórios de prova: self-proving, integridade de replay, validação de pacote, tamper detection, readiness.
- `pipeline/` → validação completa, release gate e autocorreção (`pipeline/runFullValidation.js`, `pipeline/entrypoints/`).
- `tools/system/` → comandos oficiais do ciclo de vida do sistema (bootstrap, validate, release, deploy, release-gate, go-no-go etc.).
- `config/`, `contracts/` → registries de capacidades/jornadas e contratos JSON (versões em `contracts/versions.json`).
- `migrations/` → DDL SQL (ex.: `agent-os-2026-06-11.sql`); migrations da API em `api/db/migrate.js`.
- `scripts/` → automação de bootstrap, release, deploy, smokes e governança (`scripts/governance/` contém os validadores bloqueantes).
- `tests/` → suítes Jest (unit, flow, integration, contracts, governance, ci, runtime, organizational, stress, rate-limit, rpa, security etc.).
- `reports/` → relatórios oficiais de governança em JSON (ver seção de governança).

### Legado a ignorar

- Arquivos soltos na raiz: `test-*.js`, `debug-*.js`, `validate-*.js`, `direct-*.js`.
- Diretórios: `frontend_backup/`, `backups/`, `remote-dumps/`, `remote-dumps2/`, `scripts/legacy/`.
- Relatórios `.md` na raiz (`PHASE2_*`, `EXECUTIVE_*`, `GO_REPORT_*`, `REFACTORING_*`) e PNGs de screenshot na raiz.
- Docs históricos em `dev Documentos/` e relatórios de raiz são históricos, salvo quando um índice canônico os referencia.

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
- `npm run test:flow` → testes E2E de fluxo (`tests/flow`).
- `npm run test:rpa:jest` → testes RPA sem browser (flags `RPA_SKIP_BROWSER_TESTS`/`SKIP_RPA_INTEGRATION_TESTS`).
- `npm run test:system` → contratos, governança, CI, runtime, organizacional, stress e rate-limit.
- `npm run test:vertical:proof` → prova das verticais Beauty/Fitness (unit + integration + `scripts/vertical-e2e-validate.js`).
- Frontend: `npm run frontend:test` (Vitest, config `frontend/vitest.config.mjs`) e `npm run frontend:test:e2e` (Playwright, em `frontend-e2e/`).
- RAG: `pytest` dentro de `rag-service/` (usando o venv local).
- Smokes: diversos `test:*:smoke` (voice, pbx, whatsapp, inbox, demo, bpmn etc.) via `scripts/`.
- Jest: config em `jest.config.cjs` (timeout 10s, `bail: 1`, ambiente node, roots em `engine/`, `api/`, `tests/`, `qa/`, `qa-mesh/`, `lib/` e `/opt/results/packages`; `tests/rpa/` ignorado por padrão).

### Governança executável (bloqueante)

Documentação não é suficiente. Use os validadores bloqueantes em `scripts/governance/`:

- `npm run validate:ai-memory`, `validate:runtime`, `validate:browser-evidence`, `validate:qa-governance`, `validate:replay-governance`, `validate:release-governance`, `validate:dist`, `validate:agent-adherence`, `validate:self-proving`, `validate:cleanup`, `validate:operational-rules`, `validate:coverage-completeness`, `validate:business-needs`, `validate:governance-summary`, `validate:visibility-policy`, `validate:coverage-gate` (os dois últimos, nesta ordem, fecham o gate agregado).
- Validadores adicionais: `validate:ai-memory-consistency`, `validate:layer-conventions`, `validate:invariants`.
- Coverage e visibilidade: `npm run validate:coverage-gate` (gate bloqueante de cobertura — visitada/validada/ponderada + thresholds de críticos; pisos não críticos seguem política ratchet: baseline 2026-07-25, só sobem; `--informative` para modo não bloqueante; relatório em `reports/coverage-gate-report.json`), `npm run wave:db-integrity` (Database Integrity Wave: valida os models do inventário no Postgres real — tiers estático+live, relatório versionado `reports/db-integrity-report.json` consumido pelo gate como fonte de execução técnica), `npm run wave:api-surface` (API Surface Wave: probes HTTP reais contra o servidor vivo para cada rota `api:` do inventário — existência da rota via header `x-api-route-fallback`, enforcement de auth e de classificação SUPPORT/DEVELOPMENT com política de probe seguro (métodos mutáveis só recebem probe anônimo); isenções justificadas e auditáveis em `config/api-surface-exemptions.json`; relatório versionado `reports/api-surface-report.json` consumido pelo gate como fonte de execução técnica), `npm run report:tenant-isolation` (fonte real de `tenantIsolationViolations`: suítes Jest de tenant → `reports/tenant-isolation-report.json`, versionado como exceção do `.gitignore`), `npm run validate:visibility-policy` (separação PRODUCTION/SUPPORT/DEVELOPMENT no menu e nas APIs de QA/RPA), `npm run inventory:build` (regenera `config/system-inventory.json` com diff), `npm run analyze:impact` (impacto de mudanças do inventário no grafo), `npm run demo:coverage` (6 cenários executáveis do Coverage Engine).
- `npm run validate:governance-enforcement` é o **gate agregado**. Se qualquer validador falhar, a tarefa não está release-green; reporte a falha com a evidência gerada em `reports/*.json`.
- `npm run qa:mesh` → malha canônica de cenários (go/no-go em `qa-mesh/go-no-go-report.json`).
- Relatórios oficiais ficam em `reports/*.json`; `reports/governance-score.json` é a única fonte para `overallGovernance`.

### Release e deploy

- Caminho oficial de release: `npm run system:validate` → `npm run zip:release` → `npm run system:release`.
- Caminho AI-native: `npm run validate:governance-enforcement` seguido de `npm run zip:release` quando packaging está em escopo.
- `npm run zip:release` (`scripts/release-package.sh`) gera ZIP auditado + manifesto SHA-256 em `dist/`; **bloqueia** se detectar `.env`, `.token.env`, dumps ou backups; mantém apenas os 3 ZIPs mais recentes.
- `npm run runtime:clean` limpa estado transitório antes do pacote (`runtime:clean:check` falha se restar resíduo).
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
- Caminhos de runtime/evidência devem usar raízes externas quando possível (`RUNTIME_ROOT`, padrão `/var/lib/ragent2` em containers); ver `docs/runtime-paths.md`.
- Docker é o modelo oficial de runtime/deploy em produção; nunca introduzir PM2.
- APIs de engenharia (QA Waves, QA Mesh) exigem `requireClassification('DEVELOPMENT')` e APIs de replay/RPA `requireClassification('SUPPORT')` (`api/middleware/requireClassification.js`; mapeamento role→classificação: super_admin→DEVELOPMENT, auditor→SUPPORT, demais→PRODUCTION). A política canônica de rotas é `api/modules/agent-os/experience-segregation.js`, verificada por `validate:visibility-policy`.

## Estado de governança observado

Conforme `docs/governance/PLATFORM_STATUS.md` (gerado em 2026-06-12): mesh canônico **GO**, mas decisão de readiness **NO_GO:AUTONOMOUS_READY_GO** (score 83.5) — o ZIP de release não contém todos os proofs obrigatórios (`gap-proof-package-validation`). QA coverage 100%, vertical coverage 100%. Sempre reconsulte o arquivo antes de afirmações de status.
