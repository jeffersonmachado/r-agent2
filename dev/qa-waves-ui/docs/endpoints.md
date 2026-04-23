# Endpoints mock

Base URL backend: http://localhost:4176/api

## Health
- GET /health

## Waves
- GET /waves
  - Retorna ondas com itens agregados.
  - Query params opcionais: page, pageSize

## Executions
- GET /executions
- GET /executions/:executionId
- POST /executions
  - Body:
    {
      "selectedWaveIds": ["wave-onboarding"],
      "selectedItemIds": ["item-reneg"]
    }

## Replays
- GET /replays
- GET /replays/:replayId
- POST /replays/:replayId/reexecute

Resposta de GET /replays inclui:
- replays: lista paginada
- pagination: { total, page, pageSize, totalPages }

### Query filters de replay
- waveId
- itemId
- status
- channel
- query
- startDate
- startTime
- endDate
- endTime
- page
- pageSize
- sortBy (startedAt|name|waveName|itemName|channel|status|durationMs|critical)
- sortDir (asc|desc)

Exemplo:
GET /replays?startDate=2026-04-20&startTime=08:00&endDate=2026-04-21&endTime=18:30&status=failure&page=1&pageSize=10
