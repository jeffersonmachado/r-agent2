# ENGINEERING_ROUTER_V1_BASELINE.md

Auditoria do HEAD atual (2026-09-20, branch `main`, commit `59e2d88d`) antes de implementar o
Engineering Model Router V1. Fonte única de verdade: código real lido nesta auditoria — nada
aqui é aspiracional.

## 1. Infraestrutura de IA — o que existe e será reutilizado

| Componente | Local | Reuso no Router |
|---|---|---|
| Seleção/roteamento de provider por tenant, timeout, failover | `api/services/aiProviderManager.js` | `getAiProviderForTenant`, `registerAiProvider` — reutilizado indiretamente via `generateAiResponse` |
| Entrypoint único de geração de IA | `api/services/aiProviderService.js` (`generateAiResponse(prompt, tenantId, context)`) | Chamado diretamente pelo CODER/REVIEWER do Router. `tenantId: 'system'` já é um padrão usado em produção (`api/modules/tenant/aiWorkflows.js:37`) para chamadas internas sem tenant real — o Router usa o mesmo padrão. |
| Registry estático de providers/modelos (puro) | `engine/aiProviderRegistry.js` | Estendido (não substituído) por `engine/engineeringRouter/modelCapabilities.js`, que mapeia `provider:model` → capabilities/roles/contextClass/costClass sem tocar o registry original nem exigir migração no model `AiProvider`. |
| Persistência de provider (built-in + custom) | model `AiProvider` (`api/db/models/AiProvider.js`), `api/services/aiProviderRegistryService.js` | Lido via `getRuntimeProviders()` para saber quais providers estão `enabled`. Nenhuma tabela nova de "modelo" foi criada — ver decisão de design abaixo. |
| Credenciais | `TenantAISetting`/`TenantAICredential`, `api/services/tenantAIService.js`, `api/utils/crypto.js` (AES-256-GCM) | Reutilizado tal como está. O Router NUNCA lê nem grava credencial diretamente. |
| Resiliência / circuit breaker / status agregado | `engine/aiControlPlaneResilience.js` (puro) + `api/services/aiControlPlaneStatus.js` (singleton runtime) | `wrapProviderGenerate` já embrulha `provider.generate` para todo provider registrado — o Router herda essa proteção automaticamente ao chamar `generateAiResponse`, sem reimplementar breaker. |
| Budget/custo | `evaluateBudgetRouting` (puro, `engine/aiControlPlaneResilience.js`) | Existe apenas como regra de decisão; **não há Budget Manager real** (`BUDGET_MANAGER` nunca é alimentado). V1 do Router marca custo como `UNKNOWN` quando o provider não retorna `usage` utilizável — não inventa valor. |

**Decisão de design confirmada na auditoria:** não existe hoje nenhum conceito de "role"/"capability"
de modelo em lugar nenhum (registry, model Sequelize, tenant settings). Em vez de migrar o schema
JSONB de `AiProvider.models` (risco de quebrar consumidores existentes do registry) ou criar um
`EngineeringProviderRegistry` paralelo (proibido pela missão), a V1 adiciona **um único arquivo
puro e versionado**, `engine/engineeringRouter/modelCapabilities.js`, que decora
`provider:model` com capabilities/roles/contextClass/costClass. Isso é estender o registry
existente da forma menos invasiva possível — não duplica providers, não duplica modelos, não
duplica credenciais.

## 2. AutoCorrection — o que existe e por que não é reutilizável para geração de patch

