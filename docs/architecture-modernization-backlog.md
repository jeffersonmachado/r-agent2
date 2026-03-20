# Backlog de Modernizacao Arquitetural

## Convenções
- Prioridade: P0 (imediato), P1 (proxima onda), P2 (planejado).
- Risco: baixo, medio, alto.
- Status: todo, doing, done.

## Itens

| ID | Prioridade | Onda | Item | Risco | Status | Dependencias | DoD resumido |
|---|---|---|---|---|---|---|---|
| ARC-001 | P0 | 2 | Extrair `startInitialization` de `api/server.js` para modulo dedicado | medio | done | inventario ONDA 1 | `server.js` menor, startup identico, testes de boot passando |
| ARC-002 | P0 | 2 | Extrair startup de workers para `api/runtime/startWorkers.js` | medio | done | ARC-001 | workers iniciam igual, flags env preservadas |
| ARC-003 | P0 | 2 | Extrair hooks de shutdown para `api/runtime/registerShutdownHooks.js` | baixo | done | ARC-002 | sinais e flush de sessao mantidos |
| ARC-004 | P1 | 3 | Introduzir registry de handlers (ordem declarada) | medio | done | ARC-001..003 | sem mudanca de contrato HTTP, wiring testavel |
| ARC-005 | P1 | 3 | Criar testes de contrato para roteamento principal | medio | done | ARC-004 | cobertura para rotas criticas e fallback SPA |
| ARC-006 | P1 | 4 | Plano de decomposicao para `pbxRoutes.js` | alto | done | ARC-004 | particao por subdominio PBX sem regressao |
| ARC-007 | P1 | 4 | Plano de decomposicao para `ragDocumentsRoutes.js` | medio | done | ARC-004 | rotas/document workflow intactos |
| ARC-008 | P1 | 4 | Revisar handlers nao wired (`analytics`, `bulkCampaigns`, `quickReplies`) | baixo | done | ONDA 1 | decidir: wire, mover ou remover |
| ARC-009 | P1 | 5 | Definir `platform-grid` como grid canonico para novos CRUD | baixo | done | inventario frontend | guideline publicada + adapter inicial |
| ARC-010 | P1 | 5 | Migrar paginas PBX de `DataGrid` para base canonica | medio | done | ARC-009 | parity visual e funcional por pagina |
| ARC-011 | P2 | 6 | Criar `DashboardBase` com estados e secoes reutilizaveis | medio | done | ARC-009 | dashboard alvo migrado sem regressao |
| ARC-012 | P2 | 6 | Consolidar padroes de filtros/cards entre dashboards | baixo | done | ARC-011 | menos duplicacao de layout/estado |
| ARC-013 | P2 | 7 | Remover `DevDashboardPage.refactored.jsx` apos validacao | baixo | done | ARC-011 | arquivo removido com rastreabilidade |
| ARC-014 | P2 | 7 | Remover `DevDashboardPage.jsx.backup` apos congelamento | baixo | done | ARC-013 | sem referencia residual |
| ARC-015 | P2 | 7 | Resolver `api/requestHandler.js` placeholder (usar ou remover) | baixo | done | ARC-004 | arquivo placeholder removido e compatibilidade concentrada no app Express |
| ARC-016 | P2 | 7 | Revisar wrappers `api/routes/intelligence.js` e `marketIntelligence.js` | baixo | done | ARC-004 | wrappers redundantes removidos e documentacao atualizada |
| ARC-017 | P1 | 5 | Cobrir todos os endpoints de `tenant` no router Express paralelo | medio | done | ARC-009 | dominio `tenant` inteiro roteado no Express sem desligar legado |
| ARC-018 | P0 | 5 | Consolidar Express no `api/server.js` e remover `api/server.express.js` | medio | done | ARC-017 | `server.js` vira entrypoint unico da API com app Express principal e sem ambiguidade operacional |
| ARC-019 | P0 | 5 | Migrar o fluxo principal de roteamento do `server.js` para middlewares Express | medio | done | ARC-018 | pipeline principal do servidor roda em Express sem depender do `requestHandler` como caminho principal |
| ARC-020 | P0 | 5 | Montar `core`, `platform` e `extended` como routers Express reais | medio | done | ARC-019 | todos os macrodominios principais do servidor entram no app como routers Express montaveis |
| ARC-021 | P0 | 5 | Migrar `public system`, `frontend fallback` e `tenant rate limit` para Express nativo | medio | done | ARC-020 | nao resta etapa principal de roteamento fora do modelo Express no `server.js` |
| ARC-022 | P0 | 5 | Eliminar bootstrap/import ambiguo e remover `requestHandler` residual | medio | done | ARC-021 | import de `server.js` nao dispara bootstrap, placeholder removido e testes usam `createExpressApp()` |
| ARC-023 | P0 | 5 | Retirar `auth` e `ticket` dos registries e montar routers Express diretos | medio | done | ARC-022 | `auth` e `ticket` deixam de depender de `dispatchCoreRoutes`/`dispatchPlatformRoutes` no fluxo principal |
| ARC-024 | P0 | 5 | Retirar `pbx` e `verticals` do registry estendido e montar routers Express diretos | medio | done | ARC-023 | `pbx`, `beauty` e `fitness` deixam de depender de `dispatchExtendedRoutes` no fluxo principal |
| ARC-025 | P0 | 5 | Retirar `webhooks`, `operationsDashboard` e `webScraping` do registry estendido | medio | done | ARC-024 | os tres dominios deixam de depender de `dispatchExtendedRoutes` no fluxo principal |
| ARC-026 | P0 | 5 | Retirar `qa`, `rpaTests` e `devManagement` do registry estendido | medio | done | ARC-025 | os tres dominios deixam de depender de `dispatchExtendedRoutes` no fluxo principal |
| ARC-027 | P0 | 5 | Retirar `intelligence`, `marketIntelligence`, `accessControl` e `voice` do registry estendido | medio | done | ARC-026 | os quatro dominios deixam de depender de `dispatchExtendedRoutes` no fluxo principal |
| ARC-028 | P0 | 5 | Remover a dependencia do registry estendido no fluxo principal do `server.js` | medio | done | ARC-027 | `server.js` monta um router residual explicito e deixa de depender de `dispatchExtendedRoutes` no caminho principal |
| ARC-029 | P0 | 5 | Remover a dependencia dos registries `core` e `platform` no fluxo principal do `server.js` | medio | done | ARC-028 | `server.js` monta routers residuais explicitos e deixa de depender de `dispatchCoreRoutes` e `dispatchPlatformRoutes` no caminho principal |
| ARC-030 | P0 | 5 | Remover os registries e wrappers obsoletos apos a migracao completa do `server.js` | medio | done | ARC-029 | repositorio deixa de carregar codigo morto de registry e passa a depender apenas dos routers Express atuais |
| ARC-031 | P1 | 5 | Decompor `api/modules/platform-residual/routes.js` por subdominio | medio | done | ARC-030 | `platform-residual` vira orquestrador fino com submodulos admin, content e public |
| ARC-032 | P1 | 5 | Decompor `api/modules/extended-residual/routes.js` por subdominio | medio | done | ARC-031 | `extended-residual` vira orquestrador fino com submodulos operations, business e channels |
| ARC-033 | P1 | 5 | Decompor `api/modules/core-residual/routes.js` por subdominio | medio | done | ARC-032 | `core-residual` vira orquestrador fino com submodulos admin, identity e flow |
| ARC-034 | P1 | 6 | Migrar `publicToken` de adapter legado para modulo Express nativo | medio | done | ARC-033 | `publicToken` passa a usar `routes/controller/service/repository/validator` e sai do adapter residual |
| ARC-035 | P1 | 6 | Migrar `developerKey` de adapter legado para modulo Express nativo | medio | done | ARC-034 | `developerKey` passa a usar `routes/controller/service` e sai do adapter residual |
| ARC-036 | P0 | 6 | Remover `createLegacyHandlerAdapter` do runtime e consolidar bridge Express unica | medio | done | ARC-035 | nenhum modulo executavel depende mais do adapter legado historico |
| ARC-037 | P1 | 6 | Migrar `automation` e `queue` de wiring legado para modulos Express nativos | medio | done | ARC-036 | `automation` e `queue` passam a usar `routes/controller/service` e saem dos registradores residuais |
| ARC-038 | P1 | 6 | Migrar `marketing` e `order` de wiring legado para modulos Express nativos | medio | done | ARC-037 | `marketing` e `order` passam a usar `routes/controller/service` e saem do residual de business |
| ARC-039 | P1 | 6 | Migrar `config` de wiring legado para modulo Express nativo | medio | done | ARC-038 | `config` passa a usar `routes/controller/service` e sai do residual administrativo |
| ARC-040 | P1 | 6 | Migrar `processRuntime` de wiring legado para modulo Express nativo | medio | done | ARC-039 | `processRuntime` passa a usar `routes/controller/service` e sai do residual de business |
| ARC-041 | P1 | 6 | Migrar `rbac` de wiring legado para modulo Express nativo | medio | done | ARC-040 | `rbac` passa a usar `routes/controller/service` e sai do residual de business |
| ARC-042 | P1 | 6 | Tirar `ragDocuments` do wiring residual e montar router Express dedicado | medio | done | ARC-041 | `ragDocuments` passa a usar router dedicado e sai do residual de business mantendo os subdominios de RAG recompostos no Express |
| ARC-043 | P1 | 6 | Migrar `solution` de wiring legado para modulo Express nativo | medio | done | ARC-042 | `solution` passa a usar `routes/controller/service` e sai do residual de business |
| ARC-044 | P1 | 6 | Migrar `sla` de wiring legado para modulo Express nativo | medio | done | ARC-043 | `sla` passa a usar `routes/controller/service` e sai do residual de business |
| ARC-045 | P1 | 6 | Migrar `task` de wiring legado para modulo Express nativo | medio | done | ARC-044 | `task` passa a usar `routes/controller/service` e sai do residual de operations |
| ARC-046 | P1 | 6 | Migrar `inbox` de wiring legado para modulo Express nativo | medio | done | ARC-045 | `inbox` passa a usar `routes/controller/service` e sai do residual de operations |
| ARC-047 | P1 | 6 | Migrar `schedulingSupport` de wiring legado para modulo Express nativo | medio | done | ARC-046 | `schedulingSupport` passa a usar `routes/controller/service` e sai do residual de operations |
| ARC-048 | P1 | 6 | Migrar `supervisor` de wiring legado para modulo Express nativo | medio | done | ARC-047 | `supervisor` passa a usar `routes/controller/service` e sai do residual de operations |
| ARC-049 | P0 | 6 | Eliminar `extended-residual` e promover routers de domínio | medio | done | ARC-048 | `domain-operations` e `domain-business` substituem o residual extendido no runtime |
| ARC-050 | P0 | 6 | Eliminar `core-residual` e promover routers de domínio | medio | done | ARC-049 | `domain-admin`, `domain-identity` e `domain-flow` substituem o residual core no runtime |
| ARC-051 | P0 | 6 | Eliminar `platform-residual` e promover routers de domínio | medio | done | ARC-050 | `platform-admin`, `platform-content` e `platform-public` substituem o residual platform no runtime |
| ARC-052 | P1 | 7 | Reduzir `ragRoutes.js` a orquestrador fino delegando para sub-handlers | baixo | done | ARC-051 | `ragRoutes.js` passa a delegar para `ragCore`, `ragOperations`, `ragIngestion`, `ragQuery`, `ragLearning` e `ragEphemeral` |
| ARC-053 | P1 | 7 | Decompor `systemGenerationRoutes.js` por capacidade em `system-generation/*` | medio | done | ARC-052 | `systemGenerationRoutes.js` vira orquestrador fino com extracoes de `pipeline`, `suggest-description`, `content` (faq/initial-flow) e `control` |
| ARC-054 | P1 | 7 | Decompor `flowExecutionRoutes.js` por capacidade em `flow-execution/*` | medio | done | ARC-053 | `flowExecutionRoutes.js` vira orquestrador fino com extracoes de validacao, geracao, execucao e RPA test |
| ARC-055 | P1 | 7 | Decompor `pbx/pbxCoreRoutes.js` por capacidade em `pbx-core/*` | medio | done | ARC-054 | `pbxCoreRoutes.js` vira orquestrador fino com extracoes de extensoes/provisioning, configuracao, filas, dialplan e system |
| ARC-056 | P1 | 7 | Decompor `configRoutes.js` por capacidade em `config/*` | medio | done | ARC-055 | `configRoutes.js` vira orquestrador fino com extracoes core, contracts, tenant-ai, validation e util compartilhado |
| ARC-057 | P1 | 7 | Decompor `verticalBeautyRoutes.js` por capacidade em `vertical-beauty/*` | medio | done | ARC-056 | `verticalBeautyRoutes.js` vira orquestrador fino com extracoes customer, lifecycle, insights e helper compartilhado |
| ARC-058 | P1 | 7 | Decompor `physicalStationRoutes.js` por capacidade em `physical-station/*` | medio | done | ARC-057 | `physicalStationRoutes.js` vira orquestrador fino com extracoes queue, service, support e helper compartilhado |
| ARC-059 | P1 | 7 | Decompor `publicSystemRoutes.js` por capacidade em `public-system/*` | medio | done | ARC-058 | `publicSystemRoutes.js` vira orquestrador fino com extracoes health, marketing, provisioning, runtime e helper compartilhado |
| ARC-060 | P1 | 7 | Decompor `rpaTestsRoutes.js` por capacidade em `rpa-tests/*` | medio | done | ARC-059 | `rpaTestsRoutes.js` vira orquestrador fino com extracoes recordings, execution, replay e util compartilhado |
| ARC-061 | P1 | 7 | Decompor `ticketRoutes.js` por capacidade em `tickets/*` | medio | done | ARC-060 | `ticketRoutes.js` vira orquestrador fino com extracoes core, lifecycle, communication, operations e util compartilhado |

