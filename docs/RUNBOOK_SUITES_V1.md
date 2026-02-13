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
