# Architectural Convergence Waves

## Overview

This document tracks the systematic consolidation of scattered operational services and patterns into a unified `ServiceOperationsKernel`-centered architecture.

The goal is to eliminate architectural redundancy, naming confusion, and circular dependencies while maintaining backward compatibility.

## Wave Completion Status

### ✅ Onda 2: Operational Context & Autonomous Scheduling Convergence

**Objective**: Consolidate context assembly and autonomous capabilities into canonical modules

**Changes**:
- Moved `OperationalContextAssembler` → canonical `api/core/operational-context/`
- Moved `OperationalContextQueryService` → canonical `api/core/operational-context/`
- Created `AutonomousOperationsService` facade in `api/core/autonomous-scheduling/`
- All circular dependencies broken via lazy loading (`getKernel()` patterns)

**Test Status**: 7 suites / 14 tests passing

**Completion Date**: Prior session

---

### ✅ Onda 3: Route-Level Semantic Convergence

**Objective**: Unify all route builders to use canonical naming and establish semantic variable naming

**Changes**:
- Renamed all route builder calls from `buildOperationalPipelineService()` → `buildServiceOperationsKernel()`
- Changed all local variables from `pipeline`/`service` → `kernel` semantically
- Updated affected routes:
  - `api/routes/occ/occOverviewRoutes.js` (5 instances)
  - `api/routes/occ/occSignalsRoutes.js` (3 instances)
  - `api/routes/occ/occRecommendationsRoutes.js` (3 instances) - **fixed regression** where `service.*` was undefined
  - `api/routes/occ/occOutcomesRoutes.js` (3 instances)
  - `api/routes/support/operationalQuickActionRoutes.js` (3 instances)
  - `api/routes/support/operationalPlaybookRoutes.js` (2 instances)
  - `api/routes/support/operationalSupportCoreRoutes.js` (3 instances)
  - `api/routes/crmRoutes.js` (4 instances)

**Route Builders Updated** (2 files):
- `api/routes/support/shared.js`
- `api/routes/occ/occShared.js`

**Test Status**: 4 suites / 8 tests passing

**Completion Date**: Prior session

---

### ✅ Onda 4: Legacy Alias Elimination

**Objective**: Remove all `buildOperationalPipelineService` aliases to enforce canonical naming

**Changes**:
- Removed `const buildOperationalPipelineService = buildServiceOperationsKernel;` from both shared builders
- Removed legacy export from `module.exports`
- **Final state**: Zero occurrences of `buildOperationalPipelineService` in entire codebase

**Validation**:
- Grep search confirmed 0 remaining references
- All 32 historical references converted in onda 3
- Tests continue passing: 4 suites / 8 tests

**Test Status**: 4 suites / 8 tests passing

**Completion Date**: Prior session

---

### ✅ Onda 5: State Service Convergence

**Objective**: Move operational state query services to their canonical semantic homes

**New Canonical Files Created**:
- `api/core/operational-state/OperationalStateService.js`
- `api/core/operational-state/OperationalOccQueryService.js`

**Changes**:
- `api/core/operational-state/index.js` - Updated to export both new services
- `api/core/operational-agent/OperationalStateService.js` - Converted to re-export shim
- `api/core/operational-agent/OperationalOccQueryService.js` - Converted to re-export shim
- `api/core/operational-context/OperationalContextQueryService.js` - Import updated to load `OperationalStateService` from `operational-state` (canonical)
- `api/core/service-operations-kernel/ServiceOperationsKernel.js` - Import updated to load `OperationalOccQueryService` from `operational-state` (canonical)
- `api/core/operational-agent/index.js` - Updated to import both services from `operational-state`

**Bug Fixed During onda 5**:
- `OperationalOccQueryService.js`: Import of `OCCOperationalStateRepository` was pointing to `./index` (creating circular reference)
- Fixed to import from `../operational-state-v2` (direct data layer reference)

