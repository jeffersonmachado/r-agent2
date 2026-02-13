# Rollback Playbook - Suites Criticas (Orders / Fast Service / PBX)

## Objetivo
Padronizar rollback operacional para as suites criticas com evidencias minimas de execucao.

## Pre-check geral
1. Confirmar incidente e janela de rollback.
2. Executar snapshot/backup antes de alterar estado:
   - `bash scripts/backup-postgres.sh`
3. Registrar inicio no incidente com data/hora e responsavel.

## Suite: Orders/Delivery
1. Validar saude atual:
   - `curl -s http://localhost:3000/health/selftest`
2. Reverter ultima mudanca de configuracao/flow da suite (deployment ou publish anterior).
3. Executar smoke minimo:
   - criar pedido publico
   - validar status kitchen/dispatch
4. Evidencias:
   - logs da API
   - payload do smoke
   - status final de `/health/selftest`

## Suite: Fast Service (Filas fisicas)
1. Reverter configuracoes da fila/unidade para versao estavel.
2. Executar smoke minimo:
   - kiosk cria ticket
   - station faz call/start/finish
   - panel reflete fila
3. Evidencias:
   - respostas HTTP dos endpoints publicos
   - screenshot/registro de panel

## Suite: PBX/Voz
1. Reverter dialplan/config para versao anterior.
2. Validar integridade PBX:
   - `bash scripts/test-pbx-realtime.sh`
3. Validar runtime de voz:
   - `node scripts/test-voice-runtime-smoke.js`
4. Evidencias:
   - output do smoke PBX
   - output do smoke de voz
   - `/health/selftest` sem `FAIL`

## Restore/DR basico (quando necessario)
1. Restaurar backup:
   - `bash scripts/restore-postgres.sh`
2. Reexecutar migracoes/boot se aplicavel:
   - `npm run db:migrate`
3. Validar import/export de backup por API:
   - `GET /api/backup/export`
   - `POST /api/backup/import`

## Gate de encerramento
1. Executar gate de release:
   - `npm run system:release-gate`
   - padrao: `RELEASE_GATE_MODE=stack` (executa stack completa sem repetir suites fora da stack)
   - opcional diagnostico: `RELEASE_GATE_MODE=legacy npm run system:release-gate`
2. Executar simulado de rollback e gerar evidência:
   - `npm run system:rollback-drill`
   - opcional (aplica rollback PBX no drill): `ROLLBACK_DRILL_APPLY_PBX=1 npm run system:rollback-drill`
   - por padrão, o drill exige evidência PBX de `L-03`/`L-04` em `qa/smoke-evidence.json` (`ROLLBACK_DRILL_REQUIRE_PBX_SMOKE_EVIDENCE=1`).
   - para diagnóstico isolado (sem smoke prévio): `ROLLBACK_DRILL_REQUIRE_PBX_SMOKE_EVIDENCE=0 npm run system:rollback-drill`
3. Consolidar decisão técnica de liberação:
   - `npm run system:go-no-go`
   - execução rápida sem rerodar suites pesadas: `GO_NO_GO_RUN_RELEASE_GATE=0 GO_NO_GO_RUN_ROLLBACK_DRILL=0 npm run system:go-no-go`
   - relatório: `qa/go-no-go-report.json`
4. Atualizar checklist executivo de marcos do lançamento:
   - `npm run system:launch-plan-status`
   - saídas: `qa/launch-plan-status.json` e `qa/launch-plan-status.md`
5. Arquivar evidencias:
   - `qa/release-gate-report.json`
   - `qa/rollback-drill-report.json`
   - `qa/go-no-go-report.json`
   - `qa/launch-plan-status.json`
   - `qa/launch-plan-status.md`
   - `qa/release-window-report.json`
   - `qa/release-manifest.json`
   - pacote consolidado: `npm run system:release-evidence-pack`
     - dry-run de validação: `RELEASE_EVIDENCE_DRY_RUN=1 npm run system:release-evidence-pack`
     - integridade: validar `SHA256SUMS` dentro da pasta `qa/release-evidence/<timestamp>/`
    - logs operacionais
    - checklist de rollback preenchido

## Execução padronizada da janela (recomendado)
1. Modo rápido de validação (sem rerodar suites pesadas):
   - `RELEASE_WINDOW_FAST=1 npm run system:release-window`
2. Modo completo para a janela oficial:
   - pre-check: `npm run system:release-clean-check`
   - `npm run system:release-window`
3. Evidência consolidada da execução:
   - `qa/release-window-report.json`
   - `qa/release-manifest.json`