| Componente | Local | Veredito |
|---|---|---|
| `AutoCorrectionService` | `api/services/autocorrection/AutoCorrectionService.js` | Orquestra diagnóstico→proposta→validação para falhas de **negócio/QA/RPA de tenant** (gatilho: leitura da timeline do Workspace). Domínio diferente do Router (falha de build/teste de engenharia). Não removido, não alterado. |
| `FailureDiagnosisService` | idem | 100% regex sobre texto — não é análise real de causa raiz. Não reutilizado como motor; referência de "shape" de saída apenas. |
| `PatchProposalService.buildDiff()` | idem | **Confirmado no código-fonte**: gera um diff ilustrativo (comentários genéricos, sem hunk `@@ -l,c +l,c @@` válido) — `git apply` falharia nele. Não é reutilizável para geração de patch real. O Router cria um novo `coderService` que produz unified diff real via LLM. |
| `CorrectionValidationService.runStep()` | idem | Já executa comando real via `child_process.exec` com captura estruturada `{status, code, stdout, stderr}` — mas roda no `cwd` do processo principal (sem isolamento) e fica desligada por padrão (`RAP_AUTOCORRECTION_RUN_VALIDATION`). **Padrão de execução reutilizado** (mesma forma de captura), reimplementado em `testRunnerService.js` com isolamento de workspace e ligado por padrão dentro do Router. |
| Aplicação de patch em workspace isolado (`git worktree`, sandbox, rollback) | — | **NÃO ENCONTRADO em lugar nenhum do repositório.** Gap total, implementado do zero em `patchApplyService.js`. |

O `AutoCorrectionService` **não foi removido nem modificado**. O Router é um fluxo paralelo e
novo (`api/services/engineeringRouter/`) que não compete com ele; a integração prevista
(`FailureDiagnosisService → EngineeringTask → Router`) fica registrada como possibilidade de
evolução em `POST_RELEASE_MODEL_ROUTER_BACKLOG.md` — a V1 aceita uma `EngineeringTask` criada
diretamente (via API/UI), sem depender do pipeline de autocorreção de negócio.

## 3. `src/core/cognitive/` — não aplicável ao domínio

`execution-router/` roteia execução de **planos de negócio conversacionais** (intents
CRM/agenda/PBX) entre modo atômico e durável; `learning-engine/` apenas registra eventos de
execução cognitiva em `LearningRecord`/event ledger, com política explícita de "não altera
regras críticas automaticamente". Nenhum dos dois tem noção de workspace isolado, patch ou
loop de correção. Nenhum código daqui foi reutilizado diretamente; o **padrão arquitetural**
de pipeline em fases (INPUT→CONTEXT→INTENT→PLAN→EXECUTE→VALIDATE→LEARN) inspirou o desenho do
pipeline do Router (CLASSIFY→ROUTE→CONTEXT→CODE→TEST→REVIEW→REGRESSION→GOVERNANCE).

## 4. QA Mesh, Governance, Release — pontos de integração confirmados

- `qa-mesh/meshRunner.js` exporta `runMesh(options)` publicamente e já é chamado
  programaticamente (não só via npm script) em scripts do próprio `package.json`. O Router usa
  esse mesmo caminho para a etapa de regressão, quando o Task Contract pedir.
- Padrão de gate de governança confirmado em `scripts/governance/validate-route-mounts.js` +
  `scripts/governance/common.js` (`writeReport`, `readJson`, `sha256`, `statusFromIssues`). O
  novo gate `ENGINEERING_ROUTER_V1` (`scripts/governance/validate-engineering-router-v1.js`)
  segue exatamente esse padrão e grava em `reports/engineering-router-v1-report.json`.
- Registro de rota real confirmado em 3 arquivos obrigatórios: composition root
  (`api/composition/<domínio>/index.js`) → `api/app/registerRoutes.js` → `api/app/routeRegistry.js`
  (um router ausente do terceiro arquivo responde 404 silencioso — defeito real já documentado
  no próprio `routeRegistry.js`). O Router segue os três passos.
- Classificação `DEVELOPMENT`/`PRODUCTION`/`SUPPORT` já existe como mecanismo de primeira classe:
  `api/middleware/requireClassification.js` + `api/modules/agent-os/experience-segregation.js`.
  Reutilizado tal como está — nenhuma rota nova de autorização foi criada.

## 5. Frontend — área "Development" existente como padrão a seguir

