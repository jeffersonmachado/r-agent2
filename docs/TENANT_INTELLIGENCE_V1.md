# Tenant Intelligence Core — V1

> Fase 0–5 concluída. Dezembro 2024.

## Visão Geral

O **Tenant Intelligence Core** adiciona ao r-agent2 uma camada de inteligência operacional por tenant: metas estratégicas, coleta de métricas, geração de insights rastreáveis, recomendações acionáveis e busca semântica aumentada com RAG.

---

## Arquitetura

```
api/core/tenant-intelligence/
├── helpers.js                 # Utilitários: buildId, toNumber, parsePeriod, resolvePeriodBounds, dateOnlyString
├── ContextResolver.js         # Monta contexto de tenant (dados + metas ativas) para o pipeline RAG
├── GoalEngine.js              # CRUD de TenantGoal + avaliação de status (on_track / at_risk / off_track)
├── MetricEngine.js            # Coleta snapshots de event_ledger, listagem e concentração de eventos
├── InsightEngine.js           # Gera e persiste insights rastreáveis a partir de metas + métricas
├── EvidenceEngine.js          # Cria e lista evidências vinculadas a insights
├── RecommendationEngine.js    # Mapeia insights → recomendações e persiste
├── StrategicSearchService.js  # Orquestra busca estratégica: contexto → metas → métricas → insights → RAG
├── TenantIntelligenceService.js  # Singleton-façade; entrypoint público via getTenantIntelligenceService()
└── index.js                   # Re-exporta todos os engines
```

### Fluxo principal — busca estratégica

```
POST /api/intelligence/search
  │
  ├─ ContextResolver     resolve contexto do tenant (tenantId, goals, período)
  ├─ GoalEngine          lista metas ativas
  ├─ MetricEngine        coleta snapshots somente quando refreshMetrics=true
  ├─ InsightEngine       gera insights somente quando refreshInsights=true
  ├─ RecommendationEngine gera recomendações somente quando refreshRecommendations=true
  └─ ragService.queryRag busca semântica com contexto enriquecido
```

### Modos de execução da busca

- `mode: "read"` (default): operação orientada a leitura, sem efeitos colaterais de escrita.
- `mode: "refresh"`: habilita refresh completo de métricas, insights e recomendações.

Também é possível override fino com `options`:

```json
{
  "question": "Como está o tenant?",
  "mode": "read",
  "options": {
    "refreshMetrics": false,
    "refreshInsights": false,
    "refreshRecommendations": false
  }
}
```

Regra de consistência desta V1 consolidada:

- Em uma mesma execução de busca com refresh, os snapshots coletados pelo `StrategicSearchService` são repassados para o `InsightEngine`.
- O `InsightEngine` não recolhe/persiste novos snapshots quando já recebe snapshots válidos da execução corrente.

---

## Modelos de Dados

| Modelo                 | Tabela                         | Finalidade |
|------------------------|--------------------------------|------------|
| `TenantGoal`           | `tenant_goals`                 | Metas estratégicas por tenant |
| `TenantMetricSnapshot` | `tenant_metric_snapshots`      | Snapshots de métricas (event_ledger) |
| `TenantInsight`        | `tenant_insights`              | Insights gerados automaticamente |
| `TenantInsightEvidence`| `tenant_insight_evidence`      | Evidências rastreáveis para cada insight |
| `TenantRecommendation` | `tenant_recommendations`       | Recomendações acionáveis |

Todos os modelos incluem `tenant_id` para isolamento multi-tenant e `id` em formato `<prefix>_<uuid-sem-hifens>` gerado por `buildId()`.

---

## API REST

### Autenticação e Permissões

Todas as rotas exigem:
- **Auth válida**: `requireAuth(req)` → caso contrário `401 { error: 'unauthorized' }`
- **Permissão de tenant**: `requireTenant(req)` → `tenantId`
- **Permissão de recurso**: variável por rota (ver tabela abaixo)

| Rota | Método | Permissão exigida |
|------|--------|-------------------|
| `/api/intelligence/search` | POST | `analytics:read` |
| `/api/intelligence/goals` | GET | `analytics:read` |
| `/api/intelligence/operational-state` | POST | `analytics:read` |
| `/api/intelligence/operational-state` | GET | `analytics:read` |
| `/api/intelligence/goals` | POST | `config:write` |
| `/api/intelligence/goals/:id` | PUT | `config:update` |
| `/api/intelligence/metrics/snapshots` | POST | `analytics:read` |
| `/api/intelligence/insights` | GET | `analytics:read` |
| `/api/intelligence/insights/:id/evidence` | GET | `analytics:read` |
| `/api/intelligence/recommendations` | GET | `analytics:read` |

