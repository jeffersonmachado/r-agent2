# Verticals: Beauty & Fitness — Technical Reference

> **Status: production-controlled — v1**  
> Core service logic is proven by automated tests (49 vertical unit+integration  
> tests, 0 failures). Scheduler hardening, job timeouts, and reconciliation are  
> implemented. **Notification channels (WhatsApp, SMS, email) are stubs and will  
> NOT deliver messages until provider credentials are configured.**  
> Last updated: 2026-03

---

## Table of Contents

1. [Architecture overview](#1-architecture-overview)
2. [Beauty vertical](#2-beauty-vertical)
   - 2.1 Journey flows
   - 2.2 Loyalty points
   - 2.3 API endpoints
3. [Fitness vertical](#3-fitness-vertical)
   - 3.1 Membership billing state machine
   - 3.2 Attendance lifecycle
   - 3.3 API endpoints
4. [Scheduler automation](#4-scheduler-automation)
5. [Notification adapter](#5-notification-adapter)
6. [Engagement engine](#6-engagement-engine)
7. [Environment variables](#7-environment-variables)
8. [Testing](#8-testing)
9. [Known limitations](#9-known-limitations)

---

## 1. Architecture overview

```
  ┌──────────────────────────────────────────────────────┐
  │  verticalSchedulerService  (periodic tenant discover)│
  │  → enqueues vertical_beauty_journey_tick             │
  │  → enqueues vertical_fitness_journey_tick            │
  │  → enqueues vertical_beauty_reactivation_scan (1/h)  │
  └────────────────────────┬─────────────────────────────┘
                           │ executionQueueService
                           ▼
  ┌──────────────────────────────────────────────────────┐
  │  verticalJourneyJobHandler                           │
  │  handleBeautyJourneyTick  (reminder 24h / 1h)        │
  │  handleBeautyNoShowScan   (detect no-show)           │
  │  handleBeautyReactivationScan                        │
  │  handleFitnessJourneyTick (stale checkout + scans)   │
  │  handleFitnessInactivityScan                         │
  │  handleFitnessGraceExpiryScan                        │
  └──────┬──────────┬──────────────────────────────┬─────┘
         │          │                              │
         ▼          ▼                              ▼
  beautyJourney  fitnessMembership  notificationAdapter
  Service        Service            (WhatsApp/SMS/email/internal)
```

All vertical state is persisted in **EventLedger** (immutable events) and  
**VerticalJourneyEvent** (journey audit trail). No in-memory state.

---

## 2. Beauty vertical

### 2.1 Journey flows

| Event type | Trigger | Service function |
|---|---|---|
| `appointment_confirmation_sent` | explicit API call | `sendConfirmation` |
| `reminder_24h_sent` | scheduler, T-24h | `sendReminder` |
| `reminder_1h_sent` | scheduler, T-1h | `sendReminder` |
| `no_show_detected` | scheduler scan (T+2h window) | `detectNoShow` |
| `service_completed` | explicit API call | `completeService` |
| `post_service_followup_sent` | scheduler after completion | `sendPostServiceFollowUp` |
| `loyalty_points_granted` | after `service_completed` | auto-emitted |
| `loyalty_points_reversed` | explicit API call | `reverseLoyaltyPoints` |
| `reactivation_sent` | scheduler (60-day inactivity) | `sendReactivation` |

**Reminder dedup logic:** The scheduler uses minute/hour based idempotency keys so  
duplicate reminders are never queued even if the interval fires multiple times.  
A `reminder_24h_sent` is dispatched only when `scheduled_at` is within `(1h, 26h]`  
ahead. A `reminder_1h_sent` only when `scheduled_at` ≤ 90 minutes away.

### 2.2 Loyalty points

Every `service_completed` event automatically grants 1 point (`loyalty_points_granted`).  
Points can be reversed (erros, cheque bounce, etc.) via `reverseLoyaltyPoints`.  
The current balance is computed by aggregating EventLedger — there is no mutable points  
table, giving a full audit trail for free.

```
GET /api/beauty/loyalty/:subjectId?tenantId=...
→ { points: 5, granted: 6, reversed: 1, lastUpdatedAt: "2025-12-01T..." }
```

### 2.3 API endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/beauty/confirmation` | Send appointment confirmation |
| `POST` | `/api/beauty/reminder` | Manual trigger reminder |
| `POST` | `/api/beauty/no-show` | Detect no-show for a schedule |
| `POST` | `/api/beauty/service-completed` | Mark service as completed (auto-grants loyalty point) |
| `POST` | `/api/beauty/follow-up` | Register/emit operational post-service follow-up |
| `POST` | `/api/beauty/loyalty/reverse` | Reverse loyalty points |
| `POST` | `/api/beauty/reactivation` | Send reactivation message |
| `GET` | `/api/beauty/loyalty/:subjectId` | Get loyalty balance |
| `GET` | `/api/beauty/events/:subjectId` | List journey events for subject |
| `GET` | `/api/beauty/timeline/:subjectId` | Full chronological timeline |
| `GET` | `/api/beauty/agenda` | Operational agenda (day/professional/status) |
| `GET` | `/api/beauty/customers/search` | Search customers for operations |
| `GET` | `/api/beauty/customer/:subjectId/detail` | Aggregated customer operational detail |

All endpoints require `tenantId` (header `X-Tenant-ID` or query param).

---

## 3. Fitness vertical

### 3.1 Membership billing state machine

```
  active ──────────────→ delinquent ──→ (grace_until set) ──→ blocked
    ↑                        │                                    │
    └────────────────────────┴──── reactivate ───────────────────┘
```

Valid transitions enforced in `updateBillingStatus`:

| From | To | Notes |
|---|---|---|
| `active` | `delinquent` | missed payment detected |
| `delinquent` | `grace_period` | `startGracePeriod` sets `grace_until` |
| `delinquent` / `grace_period` | `blocked` | `endGracePeriodWithBlock` or manual |
| `blocked` | `active` | `reactivateMembership` after payment |
| `active` | `cancelled` | membership terminated |

The `handleFitnessGraceExpiryScan` job automatically calls `endGracePeriodWithBlock`  
for any membership where `billing_status = delinquent` AND `grace_until < now`.

Every transition emits a `MembershipBillingStatusChanged` event to EventLedger and  
a `billing_status_changed` VerticalJourneyEvent — giving full audit history.

### 3.2 Attendance lifecycle

```
  recordCheckIn ──→ open attendance created
        │         (duplicate check: returns existing if already open)
        ▼
  recordCheckOut ──→ status = completed, duration_minutes computed
        │
        └──→ markAbsent (no-show) or
             closeStaleOpenAttendances (auto-close >8h open)
```

**Duplicate check-in prevention:** `recordCheckIn` queries for an existing `open`  
attendance for the same `(tenant_key, subject_id, membership_id)` before creating.  
If one exists it is returned unchanged (idempotent).

**Auto-close stale attendances:** `closeStaleOpenAttendances({ tenantId, maxOpenHours })`  
is called on every `vertical_fitness_journey_tick`. Any attendance open longer than  
`maxOpenHours` (default 8) is marked `absent` with `metadata.auto_closed = true`.

### 3.3 API endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/fitness/attendance/check-in` | Record check-in (idempotent) |
| `POST` | `/api/fitness/attendance/check-out` | Close open attendance |
| `POST` | `/api/fitness/no-show` | Mark session as absent |
| `GET` | `/api/fitness/attendance/history` | Attendance list with frequency |
| `GET` | `/api/fitness/attendance/open` | List currently open attendances |
| `POST` | `/api/fitness/membership/grace` | Start grace period |
| `POST` | `/api/fitness/membership/block` | Block membership |
| `POST` | `/api/fitness/membership/reactivate` | Reactivate blocked membership |
| `GET` | `/api/fitness/membership/:membershipId` | Get membership detail |
| `GET` | `/api/fitness/membership/:membershipId/billing-history` | Billing status change log |
| `GET` | `/api/fitness/memberships` | List memberships for tenant |
| `POST` | `/api/fitness/membership/renewal` | Process renewal |
| `GET` | `/api/fitness/access-status` | Check access eligibility |
| `GET` | `/api/fitness/metrics` | Vertical KPIs |
| `GET` | `/api/fitness/recommendations` | Heuristic recommendations |
| `GET` | `/api/fitness/students/search` | Search students for operational check-in |
| `GET` | `/api/fitness/student/:subjectId/detail` | Aggregated student operational detail |

---

## 4. Scheduler automation

`verticalSchedulerService.js` runs inside the server process controlled by  
`ENABLE_VERTICAL_SCHEDULER` (default: on).

**Tenant discovery**: Queries `AccessMembership` and `VerticalJourneyEvent` for distinct  
`tenant_key` values. Tenants with no data are silently skipped.

**Job frequency:**

| Job kind | Enqueued every | Idempotency window |
|---|---|---|
| `vertical_beauty_journey_tick` | `VERTICAL_SCHEDULER_INTERVAL_MS` (60s) | 1 minute |
| `vertical_fitness_journey_tick` | `VERTICAL_SCHEDULER_INTERVAL_MS` (60s) | 1 minute |
| `vertical_beauty_reactivation_scan` | once per hour | 1 hour |
| `vertical_reconciliation` | once per 6 hours | 6 hours |

The idempotency key for each job includes the tenant, kind, and truncated timestamp  
(minute or hour), so restarting the server mid-interval never produces duplicates.

**Job handlers** (all in `verticalJourneyJobHandler.js`):

- `handleBeautyJourneyTick` — scans `confirmation_sent` events, dispatches reminders
- `handleBeautyNoShowScan` — detects confirmations with no completion after 2h
- `handleBeautyReactivationScan` — targets subjects inactive ≥ 60 days
- `handleFitnessJourneyTick` — calls close-stale + inactivity + grace-expiry scans
- `handleFitnessInactivityScan` — calls `computeEngagementSignal` per active membership
- `handleFitnessGraceExpiryScan` — blocks expired grace memberships
- `handleVerticalReconciliation` — closes stale attendances (>24h) and runs grace-expiry scan; enqueued once per 6 hours per tenant

---

## 5. Notification adapter

`api/services/notifications/notificationAdapter.js` provides a unified interface:

```js
await notificationAdapter.sendJourneyNotification({
  tenantId,
  channel,       // 'whatsapp' | 'sms' | 'email' | 'internal'
  subjectId,
  customerId,
  eventType,     // e.g. 'reminder_24h_sent'
  payload,
});
```

All channels are **stubs** (log-only) by default.  
Activate real channels via environment variables:

- `NOTIFICATION_WHATSAPP_ENABLED=true` — delegates to `whatsappService.sendWhatsappMessage`
- `NOTIFICATION_SMS_ENABLED=true` — plug your SMS provider
- `NOTIFICATION_EMAIL_ENABLED=true` — plug your email provider

`broadcastJourneyNotification` sends to multiple channels in parallel.

### 5.1 Delivery logs for Operations Dashboard

To support the operational pilot view without creating a parallel datastore,
`sendJourneyNotification` now records a best-effort delivery event in
`event_ledger` for each notification attempt.

Data contract used by dashboard queries:

- `type = VerticalJourney_Custom`
- `source = vertical.notification.<channel>.<eventType>`
- `payload.kind = notification_delivery`
- `payload.status = sent | failed | skipped | provider-dependent`
- `payload.isStub = true | false`

This allows `/api/operations-dashboard/notifications` to read canonical delivery
evidence from `EventLedger` and avoid counting stubs as real deliveries.

Historical data that predates this instrumentation may still be surfaced via
the documented `VerticalJourneyEvent` proxy fallback.

---

## 6. Engagement engine

`engagementEngine.js` — stateless, heuristic-based:

| Signal type | Fitness condition | Beauty condition |
|---|---|---|
| `churn_risk` | score ≥ 0.6 | score ≥ 0.6 |
| `low_frequency` | visits/30d < 2 (fitness) | — |
| `inactive` | days_since_last_visit ≥ 45 | days ≥ 90 |
| `no_show_risk` | — | no-show rate > 60% |
| `healthy` | otherwise | otherwise |

Fitness score components:
- Recency: +0.5 (≥30 days), +0.3 (≥inactive_threshold), +0.1 (≥7 days)
- Frequency: +0.3 (0 visits), +0.15 (< 2 visits)
- Billing: +0.2 (delinquent/blocked), +0.1 (grace_period)

Each call persists a `VerticalEngagementSignal` row for trend analysis.

---

## 7. Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `ENABLE_VERTICAL_SCHEDULER` | `true` | Enable/disable the vertical scheduler |
| `VERTICAL_SCHEDULER_INTERVAL_MS` | `60000` | Tick interval in milliseconds |
| `VERTICAL_JOB_TIMEOUT_MS` | `30000` | Max wall-clock ms per job before `job_timeout` error |
| `NOTIFICATION_WHATSAPP_ENABLED` | `false` | Activate WhatsApp channel |
| `NOTIFICATION_SMS_ENABLED` | `false` | Activate SMS channel |
| `NOTIFICATION_EMAIL_ENABLED` | `false` | Activate email channel |

---

## 8. Testing

### Installation and packaging
- Default delivered source packages must be installed before running tests: `npm install`
- The default ZIP flow excludes `node_modules` on purpose. Do not rely on a prepacked dependency tree for Jest validation.
- If a package must include dependencies, use `npm run zip:all`. It preserves dependency runtime files under package-internal `build/` directories.
- A package produced with `--include-node-modules` but without the safe build handling can break Jest resolution because packages such as `jest-cli` publish their runtime entry point under `build/`.

### Unit tests (vertical scope executed)
- `npm run test:vertical:unit`
- Result (Mar/2026): **5 suites, 49 tests, 0 failures**

### Integration E2E tests (vertical scope executed)
- `npm run test:vertical:integration`
- `tests/integration/verticalBeautyEndToEnd.test.js` — **10** cenarios
- `tests/integration/verticalFitnessEndToEnd.test.js` — **14** cenarios
- Result (Mar/2026): **2 suites, 24 tests, 0 failures**

### One-command validation proof
- `npm run test:vertical:proof`
- Result (Mar/2026): unit + integration + standalone script executed in sequence with **exit code 0**

Both use Jest mocks for the DB layer and execute real service logic.

### Canonical Jest execution (repository)
```bash
npm install
npm run test:jest
```

`npm test` in this repository also runs `test:rpa` (Playwright runtime flows), so
it is **not** a pure Jest signal and may fail for external/runtime reasons
unrelated to vertical domain logic.

Equivalent direct command (same result): `npm exec -- jest --no-coverage`.

### Standalone E2E validation (no DB required)
```bash
node scripts/vertical-e2e-validate.js
# Runs Jest integration suites + in-process checks for notification adapter
# and job timeout logic.
# Exits 0 when all required checks pass, 1 on any failure.
# Provider-dependent checks are reported separately when providers are disabled
# or when real-provider validation was not requested.
# Use --check-providers to execute provider-dependent checks when channels are enabled.
```

Result (Mar/2026): **20 passed, 0 failed, 0 skipped, 3 provider-dependent**.

---

## 9. Known limitations

1. **Notification channels are stubs.** WhatsApp, SMS, and email require provider  
   credentials and service integration before enabling in production.
2. **WhatsApp/SMS/Email provider not wired.** Even with `NOTIFICATION_*_ENABLED=true`,  
   a real provider adapter must replace the stub body before messages are delivered.
3. **Tenant discovery polls DB every tick.** For high-tenant-count setups (> 1000),  
   consider caching the tenant list with a short TTL.
4. **Scheduler runs in-process.** For horizontal scaling, use a distributed lock  
   (e.g., Redis `SET NX`) around `tick()` to prevent duplicate job enqueue from  
   multiple replicas.
5. **Loyalty points are heuristic (1 pt per service).** A configurable points-per-service  
   table is not yet implemented.
6. **`closeStaleOpenAttendances` marks as `absent`.** For memberships with session  
   bundles, this may incorrectly consume a session. Review before enabling in  
   session-bundle tenants.