**Backward Compatibility**:
- Old import paths from `api/core/operational-agent/` still work via shim re-exports
- No breaking changes to existing code

**Test Status**: 6 tests passing across 3 suites (operational-context, operational-state, operational-pipeline, autonomous-scheduling, crmRoutes)

**Completion Date**: Current session

---

## Pattern: Backward Compatibility Shims

All moved services maintain backward compatibility through re-export shims in their historical locations.

Example from `api/core/operational-agent/OperationalStateService.js`:

```javascript
// Re-export from canonical location
module.exports = require('../operational-state/OperationalStateService');
```

This allows:
- Old code importing from `operational-agent/` continues to work
- New code imports from canonical semantic location `operational-state/`
- Gradual migration path (not forced)

## Canonical Module Home Directory

Each operational domain has a canonical semantic home:

| Module | Purpose | Location |
|--------|---------|----------|
| `operational-context` | Context assembly and entity context queries | `api/core/operational-context/` |
| `operational-state` | State snapshots and OCC-level query services | `api/core/operational-state/` |
| `operational-pipeline` | **Deprecated** - now pure compatibility shim re-exporting kernel | `api/core/operational-pipeline/` |
| `service-operations-kernel` | Single entry point for operational capabilities | `api/core/service-operations-kernel/` |
| `autonomous-scheduling` | Domain-specific vertical (facade pattern) | `api/core/autonomous-scheduling/` |
| `operational-agent` | **Historical location** → now mostly shims for backward compatibility | `api/core/operational-agent/` |

## Naming Conventions Established

### Route Builders

**Canonical**: `buildServiceOperationsKernel()`

```javascript
// In shared builders (api/routes/support/shared.js, api/routes/occ/occShared.js)
function buildServiceOperationsKernel() {
  return new ServiceOperationsKernel();
}
```

**Usage**: All routes now instantiate via this function. No aliases.

### Route-Level Variables

**Canonical**: `kernel`

```javascript
// Old (onda 3 removed these)
const pipeline = buildOperationalPipelineService();
const service = buildServiceOperationsKernel();

// New (canonical)
const kernel = buildServiceOperationsKernel();
```

### Import Pattern

**Canonical**: Import from semantic home, not `operational-agent/`

```javascript
// New code (preferred)
const { OperationalStateService } = require('../../core/operational-state');
const { OperationalOccQueryService } = require('../../core/operational-state');

// Legacy code (still works via shims)
const { OperationalStateService } = require('../../core/operational-agent');
```

---

### ✅ Onda 6: Simplificação da Camada OperationalStateService

**Objetivo**: Remover wrapper intermediário `OperationalStateService` que apenas estendia `OperationalStateReadService` com pares null.

**Análise**:
- `OperationalStateService` era apenas wrapper: estendia `OperationalStateReadService` + adicionava `signalQueryService: null` e `recommendationQueryService: null`
- Apenas `OperationalContextQueryService` instanciava esse wrapper
- Kernel usava diretamente `OperationalStateReadService` e `OperationalOccQueryService`
- Conclusão: Camada intermediária não agregava valor

**Mudanças Aplicadas**:
- `api/core/operational-context/OperationalContextQueryService.js`: Agora usa diretamente `operationalStateReadService` do módulo canonical
- `api/core/operational-state/index.js`: Removido `OperationalStateService` das exportações
- `api/core/operational-state/OperationalStateService.js`: **Arquivo deletado**
- `api/core/operational-agent/OperationalStateService.js`: Convertido para shim local independente (deprecado, mas mantém compatibilidade)

**Benefícios**:
- Menos uma camada de indireção no caminho crítico de query
- Menor surface area de API
- Código mais direto e testável
- Mantém compatibilidade via shim deprecado

**Test Status**: 6 testes passando (context, state, pipeline, autonomous, crm routes)

**Completion Date**: Março 11, 2026

---

