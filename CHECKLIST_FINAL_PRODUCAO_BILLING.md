# Checklist Final de Producao - Billing Operacional

Data: 2026-03-26
Escopo: SLO financeiro, alertas operacionais, reconciliacao manual/scheduler, rastreabilidade Jobs <-> Financeiro.

## 1. Gates de qualidade (obrigatorios)

- [x] Testes unitarios criticos de billing/ops passando.
- [x] Testes de integracao de reconciliacao e bridge Jobs <-> Financeiro passando.
- [x] Build de frontend passando.
- [x] Endpoints de observabilidade expostos e validados em ambiente de deploy.

### Evidencias de validacao executadas

Comandos executados nesta etapa final:

```bash
npm exec -- jest --no-coverage \
  tests/unit/billingAlertsService.test.js \
  tests/unit/billingSloHealthService.test.js \
  tests/unit/operationsDashboardService.test.js \
  tests/integration/billingReconciliationRoutes.test.js \
  tests/integration/billingWebhookReconciliationFlow.test.js \
  tests/integration/operationsDashboardJobsFinanceBridge.test.js \
  --runInBand
```

Resultado: `6 suites / 15 testes - todos passando`.

```bash
cd frontend && npm run build
```

Resultado: build Vite concluido com sucesso.

## 2. Validacoes funcionais pre-deploy

- [x] Reconciliacao manual registra snapshot no event ledger com `mode=manual`.
- [x] Reconciliacao por scheduler registra snapshot no event ledger com `mode=scheduler`.
- [x] Snapshot de reconciliacao inclui `jobId`, `actorId` e `correlationId` quando disponiveis.
- [x] Dashboard Financeiro exibe ultimo snapshot, diferenca por origem e dados de auditoria.
- [x] Navegacao cruzada Financeiro -> Jobs funcionando por `jobId`.
- [x] Navegacao cruzada Jobs -> Financeiro funcionando com destaque do item relacionado.
- [x] Painel de alertas de billing visivel no dashboard.
- [x] Bloco de violacoes SLO visivel no dashboard.

## 3. Endpoints operacionais

- [x] `GET /api/ops/billing/health`
- [x] `GET /api/ops/billing/alerts`
- [x] `POST /api/billing/reconcile`

## 4. Observabilidade e resposta operacional

- [x] Runbook operacional criado: `RUNBOOK_BILLING_OPERACIONAL.md`.
- [x] Historico de alertas persistido no event ledger para auditoria.
- [x] Distincao entre status healthy/degraded/unhealthy definida por politica de SLO.

## 5. Plano de deploy (resumo)

1. Deploy backend com novas rotas de ops e servicos de SLO/alertas.
2. Validar saude inicial via `GET /api/ops/billing/health`.
3. Deploy frontend com painel Financeiro atualizado.
4. Validar UI de alertas e bloco SLO no Operations Dashboard.
5. Executar reconciliacao manual controlada e conferir snapshot no dashboard.

## 6. Rollback (resumo)

1. Reverter frontend para versao anterior, caso haja regressao visual/funcional.
2. Reverter backend para versao anterior, caso endpoints de billing/ops apresentem erro critico.
3. Em caso de rollback parcial, manter monitoramento de event ledger para confirmar ausencia de inconsistencias.
4. Registrar incidente e causa raiz conforme runbook.

## 7. Go/No-Go

- [x] GO para producao condicionado a execucao do deploy em janela controlada e monitoramento ativo apos publicacao.
