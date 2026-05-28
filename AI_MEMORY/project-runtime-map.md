# Project Runtime Map

Validated with Playwright on 2026-05-16 against `http://127.0.0.1:5173`, API process observed on port `3001`, frontend Vite on `5173`.

## Route/API map

| Rota solicitada | Rota canonica real | Alias/Redirect | Componente | Status | Observacoes |
|---|---|---|---|---|---|
| `/support` | `/support` | none | `SupportPage` | VALIDATED | Uses support/ticket APIs; rendered ticket list and actions. |
| `/rpa-replays` | `/dev/rpa-replays` | Alias adicionado 2026-05-27 em `main.jsx` (`isRpaReplaysAlias`) | `RpaReplaysPage` | ALIAS_FIXED | Rota canonica `/dev/rpa-replays` renderiza. Alias `/rpa-replays` agora mapeia diretamente. |
| `/rag-documents` | `/rag-documents` | none | `RAGDocumentsPage` | VALIDATED_WITH_WARNINGS | RAG document UI rendered; inspect API aborts when changing RAG behavior. |
| `/system-status` | `/dev/system-status` | Alias adicionado 2026-05-27 em `main.jsx` (`isSystemStatusAlias`) | `SystemStatusPage` | ALIAS_FIXED | Rota canonica `/dev/system-status` renderiza. Alias `/system-status` agora mapeia diretamente. |
| `/channel-accounts` | `/channel-accounts` | none | `ChannelAccountsPage` | ROUTING_GAP | Router/menu define it; direct browser navigation returned backend 401 JSON. |
| `/channel-health` | `/channel-health` | none | `ChannelHealthPage` | VALIDATED | Rendered operational channel health page. |
| `/generate-system` | `/generate-system` | none | `GenerateSystemPage` | VALIDATED | Super-admin route. |
| `/dashboard` | `/dashboard` | `/` also maps dashboard in app logic | `DashboardV2` | VALIDATED | Cockpit rendered. |
| `/workspace` | `/workspace` | none | `WorkspacePage` | VALIDATED | Customer 360 rendered. |
| `/dev/qa-waves` | `/dev/qa-waves` | none | `QaWavesPage` | VALIDATED_WITH_WARNINGS | UI rendered; QA Waves API calls had network aborts/fetch failures. |

## Menus and permissions

Menu source: `frontend/src/navigation/menu.js`.

- `/support`: Relacionamento/Atendimento, permission `tickets:read`.
- `/workspace`: Relacionamento/Atendimento and Cockpit, permission `workspace:read`.
- `/rag-documents`: Inteligencia/Conhecimento, permission `rag:read`.
- `/dev/system-status`: Operacao/Monitoramento, permission `config:read`.
- `/channel-health`: Operacao/Monitoramento, permission `config:read`, roles supervisor/manager/admin/owner/super_admin.
- `/channel-accounts`: Operacao/Canais, permission `config:read`, roles supervisor/manager/admin/owner/super_admin.
- `/generate-system`: Plataforma/Super Admin, permission `config:read`, role super_admin.
- `/dev/rpa-replays`: Plataforma/Super Admin, permission `flows:read`, role super_admin.
- `/dev/qa-waves`: Plataforma/Super Admin, permission `reports:read`, roles supervisor/manager/admin/owner/super_admin.

## APIs observed through browser

- `/auth/me`
- `/tickets?status=in_progress&limit=1000`
- `/api/test-executions/replays?limit=50&sortBy=date&sortOrder=desc`
- `/tenants/system`
- `/tenants/system/context`
- `/api/qa-waves/journey-status`
- `/api/qa-waves/journeys`
- `/api/qa-waves/scenarios`
- `/api/qa-waves/executions?limit=50`

## Evidence policy

Store future screenshots/traces under governed evidence folders such as `AI_MEMORY/evidence/` or `qa/...`, never `dist/`. Prune transient artifacts and do not package them in release ZIPs.

