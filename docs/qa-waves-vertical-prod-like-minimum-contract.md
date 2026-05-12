# QA Waves Vertical Prod-Like Minimum Contract

This document defines the minimum operational replay contract required to grant honest `prod-like` evidence for the remaining verticals:

- `food`
- `clinic`
- `market`

It is derived from the current operational replay gate, not from a parallel product spec. Any future runner for these verticals should satisfy this document and the existing code-level invariants.

## Existing Gate Invariants

The current gate is enforced by three code paths:

- `scripts/smoke/qa-waves-operational-final-smoke.js`
- `qa/contracts/operationalStepRegistry.js`
- `api/services/qa/operationalReplayValidator.js`

The minimum contract below is constrained by those invariants.

### Replay-wide minimum

Every replay that intends to count as `prod-like` must satisfy all of the following:

- run against `prod_like_real_stack`
- execute with `evidenceClassification: operational`
- contain at least one mutational step
- produce `audit.valid === true`
- produce `strictGovernance.valid === true`
- produce `operationalReplayValidator(...).goNoGo === 'GO'`

### Step-wide minimum

Every step in the replay must include:

- `screenshotBefore`
- `screenshotAfter`
- `url`
- `networkEvents` (empty array is acceptable for non-mutational steps)
- `evidenceClassification: operational`

### Mutational-step minimum

Every mutational step must additionally include:

- `mutationExpected: true`
- `incrementalDiff.changed === true`
- `mutationLinkage`
- `observedMutations` covering all `expectedMutations`
- `observedSideEffects` covering all `expectedSideEffects`
- `networkCorrelation` or fallback network correlation in `postStateProof` or `postStateSummary`
- `mutationProvenance` or fallback provenance in `postStateProof` or `postStateSummary`

Every provenance record used to satisfy the gate must include:

- `valid === true`
- `correlatedBy === 'network_linkage'`

### Operational module requirement

The replay validator currently recognizes operational pages and APIs only for the following modules:

- `/support`
- `/fitness`
- `/access-control`
- `/calendar`
- `/bookings`

Before any `food`, `clinic`, or `market` runner can pass honestly, `api/services/qa/operationalReplayValidator.js` must be extended so the operational module pattern recognizes the real pages and APIs of those verticals.

Minimum new module patterns required:

- `food`: `/orders` and related order APIs
- `clinic`: `/maintenance` and related ticket maintenance APIs
- `market`: `/node-marketplace` and related node marketplace APIs

## Minimum Flow Shape Per Vertical

For the remaining verticals, the minimum acceptable flow shape is the same as the already-accepted `booking_flow` pattern:

1. Access real operational module
2. Execute one real mutational step
3. Assert persisted backend state

This is the smallest honest contract that can pass the current gate without inventing multi-step choreography that the product does not yet need.

## Food Contract

### Target UI/module

- page: `/orders`
- existing screen catalog anchor: `FOOD-SCR-01`

### Recommended journey id

- `food_order_status_flow`

### Minimum steps

1. `step_access_orders_module`
   - `actionType: navigate`
   - `mutationExpected: false`
   - proof: browser navigation into `/orders`

2. `step_update_order_status`
   - `actionType: update_order_status`
   - `mutationExpected: true`
   - expected mutations:
     - `order_status_changed`
   - expected side effects:
     - `event_ledger_recorded`
   - minimum network proof:
     - `PUT /orders/:orderId/status`
   - minimum backend delta:
     - order status changed from previous status to next status

3. `step_assert_order_backend`
   - `actionType: assert_backend_state`
   - `mutationExpected: false`
   - assert persisted order status and mutation provenance

### Existing code anchors

- frontend API: `frontend/src/api/orders.js`
- backend route: `api/modules/order/routes.js`
- backend service: `api/services/orderService.js`

## Clinic Contract

### Target UI/module

- page: `/maintenance`
- existing screen catalog anchor: `CLINIC-SCR-01`

### Recommended journey id

- `clinic_ticket_maintenance_flow`

### Minimum steps

1. `step_access_maintenance_module`
   - `actionType: navigate`
   - `mutationExpected: false`
   - proof: browser navigation into `/maintenance`

2. `step_change_ticket_maintenance_status`
   - `actionType: change_status`
   - `mutationExpected: true`
   - expected mutations:
     - `ticket_status_changed`
   - expected side effects:
     - `audit_log_created`
   - minimum network proof:
     - `PATCH /tickets/:id/status`
     - or `POST /tickets/:id/close`
   - minimum backend delta:
     - selected maintenance ticket changes persisted status

3. `step_assert_maintenance_backend`
   - `actionType: assert_backend_state`
   - `mutationExpected: false`
   - assert persisted ticket status and audit trace

### Existing code anchors

- frontend page: `frontend/src/pages/TicketMaintenancePage.jsx`
- frontend API already used in support stack: `frontend/src/api/tickets.js`
- backend support routes already support status mutation

### Note

This vertical currently maps to a maintenance workflow, not a healthcare-specific domain object. The contract should stay honest to that runtime reality until a distinct clinic operational module exists.

## Market Contract

### Target UI/module

- page: `/node-marketplace`
- existing screen catalog anchor: `MARKET-SCR-01`

### Recommended journey id

- `market_node_publish_flow`

### Minimum steps

1. `step_access_node_marketplace`
   - `actionType: navigate`
   - `mutationExpected: false`
   - proof: browser navigation into `/node-marketplace`

2. `step_publish_marketplace_node`
   - `actionType: publish_node`
   - `mutationExpected: true`
   - expected mutations:
     - `marketplace_node_published`
   - expected side effects:
     - `audit_log_created`
   - minimum network proof:
     - `POST /api/node-marketplace/publish`
   - minimum backend delta:
     - published catalog list includes the new node or new publish state

3. `step_assert_marketplace_backend`
   - `actionType: assert_backend_state`
   - `mutationExpected: false`
   - assert publish persistence and catalog visibility

### Existing code anchors

- frontend page: `frontend/src/pages/NodeMarketplacePage.jsx`
- backend admin route: `api/modules/platform-admin/handleConfigAdminRoutes.js`

## Registry And Contract Changes Required Before Implementation

Any implementation runner for these verticals should start with these code changes before browser scripting:

1. Add the new journey ids and step specs to `qa/contracts/operationalStepRegistry.js`.
2. Add action type evidence contracts to `qa/evidence/stepEvidenceContracts.js` for:
   - `update_order_status`
   - `publish_node`
3. Reuse existing contracts where possible:
   - `navigate`
   - `change_status`
   - `assert_backend_state`
4. Extend `api/services/qa/operationalReplayValidator.js` so operational module detection includes:
   - `/orders`
   - `/maintenance`
   - `/node-marketplace`
   - matching backend APIs for each vertical

## Smallest Viable Implementation Order

To reduce scope, implement in this order:

1. `food_order_status_flow`
   - already has clear frontend API and backend mutation route
2. `market_node_publish_flow`
   - single publish mutation is a good fit for the booking-style pattern
3. `clinic_ticket_maintenance_flow`
   - reuse support ticket mutation semantics, but execute from `/maintenance`

## Non-Goals

This minimum contract explicitly does not require:

- multi-actor choreography
- full omnichannel entrypoints
- WhatsApp handoff coverage
- multiple mutational steps per vertical
- artificial “journey inflation” just to increase step count

The goal is one honest operational replay per missing vertical, not a synthetic enterprise demo.