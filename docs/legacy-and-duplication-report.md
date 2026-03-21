# Relatorio de Legado e Duplicacao

## Objetivo
Registrar artefatos paralelos, wrappers e sinais de codigo morto para limpeza controlada nas ondas finais.

## Atualizacao de consolidacao (2026-03-20)
- `api/app/registerRoutes.js` reduziu de 750 para 355 linhas e deixou de concentrar builders centralizados.
- Builders centralizados no arquivo reduziram de 17 para 0 com extracoes de dominio para composition roots.
- `frontend/src/components/DataGrid.jsx` e `frontend/src/components/DataGrid.css` foram removidos do frontend ativo.
- `frontend/src/modules/dashboard-base/index.js` passa a ser o barrel canonico para exports compartilhados de dashboard.
- `api/modules/shared/legacyExpressBridge.js` permanece como unica bridge residual explicita e documentada.

## Itens encontrados

## 1) Variantes de dashboard em paralelo
- Canonico roteado: `frontend/src/pages/DevDashboardPage.jsx`
- Situacao atual: variantes `.refactored.jsx` e `.jsx.backup` removidas neste ciclo

Risco:
- Risco principal mitigado: divergencia funcional silenciosa entre versoes do dashboard.

Acao sugerida:
- Manter migracoes apenas no canonico.
- Continuar extracao de componentes reutilizaveis a partir de `DevDashboardPage.jsx`.

## 2) Wrappers de rotas backend
- `api/routes/intelligence.js` (removido)
- `api/routes/marketIntelligence.js` (removido)

Padrao:
- Eram reexports simples de handler de `api/serverHandlers/*`, sem consumidores no runtime.

Risco:
- Risco mitigado: camada extra sem valor claro foi eliminada.

Acao sugerida:
- Manter novas rotas sem wrappers redundantes e documentar qualquer alias de import apenas quando houver consumidor real.

## 2.1) Rotas de tenant ainda duplicadas em `configRoutes.js`
- `GET /tenants/current/ai-config`
- `PUT /tenants/current/ai-config`
- `PUT /tenants/current/ai-credentials`
- `POST /tenants/:tenantKey/ai-credentials/test`

Padrao:
- As rotas acima agora tambem existem no modulo Express de `tenant`, mas as copias legadas permanecem no requestHandler atual por compatibilidade.

Risco:
- Duplicacao de ponto de manutencao enquanto o fluxo legado nao for aposentado.

Acao sugerida:
- Manter o modulo `tenant` como fonte canonica.
- Remover as copias de `configRoutes.js` assim que houver testes de contrato dedicados para o router Express.

## 2.2) Entry point Express paralelo removido
- `api/server.express.js`

Padrao:
- O entrypoint paralelo foi aposentado; `api/server.js` agora concentra o app Express e o fallback legado.

Risco:
- O risco de ambiguidade operacional entre dois servidores foi mitigado, mas o `requestHandler` ainda existe como camada de transicao dentro do mesmo processo.

Acao sugerida:
- Continuar migrando dominios para routers Express reais ate que o fallback legado possa ser retirado do `server.js`.

✅ **COMPLETED (19 mar 2026)**: Tenant domain fully modularized (no fallback) via Phase 1 cutover.

## 2.3) Registries de macrodominio aposentados
Padrao:
- O caminho principal do backend nao depende mais de registries de macrodominio.
- `core`, `platform` e `extended` residuais foram **completamente eliminados** em 19 mar 2026.
- O backend monta diretamente routers de domínio: `domain-admin`, `domain-identity`, `domain-flow`, `domain-operations`, `domain-business`, `platform-admin`, `platform-content` e `platform-public`.
- Os arquivos `dispatchCoreRoutes.js`, `dispatchPlatformRoutes.js`, `dispatchExtendedRoutes.js` e os wrappers `api/modules/core|platform|extended/routes.js` foram removidos.