### Endpoints

#### `POST /api/intelligence/search`
Busca estratégica com suporte RAG.

**Body** (`application/json`):
```json
{
  "question": "Como está a meta de atendimento?",
  "period": "month",
  "mode": "read",
  "options": {
    "refreshMetrics": false,
    "refreshInsights": false,
    "refreshRecommendations": false
  }
}
```

**Resposta 200**:
```json
{
  "ok": true,
  "answer": "resposta objetiva",
  "context": { "tenant": {}, "objectives": [], "period": {}, "filters": {} },
  "goalsImpact": [],
  "insights": [],
  "recommendations": [],
  "evidence": [],
  "sources": [],
  "meta": { "usedRag": true, "usedSnapshots": false, "usedPersistedInsights": true, "mode": "read" }
}
```

`mode` e `options`:

- `mode=read` (default): sem refresh de escrita
- `mode=refresh`: refresh completo por padrão
- `options.*` permite ligar/desligar cada refresh individualmente

---

#### `POST /api/intelligence/operational-state`
Retorna leitura viva consolidada do estado operacional do tenant.

**Body** (`application/json`):
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

**Resposta 200**:
```json
{
  "ok": true,
  "state": {
    "health": { "status": "healthy", "score": 100, "reasons": [] },
    "goals": { "total": 0, "byStatus": {}, "items": [] },
    "metrics": { "totalSnapshots": 0, "latestSnapshotAt": null, "items": [] },
    "insights": { "totalOpen": 0, "byImpact": {}, "items": [] },
    "recommendations": { "totalOpen": 0, "byPriority": {}, "items": [] }
  }
}
```

Regras:

- `mode=read` (default): leitura sem coleta de novos snapshots
- `mode=refresh`: ativa `refreshMetrics=true`
- `options.refreshMetrics` pode sobrescrever o comportamento do `mode`

#### `GET /api/intelligence/operational-state`
Leitura equivalente ao endpoint POST, com parâmetros em query string.

Exemplo:

```http
GET /api/intelligence/operational-state?period=week&mode=refresh&refreshMetrics=true&includeEvidence=true
```

Query params:

- `period`
- `mode`
- `refreshMetrics`
- `includeEvidence`
- `filters` (JSON serializado, opcional)

Detalhamento completo em: `docs/TENANT_OPERATIONAL_STATE_ENGINE.md`

---

#### `GET /api/intelligence/goals`
Lista metas do tenant.

**Query params**: `status` (on_track | at_risk | off_track), `limit` (default 100), `offset` (default 0)

**Resposta 200**: `{ "ok": true, "items": [...TenantGoal], "total": N }`

---

#### `POST /api/intelligence/goals`
Cria nova meta.

**Body**:
```json
{
  "name": "Reduzir TTR",
  "metric_key": "event_ledger.resolution_time_avg",
  "target_value": 120,
  "operator": "lte",
  "period": "month"
}
```

**Resposta 201**: `{ "goal": {...TenantGoal}, "evaluation": { "computedStatus": "on_track", ... } }`

---

#### `PUT /api/intelligence/goals/:id`
Atualiza campos de uma meta existente (ex.: `current_value`, `status`).

**Body**: campos parciais de `TenantGoal`

**Resposta 200**: `{ "ok": true, "goal": {...}, "evaluation": {...} }`

**Resposta 404**: `{ "error": "goal_not_found" }`

---

#### `POST /api/intelligence/metrics/snapshots`
Coleta snapshots de métricas do `event_ledger` para o período.

**Body**: `{ "period": "month", "custom": { "start": "2025-01-01", "end": "2025-02-01" } }`

**Resposta 200**:
```json
{
  "ok": true,
  "snapshots": [{ "metric_key": "event_ledger.total_events", "value": 1234, ... }],
  "period": { "type": "month", "start": "...", "end": "..." }
}
```

---

#### `GET /api/intelligence/insights`
Lista insights gerados para o tenant.

**Query params**: `status`, `type`, `impact`, `limit` (default 100), `offset`

**Resposta 200**: `{ "ok": true, "items": [...TenantInsight], "total": N }`

---

#### `GET /api/intelligence/insights/:id/evidence`
Lista evidências rastreáveis de um insight específico.

**Resposta 200**: `{ "ok": true, "items": [...TenantInsightEvidence], "total": N }`

**Resposta 404** se o insight não pertencer ao tenant.

---

#### `GET /api/intelligence/recommendations`
Lista recomendações ativas para o tenant.

