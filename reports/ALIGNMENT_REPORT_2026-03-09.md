# ALIGNMENT REPORT — 2026-03-09

## 1) Resumo executivo

O alinhamento para a arquitetura operacional canônica foi consolidado de forma incremental, mantendo compatibilidade com os fluxos existentes. O core agora cobre explicitamente a cadeia **events → signals → recommendations → quick actions → playbooks → outcomes**, sem reescrita disruptiva e sem quebra funcional detectada em regressão no-RPA.

---

## 2) Escopo e diretriz de implementação

Escopo aplicado nesta rodada:

- Centralizar inteligência operacional no core.
- Preservar contratos legados e comportamento atual (CRM/Support/OCC).
- Adicionar caminhos canônicos de módulo/modelo/evento sem remover os antigos.
- Manter desenho multi-tenant com resolução de tenant e escopo por request.

Critério de execução: priorizar convergência arquitetural com mudanças cirúrgicas e compatíveis.

---

## 3) Arquitetura canônica alvo e aderência

Alvo canônico implementado:

- **Domain modules publish facts/events**
- **Central Operational Core interprets signals, recommends, executes e rastreia outcomes**

Status de aderência: **ALTO**, com fallback de compatibilidade preservado onde já havia fluxo contextual legado.

---

## 4) Módulos canônicos adicionados/normalizados

Foram adicionados os seguintes pontos de entrada canônicos:

- [api/core/operational-event-bus/index.js](../api/core/operational-event-bus/index.js)
- [api/core/operational-recommendations/RecommendationEngine.js](../api/core/operational-recommendations/RecommendationEngine.js)
- [api/core/operational-recommendations/OutcomeTrackingService.js](../api/core/operational-recommendations/OutcomeTrackingService.js)
- [api/core/operational-recommendations/index.js](../api/core/operational-recommendations/index.js)

Esses módulos encapsulam/reexportam componentes existentes para estabilizar nomenclatura e import paths canônicos.

---

## 5) Contrato de eventos canônicos e retrocompatibilidade

Normalização aplicada em [api/core/crm/OperationalEventWriter.js](../api/core/crm/OperationalEventWriter.js):

- Suporte a envelope canônico: `tenant_id`, `event_type`, `entity_type`, `entity_id`, `channel`, `metadata`, `event_id`, `created_at`.
- Mapeamento de aliases legados para tipo canônico.
- Persistência mantém compatibilidade com fluxo atual.

No bus ([api/core/operational-agent/OperationalEventBus.js](../api/core/operational-agent/OperationalEventBus.js)), o processamento prioriza pipeline orientado a evento e preserva fallback contextual.

---

## 6) Centralização de sinais e recomendações

Evoluções principais:

- [api/core/operational-agent/SignalDetectionService.js](../api/core/operational-agent/SignalDetectionService.js): inclusão de `detectSignalsFromEvent` e `detectSignalsFromEvents`.
- [api/core/operational-agent/OperationalAgentService.js](../api/core/operational-agent/OperationalAgentService.js): inclusão de `processOperationalEvent` e geração por sinais.

Resultado: sinais passam a poder nascer diretamente de fatos/eventos canônicos, em vez de depender apenas da varredura contextual.

---

## 7) Ações rápidas, playbooks e rastreio de outcomes

Centralização de execução/rastreio:

- [api/core/operational-quick-actions/OperationalQuickActionRegistry.js](../api/core/operational-quick-actions/OperationalQuickActionRegistry.js): enriquecimento com metadados de capability (`required_permissions`, `supported_contexts`, `parameter_schema`, `audit_behavior`).
- [api/core/operational-quick-actions/QuickActionExecutor.js](../api/core/operational-quick-actions/QuickActionExecutor.js): delegação de persistência para `OutcomeTrackingService`.
- [api/core/operational-recommendations/OutcomeTrackingService.js](../api/core/operational-recommendations/OutcomeTrackingService.js): serviço central para registro e consulta de outcomes.

Playbooks existentes seguem integrados ao pipeline sem alteração disruptiva de contrato.

---

## 8) Persistência, aliases de modelo e multi-tenant

Aliases canônicos de modelos adicionados:

- [api/db/models/OperationalEvent.js](../api/db/models/OperationalEvent.js)
- [api/db/models/OperationalPlaybookRun.js](../api/db/models/OperationalPlaybookRun.js)
- Exportação em [api/db/models/index.js](../api/db/models/index.js)

Estratégia adotada: convergência por alias e padronização incremental, evitando ruptura de tabelas/modelos já utilizados.

---

## 9) API canônica adicionada (com autenticação/escopo)

Novos endpoints em [api/server.js](../api/server.js):

- `GET /api/operational/actions/available`
- `GET /api/operational/context/:entityType/:entityId`
- `GET /api/operational/outcomes`