Acao sugerida:
- Continuar reduzindo adapters legados dentro dos routers residuais e migrar subdominios para controller/service/repository quando isso gerar simplificacao real.

## 2.4) Hotspots residuais grandes encerrados
- `api/modules/platform-residual/routes.js` foi quebrado por subdomínio e depois removido por completo.
- `api/modules/extended-residual/routes.js` foi quebrado por subdomínio e depois removido por completo.

✅ **COMPLETED (19 mar 2026)**: 
  - 9 handlers migrados de `extended-residual` para módulos dedicados (Phases 2-3)
  - Arquivo `extended-residual` deletado; subdomínios promovidos para `api/modules/domain-operations/routes.js` e `api/modules/domain-business/routes.js`
- `api/modules/core-residual/routes.js` foi quebrado por subdomínio e depois removido por completo.

Risco:
- A camada residual macrodominio foi eliminada, mas ainda existem handlers legados grandes no nível de `serverHandlers`.

Acao sugerida:
- Continuar migrando hotspots de `serverHandlers` para orquestradores finos e sub-handlers/modulos nativos.

✅ **COMPLETED (19 mar 2026)**: Phase 2 (Operations handlers) — queueTicket, ops, executionLedger, supportDebug migrados
✅ **COMPLETED (19 mar 2026)**: Phase 3 (Channel handlers) — publicApi, webhook, whatsAppConnection, whatsAppIvr, whatsAppQrWebhook migrados
✅ **COMPLETED (19 mar 2026)**: Phase 4 (Extended-Residual Elimination) — domain-operations e domain-business consolidados; extended-residual deletado
✅ **COMPLETED (19 mar 2026)**: Phase 5 (Core-Residual Elimination) — domain-admin, domain-identity e domain-flow consolidados; core-residual deletado
✅ **COMPLETED (19 mar 2026)**: Phase 6 (Platform-Residual Elimination) — platform-admin, platform-content e platform-public consolidados; platform-residual deletado

## 2.5) Subblocos residuais ja consolidados em modulo nativo
- `api/modules/public-token/routes.js`
- `api/modules/public-token/controller.js`
- `api/modules/public-token/service.js`
- `api/modules/public-token/repository.js`
- `api/modules/public-token/validator.js`
- `api/modules/developer-key/routes.js`
- `api/modules/developer-key/controller.js`
- `api/modules/developer-key/service.js`

Efeito:
- `publicToken` deixa de depender de adapter legado em `platform-residual` e passa a usar composicao nativa de modulo Express.
- `developerKey` deixa de depender de adapter legado em `extended-residual` e passa a usar composicao nativa de modulo Express.
- `automation` deixa de depender do wiring legado em `extended-residual` e passa a usar composicao nativa de modulo Express.
- `queue` deixa de depender do wiring legado em `platform-residual` e passa a usar composicao nativa de modulo Express.
- `marketing` deixa de depender do wiring legado em `extended-residual` e passa a usar composicao nativa de modulo Express.
- `order` deixa de depender do wiring legado em `extended-residual` e passa a usar composicao nativa de modulo Express.
- `config` deixa de depender do wiring legado em `platform-residual` e passa a usar composicao nativa de modulo Express.
- `processRuntime` deixa de depender do wiring legado em `extended-residual` e passa a usar composicao nativa de modulo Express.
- `rbac` deixa de depender do wiring legado em `extended-residual` e passa a usar composicao nativa de modulo Express.

