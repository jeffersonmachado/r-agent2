# Operations Dashboard (Beauty + Fitness)

Status: MVP funcional para piloto controlado (multi-tenant)

## Objetivo
Painel operacional para acompanhar o piloto das verticais Beauty e Fitness sem criar um sistema paralelo.

- Reuso do core existente (`verticalMetricsEngine`, `customerJourneyEngine`, `executionQueueService`, `verticalRecommendationService`, `engagementEngine`, `event_ledger`)
- Foco em leitura rápida para operação
- Honestidade de dados: métricas exatas vs derivadas são explicitadas

## Endpoints
Namespace: `/api/operations-dashboard`

- `GET /api/operations-dashboard/summary`
- `GET /api/operations-dashboard/timeline`
- `GET /api/operations-dashboard/jobs`
- `GET /api/operations-dashboard/notifications`
- `GET /api/operations-dashboard/insights`

Parâmetros suportados (conforme endpoint):

- `tenantId` (override permitido apenas para super-admin)
- `vertical` (`beauty`, `fitness`, `all`)
- `startDate`, `endDate`
- `subjectId`, `customerId`, `membershipId`
- `status`, `channel`
- `limit`, `page`

## Bloco A: Visão Geral
Fontes:

- `VerticalJourneyEvent`
- `VerticalAttendance`
- `VerticalEngagementSignal`
- `AccessMembership`
- `ExecutionJob`
- `EventLedger` (entregas de notificação)
- `computeVerticalMetrics` (`verticalMetricsEngine`)

Indicadores:

- Beauty: `appointmentsToday`, `completedServices`, `noShow`, `reactivations`
- Fitness: `checkInsToday`, `activeStudents`, `lowFrequency`, `blocked`
- Sistema: `jobsExecuted`, `jobsError`, `notificationsSent`, `notificationFailures`

Métricas derivadas (honestas):

- `beauty.appointmentsToday`: proxy via `VerticalJourneyEvent(event_type=confirmation_sent)`
- `fitness.lowFrequency`: último sinal `low_frequency` por aluno no período

## Bloco B: Jornada / Timeline
Fontes:

- `VerticalJourneyEvent`
- `VerticalAttendance`
- `EventLedger` (histórico de billing membership)

Status visual no retorno:

- `success`
- `failed`
- `pending`
- `provider-dependent`

Classificação aplicada:

- eventos de jornada com canal externo e sem confirmação de provider: `provider-dependent`
- eventos de attendance `absent`: `failed`
- eventos pendentes (`status=pending`): `pending`

Ordenação: mais recente para mais antigo

Paginação: `page` + `limit`

## Bloco C: Scheduler / Jobs
Fonte principal: `ExecutionJob`

Campos retornados por item:

- `kind`
- `tenantId`
- `status`
- `startedAt`
- `finishedAt`
- `durationMs`
- `attempt`
- `retries`
- `error`

Resumo retornado:

- `executed`, `success`, `failed`
- `avgDurationMs`
- `retries`
- `backlogEstimated`/`pending`
- breakdown por tipo (`byKind`)

## Bloco D: Notificações
Fonte principal:

- `EventLedger` com `type=VerticalJourney_Custom` e `source=vertical.notification.*`

Como os dados entram no ledger:

- `notificationAdapter.sendJourneyNotification` registra cada tentativa com payload `kind=notification_delivery`
- status normalizado para painel: `sent`, `failed`, `skipped`, `provider-dependent`
- `isStub` preservado (stub nunca aparece como envio real)

Fallback honesto (quando não há delivery log):

- proxy por `VerticalJourneyEvent` com `meta.dataSource=vertical_journey_proxy`
- gera warning em `meta.warnings`

## Bloco E: Insights Operacionais
Fontes:

- `verticalRecommendationService`
- `engagementEngine` (indiretamente via recomendações)
- `AccessMembership`, `VerticalJourneyEvent`, `VerticalAttendance` (seleção de candidatos)

Insights cobertos:

- Beauty: risco de no-show, elegíveis para retorno, upsell
- Fitness: risco de evasão, baixa frequência, follow-up de bloqueio/delinquência

Score + explicação:

- Quando o engine já retorna score: `scoreSource=engine`
- Quando não retorna score numérico: score derivado mapeado por tipo (`scoreSource=derived`)

## Frontend
Página: `/operations-dashboard`

Seções:

- Filtros globais (`tenant`, `vertical`, `period`)
- Cards executivos (Beauty/Fitness/Sistema)
- Timeline
- Jobs
- Notificações
- Insights

Atualização:

- manual (botão de atualizar)

## Segurança e multi-tenant

- rotas protegidas por `requireAuth`
- permissão mínima: `analytics:read`
- isolamento por tenant obrigatório
- `tenantId` em query só pode sobrescrever tenant autenticado para super-admin

## Limitações conhecidas

- parte de métricas de Beauty depende de proxy por eventos de jornada (não há tabela de agenda dedicada no escopo)
- notificações históricas anteriores ao delivery-log podem cair em modo proxy (`vertical_journey_proxy`)
- alguns scores de insights são derivados quando a recomendação não expõe score numérico
