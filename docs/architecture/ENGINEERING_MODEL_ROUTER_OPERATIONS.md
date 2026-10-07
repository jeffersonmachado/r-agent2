# ENGINEERING_MODEL_ROUTER_OPERATIONS.md

## Pré-requisitos para uso real (com chamada de rede a um LLM)

O Router reutiliza a infraestrutura de credenciais por tenant já existente. Para que
CODER/REVIEWER funcionem de verdade:

1. Configure credencial para o tenant interno usado pelo Router (padrão: `system`, o mesmo
   tenant já usado para chamadas internas em `api/modules/tenant/aiWorkflows.js`) via
   `tenantAIService.saveAICredentials('system', '<provider>', '<apiKey>')` ou a UI de
   configuração de IA do tenant.
2. Ao menos dois providers distintos com credencial válida são necessários para que a
   independência de reviewer (`HIGH`/`CRITICAL`) seja aplicada de fato — caso contrário o
   Router registra `INDEPENDENT_PROVIDER_UNAVAILABLE` e usa o mesmo provider (nunca finge
   independência).

Sem credencial configurada, o Router funciona corretamente até a etapa de roteamento e falha
de forma explícita e auditável (`NO_QUALIFIED_CODER`/`PROVIDER_NO_CREDENTIAL`) — não finge
sucesso.

## Variáveis de ambiente

| Variável | Default | Efeito |
|---|---|---|
| `ENGINEERING_ROUTER_TENANT_ID` | `system` | Tenant usado para resolver credencial de IA |
| `ENGINEERING_ROUTER_WORKSPACE_ROOT` | `os.tmpdir()/engineering-router-workspaces` | Onde os workspaces isolados (git worktree) são criados |
| `ENGINEERING_ROUTER_EVIDENCE_ROOT` | `dev/engineering-router-v1/evidence` | Onde stdout/stderr de cada test run é persistido |
| `ENGINEERING_ROUTER_CONTEXT_MAX_BYTES` | `61440` (60KB) | Orçamento total de bytes de arquivo por contexto |
| `ENGINEERING_ROUTER_CONTEXT_MAX_FILES` | `20` | Máximo de arquivos por contexto |
| `ENGINEERING_ROUTER_TEST_TIMEOUT_MS` | `120000` | Timeout por comando de teste |
| `ENGINEERING_ROUTER_LOCK_STALE_MS` | `900000` (15 min) | Após esse tempo, um lock de execução é considerado órfão (restart-safe) |

## Como criar e rodar uma task

```bash
curl -X POST /engineering/tasks -H 'Content-Type: application/json' -d '{
  "title": "corrigir bug X",
  "objective": "...",
  "taskType": "BUG_FIX",
  "risk": "LOW",
  "allowedPaths": ["src/foo.js"],
  "testCommands": ["npm run test:unit -- --testPathPattern=foo"],
  "maxIterations": 3
}'
curl -X POST /engineering/tasks/<id>/run
curl /engineering/tasks/<id>
```

`POST /run` responde `202 Accepted` imediatamente (fire-and-forget) — acompanhe o progresso via
`GET /engineering/tasks/:id` (mesmo padrão de `POST /qa-mesh/run`).

## Concorrência e restart

- Uma mesma task nunca roda duas vezes simultaneamente (`engineeringTaskService.lockForRun`,
  `SELECT ... FOR UPDATE`). Uma segunda tentativa de `run` enquanto já em execução recebe `409
  task_already_running`.
- Se o processo reiniciar no meio de uma execução, o lock fica órfão e é retomado
  automaticamente após `ENGINEERING_ROUTER_LOCK_STALE_MS` — a task nunca desaparece nem trava
  para sempre. A tentativa parcial em andamento é perdida (contabilizada como uma iteração
  usada), não a task inteira.
- Cancelamento concorrente (`POST /cancel` enquanto uma execução já está rodando) é tratado
  graciosamente pelo loop — nunca lança exceção não tratada.

## Evidência e auditoria

- stdout/stderr completos de cada comando de teste ficam em
  `dev/engineering-router-v1/evidence/<taskId>/attempt-<n>/<hash>.{stdout,stderr}.log`.
- O banco guarda apenas um excerto (últimos 4000 caracteres) + a referência de caminho.
- Todo patch gerado fica persistido em `EngineeringAttempt.patch_diff` (texto completo).
- Toda decisão de roteamento fica persistida em `EngineeringTask.routing_decision`
  (`reasonCodes` estruturados, nunca texto livre do LLM).

## Cuidado operacional: pipelines de release concorrentes

Este projeto roda em branch `main` direto e possui um pipeline de selagem
(`scripts/governance/seal-release.sh`/`scripts/two-pass-release.sh`) que pode restaurar o
working tree para o estado do HEAD como parte do seu próprio fluxo. Se uma execução manual do
Engineering Router estiver gerando arquivos de código ainda não commitados no mesmo checkout
enquanto esse pipeline roda, o checkout do pipeline pode descartar esse trabalho. Verifique
`ps aux | grep -E "seal-release|two-pass-release"` antes de sessões de trabalho longas neste
repositório, ou utilize um `git worktree` dedicado.

## Troubleshooting

| Sintoma | Causa provável |
|---|---|
| Task fica `RED` com `NO_QUALIFIED_CODER` | Nenhum modelo mapeado em `modelCapabilities.js` tem a capability exigida, está habilitado, saudável e com credencial para o tenant configurado |
| Task fica `RED` com `ENGINEERING_TASK_EXHAUSTED` | `maxIterations` esgotado sem sucesso — ver `EngineeringAttempt.error`/`failure_bundle` de cada tentativa |
| `PATCH_APPLY_FAILED` | O diff do CODER não bate com o conteúdo real do arquivo no snapshot atual — geralmente o modelo não recebeu o conteúdo mais recente (ver `context_summary.includedFiles`) |
| `PATCH_BODY_MISSING_PREFIX` | O CODER emitiu o CABEÇALHO do diff/hunk corretos e o CORPO sem prefixo de unified diff (`'use strict';` em vez de `+'use strict';`) — detectado na validação, ANTES do `git apply` (achado real do `qwen3-coder-flash`, 2026-10-07). O corpo NUNCA é reparado por heurística; ver `attempt.error.violations` para arquivo/hunk/contagens |
| Task `RED`/`BLOCKED` por patch não aplicável repetido | O MESMO coder reproduziu o defeito de formato além do limiar e não havia candidato alternativo (ou o orçamento da cadeia esgotou): o roteador reroteia por `ENGINEERING_PATCH_APPLY_REROUTE_AFTER` (default 2) usando os mesmos guardas do fallback de provider. A cadeia fica em `engineering_telemetry_events` com `event_type=PATCH_GENERATION` (geração) e `event_type=PATCH_DECISION` (decisão de reroute: `failuresOnThisModel`, `rerouteThreshold`, `rerouteTarget`) |
| Comando de teste nunca executa (`REJECTED`) | O comando não está na allowlist de `commandPolicy.js` — ajuste o `testCommands` do Task Contract para usar um prefixo permitido |