Não existe hoje nenhuma página/rota "Engineering". Existe uma área `/dev` madura
(`frontend/src/main.jsx`, menu "Central Dev" em `frontend/src/navigation/menu.js`) com o
padrão de: roteador próprio por `window.location.pathname` (`frontend/src/hooks/useRouter.js`,
**não é React Router**), páginas "puras" sem layout próprio (layout injetado pelo `main.jsx`),
chamadas via `frontend/src/api/client.js` (`fetchJson`), e bloqueio de acesso direto por URL via
`canAccessPath` (`frontend/src/utils/menuPermissions.js`). As 5 páginas do Router V1 seguem
esse padrão sob `/dev/engineering/*`.

## 6. Ambiente desta sessão — restrição factual registrada

Verificado nesta auditoria: `tenant_ai_credentials` está **vazia** no banco de desenvolvimento
local (`chatbot-postgres`, banco `results_saas`) e nenhuma variável de ambiente de API key de
provider de IA (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY` etc.) está definida no shell desta sessão.
Os 6 providers built-in (`openai`, `anthropic`, `deepseek`, `kimi`, `mistral`, `groq`) estão
`enabled=true` no registry, mas nenhum tem credencial configurada. Isso significa que uma
chamada real de rede a um LLM externo feita por este ambiente falhará por ausência de
credencial (`generateAiResponse` lança erro real e explícito — comportamento correto, não é
bug). Consequência direta para o critério de aceite `REAL_RAP_TASK_PILOT`: a execução
ponta-a-ponta com **chamada de rede real** a um provider externo depende de uma credencial
válida ser configurada (via `TenantAISetting`/`TenantAICredential`, mecanismo já existente).
Sem isso, o pilot fica `BLOCKED_EXTERNAL` por definição da própria missão (não é permitido
fingir sucesso). Testes unitários/contract/integração usam um fake provider registrado através
do mesmo `registerAiProvider` real (não um mock que baipassa a arquitetura), respeitando o
contrato exato de `provider.generate(prompt, options) → { text, usage }`.

## Nota operacional (durante a implementação)

Um pipeline de selagem de release (`scripts/governance/seal-release.sh` /
`scripts/two-pass-release.sh`), iniciado por outra sessão de trabalho neste mesmo repositório,
rodou concorrentemente durante parte desta missão e, ao restaurar o working tree para o estado
do HEAD como parte de seu próprio fluxo, descartou o trabalho ainda não commitado desta missão
em andamento. O trabalho foi integralmente recriado a partir do conteúdo já validado (testes já
haviam rodado e passado antes do incidente). Recomenda-se, para missões futuras que editem este
repositório por longos períodos, verificar `ps aux | grep seal-release` antes de iniciar e
considerar isolar o trabalho em um `git worktree`/branch dedicado quando um pipeline de release
puder estar ativo.

## GAPS a implementar do zero (V1)

1. Conceito de role/capability por modelo → `engine/engineeringRouter/modelCapabilities.js`.
2. `EngineeringTask`/`EngineeringAttempt`/`EngineeringTestRun`/`EngineeringReview`/
   `EngineeringTelemetryEvent` — modelos e migration novos.
3. `TaskClassifier` determinístico versionado.
4. `EngineeringModelRouter` + `EngineeringRoutingPolicy` versionada.
5. `EngineeringContextBuilder` com orçamento, dedupe e redação de segredo.
6. Geração de patch real (unified diff) via LLM + validador de patch + path boundary.
7. Aplicação controlada de patch em `git worktree` isolado com rollback.
8. `TestRunnerService` determinístico com allowlist de comando, isolado por workspace.
9. Loop RED→FIX com `maxIterations` e `ENGINEERING_TASK_EXHAUSTED`.
10. Reviewer independente (provider diferente do coder quando risco HIGH/CRITICAL).
11. Rotas REST `DEVELOPMENT`-only, composition root, registro de router.
12. UI: Overview, Tasks, Task Detail, Models/Router, Release Closure sob `/dev/engineering/*`.
13. Gate de governança `ENGINEERING_ROUTER_V1`.
14. Testes unit/contract/integration/E2E com fake provider fiel ao contrato real.
