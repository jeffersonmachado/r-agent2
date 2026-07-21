# Runbook 3: Ler Governança

## Objetivo

Interpretar os relatórios de governança QA Waves e tomar decisão de release.

## Pré-requisitos

- QA Mesh executado (`npm run qa:mesh`)
- Arquivos de evidência gerados

## Passo a passo

### 1. Verificar enterprise governance

```bash
# Via API (requer API rodando)
curl -s http://127.0.0.1:3001/api/qa-waves/enterprise-governance | jq '{status, operationalConfidence, continuousHealthy: .continuousValidationStatus.healthy, activeBlockers}'

# Ou direto do arquivo
cat qa/qa-waves-enterprise-governance.json | jq '{status, operationalConfidence, activeBlockers}'
```

### 2. Interpretar os campos críticos

| Campo | Significado | Valor desejado |
|---|---|---|
| `status` | Decisão GO/NO_GO | `GO` |
| `operationalConfidence` | Score agregado (0-100) | ≥ 95 |
| `replayIntegrity.rate` | % de replays íntegros | 100 |
| `activeBlockers` | Bloqueadores ativos | `[]` (vazio) |
| `continuousValidationStatus.healthy` | Smoke contínuo saudável | `true` |
| `smokeHealth.status` | Smoke prod-like | `GO` |
| `governanceSignature.valid` | Assinaturas de governança | `true` |

### 3. Verificar relatório GO/NO_GO do mesh

```bash
cat qa-mesh/go-no-go-report.json | jq '{
  decision: .decision,
  totals: {passed: .totals.passed, failed: .totals.failed, total: .totals.total},
  domains: .totals.domains
}'
```

### 4. Verificar governance score

```bash
cat reports/governance-score.json | jq '{status, overallGovernance, statuses}'
```

### 5. Rodar validadores de governança

```bash
npm run validate:qa-governance
npm run validate:qa-waves-registry
npm run validate:governance-summary
```

### 6. Consultar PLATFORM_STATUS

```bash
cat docs/governance/PLATFORM_STATUS.md
```

## Decisão

| Evidência | GO | NO_GO |
|---|---|---|
| Enterprise governance | `status: "GO"` | `status: "NO_GO"` |
| QA Mesh | 0 failures | > 0 failures |
| Governance score | `overallGovernance ≥ 95` | < 95 |
| Bloqueadores | `activeBlockers: []` | Bloqueadores presentes |
| Smoke contínuo | `healthy: true` | `healthy: false` |

## Troubleshooting

| Sintoma | Ação |
|---|---|
| Enterprise governance NO_GO | Rodar `POST /api/qa-waves/operational/recompute` e reexecutar mesh |
| Governance score < 95 | Rodar validadores individuais e corrigir gaps |
| Bloqueadores ativos | Inspecionar `activeBlockers[].reason` e tratar cada um |