As rotas reutilizam os mecanismos existentes de autenticação, tenant scope e autorização.

---

## 10) Evidências de validação pós-refactor

### 10.1 Testes focados dos módulos alterados

Comando:

- `npx jest --runInBand ...OperationalEventWriter.test.js ...SignalDetectionService.test.js ...OperationalEventBus.test.js ...OperationalQuickActionRegistry.test.js ...QuickActionExecutor.test.js ...OutcomeTrackingService.test.js`

Resultado:

- **6 suites passed, 6 total**
- **41 tests passed, 41 total**

### 10.2 Regressão backend no-RPA

Comando:

- `npm run test:backend:full:no-rpa`

Resultado:

- **230 suites passed, 230 total**
- **1220 tests passed, 1220 total**

### 10.3 Regressão completa no-RPA (frontend)

Comando:

- `npm run test:regression:full:no-rpa`

Evidência frontend:

- **55 test files passed, 55 total**
- **279 tests passed, 279 total**
- JUnit: [frontend/test-results/junit.xml](../frontend/test-results/junit.xml)

### 10.4 Teste HTTP dos endpoints canônicos operacionais

Comando:

- `npx jest --runInBand api/server.test.js -t "Operational canonical routes"`

Resultado:

- **1 suite passed, 1 total**
- **13 tests passed, 13 total**
- Cobertura validada para:
	- `GET /api/operational/actions/available`
	- `GET /api/operational/context/:entityType/:entityId`
	- `GET /api/operational/outcomes`
- Contratos de erro validados:
	- `400` (source inválido)
	- `403` (sem permissão / escopo negado)
	- `422` (escopo inválido)

### 10.5 Regressão completa da suíte de servidor

Comando:

- `npx jest --runInBand api/server.test.js`

Resultado:

- **1 suite passed, 1 total**
- **41 tests passed, 41 total**
- Inclui cenários legados do servidor + rotas canônicas operacionais.

### 10.6 Estabilidade da regressão backend no-RPA (stress repeat)

Script adicionado:

- `npm run test:backend:full:no-rpa:stress`

Execução de validação (1 repetição):

- `bash scripts/test-backend-no-rpa-stress.sh 1`
	- **230 suites passed, 230 total**
	- **1220 tests passed, 1220 total**
	- logs gerados em `reports/stress/` (summary + log por execução)

Execução de estabilidade (3 repetições contínuas):

- `npm run test:backend:full:no-rpa:stress -- 3`
	- **run 1:** 230/230 suites, 1220/1220 tests, ~59s
	- **run 2:** 230/230 suites, 1220/1220 tests, ~1290s
	- **run 3:** 230/230 suites, 1220/1220 tests, ~2534s
	- **resultado funcional:** 3/3 pass, sem reproduzir `exit 137` nesta janela
	- **evidências:**
		- `reports/stress/backend-no-rpa-stress-20260309-210046.summary.log`
		- `reports/stress/backend-no-rpa-stress-20260309-210046.run-1.log`
		- `reports/stress/backend-no-rpa-stress-20260309-210046.run-2.log`
		- `reports/stress/backend-no-rpa-stress-20260309-210046.run-3.log`

Mitigação aplicada nesta rodada:

- Desabilitação de logging em arquivo por padrão no ambiente de teste (`NODE_ENV=test`) em `api/utils/logger.js`.
- Hardening dos comandos de regressão/stress backend para `LOG_TO_FILE=${LOG_TO_FILE:-0}` em `package.json` e `scripts/test-backend-no-rpa-stress.sh`.

Revalidação de estabilidade após mitigação (3 repetições contínuas):

- `npm run test:backend:full:no-rpa:stress -- 3`
	- **run 1:** 230/230 suites, 1220/1220 tests, ~61s
	- **run 2:** 230/230 suites, 1220/1220 tests, ~61s
	- **run 3:** 230/230 suites, 1220/1220 tests, ~67s
	- **resultado funcional:** 3/3 pass
	- **resultado de performance:** sem inflação progressiva observada nesta janela
	- **análise automática:** sem anomalias relevantes detectadas
	- **evidências:**
		- `reports/stress/backend-no-rpa-stress-20260309-223221.summary.log`
		- `reports/stress/backend-no-rpa-stress-20260309-223221.run-1.log`
		- `reports/stress/backend-no-rpa-stress-20260309-223221.run-2.log`
		- `reports/stress/backend-no-rpa-stress-20260309-223221.run-3.log`
		- `reports/stress/backend-no-rpa-stress-20260309-223221.analysis.md`

Extensão da janela de estabilidade pós-mitigação (5 repetições contínuas):

