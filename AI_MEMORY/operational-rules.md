# Operational Rules

- Docker is the official production/deploy runtime model.
- Never introduce PM2 as a process manager.
- Keep `dist/` clean except approved release ZIPs/manifests.
- Do not package `.env`, `.token.env`, tokens, dumps, backups, `node_modules`, WhatsApp auth caches or transient runtime evidence.
- Runtime/evidence paths should use external runtime roots where possible; see `docs/runtime-paths.md`.
- Screenshots/traces are evidence, not source assets. Store them under governed evidence directories and prune them.
- Do not commit generated secrets or local credentials.
- Do not silently fallback from real runtime to synthetic when a gate requires real runtime.

## QA Mesh Environment Hygiene

- Mesh history auto-prunes on every execution: keeps `QA_MESH_MAX_HISTORY` files (default 5) PER CLASS — canonical executions (`isCanonicalExecution: true`) and non-canonical runs have separate quotas, and non-canonical scheduler runs never prune canonical ones (they are coverage evidence for the gate).
- Mesh evidence auto-prunes on every execution: keeps only `QA_MESH_MAX_EVIDENCE` directories (default 5).
- Flaky detection window is `QA_MESH_FLKY_WINDOW` runs (default 5, was 15).
- Stale lock files (`canonical.lock.json`, `mesh-running.lock`) are auto-cleaned if older than `QA_MESH_STALE_LOCK_MINUTES` (default 30).
- `npm run validate:cleanup` checks history count, evidence count, disk usage and stale locks.
- `validate:governance-enforcement` includes `validate:cleanup` in the aggregate gate.
- If history/evidence is polluted with old infra failures, run the mesh once — auto-pruning will clean it on the next execution.
- All limits are configurable via env vars; see `qa-mesh/meshRunner.js` constants.

Canonical sources: `docs/release-contract.md`, `docs/runtime-governance.md`, `docs/runtime-paths.md`, `scripts/check-dist-clean.sh`, `scripts/release-payload-blocklist.sh`, `scripts/governance/validate-cleanup.js`.