## 2.7) Subblocos residuais recem migrados para modulo nativo
- `api/modules/automation/routes.js`
- `api/modules/automation/controller.js`
- `api/modules/automation/service.js`
- `api/modules/queue/routes.js`
- `api/modules/queue/controller.js`
- `api/modules/queue/service.js`
- `api/modules/marketing/routes.js`
- `api/modules/marketing/controller.js`
- `api/modules/marketing/service.js`
- `api/modules/order/routes.js`
- `api/modules/order/controller.js`
- `api/modules/order/service.js`
- `api/modules/config/routes.js`
- `api/modules/config/controller.js`
- `api/modules/config/service.js`
- `api/modules/process-runtime/routes.js`
- `api/modules/process-runtime/controller.js`
- `api/modules/process-runtime/service.js`
- `api/modules/rbac/routes.js`
- `api/modules/rbac/controller.js`
- `api/modules/rbac/service.js`
- `api/modules/rag-documents/routes.js`
- `api/modules/solution/routes.js`
- `api/modules/solution/controller.js`
- `api/modules/solution/service.js`
- `api/modules/sla/routes.js`
- `api/modules/sla/controller.js`
- `api/modules/sla/service.js`
- `api/modules/task/routes.js`
- `api/modules/task/controller.js`
- `api/modules/task/service.js`
- `api/modules/inbox/routes.js`
- `api/modules/inbox/controller.js`
- `api/modules/inbox/service.js`
- `api/modules/scheduling-support/routes.js`
- `api/modules/scheduling-support/controller.js`
- `api/modules/scheduling-support/service.js`
- `api/modules/supervisor/routes.js`
- `api/modules/supervisor/controller.js`
- `api/modules/supervisor/service.js`

Efeito adicional:
- `ragDocuments` deixa de depender do wiring legado em `extended-residual` e passa a usar um router dedicado que recompõe os subdominios de RAG ja decompostos no fluxo Express principal.
- `solution` deixa de depender do wiring legado em `extended-residual` e passa a usar composicao nativa de modulo Express.
- `sla` deixa de depender do wiring legado em `extended-residual` e passa a usar composicao nativa de modulo Express.
- `task` deixa de depender do wiring legado em `extended-residual` e passa a usar composicao nativa de modulo Express.
- `inbox` deixa de depender do wiring legado em `extended-residual` e passa a usar composicao nativa de modulo Express.
- `schedulingSupport` deixa de depender do wiring legado em `extended-residual` e passa a usar composicao nativa de modulo Express.
- `supervisor` deixa de depender do wiring legado em `extended-residual` e passa a usar composicao nativa de modulo Express.

## 2.6) Adapter legado historico removido
- `api/express/adapters/createLegacyHandlerAdapter.js` foi removido.
- `api/modules/shared/legacyExpressBridge.js` passa a centralizar a ponte Express explicita para handlers que ainda nao foram reescritos em modulo nativo.

Efeito:
- Nenhum modulo executavel depende mais de `createLegacyHandlerAdapter`.
- O servidor funciona apenas com routers de domínio e módulos Express diretos, sem a camada antiga de adapter por registries ou residuals macrodominio.

Proximo passo sugerido:
- Repetir o mesmo padrao de migracao nativa nos hotspots de `serverHandlers` ainda grandes, comecando por `ragRoutes`, `systemGenerationRoutes` e `flowExecutionRoutes`.

✅ **COMPLETED (19 mar 2026)**: Extended-residual elimination phase fully deployed with 58 regression tests passing

## 2.7) Extended-Residual Elimination (Fase 4 — 19 de março de 2026)

**Objetivo**: Promover subblocos de `extended-residual` para domain-level routers dedicados, eliminando o módulo residual inteiramente.

**Fase 2 — Operations Handlers**: 4 handlers migrados via createXxxRoutes wrappers
- `handleQueueTicketRoutes` → `api/modules/queue-ticket/routes.js`
- `handleOpsRoutes` → `api/modules/ops/routes.js`
- `handleExecutionLedgerRoutes` → `api/modules/execution-ledger/routes.js`
- `handleSupportDebugRoutes` → `api/modules/support-debug/routes.js`
- ✅ Validação: `extendedResidualCutoverWiring.test.js` (2 testes, 2 pass)