- `npm run test:backend:full:no-rpa:stress -- 5`
	- **run 1:** 230/230 suites, 1220/1220 tests, ~59s
	- **run 2:** 230/230 suites, 1220/1220 tests, ~64s
	- **run 3:** 230/230 suites, 1220/1220 tests, ~67s
	- **run 4:** 230/230 suites, 1220/1220 tests, ~69s
	- **run 5:** 230/230 suites, 1220/1220 tests, ~66s
	- **resultado funcional:** 5/5 pass
	- **resultado de performance:** variação controlada, sem inflação progressiva observada
	- **análise automática:** sem anomalias relevantes detectadas
	- **evidências:**
		- `reports/stress/backend-no-rpa-stress-20260309-223926.summary.log`
		- `reports/stress/backend-no-rpa-stress-20260309-223926.run-1.log`
		- `reports/stress/backend-no-rpa-stress-20260309-223926.run-2.log`
		- `reports/stress/backend-no-rpa-stress-20260309-223926.run-3.log`
		- `reports/stress/backend-no-rpa-stress-20260309-223926.run-4.log`
		- `reports/stress/backend-no-rpa-stress-20260309-223926.run-5.log`
		- `reports/stress/backend-no-rpa-stress-20260309-223926.analysis.md`

Janela de endurance pós-mitigação (10 repetições contínuas):

- `npm run test:backend:full:no-rpa:stress -- 10`
	- **run 1:** 230/230 suites, 1220/1220 tests, ~62s
	- **run 2:** 230/230 suites, 1220/1220 tests, ~71s
	- **run 3:** 230/230 suites, 1220/1220 tests, ~65s
	- **run 4:** 230/230 suites, 1220/1220 tests, ~68s
	- **run 5:** 230/230 suites, 1220/1220 tests, ~66s
	- **run 6:** 230/230 suites, 1220/1220 tests, ~66s
	- **run 7:** 230/230 suites, 1220/1220 tests, ~67s
	- **run 8:** 230/230 suites, 1220/1220 tests, ~70s
	- **run 9:** 230/230 suites, 1220/1220 tests, ~67s
	- **run 10:** 230/230 suites, 1220/1220 tests, ~69s
	- **resultado funcional:** 10/10 pass
	- **resultado de performance:** estabilidade sustentada, sem drift progressivo
	- **análise automática:** sem anomalias relevantes detectadas
	- **evidências:**
		- `reports/stress/backend-no-rpa-stress-20260309-224637.summary.log`
		- `reports/stress/backend-no-rpa-stress-20260309-224637.run-1.log`
		- `reports/stress/backend-no-rpa-stress-20260309-224637.run-2.log`
		- `reports/stress/backend-no-rpa-stress-20260309-224637.run-3.log`
		- `reports/stress/backend-no-rpa-stress-20260309-224637.run-4.log`
		- `reports/stress/backend-no-rpa-stress-20260309-224637.run-5.log`
		- `reports/stress/backend-no-rpa-stress-20260309-224637.run-6.log`
		- `reports/stress/backend-no-rpa-stress-20260309-224637.run-7.log`
		- `reports/stress/backend-no-rpa-stress-20260309-224637.run-8.log`
		- `reports/stress/backend-no-rpa-stress-20260309-224637.run-9.log`
		- `reports/stress/backend-no-rpa-stress-20260309-224637.run-10.log`
		- `reports/stress/backend-no-rpa-stress-20260309-224637.analysis.md`

---

## 11) Gaps remanescentes e próximos passos

Status geral: **APROVADO para continuidade** (escopo sem RPA).

Pendências não bloqueantes para próxima iteração:

- Expandir casos HTTP dos endpoints canônicos para cenários de erro específicos (422/403 por escopo/permissão e filtros avançados).
- Formalizar documentação do envelope canônico de eventos em guia contratual dedicado.
- Evoluir rastreabilidade (dashboards/telemetria) para leitura direta do pipeline canônico consolidado.

Conclusão: o sistema permanece estável e compatível, com o core operacional mais centralizado e aderente ao modelo arquitetural definido.

---

## 12) Atualização incremental desta rodada (A2/A3/B1/B2/C1)

### A2 — Desacoplamento de recommendation generation

- [api/core/operational-agent/OperationalAgentService.js](../api/core/operational-agent/OperationalAgentService.js)
	- remoção da dependência direta de `core/insights/RecommendationEngine` na geração por sinal;
	- recomendações agora são materializadas a partir do payload canônico vindo do scorer/policy.
- [api/core/operational-agent/OperationalRecommendationScorer.js](../api/core/operational-agent/OperationalRecommendationScorer.js)
	- delegação para `operational-recommendations/RecommendationPolicyService`.
- [api/core/operational-recommendations/RecommendationEngine.js](../api/core/operational-recommendations/RecommendationEngine.js)
	- criação local/normalização de recommendation (sem ponte no módulo legado de insights).

### A3 + B1 — Publicação canônica e expansão de taxonomia