## Sequencia recomendada de execucao
1. ARC-001, ARC-002, ARC-003.
2. ARC-004, ARC-005.
3. ARC-008 e ARC-015/016 para reduzir ambiguidade estrutural.
4. ARC-006, ARC-007, ARC-053, ARC-054, ARC-055, ARC-056, ARC-057, ARC-058, ARC-059 e ARC-060 (decomposicao por hotspots).
5. ARC-009, ARC-010, ARC-011, ARC-012.
6. ARC-013, ARC-014.

## Validacao minima por item de codigo
- `node --check` nos arquivos alterados.
- Suite unitaria alvo do dominio alterado.
- Smoke de rotas criticas para mudancas em backend principal.

## Notas de Progresso

### ARC-010 (Grid Migration Wave) ✅ DONE
**Wave 1:** PbxTrunksPage ✅
**Wave 2:**
- PbxRoutesPage ✅ Migrado (DataGrid → PlatformGrid + usePlatformGridState)
- PbxExtensionsPage ✅ Migrado (DataGrid → PlatformGrid + usePlatformGridState)
- SolutionsPage ✅ Migrado (DataGrid → PlatformGrid + usePlatformGridState)

**Wave 3:**
- PbxModulePage ✅ Migrado (2x DataGrid → PlatformGrid; mainGrid + versionsGrid hooks; persistenceKey per moduleConfig.key)
- PbxPage ✅ Migrado (5x DataGrid → PlatformGrid; bulkGrid, extensionsGrid, queueMetricsGrid, aclsGrid, campaignListDraftGrid hooks)

**Result:** Zero DataGrid consumers remain in `/pages/`. `PlatformGrid` is the sole grid component across all pages. Updated: `frontend-grid-inventory.md`.
