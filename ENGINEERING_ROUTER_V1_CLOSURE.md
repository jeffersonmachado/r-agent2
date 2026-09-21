# ENGINEERING_ROUTER_V1_CLOSURE.md

Missão: RELEASE_CLOSURE HARDENING do Engineering Model Router V1. Fechar os 10 blockers
congelados abaixo com teste-primeiro, evidência de runtime real, e um piloto real promovido ao
source antes de declarar GO. Sem V2, sem redesenho, sem novas frentes.

## Baseline

```
BASELINE_HEAD: 6f5b5d690b772ccd066059659ad234d3ab5d1f1b
BASELINE_SOURCE_FINGERPRINT: d4c4d01597a07d7003b4d27129e2572e2f06e9e0f28def5dcfaba3097d68dc01
  (governance/proof-engine/fingerprint-chain.js::computeSourceFingerprint — autoridade canônica
  já existente no projeto, reutilizada aqui sem reimplementar)
STARTED_AT: 2026-09-21T05:30:00Z (aprox., início desta missão de fechamento)
CLOSURE_BACKLOG_VERSION: 1.0.0
GIT_STATUS_AT_BASELINE: working tree limpo (sem alterações pendentes)
```

Gate estrutural na baseline: `node scripts/governance/validate-engineering-router-v1.js` →
`status=PASS checks=44 falhas=0`.

## Escopo congelado (10 blockers, ordem de execução obrigatória)

1. ERV1-CLOSE-001 — Eliminar execução arbitrária de shell no Test Runner
2. ERV1-CLOSE-002 — Isolar environment dos testes + redaction de output
3. ERV1-CLOSE-003 — SecretRedaction multiline/whole-document
4. ERV1-CLOSE-006 — Separar credential scope de tenant/event scope
5. ERV1-CLOSE-008 — Model-level availability + reroute
6. ERV1-CLOSE-009 — Restart/resume + concorrência
7. ERV1-CLOSE-004 — Regression e Governance reais
8. ERV1-CLOSE-005 — Promotion do patch exato validado
9. ERV1-CLOSE-007 — Release Closure com autoridade real
10. ERV1-CLOSE-010 — Runtime certification

## Blockers

### ERV1-CLOSE-001 — Execução de comandos

- RED reproduced:
- fix:
- tests:
- evidence:
- status: EM ANDAMENTO

### ERV1-CLOSE-002 — Safe environment + output redaction

- status: PENDENTE

### ERV1-CLOSE-003 — Secret redaction multiline

- status: PENDENTE

### ERV1-CLOSE-006 — Credential scope isolation

- status: PENDENTE

### ERV1-CLOSE-008 — Model-level availability + reroute

- status: PENDENTE

### ERV1-CLOSE-009 — Restart/resume + concorrência

- status: PENDENTE

### ERV1-CLOSE-004 — Regression e Governance reais

- status: PENDENTE

### ERV1-CLOSE-005 — Promotion do patch exato validado

- status: PENDENTE

### ERV1-CLOSE-007 — Release Closure com autoridade real

- status: PENDENTE

### ERV1-CLOSE-010 — Runtime certification

- status: PENDENTE

## Relatório final (preenchido ao fim)

FINAL: PENDENTE