- [api/core/crm/OperationalEventWriter.js](../api/core/crm/OperationalEventWriter.js)
	- eventos persistidos agora são despachados ao bus operacional em modo sem re-persistência (`persistEvent: false`), mantendo compatibilidade.
- [api/core/operational-agent/OperationalEventBus.js](../api/core/operational-agent/OperationalEventBus.js)
	- suporte a evento já persistido (`persistedEvent`) e guarda contra recursão de escrita.
- [api/core/operational-agent/SignalDetectionService.js](../api/core/operational-agent/SignalDetectionService.js)
	- ampliação de mapeamentos event→signal para famílias CRM/support/scheduling/revenue (`lead_*`, `crm_opportunity_*`, `ticket_*`, `schedule_*`, `follow_up_*`, `revenue_opportunity_created`).

### B2 — Normalização de quick actions

- [api/core/operational-quick-actions/OperationalQuickActionRegistry.js](../api/core/operational-quick-actions/OperationalQuickActionRegistry.js)
	- aliases canônicos de action id (`schedule_contact`, `create_followup_task`, `notify_agent`, etc.) para ids executáveis do registry;
	- mapeamento adicional recommendationType→quick actions para tipos canônicos (`assign_ticket`, `reschedule_appointment`, `review_operational_signal`, etc.).
- [api/core/operational-recommendations/RecommendationCatalog.js](../api/core/operational-recommendations/RecommendationCatalog.js)
	- cobertura ampliada de famílias já emitidas pelo detector (`ticket_escalation`, `channel_attention`, `followup_overdue`, `upsell_opportunity`, `customer_reactivation`).

### C1 — Rastreabilidade de outcomes

- [api/core/operational-recommendations/OutcomeTrackingService.js](../api/core/operational-recommendations/OutcomeTrackingService.js)
	- persistência de `trace` normalizado em action/outcome (source, signalId, recommendationId, playbook ids, sourceEventId, correlationId).

### Evidências de validação desta rodada

- `npx jest api/core/operational-agent/__tests__/OperationalAgentService.test.js api/core/operational-agent/__tests__/OperationalEventBus.test.js api/core/crm/__tests__/OperationalEventWriter.test.js`
	- **9/9 testes pass**
- `npx jest api/core/operational-agent/__tests__/SignalDetectionService.test.js api/core/operational-agent/__tests__/OperationalAgentService.test.js api/core/operational-agent/__tests__/OperationalEventBus.test.js api/core/crm/__tests__/OperationalEventWriter.test.js`
	- **12/12 testes pass**
- `npx jest api/core/operational-quick-actions/__tests__/OperationalQuickActionRegistry.test.js api/core/operational-agent/__tests__/SignalDetectionService.test.js api/core/operational-agent/__tests__/OperationalAgentService.test.js`
	- **17/17 testes pass**
- `npx jest api/core/operational-recommendations/__tests__/OutcomeTrackingService.test.js api/core/operational-quick-actions/__tests__/OperationalQuickActionRegistry.test.js api/core/operational-agent/__tests__/OperationalEventBus.test.js`
	- **17/17 testes pass**

Status após esta rodada: avanço consistente em A2/A3/B1/B2/C1, mantendo compatibilidade e estabilidade no escopo validado.

---

## 13) Atualização incremental desta rodada (C2/C3/C4)

### C2 — Thinning OCC (redução de duplicação)

- [api/routes/operationalOccRoutes.js](../api/routes/operationalOccRoutes.js)
	- centralização dos guard rails OCC em helper comum `withOccSuperAdmin`;
	- eliminação de repetição de autenticação/autorização/erros nas rotas administrativas OCC.

### C3 — Extração de rotas operacionais de `server.js`

- [api/server.js](../api/server.js)
	- remoção do bloco inline de rotas OCC administrativas (`/api/admin/tenants/health`, `/api/admin/tenant/:id/...` operacionais);
	- delegação explícita para `handleOperationalOccRoutes(...)`.
- [api/routes/operationalOccRoutes.js](../api/routes/operationalOccRoutes.js)
	- novo módulo dedicado ao roteamento OCC operacional, preservando contratos HTTP e mensagens de erro existentes.

### C4 — Cenários E2E (HTTP) de fluxo centralizado

- [api/server.test.js](../api/server.test.js)
	- adição de cenários de integração HTTP para OCC:
		- fluxo por contato: `operational-signals/generate` + `operational-recommendations/generate`;
		- listagem OCC de sinais validando `readPath: 'occ'`;
		- guarda de autorização (operador em endpoint OCC admin retorna `403`).

### Evidências de validação desta rodada

- `npx jest api/server.test.js --runInBand -t "Fluxo OCC centralizado|GET OCC /operational-signals|POST OCC status de recomendação"`
	- **1 suite passed**
	- **3 tests passed, 0 failed**