## Próximas Ondas (Planejadas)

### Onda 7: Auditoria OperationalPipelineService

**Objective**: Validate OperationalPipelineService is pure delegator; clean up if needed

**Current State**: Likely already a pure delegator; needs validation
- Check all methods simply call kernel equivalents
- Remove if fully redundant
- Or optimize if any unique value remains

### ✅ Onda 8: Consolidação de OperationalEventProcessor

**Objetivo**: Mover processador de eventos para módulo canônico `operational-events` e consolidar pipeline

**Implementação**:
- Criado `OperationalEventProcessor` canônico em `api/core/operational-events/OperationalEventProcessor.js`
- `OperationalEventsService` agora importa processor local (não mais de `operational-agent`)  
- Adicionado export ao índice de `operational-events`
- Convertido arquivo legado `api/core/operational-agent/OperationalEventProcessor.js` para shim re-export
- Atualizados imports em `OperationalAgentService.js` e `operational-agent/index.js` para canônico

**Fluxo de Evento (Convergido)**:
```
kernel.ingestEvent() 
  → operationalEventsService.ingestEvent()
    → OperationalEventProcessor.processOperationalEvent() [CANONICAL]
      → SignalDetectionService.detectSignalsFromEvent()
      → OperationalSignalRegistry.upsertDetectedSignals()
      → RecommendationService.generateRecommendationsForSignals()
    → return { ok, eventDriven, signals, recommendations, ... }
```

**Resumo de Mudanças**:
- Arquivos criados: 1 (processor canônico em operational-events)
- Arquivos deletados: 0 (compatibilidade mantida via shim)
- Arquivos modificados: 4 (OperationalEventsService, operational-events/index, OperationalAgentService, operational-agent/index)
- Linhas alteradas: ~180 (net zero com shim)

**Compatibilidade Backward**:
- Imports antigos de `operational-agent/OperationalEventProcessor` continuam funcionando (shim re-export)
- Zero breaking changes na API externa
- Testes de pipeline E2E e agent passando

**Test Status**: 5 suites / 10 testes passando (context, state, pipeline, service-operations-kernel, autonomous-scheduling - todos verdes)

**Completion Date**: Março 11, 2026

---

## Testing Strategy

Each onda is validated via Jest:

```bash
# Test affected modules
REDIS_URL=redis://localhost:6379 SEQUELIZE_LOGGING=false npx jest --runInBand --forceExit --testTimeout=10000 [affected paths]
```

**Test Suites** (core validation set):
- `api/routes/__tests__/crmRoutes.test.js`

**Audit Results**: 100% pure delegator confirmed
- 41 total methods, all simply return `this.kernel.[method]()`
- Zero custom logic, transformations, or branching
- Not imported anywhere in active code (only used in tests and docs)
- Conclusion: Safe to simplify to compatibility shim

**Changes Applied**:
- Removed file: `api/core/operational-pipeline/OperationalPipelineService.js`
- Simplified `api/core/operational-pipeline/index.js`:
  - Now re-exports `ServiceOperationsKernel` as `OperationalPipelineService` (deprecated class alias)
  - `operationalPipelineService` singleton now points directly to `serviceOperationsKernel`
  - Removed legacy constructor complexity
- Updated test: `OperationalPipelineService.test.js` validates compatibility shim works correctly

**Benefits**:
- Eliminated redundant class entirely
- Reduced codebase by ~145 lines
- Faster instantiation (direct kernel, no wrapper overhead)
- Clearer that pipel ine is legacy - push new code to use kernel directly
- Maintained full backward compatibility for old imports

**Test Status**: 2 tests passing for shim (action dispatch + state snapshot), all suite green

**Completion Date**: Março 11, 2026

---
- `api/core/autonomous-scheduling/__tests__/AutonomousOperationsService.test.js`

**Current Status**: All core tests passing

## Documentation

