# Backend Consolidation Audit

Date: 2026-03-10

## Main findings

- `api/server.js` is the primary structural bottleneck.
  It mixes route matching, startup orchestration, background jobs, provider initialization, realtime wiring, graceful shutdown, static frontend fallback and compatibility logic in one file.

- Oversized HTTP surface still lives inside `api/server.js`.
  Major route clusters found inline:
  - PBX
  - scheduling/calendar
  - autonomous scheduling
  - beauty/fitness verticals
  - flows
  - CRM
  - support
  - WhatsApp QR and IVR
  - voice runtime
  - backup/import/export

- Canonical operational logic already exists, but is fragmented:
  - `api/core/operational-agent/`
  - `api/core/operational-decision/`
  - `api/core/operational-recommendations/`
  - `api/core/operational-outcomes/`
  - `api/core/operational-playbooks/`
  - `api/core/operational-quick-actions/`
  - `api/core/operational-state/`
  - `api/core/operational-state-v2/`

- Operational state and context are duplicated across modules.
  Examples:
  - `api/core/operational-agent/OperationalStateService.js`
  - `api/core/operational-state-v2/OCCOperationalStateRepository.js`
  - `api/services/operationalMetricsService.js`
  - `api/services/schedulingHealthService.js`
  - `api/core/autonomous-scheduling/OperationalMetricsAggregator.js`
  - `api/core/operational-agent/OperationalContextAssembler.js`
  - `api/services/conversationContextService.js`

- Compatibility layers already exist and should be preserved, not removed abruptly:
  - `api/core/operational-compat/`
  - `api/services/operationalEventBus.js`
  - legacy PBX and WhatsApp compatibility endpoints

- Quick actions and playbooks are mostly separated already, but callers still reach them through mixed service paths instead of one canonical orchestration layer.

- OCC endpoints are partially thin already via `api/routes/operationalOccRoutes.js`, but many OCC-adjacent aggregates still depend on non-canonical service calls.

## Refactor map

1. Extract bootstrap orchestration from `api/server.js` into `api/bootstrap/*`.
2. Introduce explicit canonical contracts for the operational cycle.
3. Add canonical facades for:
   - events
   - signals
   - recommendations
   - decision
   - actions
   - outcomes
   - memory
   - context
   - state
4. Route existing modules through these facades using adapters instead of rewrites.
5. Keep legacy route behavior stable while migrating ownership toward canonical modules.

## Immediate priorities

- Bootstrap decomposition
- Canonical contracts
- Unified operational state snapshot service
- Unified operational context service
- Canonical pipeline facade for OCC and future orchestration