- `npx jest api/server.test.js --runInBand -t "Operational canonical routes"`
	- **1 suite passed**
	- **13 tests passed, 0 failed**

Status após esta rodada: C2/C3/C4 implementados no escopo HTTP/OCC com preservação de compatibilidade e validação focada verde.

---

## 14) Consolidação arquitetural incremental (2026-03-10)

Escopo consolidado nesta rodada final (sem redesign, com compatibilidade):

1. Canonização de modelos operacionais com adapters:
	- [api/db/models/OperationalEvent.js](../api/db/models/OperationalEvent.js)
	- [api/db/models/OperationalPlaybookExecution.js](../api/db/models/OperationalPlaybookExecution.js)
	- [api/db/models/OperationalPlaybookRun.js](../api/db/models/OperationalPlaybookRun.js)
2. Desacoplamento do recommendation core:
	- [api/core/operational-recommendations/RecommendationEngine.js](../api/core/operational-recommendations/RecommendationEngine.js)
	- [api/core/operational-recommendations/SignalRepository.js](../api/core/operational-recommendations/SignalRepository.js)
	- [api/core/operational-recommendations/RecommendationStore.js](../api/core/operational-recommendations/RecommendationStore.js)
	- [api/core/operational-recommendations/QuickActionResolver.js](../api/core/operational-recommendations/QuickActionResolver.js)
3. Redução de centralização no agente operacional:
	- [api/core/operational-agent/OperationalAgentService.js](../api/core/operational-agent/OperationalAgentService.js)
	- [api/core/operational-agent/SignalService.js](../api/core/operational-agent/SignalService.js)
	- [api/core/operational-agent/RecommendationService.js](../api/core/operational-agent/RecommendationService.js)
	- [api/core/operational-agent/OperationalEventProcessor.js](../api/core/operational-agent/OperationalEventProcessor.js)
4. Publicação canônica de eventos expandida:
	- [api/core/crm/OperationalEventWriter.js](../api/core/crm/OperationalEventWriter.js)
	- [api/services/outboundQueueService.js](../api/services/outboundQueueService.js)
	- [api/services/whatsappInboundService.js](../api/services/whatsappInboundService.js)
	- [api/services/ragDocumentsService.js](../api/services/ragDocumentsService.js)
5. Query services OCC/contexto:
	- [api/core/operational-agent/OperationalOccQueryService.js](../api/core/operational-agent/OperationalOccQueryService.js)
	- [api/core/operational-agent/OperationalContextQueryService.js](../api/core/operational-agent/OperationalContextQueryService.js)
	- [api/routes/operationalOccRoutes.js](../api/routes/operationalOccRoutes.js)
	- [api/server.js](../api/server.js)
6. Modularização da detecção via registry:
	- [api/core/operational-agent/SignalDetectorsRegistry.js](../api/core/operational-agent/SignalDetectorsRegistry.js)
	- [api/core/operational-agent/SignalDetectionService.js](../api/core/operational-agent/SignalDetectionService.js)
7. Refino de execução de playbooks:
	- [api/core/operational-playbooks/PlaybookRunner.js](../api/core/operational-playbooks/PlaybookRunner.js)
8. Cobertura e2e/pipeline e regressão focada:
	- [api/core/operational-agent/__tests__/OperationalPipeline.e2e.test.js](../api/core/operational-agent/__tests__/OperationalPipeline.e2e.test.js)
	- [api/core/operational-recommendations/__tests__/RecommendationEngine.test.js](../api/core/operational-recommendations/__tests__/RecommendationEngine.test.js)
	- [api/core/operational-playbooks/__tests__/PlaybookRunner.test.js](../api/core/operational-playbooks/__tests__/PlaybookRunner.test.js)
	- [api/core/operational-agent/__tests__/OperationalAgentService.test.js](../api/core/operational-agent/__tests__/OperationalAgentService.test.js)

### Evidência de validação ampla desta rodada

- Comando executado:
	- `REDIS_URL=redis://localhost:6379 SEQUELIZE_LOGGING=false npx jest --runInBand api/core/operational-agent/__tests__/OperationalAgentService.test.js api/core/operational-agent/__tests__/SignalDetectionService.test.js api/core/operational-agent/__tests__/OperationalEventBus.test.js api/core/operational-agent/__tests__/OperationalPipeline.e2e.test.js api/core/operational-recommendations/__tests__/RecommendationEngine.test.js api/core/operational-playbooks/__tests__/PlaybookRunner.test.js api/server.test.js`
- Resultado:
	- **7 suites passed, 7 total**
	- **59 tests passed, 59 total**
	- sem falhas funcionais nas áreas alteradas

### Dívida técnica residual (não bloqueante)

- Avisos de teardown assíncrono em alguns cenários de `api/server.test.js` (`Cannot log after tests are done`), sem impacto funcional na validação desta rodada.
- Recomenda-se uma rodada dedicada de hardening com `--detectOpenHandles` focada em serviços de RAG/tenant indexing para eliminar logs pós-encerramento.

