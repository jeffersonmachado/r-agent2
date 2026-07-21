# Runbook 1: Criar Cenário QA Waves

## Objetivo

Criar um cenário executável de QA Waves — desde a geração via bot até a aprovação final.

## Pré-requisitos

- API em execução (`npm run dev:api` ou `docker compose up api`)
- Autenticado como `systemadmin` no tenant `system`
- Conhecer a vertical e jornada alvo (ex: `fitness`, `agendamento`)

## Passo a passo

### 1. Verificar cobertura atual

```bash
# Lista jornadas com status de cobertura
curl -s http://127.0.0.1:3001/api/qa-waves/intelligence/coverage?vertical=fitness | jq .
```

### 2. Identificar gaps

```bash
# Analisa gaps de cobertura para uma vertical
curl -s -X POST http://127.0.0.1:3001/api/qa-waves/intelligence/analyze-gaps \
  -H 'Content-Type: application/json' \
  -d '{"vertical":"fitness"}' | jq .
```

### 3. Gerar cenário via bot

```bash
# Gera draft de cenário com IA
curl -s -X POST http://127.0.0.1:3001/api/qa-waves/intelligence/generate-scenario \
  -H 'Content-Type: application/json' \
  -d '{
    "vertical": "fitness",
    "journey": "agendamento",
    "stage": "aula_experimental",
    "gap": "missing_e2e_scenario",
    "context": {"channels": ["whatsapp"], "risk": "high"}
  }' | jq .
```

### 4. Listar drafts gerados

```bash
curl -s "http://127.0.0.1:3001/api/qa-waves/intelligence/drafts?vertical=fitness" | jq .
```

### 5. Gerar seeds para o cenário

```bash
curl -s -X POST http://127.0.0.1:3001/api/qa-waves/intelligence/generate-seeds \
  -H 'Content-Type: application/json' \
  -d '{"scenarioId":"fitness-matricula-agendamento","quantity":5}' | jq .
```

### 6. Validar cenário

```bash
# Valida se o cenário está conforme o schema
curl -s -X POST http://127.0.0.1:3001/api/qa-waves/validate-scenario \
  -H 'Content-Type: application/json' \
  -d @qa/qa-waves/draft-scenario.json | jq .
```

### 7. Revisar e aprovar

No browser (frontend em `http://127.0.0.1:5173`):

1. Acessar `/dev/qa-waves` (menu Plataforma > QA Waves)
2. Clicar na vertical e jornada desejada
3. Revisar passos, canais, validações do draft
4. Clicar **Aprovar** ou **Rejeitar** com justificativa

Alternativa via API:

```bash
# Aprovar draft
curl -s -X POST http://127.0.0.1:3001/api/qa-waves/intelligence/approve-scenario \
  -H 'Content-Type: application/json' \
  -d '{"draftId":"<draftId>","approvedBy":"systemadmin"}' | jq .
```

### 8. Salvar cenário aprovado

```bash
curl -s -X POST http://127.0.0.1:3001/api/qa-waves/save-scenario \
  -H 'Content-Type: application/json' \
  -d @qa/qa-waves/approved-scenario.json | jq .
```

## Verificação de sucesso

- `qa/qa-waves/scenario-store.json` contém o novo cenário com `status: "approved"`
- `qa-waves/journey-coverage/fitness.json` mostra o cenário na jornada correta
- `npm run qa:waves:diagrams` gera diagrama atualizado

## Troubleshooting

| Sintoma | Ação |
|---|---|
| `AI_UNAVAILABLE` | Verificar se RAG service está rodando (`npm run rag:dev`) |
| Validação falha | Verificar `waveScenarioSchema.js` — steps precisam de `type`, `adapter`, `channel` permitidos |
| Draft não aparece | Verificar `GET /api/qa-waves/intelligence/drafts` com filtro correto |