This convergence effort is documented in:
- This file: `16-architectural-convergence-waves.md` (wave tracking)
- `00-platform-vision.md` (architectural foundation)
- `SERVICE_OPERATIONS_KERNEL.md` (kernel contract)
- Individual module docs in `api/core/[module-name]/`

## Próximas Ondas (Planejadas)

### ✅ Onda 10: Consolidar Imports de Camadas Internas (COMPLETADA)

**Objetivo**: Redirecionar imports internos de operational-agent para seus módulos canônicos

**Consolidações Realizadas**:

**A. Consolidar Imports Inteiros** ✅:
- `operational-signals/OperationalSignalsService.js` - import direto de `./SignalService` e `./SignalQueryService`
- `api/services/signalDetectionService.js` - import de `operational-signals` em vez de `operational-agent`
- `api/services/operationalEventBus.js` - import de `operational-event-bus` em vez de `operational-agent`
- `ServiceOperationsKernel.js` - import de `operational-signals` em vez de `operational-agent`
- `operational-event-bus/index.js` - import direto de `./OperationalEventBus`

**B. Consolidar em Módulos Canônicos** ✅:
- **operational-signals**: Consolidou SignalService, SignalQueryService, OperationalSignalRegistry, SignalDetectionService, SignalDetectorsRegistry
- **operational-event-bus**: Consolidou OperationalEventBus

**C. Converter Shims em operational-agent** ✅:
- `SignalService.js` → shim (import de `../operational-signals`)
- `SignalQueryService.js` → shim (import de `../operational-signals`)
- `SignalDetectionService.js` → shim (import de `../operational-signals`)
- `SignalDetectorsRegistry.js` → shim (import de `../operational-signals`)
- `OperationalEventBus.js` → shim (import de `../operational-event-bus`)
- `OperationalSignalRegistry.js` → shim (import de `../operational-signals`)

**D. Audit Routes** ✅:
- Verificado: Zero imports diretos de `operational-agent` em `/api/routes/`
- Todas as rotas usam `buildServiceOperationsKernel` como padrão
- Nenhuma consolidação necessária nas rotas

**Test Status** ✅:
- ServiceOperationsKernel: ✅ 2 tests passing
- OperationalPipelineService: ✅ 2 tests passing
- AutonomousOperationsService: ✅ 2 tests passing
- **Total: 6 tests passing**

**Impacto de Onda 10**:
- Eliminadas ~400 linhas de código duplicado (Signal* classes agora em único lugar)
- 100% backward compatibility mantida via shims em operational-agent
- operational-agent agora é 90% shims (apenas 1 classe original: OperationalAgentService)
- Imports internos agora apontam para módulos semânticos corretos
- Preparação para potencial remoção completa de operational-agent em futuras ondas

**Completion Date**: 11 de março de 2026

**Status**: Ready for Onda 11 (cleanup de operational-agent shims legados)

---

### ✅ Onda 9: Consolidar OperationalAgentService (COMPLETADA)

**Objetivo**: Consolidar OperationalAgentService (100% delegador puro) via lazy-loading

**Análise Realizada** ✅:
- Confirmado: OperationalAgentService é 100% delegador (0 lógica de negócio)
- Apenas 3 importadores diretos: OperationalEventBus, OperationalPlaybookEngine, QuickActionAccess
- Estratégia: Lazy-loading getters em cada importador para quebrar circularidade

**Implementação** ✅:
1. `OperationalAgentService.js` - Convertido para delegador lazy-loading com `getKernel()`
2. `OperationalEventBus.js` - Added `getOperationalAgentService()` getter (lazy-load)
3. `OperationalPlaybookEngine.js` - Added `getOperationalAgentService()` getter (lazy-load)
4. `QuickActionAccess.js` - Refactored factory para lazy-instantiation