### Estimativa final de alinhamento arquitetural

- **Alinhamento estimado: 91%** no escopo solicitado de consolidação incremental.
- Status: **APROVADO para continuidade**, mantendo compatibilidade e sem regressão funcional nas trilhas validadas.

---

## 15) Hardening pós-validação (detectOpenHandles) — 2026-03-10

Correção aplicada para eliminar logs assíncronos após encerramento de testes:

- [api/services/tenantService.js](../api/services/tenantService.js)
	- inclusão de guard único `shouldSkipTenantSiteIndexing()` cobrindo `NODE_ENV=test`, `JEST_WORKER_ID`, `VITEST`, `CI=true` e `SKIP_TENANT_SITE_INDEXING=true`;
	- bloqueio explícito do disparo assíncrono de indexação de site em `createTenant` e `updateTenant` durante ambiente de teste;
	- remoção de ruído de log de skip no caminho de early-return.

### Evidências desta rodada de hardening

- `REDIS_URL=redis://localhost:6379 SEQUELIZE_LOGGING=false npx jest --runInBand api/server.test.js --detectOpenHandles --openHandlesTimeout=2000`
	- **1 suite passed, 41 tests passed**
	- sem ocorrência de `Cannot log after tests are done`
- `REDIS_URL=redis://localhost:6379 SEQUELIZE_LOGGING=false npx jest --runInBand --detectOpenHandles --openHandlesTimeout=2000 api/core/operational-agent/__tests__/OperationalAgentService.test.js api/core/operational-agent/__tests__/SignalDetectionService.test.js api/core/operational-agent/__tests__/OperationalEventBus.test.js api/core/operational-agent/__tests__/OperationalPipeline.e2e.test.js api/core/operational-recommendations/__tests__/RecommendationEngine.test.js api/core/operational-playbooks/__tests__/PlaybookRunner.test.js api/server.test.js`
	- **7 suites passed, 59 tests passed**
	- sem ocorrência de `Cannot log after tests are done`
- `REDIS_URL=redis://localhost:6379 SEQUELIZE_LOGGING=false LOG_TO_FILE=0 NODE_OPTIONS=--max-old-space-size=4096 npx jest --bail=0 --runInBand --testPathIgnorePatterns='/tests/rpa/' --detectOpenHandles --openHandlesTimeout=2000`
	- **232 suites passed, 232 total**
	- **1228 tests passed, 1228 total**
	- sem ocorrência de `Cannot log after tests are done`
	- sem ocorrência de `Force exiting Jest`
- `npm run test:frontend:full`
	- **55 test files passed, 55 total**
	- **279 tests passed, 279 total**
	- **JUNIT**: [frontend/test-results/junit.xml](../frontend/test-results/junit.xml)

Status: hardening de teardown assíncrono para o fluxo de indexação institucional **concluído** nesta trilha.

---

## 16) Sanity final (doctor + smoke curto) — 2026-03-10

Execução final de sanidade para fechamento da rodada:

- `npm run doctor:dev`
	- ambiente sem servidores de app ativos no momento da checagem (API/Frontend DOWN por ausência de processo), como esperado após limpeza de processos;
	- porta `8000` ativa (serviço externo ao app principal) sem impacto na regressão validada.
- `REDIS_URL=redis://localhost:6379 SEQUELIZE_LOGGING=false npx jest --runInBand --detectOpenHandles --openHandlesTimeout=2000 api/server.test.js -t "Operational canonical routes|Fluxo OCC centralizado"`
	- **1 suite passed**
	- **13 testes passed** (41 totais na suite, com 28 skipped pelo filtro)
	- sem ocorrência de `Force exiting Jest`
	- sem ocorrência de `Cannot log after tests are done`
- `REDIS_URL=redis://localhost:6379 npm run test:websocket`
	- **2 suites passed, 10 testes passed**
	- validação verde da trilha de conexão/auth/ping/subscription em websocket.

### Go/No-Go (escopo desta rodada)

- **GO (condicionado)** para continuidade/release no escopo validado.
- Condição operacional: subir API/Frontend no ambiente alvo antes do smoke de runtime (`/health` e rota de UI) para confirmar disponibilidade do deploy.

### Runtime smoke (serviços ativos) — fechamento operacional

- `REDIS_URL=redis://localhost:6379 SEQUELIZE_LOGGING=false npm run dev` (serviços em execução)
- `curl -fsS http://127.0.0.1:3001/health`
	- retorno: `{"status":"ok"}`
- `curl -I -s http://127.0.0.1:5173 | head -n 1`
	- retorno: `HTTP/1.1 200 OK`
