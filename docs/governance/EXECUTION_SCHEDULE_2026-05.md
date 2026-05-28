# Execution Schedule - Recovery Plan (May/2026)

## Objective
Close current NO_GO blockers and restore release promotion eligibility with evidence.

## Scope
- Recover canonical qa-mesh regression (BASELINE_PASS_RATE_REGRESSION)
- Reestablish release-gate GO
- Stabilize visual replay evidence for critical journeys

## Workplan (7 business days)

### Day 1 - Triage and owner assignment
- Confirm 4 failing scenarios from canonical mesh execution mesh-2026-05-12T23-50-45-984Z.
- Assign accountable owners by domain (pbx, qa-mesh, replay/browser).
- Freeze promotion actions until canonical mesh returns GO.

### Day 2 - P0 fix wave (mesh)
- Fix root causes for the 4 failing scenarios.
- Run focused regression on failing scenarios only.
- Capture corrected evidence in qa-mesh artifacts.

### Day 3 - Canonical recovery
- Run full qa-mesh execution (62 scenarios).
- Promote execution only if result is GO and pass rate returns to baseline target.
- Publish updated go-no-go and metrics reports.

### Day 4 - P0 fix wave (release gate)
- Execute official gate end-to-end with external RUNTIME_ROOT.
- Validate final-governance decision and cross-report consistency.
- Block release if any CRITICAL check remains false.

### Day 5 - P1 fix wave (visual journeys)
- Normalize browser auth + tenant selection in critical smokes.
- Ensure before/after snapshots are available for critical steps.
- Re-run replay-hardening checks and compare violations delta.

### Day 6 - Governance update
- Update PLATFORM_STATUS.md and KNOWN_GAPS.md with new state.
- Regenerate final-readiness and final-governance reports.
- Prepare decision memo for GO/NO_GO review.

### Day 7 - Decision day
- Review KPIs and risk log.
- Approve release only if all P0 criteria are green.
- Publish final rollout decision and archived evidence package.

## Exit Criteria
- Canonical qa-mesh: GO
- release-gate: GO
- final-governance critical checks: all pass
- visual_journeys: no unresolved high-severity violations for critical journeys

## KPI and Monitoring Pack
- KPI 1: qa-mesh pass rate (target: 100% of declared canonical scenarios)
- KPI 2: release gate decision (target: GO)
- KPI 3: critical governance checks pass ratio (target: 100%)
- KPI 4: visual replay availability in critical journeys (target: 100% steps with ui.available=true)
- KPI 5: blocker aging (target: P0 <= 48h, P1 <= 5 business days)

## Reporting Cadence
- Daily 09:00: status checkpoint (owners + blockers + ETA)
- Daily 17:00: KPI snapshot and risk update
- End of cycle: final GO/NO_GO record with linked artifacts
