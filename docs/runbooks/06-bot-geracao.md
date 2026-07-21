# Runbook 6: Bot de Geração de Cenários

## Objetivo

Operar o pipeline completo de geração automática de cenários QA Waves via bot.

## Pré-requisitos

- API em execução
- RAG service em execução (`npm run rag:dev` ou `docker compose up rag-service`)
- Cenários-esqueleto existentes no `scenario-store.json` (drafts)

## Pipeline do bot

```
1. scenario generation → 2. uiSteps inference → 3. validators → 4. seeds → 5. preflight → 6. persist
```

## Passo a passo

### 1. Executar bot completo (todos os drafts)

```bash
# Via API — executa geração para todas as capabilities com gaps
curl -s -X POST http://127.0.0.1:3001/api/qa-waves/bot/generate-all \
  -H 'Content-Type: application/json' \
  -d '{"vertical":"fitness","persist":true}' | jq .
```

### 2. Gerar cenário individual (modo interativo)

```bash
# Passo 1: Gerar estrutura do cenário
curl -s -X POST http://127.0.0.1:3001/api/qa-waves/intelligence/generate-scenario \
  -H 'Content-Type: application/json' \
  -d '{
    "vertical": "fitness",
    "journey": "agendamento",
    "stage": "aula_experimental",
    "gap": "missing_e2e_scenario",
    "context": {"channels": ["whatsapp"], "risk": "high"}
  }' | jq '.draftId'

# Passo 2: Gerar UI steps (usa o draftId do passo 1)
DRAFT_ID="<draftId>"
curl -s -X POST http://127.0.0.1:3001/api/qa-waves/bot/generate-ui-steps \
  -H 'Content-Type: application/json' \
  -d "{\"draftId\":\"$DRAFT_ID\",\"channels\":[\"whatsapp\"]}" | jq .

# Passo 3: Gerar validators
curl -s -X POST http://127.0.0.1:3001/api/qa-waves/bot/generate-validators \
  -H 'Content-Type: application/json' \
  -d "{\"draftId\":\"$DRAFT_ID\"}" | jq .

# Passo 4: Gerar seeds
curl -s -X POST http://127.0.0.1:3001/api/qa-waves/intelligence/generate-seeds \
  -H 'Content-Type: application/json' \
  -d '{"scenarioId":"fitness-matricula-agendamento","quantity":5}' | jq .

# Passo 5: Validar cenário completo
curl -s -X POST http://127.0.0.1:3001/api/qa-waves/validate-scenario \
  -H 'Content-Type: application/json' \
  -d "{\"draftId\":\"$DRAFT_ID\"}" | jq '{valid, errors}'
```

### 3. Revisar e aprovar em lote

```bash
# Listar todos os drafts pendentes
curl -s "http://127.0.0.1:3001/api/qa-waves/intelligence/drafts?status=pending" | jq '.items[] | {draftId: .id, vertical, journey, name}'

# Aprovar drafts válidos em lote
for DRAFT_ID in $(curl -s "http://127.0.0.1:3001/api/qa-waves/intelligence/drafts?status=pending" | jq -r '.items[].id'); do
  echo "Aprovando $DRAFT_ID..."
  curl -s -X POST http://127.0.0.1:3001/api/qa-waves/intelligence/approve-scenario \
    -H 'Content-Type: application/json' \
    -d "{\"draftId\":\"$DRAFT_ID\",\"approvedBy\":\"bot-runbook\"}" | jq '{draftId, status}'
done
```

### 4. Aplicar remediações automáticas

```bash
# Analisa gaps e aplica correções automáticas
curl -s -X POST http://127.0.0.1:3001/api/qa-waves/operational/auto-remediate \
  -H 'Content-Type: application/json' \
  -d '{"vertical":"fitness","apply":true}' | jq .
```

### 5. Pós-geração: atualizar artefatos

```bash
# Atualizar diagramas
npm run qa:waves:diagrams

# Atualizar roteiros
npm run qa:waves:runbooks

# Atualizar enterprise governance
node -e "
const { buildQaWavesEnterpriseGovernance } = require('./tools/system/lib/qa-waves-enterprise-governance-bridge');
const fs = require('fs');
fs.writeFileSync('qa/qa-waves-enterprise-governance.json', JSON.stringify(buildQaWavesEnterpriseGovernance({root:__dirname}), null, 2));
console.log('✅ Enterprise governance updated');
"
```

## Estratégia por vertical

| Vertical | Cenários-esqueleto | Prioridade |
|---|---|---|
| fitness | 27 (mais madura) | **Alta** — começar por aqui |
| beauty | 13 | Média |
| food | 3 | Baixa |
| clinic | 3 | Baixa |
| market | 3 | Baixa |
| services | 3 | Baixa |

Recomendação: executar bot por vertical, começando por fitness. Para cada draft gerado, revisar steps, canais e validações antes de aprovar.

## Verificação de sucesso

- `scenario-store.json` com novos cenários `approved`
- `npm run qa:waves:diagrams` gera diagramas com passos preenchidos
- `npm run qa:waves:runbooks` gera roteiros completos
- `npm run validate:qa-waves-registry` passa

## Troubleshooting

| Sintoma | Ação |
|---|---|
| `AI_UNAVAILABLE` | RAG service offline — iniciar com `npm run rag:dev` |
| Geração retorna steps vazios | Contexto insuficiente — adicionar mais detalhes em `context` |
| Preflight falha | Verificar `waveScenarioSchema.js` para tipos/adapter/canais permitidos |
| Persistência falha | Permissão de escrita em `qa/qa-waves/` |