**Problema Pré-Existente Descoberto e Resolvido** 🔧:
- Issue inicial: `OCCOperationalStateRepository is not a constructor` durante lazy-loading
- Root cause: Circular dependency na module load-time entre operational-state e operational-state-v2
- **Solução implementada**:
  1. Lazy-load OCCOperationalStateRepository innerhalb OperationalOccQueryService (constructor time)
  2. Lazy-load OperationalOccQueryService via getter em ServiceOperationsKernel
  3. Import direto de operational-state-v2 em ServiceOperationsKernel factory function
  4. Evita resolução de circular dependency na module initialization

**Mudanças em ServiceOperationsKernel**:
- `getOccStateRepository()` factory function (lazy-load OCCOperationalStateRepository)
- `getOccQueryService()` factory function (lazy-load OperationalOccQueryService)
- `occQueryService` property convertido para getter/setter lazy-loading

**Mudanças em OperationalOccQueryService**:
- Lazy-load `OCCOperationalStateRepository` no constructor (em vez de top-level import)
- Quebra circular dependency sem impacto na API

**Test Status** ✅:
- ServiceOperationsKernel: ✅ 2 tests passing
- OperationalPipelineService: ✅ 2 tests passing (shim tests)
- AutonomousOperationsService: ✅ 2 tests passing
- **Total: 6 tests passing** (kernel integration + compatibility layer)

**Impacto**:
- Eliminadas ~150 linhas de delegação desnecessária em OperationalAgentService
- OperationalAgentService agora é puro thin delegator (11 linhas effective code)
- 100% backward compatibility mantida
- 0 breaking changes para callers

**Completion Date**: 11 de março de 2026 (com fix de circular dependency)

---

### ✅ Onda 11: Limpeza de Shims Restantes em operational-agent (COMPLETADA)

**Objetivo**: Remover código morto residual e transformar `operational-agent` em fachada limpa de compatibilidade

**Mudanças Realizadas**:
- `OperationalSignalRegistry.js` reduzido a shim puro, removendo implementação residual após `module.exports`
- `RecommendationService.js` e `RecommendationQueryService.js` movidos semanticamente para `operational-recommendations/`
- `operational-agent/index.js` reescrito para reexportar diretamente das casas canônicas
- Imports internos restantes passaram a apontar para módulos semânticos corretos

**Resultado**:
- `operational-agent` ficou concentrado em `OperationalAgentService`, `OperationalCanonicalPipelineService` e shims finos
- Menos ambiguidade arquitetural e menor risco de drift entre implementações duplicadas

**Test Status** ✅:
- Core regression suite: 4 suítes / 8 testes passando

**Completion Date**: 11 de março de 2026

---

### ✅ Onda 12: Redirecionar Testes do Index Legado (COMPLETADA)

**Objetivo**: Eliminar dependência de `api/core/operational-agent/index.js` nos testes de integração do servidor

**Mudanças Realizadas**:
- `api/server.test.js` atualizado para importar caminhos canônicos:
  - `OperationalOccQueryService` → `./core/operational-state`
  - `OperationalContextQueryService` → `./core/operational-context`
  - spy de geração OCC ajustado para `ServiceOperationsKernel`, refletindo o fluxo real das rotas
- Verificado: zero imports restantes de `./core/operational-agent` em código `api/**/*.js`

**Test Status** ✅:
- `api/server.test.js` (subset OCC/context/outcomes): 14 testes passando
- Core regression suite: 4 suítes / 8 testes passando

**Impacto**:
- Testes agora validam a arquitetura canônica em vez da fachada legada
- `operational-agent/index.js` deixou de ser dependência de execução em fluxos principais e testes de servidor

**Completion Date**: 11 de março de 2026

---

### ✅ Onda 13: Mover Últimas Classes Ativas para Casas Canônicas (COMPLETADA)

**Objetivo**: Reduzir `operational-agent` ao mínimo necessário, movendo as últimas classes com implementação real para módulos semânticos

