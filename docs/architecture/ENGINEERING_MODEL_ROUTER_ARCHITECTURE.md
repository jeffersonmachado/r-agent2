# ENGINEERING_MODEL_ROUTER_ARCHITECTURE.md

## Camadas

```
engine/engineeringRouter/            → núcleo puro, determinístico, zero I/O
  constants.js                       → vocabulário fechado (taskType, risk, scope, capability, estados)
  modelCapabilities.js               → extensão versionada do registry de IA (provider:model → capability/role)
  taskClassifier.js                  → classify(task, context) determinístico
  routingPolicy.js                   → policy versionada por taskType
  modelSelector.js                   → seleção de CODER/REVIEWER + independência de provider
  pathBoundary.js                    → allowedPaths/forbiddenPaths
  patchValidator.js                  → parsing/validação de unified diff
  secretRedaction.js                 → bloqueio/redação de segredo no contexto
  commandPolicy.js                   → allowlist de comando de teste
  stateMachine.js                    → transições válidas da EngineeringTask
  responseParsing.js                 → extração de JSON estruturado da resposta do LLM

api/services/engineeringRouter/      → I/O real (DB, filesystem, git, rede via infra existente)
  engineeringModelAvailabilityService.js → junta registry + control plane + credenciais reais
  engineeringTaskService.js          → CRUD, lock, state machine, telemetria (Sequelize)
  contextBuilderService.js           → leitura real de arquivo, orçamento, dedupe
  engineeringAiInvoker.js            → ponto único de chamada de IA (aiProviderManager.getProviderInstance)
  coderService.js / reviewerService.js → prompts + parsing de resposta estruturada
  patchApplyService.js               → git worktree isolado (snapshot commit + apply + rollback)
  testRunnerService.js               → execução real de comando com evidência em disco
  engineeringModelStatsService.js    → dados agregados para a UI de Models
  releaseClosureService.js           → leitura de artefatos reais de governança
  engineeringRouterService.js        → orquestração completa (o "maestro")

api/modules/engineering-router/routes.js       → rotas REST (DEVELOPMENT-only)
api/composition/engineering-router/index.js    → composition root (buildDeps)
api/db/models/Engineering*.js                  → 5 models Sequelize
frontend/src/pages/Engineering*.jsx            → 5 telas
```

## Pipeline (fluxo real)

```mermaid
flowchart TD
  A[POST /engineering/tasks] --> B[createTask: classify + persist CLASSIFIED]
  B --> C[POST /tasks/:id/run → runTask (fire-and-forget)]
  C --> D[ensureRouted: buildAvailableModels + selectCoderAndReviewer → ROUTED]
  D --> E[runOneAttempt: CODING]
  E --> F[contextBuilder.buildContext]
  F --> G[coderService.generatePatch via engineeringAiInvoker]
  G --> H[patchValidator.validatePatch]
  H -- invalido --> R[RETRY: failureBundle]
  H -- valido --> I[patchApplyService.createWorkspace snapshot + applyPatch]
  I -- falha --> R
  I -- ok --> J[TESTING: testRunnerService.runTestCommands]
  J -- falha --> R
  J -- ok --> K[REVIEWING: reviewerService.review]
  K -- REJECT blocker/regression --> R
  K -- APPROVE --> L[REGRESSION local]
  L --> M[GOVERNANCE]
  M --> N[GREEN]
  R --> O{iterations < maxIterations?}
  O -- sim --> E
  O -- nao --> P[RED: ENGINEERING_TASK_EXHAUSTED]
```

## Decisões de design que exigiram extensão mínima da infra existente

1. **`context.model` opcional em `aiProviderService.js`** (`api/services/aiProviderService.js`):
   cada `generate(prompt, context)` agora aceita `context.model` como override do modelo
   configurado globalmente para o tenant/provider. Aditivo e retrocompatível — sem
   `context.model`, comportamento idêntico ao anterior. Necessário porque o Router precisa
   chamar um modelo específico por papel (CODER/REVIEWER), não o modelo default do tenant.
2. **`aiProviderManager.getProviderInstance(providerId)`**: nova função exportada que retorna
   a instância já registrada de um provider (com timeout aplicado), sem passar pela resolução
   primary/secondary/composite por tenant. Uso legítimo apenas quando o CHAMADOR (Router) já
   decidiu qual provider quer por uma regra explicável — nunca para deixar o modelo escolher.
3. **Snapshot commit em vez de `git worktree add HEAD`** (`patchApplyService.createSnapshotCommit`):
   este projeto roda em "branch main direto" quase sempre com mudanças pendentes não
   commitadas. Um worktree a partir de `HEAD` não veria esse trabalho em andamento. A técnica
   (índice temporário via `GIT_INDEX_FILE`, `add -A`, `write-tree`, `commit-tree`) cria um
   commit fiel ao estado atual do disco sem qualquer mutação do HEAD/branch/índice reais.
4. **`modelCapabilities.js` como arquivo puro versionado**, em vez de migrar o schema JSONB de
   `AiProvider.models` — evita quebrar consumidores existentes desse shape em produção.

## Por que não um segundo ecossistema de providers

Não existe `EngineeringProviderRegistry`. `modelCapabilities.js` apenas decora entradas que já
existem em `engine/aiProviderRegistry.js` com metadados de capability/role — um modelo não
listado ali simplesmente não participa do Router (allowlist segura por padrão). Toda chamada de
IA passa pelo mesmo `aiProviderManager`/`aiControlPlaneStatus` usados pelo resto do sistema.
