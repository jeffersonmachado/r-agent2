# RAP Workspace

O Workspace e a camada 360 do RAP: centraliza a operacao em torno de uma `WorkspaceEntity` sem duplicar dados de origem.

## Contratos

- Multi-tenant obrigatorio: toda query usa `tenant_id` ou `tenant_key` resolvido a partir do tenant autenticado.
- `WorkspaceEntityLink` e a fonte primaria de relacao entre entidade 360 e dados de origem.
- Dados existentes continuam no modulo original; o Workspace guarda vinculos, insights, acoes e eventos operacionais proprios.
- Timeline e paginada por `limit`/`offset` e filtravel por `type`.
- QA/RPA entra via `Evidence`, incluindo `source_ref`/`metadata` para replay quando disponivel.
- Insights combinam heuristicas deterministicas com integracoes defensivas aos servicos de IA existentes.

## Fontes Linkadas

- `conversation`
- `message`
- `ticket`
- `task`
- `schedule`
- `project`
- `project_item`
- `document`
- `evidence`
- `lead`
- `payment`

## Rotas Workspace

- `GET /workspace/entities`
- `GET /workspace/entities/:id`
- `GET /workspace/entities/:id/timeline?type=message|ticket|task|schedule|project|document|evidence|payment`
- `GET /workspace/entities/:id/insights`
- `GET /workspace/entities/:id/actions`
- `POST /workspace/entities`
- `POST /workspace/links`
- `POST /workspace/actions`
- `POST /workspace/entities/:id/actions/auto`
- `GET /workspace/tasks`
- `POST /workspace/tasks`

## Rotas Operacionais

- `GET /timesheet`
- `POST /timesheet`
- `GET /resources`
- `POST /resources`
- `POST /resources/availability`
- `GET /resource-bookings`
- `POST /resource-bookings`
- `GET /payment-events`
- `POST /payment-events`

## Permissoes

- `workspace.read`
- `workspace.write`
- `workspace.action`
- `workspace.insight`
