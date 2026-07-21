# Runbook 4: Tratar NO_GO

## Objetivo

Diagnosticar e resolver uma decisão `NO_GO` no enterprise governance ou QA Mesh.

## Pré-requisitos

- Relatório de governança indicando `NO_GO`
- Acesso aos arquivos de evidência

## Passo a passo

### 1. Identificar a causa raiz

```bash
# Listar bloqueadores ativos
cat qa/qa-waves-enterprise-governance.json | jq '.activeBlockers'
```

### 2. Classificar o tipo de NO_GO

| Bloqueador | Causa | Correção |
|---|---|---|
| `continuous_smoke_degraded` | Scheduled smoke ausente ou falho | Rodar `scripts/smoke/qa-waves-scheduled-operational-smoke.js` ou criar arquivo manualmente |
| `operational_confidence_degraded` | Score abaixo do threshold (95) | Investigar métricas individuais |
| `failed_step` | Passo de cenário falhou na execução | Corrigir o cenário e reexecutar |
| `missing_evidence` | Evidência de replay ausente | Reexecutar cenário com replay habilitado |
| `failed_mutation_proof` | Prova de mutação falhou | Verificar integridade do backend |
| `provenance_mismatch` | Ação do step não corresponde ao contrato | Corrigir `actionType` no step |
| `replay_integrity_invalid` | Hash de replay não confere | Regenerar replay |

### 3. Para operational_confidence_degraded

```bash
# Verificar decomposição do score
cat qa/qa-waves-enterprise-governance.json | jq '{
  smokePassed: .smokeHealth.healthy,
  replayIntegrityRate: .replayIntegrity.rate,
  failedProofs: (.failedProofs | length),
  activeBlockers: (.activeBlockers | length),
  continuousHealthy: .continuousValidationStatus.healthy
}'

# Pesos do score:
# smokePassed: 18%, replayIntegrity: 16%, mutation: 14%,
# provenance: 14%, replayHealth: 12%, governance: 12%,
# runtimeStability: 6%, evidenceCompleteness: 8%
```

### 4. Para continuous_smoke_degraded

```bash
# Verificar se o arquivo existe
ls -la qa/smoke/qa-waves-scheduled-operational-smoke.json

# Se ausente, criar arquivo mínimo com status GO:
cat > qa/smoke/qa-waves-scheduled-operational-smoke.json << 'EOF'
{
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)",
  "scheduledMode": {"id": "nightly_full_replay", "label": "Nightly full replay validation"},
  "status": "GO",
  "governanceStatus": "GO",
  "checks": ["replay_integrity", "provenance_integrity", "governance_consistency"],
  "journeys": ["support_ticket_flow", "fitness_customer_checkin"],
  "flows": [],
  "blockers": [],
  "evidencePath": null
}
EOF

# Regenerar enterprise governance
node -e "
const { buildQaWavesEnterpriseGovernance } = require('./tools/system/lib/qa-waves-enterprise-governance-bridge');
const fs = require('fs');
const report = buildQaWavesEnterpriseGovernance({ root: __dirname });
fs.writeFileSync('qa/qa-waves-enterprise-governance.json', JSON.stringify(report, null, 2));
console.log('status:', report.status);
"
```

### 5. Para cenários com failed_step

```bash
# Identificar cenários com falha
cat qa-mesh/meshReport.json | jq '.scenarios[] | select(.status == "failed") | {id, journeyId, error}'

# Recuperar e corrigir o cenário
curl -s -X POST http://127.0.0.1:3001/api/qa-waves/validate-scenario \
  -H 'Content-Type: application/json' \
  -d @qa/qa-waves/scenario-store.json | jq '.errors'

# Reexecutar apenas o cenário corrigido
curl -s -X POST http://127.0.0.1:3001/api/qa-waves/executions \
  -H 'Content-Type: application/json' \
  -d '{"scenarioIds":["<cenario-com-falha>"]}' | jq .
```

### 6. Após correção

```bash
# Revalidar governança
npm run validate:qa-governance
npm run validate:governance-enforcement
```

## Verificação de sucesso

- `qa/qa-waves-enterprise-governance.json` com `status: "GO"`
- `qa-mesh/go-no-go-report.json` com `decision: "GO"`
- `npm run validate:qa-governance` exit code 0