**Mudanças Realizadas**:
- `OperationalRecommendationScorer` movido para `api/core/operational-recommendations/OperationalRecommendationScorer.js`
- `OperationalCanonicalPipelineService` movido para `api/core/operational-pipeline/OperationalCanonicalPipelineService.js`
- `operational-recommendations/index.js` atualizado para exportar `OperationalRecommendationScorer`
- `operational-pipeline/index.js` atualizado para exportar `OperationalCanonicalPipelineService`
- Arquivos antigos em `operational-agent/` convertidos em shims finos de compatibilidade
- `operational-agent/index.js` passou a reexportar diretamente das novas casas canônicas

**Resultado**:
- `operational-agent` deixa de concentrar qualquer implementação relevante além de `OperationalAgentService`
- `OperationalCanonicalPipelineService` e `OperationalRecommendationScorer` passam a viver em domínios semanticamente corretos
- Compatibilidade retroativa preservada sem duplicação de lógica
- Restaram apenas 3 imports runtime de `operational-agent/OperationalAgentService`, todos intencionais para compatibilidade (`OperationalEventBus`, `OperationalPlaybookEngine`, `QuickActionAccess`)

**Test Status** ✅:
- `OperationalCanonicalPipelineService.test.js`: ✅
- Core regression suite: 4 suítes / 8 testes passando
- Total validado nesta onda: 5 suítes / 9 testes passando

**Completion Date**: 11 de março de 2026

**Status**: `operational-agent` ficou essencialmente reduzido a `OperationalAgentService` + shims

---

### ✅ Onda 14: Eliminar Consumidores Runtime de OperationalAgentService (COMPLETADA)

**Objetivo**: Remover os últimos consumidores runtime de `OperationalAgentService`, fazendo-os depender diretamente do kernel canônico

**Mudanças Realizadas**:
- `OperationalEventBus` passou a lazy-load `ServiceOperationsKernel` e usar `ingestEvent` / métodos canônicos
- `OperationalPlaybookEngine` passou a lazy-load `ServiceOperationsKernel` para geração e listagem de sinais/recomendações
- `QuickActionAccess` passou a criar `ServiceOperationsKernel` por padrão, mantendo compatibilidade com o parâmetro legado `createOperationalAgentService`
- Mantida compatibilidade retroativa via parâmetros legados (`operationalAgentService`) para testes e integrações antigas

**Resultado**:
- Zero imports runtime restantes de `operational-agent/OperationalAgentService` em `api/**/*.js`
- `OperationalAgentService` passa a existir apenas como fachada de compatibilidade explícita
- O fluxo principal usa diretamente `ServiceOperationsKernel`

**Test Status** ✅:
- `OperationalEventBus.test.js`: ✅
- `OperationalPlaybookEngine.test.js`: ✅
- `QuickActionAccess.test.js`: ✅
- Core regression suite: ✅
- Total validado nesta onda: 7 suítes / 23 testes passando

**Completion Date**: 11 de março de 2026

---

### ✅ Onda 15: Limpar Testes Legados e Refinar o Facade operational-agent (COMPLETADA)

**Objetivo**: Remover referências legadas desnecessárias dos testes e deixar `operational-agent/index.js` explicitamente posicionado como fachada de compatibilidade

**Mudanças Realizadas**:
- Testes em `api/core/operational-agent/__tests__/` passaram a importar módulos canônicos:
  - `OperationalEventBus` → `operational-event-bus`
  - `OperationalOccQueryService` → `operational-state`
  - `OperationalSignalRegistry` → `operational-signals`
  - `SignalDetectionService` → `operational-signals`
  - `OperationalCanonicalPipelineService` → `operational-pipeline`
  - `OperationalEventProcessor`, `RecommendationService`, `SignalService`, `OperationalContextQueryService` → casas canônicas no teste E2E
- Mocks dos testes de `OperationalSignalRegistry` foram ajustados para o path real de dependência (`OperationalSignalStateStoreV2`)
- `operational-agent/index.js` recebeu anotação explícita de que apenas `OperationalAgentService` permanece como entrypoint legado intencional

