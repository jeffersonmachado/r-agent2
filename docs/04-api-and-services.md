# 04 — API and Services

## Escopos de API operacional

A plataforma expõe APIs operacionais em dois escopos:

- **Admin/OCC**: gestão e coordenação por tenant.
- **Contato/CRM**: operação contextual para um contato específico.

## Endpoints principais (Admin/OCC)

Base: `api/server.js` + cliente `frontend/src/api/superAdmin.js`

### Saúde e visão OCC

- `GET /api/admin/tenants/health`
- `GET /api/admin/tenant/:tenantId/metrics`
- `GET /api/admin/tenant/:tenantId/alerts`
- `GET /api/admin/tenant/:tenantId/ura/audit`
- `GET /api/admin/tenant/:tenantId/feature-flags`
- `PUT /api/admin/tenant/:tenantId/feature-flags/:featureKey`
- `GET /api/admin/tenant/:tenantId/crm/operational-summary`

### Sinais e recomendações (tenant)

- `GET /api/admin/tenant/:tenantId/operational-signals`
- `POST /api/admin/tenant/:tenantId/operational-signals/generate`
- `POST /api/admin/tenant/:tenantId/operational-signals/:signalId/status`
- `GET /api/admin/tenant/:tenantId/operational-recommendations`
- `POST /api/admin/tenant/:tenantId/operational-recommendations/generate`
- `POST /api/admin/tenant/:tenantId/operational-recommendations/:recommendationId/status`

### Operational Outcomes API

- `GET /api/admin/tenant/:tenantId/operational-outcomes`
- Filtros suportados: `status`, `sourceType`, `outcomeType`, `signalId`, `recommendationId`, `playbookExecutionId`, `actionId`, `actionType`, `contactId`, `from`, `to`, `limit`
- Uso principal: OCC, auditoria operacional e análise de aprendizagem

Registro canônico atual:

- quick actions registram `OperationalAction` e persistem outcome pela `OperationalOutcomeEngine`
- playbooks registram outcome automático ao completar ou abortar
- mudanças relevantes de recomendação emitem evento operacional e feedback para memória; `accepted`, `ignored` e `executed` passam a ter outcome observável no ciclo operacional
- `OperationalOutcomeEngine` alimenta `OperationalMemoryService.recordOutcome()` automaticamente

Fluxo canônico exposto:

`events -> signals -> recommendations -> decisions -> actions -> outcomes -> operational memory`

### Quick actions (tenant)

- `GET /api/admin/tenant/:tenantId/operational-signals/:signalId/quick-actions`
- `POST /api/admin/tenant/:tenantId/operational-signals/:signalId/quick-actions/:actionId`
- `GET /api/admin/tenant/:tenantId/operational-recommendations/:recommendationId/quick-actions`
- `POST /api/admin/tenant/:tenantId/operational-recommendations/:recommendationId/quick-actions/:actionId`

### Playbooks (admin)

- `GET /api/admin/playbooks`
- `GET /api/admin/playbooks/:playbookId`
- `POST /api/admin/playbooks/:playbookId/execute`
- `POST /api/admin/playbooks/:playbookId/step`

### CRM Playbooks API

- Endpoint compatível atual: `GET /api/crm/contacts/:contactId/playbooks`
- Alias compatível adicional: `GET /api/operational/crm/contact/:contactId/playbooks`
- Finalidade: listar playbooks sugeridos para um contato a partir de sinais e recomendações operacionais

## Endpoints principais (Contato/CRM)

Base: `api/server.js`

- `GET /api/crm/contacts/:contactId/operational-profile`
- `GET /api/crm/contacts/:contactId/operational-summary`
- `GET /api/crm/contacts/:contactId/operational-signals`
- `GET /api/crm/contacts/:contactId/operational-recommendations`
- `GET /api/crm/contacts/:contactId/operational-signals/:signalId/quick-actions`
- `POST /api/crm/contacts/:contactId/operational-signals/:signalId/quick-actions/:actionId`
- `GET /api/crm/contacts/:contactId/operational-recommendations/:recommendationId/quick-actions`
- `POST /api/crm/contacts/:contactId/operational-recommendations/:recommendationId/quick-actions/:actionId`

## Catálogo de serviços de domínio

## Registro de rotas operacionais

Base de registro:

- `api/routes/index.js`
- `api/routes/operationalOccRoutes.js`
- `api/routes/operationalSupportRoutes.js`
- `api/routes/crmRoutes.js`

Organização atual:

- OCC por domínio em `api/routes/occ/`
- Support/operational em `api/routes/support/`
- CRM operacional por contato em `api/routes/crmRoutes.js`

Os endpoints públicos permanecem os mesmos; a divisão acima é apenas organizacional.

### `api/core/operational-agent/`

- `OperationalAgentService`: orquestra visão operacional integrada.
- `SignalDetectionService`: detecta sinais ativos.
- `OperationalSignalRegistry`: catálogo e regras de sinais.
- `OperationalContextAssembler`: monta contexto operacional unificado.
- `OperationalRecommendationScorer`: scoring operacional complementar.

### `api/core/insights/RecommendationEngine.js`

- Geração e priorização de recomendações a partir de contexto/sinais.

### `api/core/operational-quick-actions/`

- `OperationalQuickActionRegistry`: define ações e mapeamentos.
- `QuickActionAccess`: resolve permissão e escopo de execução.
- `QuickActionContextGuard`: valida pré-condições contextuais.
- `QuickActionExecutor`: executa ação e registra outcome.

### `api/core/operational-playbooks/`

- `OperationalPlaybookEngine`: seleciona e inicia playbooks.
- `PlaybookRegistry`: catálogo de playbooks.
- `PlaybookRunner`: ciclo de execução.
- `PlaybookStepExecutor`: execução de cada etapa.

### `api/core/operational-outcomes/`

- `OperationalOutcomeEngine`: registro e consulta de outcomes operacionais.
- `OutcomeTrackingService`: rastreio de quick actions; persiste `OperationalAction` e delega o outcome à engine canônica.

### `api/core/operational-memory/`

- `OperationalMemoryService`: persistência operacional compatível para outcomes, decisões e feedback de recomendações.
- Consultas principais: `getRecentOperationalLearnings()` e `getOutcomeStats()`.

## Contratos operacionais mínimos

Em respostas operacionais, manter consistência de campos-chave:

- Identificação: `id`, `tenantId`, `contactId` (quando aplicável)
- Classificação: `type`, `status`, `priority`/`score`
- Contexto: `context`/`context_json`
- Auditoria: `createdAt`, `updatedAt`, `executedBy`/`actor` (quando aplicável)

## Regras de integração

- Todo endpoint operacional requer autenticação.
- Escopo admin e escopo contato não devem ser misturados no mesmo fluxo de UI.
- Quick actions devem retornar erro explícito para ação inválida/sem contexto.
- Mudanças em contratos devem ser refletidas em testes de API e frontend.
- Outcomes devem alimentar memória operacional automaticamente.