**Fase 3 — Channel Handlers**: 5 handlers migrados via createXxxRoutes wrappers
- `handlePublicApiRoutes` → `api/modules/public-api/routes.js`
- `handleWebhookRoutes` → `api/modules/channel-webhook/routes.js`
- `handleWhatsAppConnectionRoutes` → `api/modules/whatsapp-connection/routes.js`
- `handleWhatsAppIvrRoutes` → `api/modules/whatsapp-ivr/routes.js` (+ `crypto` injection)
- `handleWhatsAppQrWebhookRoutes` → `api/modules/whatsapp-qr-webhook/routes.js`
- ✅ Validação: `extendedChannelCutoverWiring.test.js` (2 testes, 2 pass)

**Fase 4 — Domain-Level Consolidation**: Subblocos residuais promovidos
- `api/modules/extended-residual/extendedOperationsRoutes.js` → `api/modules/domain-operations/routes.js`
  - Monta: task, scheduling-support, inbox, supervisor
- `api/modules/extended-residual/extendedBusinessRoutes.js` → `api/modules/domain-business/routes.js`
  - Monta: rag-documents, rbac, process-runtime, marketing, order, automation, developer-key, solution, sla
- `api/modules/extended-residual/` **deletado inteiramente** (não há mais referências)
- ✅ Validação: `domainOperationsBusinessCutoverWiring.test.js` (9 testes, 9 pass)

**Estatística Final**:
- 9 routers modulares criados (9 × ~15 linhas cada ≈ 135 linhas)
- 600+ linhas de código residual promovidas para composição nativa
- 0 referências remanescentes a extended-residual (validado com ripgrep)
- 58 testes de regressão passing (9 suites, 58 tests, 18.307s)
- Decomposição completa do monolito residual extendido

✅ **COMPLETED (19 mar 2026)**: Extended-residual elimination phase fully deployed with 58 regression tests passing

## 3) Handlers presentes e nao wired no dispatcher principal
- `api/serverHandlers/analyticsRoutes.js`
- `api/serverHandlers/bulkCampaignsRoutes.js`
- `api/serverHandlers/quickRepliesRoutes.js`

Risco:
- Codigo aparentemente valido, mas sem efeito no fluxo real.

Acao sugerida:
- Para cada handler: decidir `wire now`, `deprecate` ou `merge`.

## 4) Duplicacao estrutural em `platform-grid`
- `frontend/src/modules/platform-grid/components/*` contem reexports para `../PlatformGrid*`.

Risco:
- Multiplicacao de paths sem ganho funcional.

Acao sugerida:
- Padronizar um unico ponto de import (`modules/platform-grid/index.js`).
- Considerar as paginas novas e migradas para `PlatformGrid` como consumidoras do path canonico.

## Prioridade de limpeza
1. Resolver handlers ainda nao wired.
2. Unificar caminhos de import canonicos (`platform-grid`).
3. Reduzir hotspots remanescentes de `serverHandlers` agora que os residuals macrodominio foram eliminados.

## 5) Estado atual consolidado (19 mar 2026)
- Nenhum macrodomínio residual permanece no runtime.
- `ragRoutes.js` foi reduzido a orquestrador fino e passou a delegar para `api/serverHandlers/rag/*`.
- Os principais hotspots antigos (`pbxRoutes.js`, `ticketRoutes.js`, `ragDocumentsRoutes.js`, `ragRoutes.js`) deixaram de concentrar a lógica inteira em um único arquivo-origem.
- `systemGenerationRoutes.js` concluiu decomposicao para `api/serverHandlers/system-generation/*` (`pipelineRoutes`, `suggestDescriptionRoute`, `contentRoutes` e `controlRoutes`), reduzindo o arquivo principal para 32 linhas.
- A regressão arquitetural validada cobre 11 suites e 75 testes para o wiring principal; a decomposição de RAG adicionou mais 4 suites direcionadas com 9 testes verdes.