**Resultado**:
- Os testes validam diretamente a arquitetura canônica, sem depender de reexports legados
- Permanece apenas o teste de compatibilidade específico de `OperationalAgentService` como referência intencional ao módulo legado

**Test Status** ✅:
- 11 suítes / 29 testes passando

**Completion Date**: 11 de março de 2026

---

### ✅ Onda 16: Depreciação Forte de OperationalAgentService (COMPLETADA)

**Objetivo**: Manter `OperationalAgentService` apenas como fachada pública legada, com semântica explícita de depreciação forte e cobertura de compatibilidade alinhada ao kernel

**Mudanças Realizadas**:
- `OperationalAgentService` passou a emitir `DeprecationWarning` única por processo (`OperationalAgentServiceDeprecated`)
- Adicionado suporte explícito a injeção de `kernel` / `createKernel` para testes e compatibilidade controlada
- Teste legado de `OperationalAgentService` foi reescrito para validar:
  - emissão única do aviso de depreciação
  - delegação completa para `ServiceOperationsKernel`
  - preservação do alias legado `processOperationalEvent -> ingestEvent`

**Resultado**:
- `OperationalAgentService` permanece disponível, mas agora claramente posicionado como entrypoint legado
- A compatibilidade é preservada sem manter lógica de negócio duplicada
- O comportamento esperado do facade ficou formalizado em teste dedicado

**Test Status** ✅:
- `OperationalAgentService.test.js`: ✅
- Regressão combinada: 8 suítes / 26 testes passando

**Completion Date**: 11 de março de 2026

---

### ✅ Onda 17: Reduzir operational-agent/index.js a Fachada Lazy de Compatibilidade (COMPLETADA)

**Objetivo**: Minimizar o custo e a ambiguidade do `operational-agent/index.js`, mantendo compatibilidade sem imports canônicos eager no load do módulo

**Mudanças Realizadas**:
- `operational-agent/index.js` reescrito para:
  - exportar `OperationalAgentService` como entrypoint legado explícito
  - expor demais símbolos via getters lazy
  - emitir `DeprecationWarning` por símbolo acessado (`OperationalAgentIndexDeprecatedExport`)
- adicionada cobertura dedicada em `OperationalAgentIndex.test.js`

**Resultado**:
- o facade legado não puxa mais todos os módulos canônicos eager ao ser importado
- consumidores antigos continuam funcionando, mas agora recebem sinalização de depreciação por export legado acessado
- o papel do index ficou reduzido a compatibilidade controlada

**Test Status** ✅:
- `OperationalAgentIndex.test.js`: ✅
- regressão combinada: 9 suítes / 28 testes passando

**Completion Date**: 11 de março de 2026

---

### ✅ Onda 18: Avisos de Depreciação por Shim Individual (COMPLETADA)

**Objetivo**: Tornar explícito o uso de qualquer shim legado em `operational-agent/*`, não apenas via `index.js`

**Mudanças Realizadas**:
- Criado helper compartilhado: `api/core/operational-agent/deprecation.js`
  - warning code: `OperationalAgentShimDeprecated`
  - emissão uma única vez por shim por processo
- Aplicado warning de depreciação em todos os shims de `operational-agent/` (exceto `OperationalAgentService`):
  - `SignalService`, `SignalQueryService`, `SignalDetectionService`, `SignalDetectorsRegistry`, `OperationalSignalRegistry`
  - `RecommendationService`, `RecommendationQueryService`, `OperationalRecommendationScorer`
  - `OperationalEventProcessor`, `OperationalEventBus`
  - `OperationalOccQueryService`, `OperationalStateService`
  - `OperationalContextAssembler`, `OperationalContextQueryService`
  - `OperationalCanonicalPipelineService`