**Query params**: `status`, `priority`, `limit`, `offset`

**Resposta 200**: `{ "ok": true, "items": [...TenantRecommendation], "total": N }`

---

## GoalEngine — Avaliação de Status

`evaluateGoalStatus({ targetValue, currentValue, operator })` retorna `computedStatus`:

| `operator` | Condição para `on_track` |
|------------|--------------------------|
| `gte`      | `currentValue >= targetValue` |
| `lte`      | `currentValue <= targetValue` |
| `eq`       | `currentValue === targetValue` |

Thresholds de risco (`at_risk`): desvio ≤ 15% do alvo. Além disso: `off_track`. Inputs ausentes/NaN: `unknown`.

---

## Período — `resolvePeriodBounds`

| `period` | Janela |
|----------|--------|
| `day`    | Últimas 24 h |
| `week`   | Últimos 7 dias |
| `month`  | Últimos 30 dias |
| `quarter`| Últimos 90 dias |
| `year`   | Últimos 365 dias |
| `custom` + `{ start, end }` válidas | Janela exata |
| `custom` com datas inválidas | Fallback para `month` |

---

## Tipos de Insight

| `type` | Gatilho |
|--------|---------|
| `goal_off_track` | Meta com `computedStatus = off_track` |
| `goal_at_risk`   | Meta com `computedStatus = at_risk` |
| `metric_drop`    | Variação negativa significativa em métrica |
| `metric_increase`| Variação positiva significativa em métrica |
| `event_concentration` | Concentração anômala de um tipo de evento |

Cada insight é criado com deduplicação (`_findExistingInsight`) para evitar duplicatas no mesmo ciclo.

---

## Rastreabilidade — Evidências

Cada insight pode ter `N` evidências (`TenantInsightEvidence`) com campos:
- `evidence_type`: `metric_snapshot` | `goal_evaluation` | `event_ledger`
- `source_type`: tipo da entidade fonte
- `source_id`: ID da entidade fonte
- `payload`: dados brutos (JSON)

---

## Recomendações — Mapeamento de Tipo

| Tipo de insight | Ação sugerida |
|-----------------|---------------|
| `goal_off_track` | Revisão imediata da meta e das causas |
| `event_concentration` | Investigar concentração de eventos |
| `metric_drop` | Analisar degradação da métrica |
| `metric_increase` | Avaliar se o aumento é esperado |
| `goal_at_risk` | Monitoramento reforçado |
| *(outros)* | Análise geral recomendada |

---

## Cobertura de Testes (Phase 5)

| Arquivo | Testes | Cobertura |
|---------|--------|-----------|
| `tests/unit/intelligenceRoutes.test.js` | 7 | Rotas básicas (search, goals CRUD, mode/options de busca) |
| `tests/unit/intelligenceRouteWiring.test.js` | 2 | Wiring do dispatcher no server |
| `tests/unit/tenantIntelligenceEngines.test.js` | 53 | helpers, GoalEngine, RecommendationEngine._mapInsightToRecommendation, EvidenceEngine, controle de refresh no InsightEngine |
| `tests/unit/tenantIntelligenceRoutesExpanded.test.js` | 28 | Auth guards, PUT goals/:id, GET insights, GET evidence, POST metrics/snapshots |
| `tests/unit/strategicSearchService.test.js` | 3 | modo read/refresh e handoff de snapshots sem duplicação |
| **Total** | **93** | |

---

## Restrições Multi-Tenant

- Toda operação de leitura/escrita inclui `WHERE tenant_id = :tenantId`
- Nenhum cross-tenant leak é possível via queries dos engines
- `requireTenant()` falha com 401 no nível de rota se tenant não identificado

---

## Limitações Conhecidas (V1)

1. **Sem geração automática de insights em background**: insights são gerados on-demand via `/api/intelligence/search` ou chamada direta a `InsightEngine.generateInsights()`
2. **Sem paginação cursor-based**: usa `limit/offset`
3. **`event_concentration` usa SQL raw**: depende de `getSequelize()` direto; não testado em SQLite (apenas PostgreSQL)
4. **RAG opcional**: se `ragService` não estiver configurado, `StrategicSearchService` pode falhar silenciosamente

---

## Migração

Nenhuma migração manual necessária além das já executadas nas fases 0–2:
- `20241201_create_tenant_goals`
- `20241201_create_tenant_metric_snapshots`
- `20241201_create_tenant_insights`
- `20241201_create_tenant_insight_evidence`
- `20241201_create_tenant_recommendations`

Em desenvolvimento, o Sequelize sincroniza automaticamente via `sync({ alter: true })`.
