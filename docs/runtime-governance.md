# Runtime Governance

Este documento define como o repositório classifica execução real vs sintética.

## Classes oficiais

- REAL_OK
- SYNTHETIC_OK
- REAL_FAILED_FALLBACK_USED
- BLOCKED

## Regras de classificação

- REAL_OK: runtime real confirmado sem fallback degradante.
- SYNTHETIC_OK: execução concluída em isolamento/sintético sem exigência de runtime real.
- REAL_FAILED_FALLBACK_USED: cenário exigia real, houve fallback degradante.
- BLOCKED: cenário exigia real e não houve confirmação de runtime real.

## Tradução para decisão de gate

- REAL_OK -> go
- SYNTHETIC_OK -> go_degraded
- REAL_FAILED_FALLBACK_USED -> no_go
- BLOCKED -> no_go

## Artefato de governança

Arquivo: qa/runtime-governance-report.json

Campos principais:
- requireRealRuntime
- signals (real confirmado / fallback usado)
- fallbackCount
- issues
- classification
- gateStatus

## Controle por ambiente

- RUNTIME_REQUIRE_REAL=1: exige runtime real
- RUNTIME_REAL_CONFIRMED=1: força confirmação de runtime real
- RUNTIME_FALLBACK_USED=1: marca fallback degradante

Em gates de release:
- RELEASE_GATE_REQUIRE_REAL_RUNTIME=1 bloqueia qualquer resultado não real
- RELEASE_GATE_ALLOW_DEGRADED=0 bloqueia go_degraded
