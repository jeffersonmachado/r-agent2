# Runbook Suites v1 (operacao, troubleshooting, SLO/SLI)

## Escopo
- Fast service (filas fisicas)
- Orders/Delivery
- PBX/Voz

## Fast Service
- Health checks:
  - `GET /health/selftest`
  - `GET /api/physical/metrics?locationId=<id>`
- Operacao diaria:
  - validar emissao de senha (`/physical/kiosk/ticket`)
  - validar painel (`/physical/panel/state`)
  - validar estacao (`call/start/finish/skip/transfer`)
- Troubleshooting:
  - fila travada: verificar `waiting/called/in_service` em `physical_tickets`
  - sequencia quebrada: validar `physical_ticket_sequences` por `tenant+location+queue+day`
  - atraso alto: consultar `avg_wait_seconds` e `abandonmentRate` em metrics
- SLI/SLO:
  - `SLI.avg_wait_seconds` / `SLO <= 120s` (stage/prod)
  - `SLI.abandonment_rate` / `SLO <= 10%`

## Orders/Delivery
- Health checks:
  - `GET /health/selftest`
  - `GET /api/orders/metrics?locationId=<id>`
- Operacao diaria:
  - validar criacao de pedido publico (`POST /storefront/orders`)
  - validar ciclo kitchen/dispatch/status
  - validar incidente operacional (`POST /orders/:id/incidents`)
- Troubleshooting:
  - pedido sem progresso: verificar status e timeline de eventos
  - SLA em risco: monitorar `avgOrderToReadySeconds` e `avgOrderToDeliverSeconds`
  - incidente duplicado: checar idempotencia no contexto do pedido
- SLI/SLO:
  - `SLI.order_to_ready` / `SLO <= 15min`
  - `SLI.order_to_deliver` / `SLO <= 60min`

## PBX/Voz
- Health checks:
  - `GET /health/selftest` (checks: `pbxEventRuntime`, `voiceRuntime`, `eventDispatchRuntime`)
  - `GET /api/voice/metrics`
  - `GET /api/voice/runtime/stats`
- Operacao diaria:
  - validar publish de dialplan (`POST /api/pbx/dialplan/apply`)
  - validar historico/rollback (`GET /api/pbx/config-versions`, `POST /api/pbx/dialplan/rollback?version=...`)
  - validar politica de gravacao (`GET/POST /api/pbx/recordings/policy`)
- Troubleshooting:
  - runtime sem eventos: validar ingestao `POST /api/voice/events`
  - fila de voz degradada: revisar queue members e estrategia
  - dispatch de eventos degradado:
    - validar `eventDispatchRuntime` no `GET /health/selftest`
    - listar DLQ de triggers:
      - `GET /api/ops/execution-jobs/dead?kind=dispatch_event_trigger&limit=50`
    - reprocesso assistido por job (um a um, com trilha de auditoria):
      - `POST /api/ops/execution-jobs/retry` com body `{"jobId":"<job-id>"}`
    - apos reprocesso, rerodar gate tecnico:
      - `npm run system:release-gate`
  - thresholds por tenant (event dispatch):
    - variavel: `SELFTEST_EVENT_DISPATCH_THRESHOLDS_BY_TENANT_JSON`
    - exemplo:
      - `{"system":{"deadFail":5,"retryFail":100},"tenantA":{"deadFail":1,"retryFail":20}}`
  - download de gravacao bloqueado: revisar politica (`enabled`/`retentionDays`)
- SLI/SLO:
  - `SLI.voice_runtime_fail` / `SLO = 0 FAIL em selftest`
  - `SLI.active_sessions_backlog` / thresholds por ambiente
  - `SLI.voice_cost_per_call` monitorado por tenant

## Rollback
- Referencia: `docs/ROLLBACK_PLAYBOOK_SUITES_CRITICAS.md`
- Em qualquer incidente critico:
  - congelar mudancas
  - executar rollback da suite afetada
  - rerodar gate tecnico minimo (`npm run system:release-gate`)
  - observacao: o gate usa modo `stack` por padrao (sem duplicar suites)
  - diagnostico (modo legado com etapas redundantes): `RELEASE_GATE_MODE=legacy npm run system:release-gate`

## Imagens Pre-aquecidas (test stack)
- Objetivo:
  - reduzir tempo de `stack-up` em execucoes repetidas (local/CI).
- Build (pre-aquecimento):
  - `npm run system:test-images:prewarm`
  - ou `bash scripts/prewarm-test-images.sh build`
- Push (pipeline de build):
  - `TEST_IMAGE_PREFIX=<registry/repo/r-agent2> TEST_IMAGE_TAG=<tag> npm run system:test-images:push`
- Pull (pipeline de testes):
  - `TEST_IMAGE_PREFIX=<registry/repo/r-agent2> TEST_IMAGE_TAG=<tag> npm run system:test-images:pull`
- Consumo no gate/smokes sem rebuild:
  - `TEST_IMAGE_PREFIX=<registry/repo/r-agent2> TEST_IMAGE_TAG=<tag> STACK_PULL_IMAGES=1 STACK_NO_BUILD=1 bash scripts/test-stack-up.sh`
- Variaveis relevantes:
  - `TEST_IMAGE_PREFIX` (default: `r-agent2`)
  - `TEST_IMAGE_TAG` (default: `test`)
  - `TEST_API_BASE_IMAGE` (override explicito da base da API)

## Fluxo Padrao da Test Stack
- Subir stack de teste:
  - `npm run test:stack:up`
- Aguardar readiness manualmente:
  - `npm run test:stack:wait-ready`
- Rodar smoke essencial da stack (API + frontend + RAG):
  - `npm run test:stack:smoke`
- Rodar fluxo completo com cleanup automatico:
  - `npm run test:stack:full`
- Derrubar stack manualmente:
  - `npm run test:stack:down`
- Reaproveitar imagens locais e evitar rebuild:
  - `STACK_NO_BUILD=1 npm run test:stack:full`
- Manter stack ativa apos o fluxo completo:
  - `STACK_KEEP_UP=1 npm run test:stack:full`

## CI da Test Stack
- Workflow dedicado:
  - `.github/workflows/test-stack-smoke.yml`
- Caracteristicas:
  - nao bloqueante (`continue-on-error: true`)
  - executa `npm run test:stack:full`
  - publica `docker compose ps` e logs como artifact
  - escreve resumo no `GITHUB_STEP_SUMMARY` com outcome, duracao e snapshot da stack
