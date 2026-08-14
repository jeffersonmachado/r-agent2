# Runbook 5: Integridade de Replay

## Objetivo

Verificar e garantir a integridade dos replays determinísticos de cenários QA Waves.

## Pré-requisitos

- Cenários executados com replay habilitado
- Playwright instalado (`npx playwright install`)
- RPA configurado (`core/rpa/`)
- `REPLAY_SIGNING_KEY` ou `ENCRYPTION_KEY` com pelo menos 32 bytes no ambiente/`.env`
- Token autenticado do tenant para consultas HTTP (`AUTH_TOKEN` e `TENANT_ID` nos exemplos)

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
curl -s \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "X-Tenant-Id: $TENANT_ID" \
  "http://127.0.0.1:3001/api/qa-waves/replays?limit=50" \
  | jq '.items[] | {id, journeyId, replayHash, status}'
```

### 3. Verificar integridade de um replay específico

```bash
REPLAY_ID="<replayId>"
curl -s \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "X-Tenant-Id: $TENANT_ID" \
  "http://127.0.0.1:3001/api/qa-waves/replays/$REPLAY_ID" | jq '{
  replayHash,
  replayChecksum,
  governanceSignature,
  steps: (.steps | length),
  valid: (.governance.replayIntegrity.valid)
}'
```

### 4. Reexecutar replay com falha de integridade

```bash
curl -s -X POST \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "X-Tenant-Id: $TENANT_ID" \
  "http://127.0.0.1:3001/api/qa-waves/replays/$REPLAY_ID/reexecute" | jq .
```

### 5. Verificar hashes manualmente

```bash
# Validar o payload canônico e a assinatura HMAC de um replay exportado
node --env-file-if-exists=.env -e "
const fs = require('fs');
const { validateReplayIntegrity } = require('./lib/replayIntegrity');
const replay = JSON.parse(fs.readFileSync('qa/replay/<replayFile>.json', 'utf8'));
const result = validateReplayIntegrity(replay, replay.governance || {});
console.log(JSON.stringify(result, null, 2));
if (!result.valid) process.exitCode = 1;
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
RUN_QA_WAVES_PROD_LIKE_SMOKE=1 \
node --env-file-if-exists=.env scripts/smoke/qa-waves-operational-final-smoke.js
```

### 8. Atualizar enterprise governance com novos replays

```bash
npm run qa:waves:enterprise-governance
```

## Verificação de sucesso

- Todos os replays têm hash e checksum canônicos equivalentes
- `governanceSignature` e `integrity.signatureAlgorithm` usam `hmac-sha256`
- a cadeia recomputada, o `reportHash`, a assinatura enterprise e o pacote apontam para a mesma evidência
- `replayIntegrity.rate` = 100 no enterprise governance
- `npm run validate:replay-governance` exit code 0

## Troubleshooting

| Sintoma | Ação |
|---|---|
| Hash não confere | Replay foi modificado após gravação — reexecutar cenário |
| Playwright não instalado | `npx playwright install chromium` |
| Replay sem passos | Cenário executou sem RPA habilitado — reexecutar com `replay: true` |
| `gov-sha256`/algoritmo legado | Reexecutar o smoke real com a chave configurada; não reclassificar nem apenas reescrever o JSON |
| governanceSignature inválida | Tratar como tamper/key mismatch e reexecutar a jornada real; regenerar apenas o relatório não corrige o replay |