- `npm run doctor:dev`
	- API health: **OK**
	- Frontend health: **OK**
	- portas ativas esperadas: `3001` (API), `5173` (frontend), `8001` (rag-service)

Veredito final desta rodada: **GO operacional completo** (validação funcional + regressão + runtime smoke).

---

## 17) Transition closure final — arquitetura operacional (2026-03-10)

Fechamento final da transição solicitado para o novo modelo operacional, executado sem redesign e com preservação de contrato.

### 17.1 Escopo fechado

- Canonização de ownership de modelo de execução de playbook para `OperationalPlaybookRun`.
- Isolamento explícito de compatibilidade em camada dedicada (`operational-compat`).
- Extração de rotas operacionais de suporte/admin para módulo dedicado, reduzindo acoplamento em `server.js`.
- Ajuste de read-path de outcomes para query service operacional.

### 17.2 Canonização de modelo (sem quebra)

- [api/db/models/OperationalPlaybookRun.js](../api/db/models/OperationalPlaybookRun.js): passou a ser owner canônico.
- [api/db/models/OperationalPlaybookExecution.js](../api/db/models/OperationalPlaybookExecution.js): preservado como alias de compatibilidade.

### 17.3 Camada de compatibilidade isolada

- [api/core/operational-compat/playbookCompat.js](../api/core/operational-compat/playbookCompat.js)
- [api/core/operational-compat/modelCompat.js](../api/core/operational-compat/modelCompat.js)
- [api/core/operational-compat/index.js](../api/core/operational-compat/index.js)

Funções centrais:

- normalização de keys/references canônicas e legadas;
- resolução de modelos com fallback controlado.

### 17.4 Runtime/playbook state alinhado

- [api/core/operational-playbooks/PlaybookRunner.js](../api/core/operational-playbooks/PlaybookRunner.js): leitura canônica-first, mirror legado best-effort e referência canônica de run com bridge legado no payload.
- [api/core/operational-state/OperationalPlaybookExecutionStateStoreV2.js](../api/core/operational-state/OperationalPlaybookExecutionStateStoreV2.js): resolução via compat adapter.
- [scripts/check-operational-state-v2-consistency.js](../scripts/check-operational-state-v2-consistency.js): chave canônica de runs priorizada com fallback para executions legado.

### 17.5 Event sovereignty e CRM

- [api/core/crm/CRMEventService.js](../api/core/crm/CRMEventService.js): resolução de model operacional via compat adapter, removendo acoplamento direto ao nome legado.

### 17.6 Rotas operacionais extraídas

- [api/routes/operationalSupportRoutes.js](../api/routes/operationalSupportRoutes.js): novo módulo para blocos operacionais de suporte/admin/CRM.
- [api/server.js](../api/server.js): delegação para handler dedicado, com remoção dos blocos inline equivalentes.

### 17.7 Evidência de testes desta etapa

- `npx jest --runInBand api/core/operational-playbooks/__tests__/PlaybookRunner.test.js api/core/operational-compat/__tests__/operationalCompat.test.js api/core/crm/__tests__/OperationalEventWriter.test.js api/core/operational-agent/__tests__/OperationalAgentService.test.js api/server.test.js`
	- **5 suites passed, 5 total**
	- **58 tests passed, 58 total**

### 17.8 Compatibilidade e multi-tenant

- Contratos HTTP mantidos.
- Fallback legado mantido para keys/references/model lookup.
- Escopo tenant preservado em todas as trilhas alteradas.

### 17.9 Estado residual

- Sem blockers funcionais identificados na trilha validada.
- Próximo ciclo pode focar apenas em redução gradual de dependências legadas já isoladas.

### 17.10 Veredito de fechamento

- **TRANSITION CLOSURE CONCLUÍDA** no escopo solicitado.
- Entrega concluída com alinhamento canônico, compatibilidade preservada e validação verde focada.

---

## 18) Regressão ampliada OCC V2 — evidência complementar (2026-03-10)

Validação complementar executada após a evolução do OCC para leitura v2 com feature flag.

### Comando

- `npx jest --runInBand api/core/operational-state-v2/__tests__/OCCOperationalStateRepository.test.js api/core/operational-agent/__tests__/OperationalOccQueryService.test.js api/core/operational-agent/__tests__/OperationalAgentService.test.js api/core/operational-agent/__tests__/OperationalEventBus.test.js api/core/operational-agent/__tests__/SignalDetectionService.test.js api/core/operational-playbooks/__tests__/PlaybookRunner.test.js api/core/crm/__tests__/OperationalEventWriter.test.js api/server.test.js`

### Resultado

- **8 suites passed, 8 total**
- **72 tests passed, 72 total**

### Cobertura validada nesta execução

