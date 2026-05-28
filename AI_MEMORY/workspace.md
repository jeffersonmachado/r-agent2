# RAP Workspace

RAP Workspace is the customer/operation 360 surface. Runtime validation on 2026-05-16 confirmed `/workspace` renders authenticated with customer entities, operational timeline, tickets, tasks, agenda, documents, payments, QA/RPA tabs, IA insights and actions.

## Canonical sources

- `docs/SUPORTE_PADRAO_WORKSPACE.md`
- `docs/OPERATIONS_DASHBOARD.md`
- `docs/ARCHITECTURE_OPERATIONAL_CONSOLE_PHASE4.md`
- `api/composition/workspace/index.js`
- `api/modules/project-management/routes.js`
- `api/db/migrations/20260429090000-create-workspace-core.js`
- `api/db/migrations/20260429100000-evolve-workspace-production-core.js`
- `frontend/src/pages/WorkspacePage.jsx`
- `frontend/src/navigation/workspaceAreas.js`

## Agent rules

- Treat workspace as the operational source of context, not only a dashboard.
- Validate changes against CRM, tickets, agenda/tasks, omnichannel and QA/RPA evidence surfaces.
- Preserve tenant isolation and RBAC.

