# Runbook 5: Integridade de Replay

## Objetivo

Verificar e garantir a integridade dos replays determinísticos de cenários QA Waves.

## Pré-requisitos

- Cenários executados com replay habilitado
- Playwright instalado (`npx playwright install`)
- RPA configurado (`core/rpa/`)

## Passo a passo

### 1. Verificar integridade de replays existentes

```bash
# Validar integridade via validador
npm run validate:replay-governance

# Inspecionar relatório
cat reports/replay-governance-validation-report.json | jq .
```

### 2. Listar replays disponíveis

```bash
curl -s "http://127.0.0.1:3001/api/qa-waves/replays?limit=50" | jq '.items[] | {id, journeyId, replayHash, status}'
```

### 3. Verificar integridade de um replay específico

```bash
REPLAY_ID="<replayId>"
curl -s "http://127.0.0.1:3001/api/qa-waves/replays/$REPLAY_ID" | jq '{
  replayHash,
  replayChecksum,
  governanceSignature,
  steps: (.steps | length),
  valid: (.governance.replayIntegrity.valid)
}'
```

### 4. Reexecutar replay com falha de integridade

```bash
curl -s -X POST "http://127.0.0.1:3001/api/qa-waves/replays/$REPLAY_ID/reexecute" | jq .
```

### 5. Verificar hashes manualmente

```bash
# Gerar hash de um replay para verificação manual
node -e "
const fs = require('fs');
const crypto = require('crypto');
const replay = JSON.parse(fs.readFileSync('qa/replay/<replayFile>.json', 'utf8'));
const steps = replay.steps || [];
const hash = crypto.createHash('sha256').update(JSON.stringify(steps)).digest('hex');
console.log('Computed hash:', 'sha256:' + hash);
console.log('Stored hash:  ', replay.replayChecksum);
console.log('Match:', 'sha256:' + hash === replay.replayChecksum);
"
```

### 6. Verificar proveniência (mutation provenance)

```bash
cat qa/qa-waves-enterprise-governance.json | jq '
  .replayArtifacts[] | {
    journeyId,
    replayHash,
    governanceSignature
  }
'
```

### 7. Rodar smoke prod-like para regenerar evidências

```bash
# Requer runtime completo
RUN_QA_WAVES_PROD_LIKE_SMOKE=1 node scripts/smoke/qa-waves-operational-final-smoke.js
```

### 8. Atualizar enterprise governance com novos replays

```bash
node -e "
const { buildQaWavesEnterpriseGovernance } = require('./tools/system/lib/qa-waves-enterprise-governance-bridge');
const fs = require('fs');
const report = buildQaWavesEnterpriseGovernance({ root: __dirname });
fs.writeFileSync('qa/qa-waves-enterprise-governance.json', JSON.stringify(report, null, 2));
console.log('Replay integrity rate:', report.replayIntegrity.rate + '%');
"
```

## Verificação de sucesso

- Todos os replays têm `replayHash` === `replayChecksum`
- `governanceSignature` confere em todos os artifacts
- `replayIntegrity.rate` = 100 no enterprise governance
- `npm run validate:replay-governance` exit code 0

## Troubleshooting

| Sintoma | Ação |
|---|---|
| Hash não confere | Replay foi modificado após gravação — reexecutar cenário |
| Playwright não instalado | `npx playwright install chromium` |
| Replay sem passos | Cenário executou sem RPA habilitado — reexecutar com `replay: true` |
| governanceSignature inválida | Regenerar enterprise governance |
