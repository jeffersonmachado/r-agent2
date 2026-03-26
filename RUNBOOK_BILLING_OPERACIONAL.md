# Runbook Operacional de Billing

## Objetivo
Garantir resposta rapida e padronizada para incidentes de cobranca nas verticais Beauty e Fitness.

## Escopo
- Webhook de pagamentos
- Reconciliacao manual e agendada
- Jobs de billing_reconciliation
- Alertas e SLO financeiro

## Endpoints Operacionais
- GET /api/ops/billing/metrics
- GET /api/ops/billing/health
- GET /api/ops/billing/alerts
- POST /billing/reconcile
- GET /api/operations-dashboard/finance
- GET /api/operations-dashboard/jobs

## SLOs Financeiros (padrao)
- maxProblematicRatePct: 20
- maxChargebackRatePct: 2
- maxRefundRatePct: 8
- maxPendingRatePct: 12
- maxOverdueRatePct: 10
- maxDeadJobs: 0
- maxPendingLagSec: 1800

## Triagem Inicial (5 minutos)
1. Consultar saude: GET /api/ops/billing/health.
2. Verificar alertas ativos: GET /api/ops/billing/alerts.
3. Abrir dashboard operacional na aba Financeiro e identificar status SLO.
4. Se houver alerta critico, abrir job associado no Scheduler/Jobs.

## Falhas Recorrentes de Reconciliacao
Sinal:
- alerta billing_reconciliation_recurring_failure
- deadJobs > 0 para billing_reconciliation

Acao:
1. Listar DLQ: GET /api/ops/execution-jobs/dead?kind=billing_reconciliation
2. Reprocessar job critico: POST /api/ops/execution-jobs/retry { jobId }
3. Executar reconciliacao manual: POST /billing/reconcile
4. Validar snapshot no Financeiro (manual ou scheduler)

## Backlog Envelhecido
Sinal:
- alerta billing_reconciliation_backlog_aged
- pendingLagSec acima do alvo

Acao:
1. Verificar volume pendente em Jobs.
2. Executar /billing/reconcile para reduzir backlog.
3. Confirmar queda de pendingLagSec em /api/ops/billing/health.

## Spike de Chargeback
Sinal:
- alerta billing_chargeback_spike
- chargebackRatePct acima de 2%

Acao:
1. Filtrar Financeiro por status chargeback.
2. Mapear provider e vertical afetados.
3. Abrir incidente e escalar para dono de integracao PSP.
4. Acompanhar reducao de taxa nas proximas 24h.

## Verificacao Pos-Incidente
1. /api/ops/billing/health com status healthy ou degraded sem critico.
2. Sem dead jobs de billing_reconciliation.
3. Sem novos alertas criticos em /api/ops/billing/alerts.
4. Snapshot recente de reconciliacao no Financeiro com updated > 0 quando aplicavel.

## Registro e Auditoria
- Alertas persistem em event_ledger com source: ops.billing.alert.
- Snapshots de reconciliacao persistem em event_ledger:
  - billing.reconciliation.manual
  - billing.reconciliation.scheduler

## Escalonamento
- P1: deadJobs > 0 + chargebackRatePct acima do alvo
- P2: pendingLagSec acima do alvo por mais de 30 min
- P3: violacoes leves sem impacto em receita liquida

## Checklist de Encerramento
1. Confirmar causa raiz.
2. Confirmar mitigacao aplicada.
3. Atualizar changelog operacional.
4. Abrir tarefa de prevencao se recorrente.