- Adicionada cobertura dedicada em `OperationalAgentShimDeprecation.test.js`
- Ajustado `OperationalAgentIndex.test.js` para refletir warning duplo esperado ao acessar export via index (`index warning` + `shim warning`)

**Resultado**:
- Import direto de qualquer shim legado agora gera sinalização clara de depreciação
- Compatibilidade permanece intacta
- Estratégia de saída dos legados ficou observável em runtime e protegida por testes

**Test Status** ✅:
- `OperationalAgentShimDeprecation.test.js`: ✅
- regressão combinada: 10 suítes / 30 testes passando

**Completion Date**: 11 de março de 2026

---

### ✅ Onda 19: Flag de Remoção Segura para Shims Legados (COMPLETADA)

**Objetivo**: Permitir remoção gradual e segura dos shims de `operational-agent`, com modo estrito opcional sem quebrar comportamento padrão

**Mudanças Realizadas**:
- `api/core/operational-agent/deprecation.js` recebeu suporte a modo estrito por env:
  - `OPERATIONAL_AGENT_SHIM_STRICT=true|1|on|strict`
  - em modo estrito, importar shim legado lança erro com code `OperationalAgentShimBlocked`
- comportamento padrão permanece `warn-only` (retrocompatível)
- cobertura de teste ampliada em `OperationalAgentShimDeprecation.test.js` para validar:
  - warning único por shim
  - warnings independentes por shims distintos
  - bloqueio de import em modo estrito

**Resultado**:
- time pode ativar rollout progressivo de remoção em ambiente controlado (CI/staging)
- produção segue compatível por default
- base preparada para desativação efetiva de shims com baixo risco

**Rollout CI/Staging (fase atual)**:
- workflow: `.github/workflows/ci.yml`
- job dedicado: `Operational Agent Shim Strict (staging rollout)`
- escopo: `develop` + `pull_request`
- modo: `OPERATIONAL_AGENT_SHIM_STRICT=1`
- política: controlada por variável de repositório `OPERATIONAL_AGENT_SHIM_STRICT_ENFORCE`
  - `0` (default): não bloqueante (`continue-on-error=true`)
  - `1` (fase 2): bloqueante (`continue-on-error=false`)

**Ativação Fase 2 (enforcement)**:
- definir `OPERATIONAL_AGENT_SHIM_STRICT_ENFORCE=1` nas Repository Variables do GitHub Actions
- opcional e recomendado: tornar o check `Operational Agent Shim Strict (staging rollout)` obrigatório na branch protection de `main`

**Test Status** ✅:
- regressão focada de compatibilidade + core: 7 suítes / 16 testes passando

**Completion Date**: 11 de março de 2026

---

## Decision Log

### Why eliminate buildOperationalPipelineService alias?

**Rationale**: 
- Alias created confusion about the canonical pattern
- All routes use same underlying kernel
- Canonical naming improves code clarity
- Schema made onda 4 removal safe (zero ambiguity remaining)

### Why keep operational-agent as shim layer?

**Rationale**:
- Historical code may import from `operational-agent/`
- Shims provide zero-cost backward compatibility
- Allows gradual migration of import paths
- No breaking changes to existing deployments

### Why move state services to operational-state?

**Rationale**:
- `OperationalStateService` is fundamentally about state snapshots and reads
- `OperationalOccQueryService` performs OCC-level projections and retrieval
- Both are "state domain" concerns, not "agent" concerns
- Semantic correctness: operational-state/ is the canonical home
- operational-agent/ becomes mostly legacy shim reference

## References

- **Kernel Contract**: `api/core/service-operations-kernel/ServiceOperationsKernel.js`
- **Autonomous Scheduling Example**: `api/core/autonomous-scheduling/AutonomousOperationsService.js`
- **Context Assembly**: `api/core/operational-context/OperationalContextAssembler.js`
- **State Service**: `api/core/operational-state/OperationalStateService.js`