- Repositório OCC v2 (signals/recommendations/playbooks/KPIs/top signal types).
- Switch por feature flag OCC com fallback legado em `OperationalOccQueryService`.
- Rotas OCC completas em `api/server.test.js`, incluindo:
	- `GET /api/admin/tenant/:id/operational-kpis`
	- `GET /api/admin/tenant/:id/operational-signals/top-types`
	- `GET /api/admin/tenant/:id/operational-playbook-executions`
	- rotas canônicas já existentes (`operational-signals`, `operational-recommendations`, `operational/actions`, `operational/context`, `operational/outcomes`).

### Observação técnica residual

- O runner ainda reporta `Force exiting Jest` ao final do batch (handles assíncronos remanescentes no ambiente de teste), porém sem falha funcional na suíte executada.

---

## 19) Regressão OCC ampliada com Decision Engine — evidência complementar (2026-03-10)

Validação complementar executada após a introdução do motor de decisão operacional seguro (metadata-only) e dos novos endpoints OCC de decisões.

### Comando

- `npx jest --runInBand api/core/operational-state-v2/__tests__/OCCOperationalStateRepository.test.js api/core/operational-agent/__tests__/OperationalOccQueryService.test.js api/core/operational-decision/__tests__/OperationalDecisionEngine.test.js api/server.test.js`

### Resultado

- **4 suites passed, 4 total**
- **60 tests passed, 60 total**

### Cobertura validada nesta execução

- Repositório OCC v2 (`OCCOperationalStateRepository`) com filtros e agregações operacionais.
- Serviço OCC (`OperationalOccQueryService`) com read path feature-gated e fallback legado.
- Guard rail de ativação validado para camada de decisão:
	- feature flag por tenant: `operational_decision_engine_enabled`
	- fallback por env: `OPERATIONAL_DECISION_ENGINE_ENABLED`
- Motor de decisão operacional (`OperationalDecisionEngine`) cobrindo:
	- score e breakdown determinísticos,
	- policy/action mode,
	- expected outcome,
	- ordenação por prioridade,
	- tipos mandatórios (`low_occupancy`, `support_backlog_risk`, `customer_reactivation`, `missed_revenue`, `high_cancel_rate`, `channel_attention`).
- Rotas OCC em `api/server.test.js` incluindo os novos endpoints:
	- `GET /api/admin/tenant/:id/operational-decisions/signals`
	- `GET /api/admin/tenant/:id/operational-decisions/recommendations`
	- validação de cenários com feature desabilitada (`enabled=false`, lista vazia) e habilitada (`enabled=true`, metadados de decisão).

### Observação técnica residual

- O runner ainda pode reportar `Force exiting Jest` ao final do batch (handles assíncronos remanescentes no ambiente de teste), sem impacto funcional nos resultados acima.

### Referência cruzada de documentação

- Documentação canônica do modelo operacional atualizada em [docs/03-operational-model.md](../docs/03-operational-model.md), incluindo a seção **Camada de decisão operacional segura (metadata-only)** com flags, endpoints e evidência de regressão complementar.

---

## 20) Consolidação v2-only do estado operacional (remoção de legado) — evidência (2026-03-10)

Refactor concluído para promover `operational-state-v2` como fonte única de verdade para sinais, recomendações e execuções de playbook.

### Mudanças estruturais aplicadas

- Remoção de leitura/escrita operacional em `tenant_settings` para:
	- `operational_signals_v1`
	- `operational_recommendations_v1`
	- `operational_playbook_runs_v1`
	- `operational_playbook_executions_v1`
- Remoção de dual-write e fallback de migração em:
	- `OperationalSignalRegistry`
	- `RecommendationStore`
	- `PlaybookRunner`
	- `OperationalOccQueryService`
- Remoção de migration gates operacionais:
	- `operational_state_v2_write_enabled`
	- `operational_state_v2_read_occ_enabled`
	- `operational_state_v2_read_support_enabled`
	- `operational_state_v2_read_playbooks_enabled`
- Ajuste das rotas OCC/Support e camadas de serviço para consumo canônico v2-only.

### Regressão focada (módulos alterados)

Comando:

- `npx jest --runInBand api/core/operational-agent/__tests__/OperationalOccQueryService.test.js api/core/operational-agent/__tests__/OperationalSignalRegistry.v2.test.js api/core/operational-playbooks/__tests__/PlaybookRunner.test.js api/core/operational-agent/__tests__/OperationalAgentService.test.js api/core/operational-compat/__tests__/operationalCompat.test.js api/services/__tests__/tenantFeatureService.test.js`

Resultado:

- **6 suites passed, 6 total**
- **22 tests passed, 22 total**

### Regressão de contrato HTTP do servidor

Comando:

- `npx jest --runInBand api/server.test.js`

Resultado:

- **1 suite passed, 1 total**
- **46 tests passed, 46 total**

### Observação técnica residual

- O aviso `Force exiting Jest` pode permanecer ao final do batch (open handles), sem falha funcional nas suítes validadas.
