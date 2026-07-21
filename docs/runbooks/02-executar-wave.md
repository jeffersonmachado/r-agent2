# Runbook 2: Executar Wave

## Objetivo

Executar uma wave de cenários QA Waves via QA Mesh e coletar evidências.

## Pré-requisitos

- Cenários no estado `approved` no `scenario-store.json`
- API em execução
- Redis e PostgreSQL acessíveis (mesh runner depende deles)

## Passo a passo

### 1. Verificar cenários disponíveis para execução

```bash
curl -s "http://127.0.0.1:3001/api/qa-waves/scenarios?status=approved" | jq '.items[] | {id, vertical, journey, status}'
```

### 2. Iniciar execução da wave

```bash
# Executa todos os cenários aprovados
curl -s -X POST http://127.0.0.1:3001/api/qa-waves/executions \
  -H 'Content-Type: application/json' \
  -d '{"scenarioIds":[],"policy":"full"}' | jq .

# Ou executar cenários específicos
curl -s -X POST http://127.0.0.1:3001/api/qa-waves/executions \
  -H 'Content-Type: application/json' \
  -d '{"scenarioIds":["fitness-matricula-agendamento","fitness-matricula-checkin"]}' | jq .
```

### 3. Acompanhar execução

```bash
# Polling do status
EXECUTION_ID="<executionId>"
curl -s "http://127.0.0.1:3001/api/qa-waves/executions/$EXECUTION_ID" | jq '{status, progress}'
```

### 4. Rodar QA Mesh

```bash
npm run qa:mesh
```

### 5. Verificar resultado do mesh

```bash
cat qa-mesh/go-no-go-report.json | jq '{decision, totals: .totals, blockingDomains}'
```

### 6. Coletar evidências de replay

```bash
# Listar replays gerados
curl -s "http://127.0.0.1:3001/api/qa-waves/replays?limit=20" | jq .
```

### 7. Validar integridade dos replays

```bash
npm run validate:replay-governance
```

## Verificação de sucesso

- `qa-mesh/go-no-go-report.json` com `status: "GO"`
- `qa-mesh/metrics.json` com 0 failures, 0 infra errors
- Replays listados em `GET /api/qa-waves/replays` com hashes válidos
- `npm run validate:replay-governance` exit code 0

## Troubleshooting

| Sintoma | Ação |
|---|---|
| Execução fica em `running` indefinidamente | Verificar logs da API (`docker compose logs api`) |
| Mesh retorna infra errors | Verificar Redis/PostgreSQL acessíveis |
| Cenário falha com timeout | Aumentar `timeoutMs` nos steps ou verificar adapter |
