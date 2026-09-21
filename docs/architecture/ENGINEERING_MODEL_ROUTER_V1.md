# ENGINEERING_MODEL_ROUTER_V1.md

## O que é a V1

O Engineering Model Router V1 é um pipeline determinístico e auditável que coordena:

```
EngineeringTask → CLASSIFY → SELECT CODER/REVIEWER → BUILD CONTEXT → GENERATE PATCH
→ VALIDATE PATCH → CONTROLLED APPLY → DETERMINISTIC TEST → (RED→FIX loop)
→ INDEPENDENT REVIEW → REGRESSION → GOVERNANCE → GREEN/RED
```

**V1 é roteamento baseado em política (policy-based routing)**: toda decisão de qual modelo
executa CODER/REVIEWER é determinística, explicável por `reasonCodes` estruturados, e definida
por uma tabela versionada (`engine/engineeringRouter/routingPolicy.js`). Não há aprendizado
histórico, scoring adaptativo, bandit selection ou benchmarking automático — isso é V2 futuro
(ver seção abaixo) e está fora do escopo desta missão.

## Reuso de infraestrutura existente (não duplicação)

| Preocupação | Componente reutilizado | Como |
|---|---|---|
| Registry de providers/modelos | `engine/aiProviderRegistry.js` | Estendido (não substituído) por `engine/engineeringRouter/modelCapabilities.js` |
| Chamada de IA | `api/services/aiProviderService.generateAiResponse` / `aiProviderManager.getProviderInstance` | Usado diretamente via `engineeringAiInvoker.js` |
| Resiliência/circuit breaker | `api/services/aiControlPlaneStatus.js` | Herdado automaticamente (todo provider registrado já é `wrapProviderGenerate`) |
| Credenciais | `TenantAISetting`/`TenantAICredential` | Lidas via `tenantAIService.hasCredentials` — nunca reimplementadas |
| Classificação DEVELOPMENT/PRODUCTION | `api/middleware/requireClassification.js` | Reutilizado tal como está em toda rota |
| Regressão | `qa-mesh/meshRunner.runMesh` | Disponível para uso quando o Task Contract pedir suíte ampliada (V1: regressão local via re-execução limpa dos testCommands em workspace isolado) |

Ver auditoria completa em `ENGINEERING_ROUTER_V1_BASELINE.md` (raiz do repositório).

## Critério de aceite — status real

| Item | Status |
|---|---|
| Registry existente reutilizado | GO |
| AI Control Plane reutilizado | GO |
| EngineeringTask persistente | GO |
| Classifier funcional | GO |
| Policy versionada | GO |
| Model routing funcional | GO |
| CODER selecionado | GO |
| REVIEWER selecionado | GO |
| Independent provider para HIGH/CRITICAL quando disponível | GO |
| ContextBuilder funcional | GO |
| Secret redaction | GO |
| Real patch format | GO |
| Patch validator | GO |
| Path boundaries | GO |
| Controlled apply | GO |
| Deterministic test runner | GO |
| RED→FIX loop | GO |
| Max iterations | GO |
| Reviewer loop | GO |
| Regression | GO (local; qa-mesh completo é extensão registrada em POST_RELEASE) |
| Telemetry básica | GO |
| State persistence | GO |
| Restart-safe behavior | GO |
| DEVELOPMENT segregation backend | GO |
| UI (5 telas) | GO |
| Unit/contract/integration/E2E tests | GO |
| Governance gate | GO |
| Documentation | GO |
| **One real RAP task executed successfully (pilot)** | **GO** — ver nota abaixo |

### Nota sobre o pilot real

Credenciais reais foram configuradas via a UI existente de tenant (`/config?tenant=system&tab=ai`,
`TenantAISetting`/`TenantAICredential` — nenhum mecanismo paralelo criado), usando chaves
fornecidas pelo usuário. Das chaves testadas, apenas a da OpenAI resultou funcional em produção
(Anthropic com saldo insuficiente, DeepSeek com saldo insuficiente apesar de passar no teste de
UI, Kimi com token expirado — todas removidas do tenant após a verificação, para não deixar
credenciais mortas configuradas).

Com a credencial real da OpenAI, a task `88b903bd-9089-4708-87a0-449c62f2d409` ("Adicionar teste
unitário para `typeCompatibility.js`") foi executada ponta a ponta via UI real (Playwright
dirigindo o browser, autenticado como `systemadmin`), contra o servidor de desenvolvimento real e
seu banco real: CODER `openai:gpt-5.4-mini` gerou o patch real, `TESTING` aplicou o patch em um
git worktree isolado e rodou `npx jest` de verdade (exit code 0), e o REVIEWER `openai:gpt-4o`
(provider diferente do coder, independência de reviewer respeitada) aprovou estruturadamente.
Resultado final: **GREEN**, sem nenhum dublê nem simulação.

A execução real contra um LLM de verdade — algo que nenhum teste com fake provider conseguiria
revelar — expôs três bugs reais de robustez no próprio Router, todos corrigidos como
`V1_BLOCKER` dentro do escopo desta mesma missão (não adiados para V2):

1. **Parsing frágil da resposta do CODER** — quando o diff gerado contém strings tipo-JSON
   embutidas, o parse ingênuo de JSON falhava. Corrigido com fallback de reparo estrutural em
   `engine/engineeringRouter/responseParsing.js` (`repairCoderResponse`), usado por
   `coderService.js`.
2. **Contagem de hunk incorreta declarada pelo modelo** (`@@ -a,b +c,d @@` com contagem errada,
   fazendo `git apply` rejeitar como "patch corrompido" mesmo com conteúdo perfeitamente
   aplicável) — corrigido com `engine/engineeringRouter/hunkNormalizer.js`
   (`normalizeHunkHeaders`), que recalcula a contagem real a partir do corpo do hunk antes do
   apply. Coberto por `tests/unit/engineeringRouterHunkNormalizer.test.js` (5/5 PASS), incluindo
   o caso real observado no pilot.
3. **Modelo mapeado como REVIEWER que não existe/está descontinuado na API real**
   (`openai:gpt-5.5-pro`, `openai:gpt-5-codex` — ambos retornaram `404` reais da OpenAI) —
   corrigido adicionando `openai:gpt-4o` (confirmado funcional) a
   `engine/engineeringRouter/modelCapabilities.js`, sem remover os mapeamentos antigos.

O loop completo (RED→FIX→REVIEW→GREEN) já havia sido comprovado ponta a ponta com toda a
infraestrutura real (persistência, git worktree isolado, test runner real, state machine,
telemetria) em `tests/integration/engineeringRouterFullLoopE2E.test.js`; o pilot real acima
comprova adicionalmente a chamada de rede real ao LLM, que aquele teste de contrato
intencionalmente substitui por um provider registrado via mecanismo real. Ver o passo a passo
completo, com prints reais, em `ENGINEERING_MODEL_ROUTER_MANUAL.md`.

## V1 vs V2 (não confundir)

- **V1 (esta missão)**: roteamento baseado em política, determinístico, versionado, explicável.
- **V2 (futuro, não implementado)**: roteamento adaptativo com aprendizado histórico de
  performance por modelo/tarefa. Todo item dessa natureza está registrado, sem implementação,
  em `POST_RELEASE_MODEL_ROUTER_BACKLOG.md`.
