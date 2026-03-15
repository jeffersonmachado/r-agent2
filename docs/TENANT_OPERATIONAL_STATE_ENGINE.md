# Tenant Operational State Engine - Base V1

## 1. Proposito

O `TenantOperationalStateEngine` e a camada que consolida uma leitura viva do estado operacional do tenant.

Ele reutiliza os blocos ja existentes do Tenant Intelligence Core para montar uma visao unica, atual e acionavel do tenant:

- contexto (`TenantContext` via `ContextResolver`)
- metas (`TenantGoal` via `GoalEngine`)
- snapshots de metricas (`TenantMetricSnapshot` via `MetricEngine`)
- insights (`TenantInsight` via `InsightEngine`)
- recomendacoes (`TenantRecommendation` via `RecommendationEngine`)
- evidencias (`TenantInsightEvidence` via `EvidenceEngine`, opcional)

## 2. Localizacao

Arquivo principal:

- `api/core/tenant-intelligence/TenantOperationalStateEngine.js`

Facade publica:

- `TenantIntelligenceService.getOperationalState(input)`

Endpoints HTTP:

- `POST /api/intelligence/operational-state`
- `GET /api/intelligence/operational-state`

## 3. Contrato de entrada

```json
{
  "period": "month",
  "mode": "read",
  "filters": {},
  "options": {
    "refreshMetrics": false,
    "includeEvidence": false
  }
}
```

Regras:

- `mode=read` (default): nao coleta novos snapshots
- `mode=refresh`: ativa `refreshMetrics=true` por padrao
- `options.refreshMetrics` pode sobrescrever o padrao do `mode`
- `options.includeEvidence=true` inclui `evidenceByInsight` e `evidenceTotal`

## 4. Contrato de saida

```json
{
  "ok": true,
  "state": {
    "tenant": {
      "id": "tenant-1",
      "context": {}
    },
    "period": {
      "type": "month",
      "start": "...",
      "end": "..."
    },
    "filters": {},
    "health": {
      "status": "warning",
      "score": 62,
      "reasons": ["1 goal(s) off_track"]
    },
    "goals": {
      "total": 0,
      "byStatus": {},
      "items": []
    },
    "metrics": {
      "totalSnapshots": 0,
      "latestSnapshotAt": null,
      "items": []
    },
    "insights": {
      "totalOpen": 0,
      "byImpact": {},
      "items": [],
      "evidenceByInsight": {},
      "evidenceTotal": 0
    },
    "recommendations": {
      "totalOpen": 0,
      "byPriority": {},
      "items": []
    },
    "refresh": {
      "metrics": false,
      "snapshotsCreated": 0,
      "ok": true
    },
    "generatedAt": "..."
  }
}
```

### Variante GET

Exemplo:

```http
GET /api/intelligence/operational-state?period=week&mode=refresh&refreshMetrics=true&includeEvidence=false
```

Parametros suportados:

- `period`: `day|week|month|quarter|year|custom`
- `mode`: `read|refresh`
- `refreshMetrics`: `true|false|1|0`
- `includeEvidence`: `true|false|1|0`
- `filters`: JSON serializado (opcional)

## 5. Modelo de health score (base V1)

Pontuacao inicial: `100`

Penalidades:

- `-20` por meta `off_track`
- `-10` por meta `at_risk`
- `-15` por insight `impact=high`
- `-10` por recomendacao `priority=critical`

Faixas:

- `healthy`: score >= 70
- `warning`: 40 <= score <= 69
- `critical`: score <= 39

## 6. Objetivo desta base

Esta base entrega:

- ponto unico de leitura operacional por tenant
- contrato consistente para UI e automacoes
- suporte a modo `read` e `refresh` sem duplicar arquitetura

E nao tenta, nesta fase:

- inferencia causal avancada
- previsao de tendencias com modelos complexos
- consolidacao cross-tenant
