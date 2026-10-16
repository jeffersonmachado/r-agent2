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

## Timeout Architecture (SLOW != STUCK != DEAD)

- Lento não é travado; travado não é morto. **Tempo decorrido nunca é autoridade** para declarar morte de missão, perda de trabalho ou invasão de ownership.
- Nenhum número de timeout solto: a fonte única é `config/timeout-policy.json` (`resolveTimeoutPolicy`, clamp em `[min,max]` com clamp reportado).
- Liveness = **heartbeat + lease + fencing** (`qa-mesh/meshLease.js`): heartbeat fresco ⇒ `ACTIVE` mesmo com PID morto; heartbeat obsoleto ⇒ `EXPIRED` mesmo com PID vivo. **PID é apenas corroborativo**.
- Takeover **incrementa o fence**; dois donos nunca escrevem. `lockMission` exige `lockFreeOrMine` E `leaseFreeOrMine` — takeover por idade é proibido.
- Avanço = **progresso significativo** (`engine/engineeringMission/progressPolicy.js`); `heartbeat`/`poll`/`keepalive` **não** contam. Sem milestone registrado o veredito é `UNKNOWN`, nunca "travado".
- Ausência de progresso dispara **diagnóstico** (`DIAGNOSE`), nunca kill/takeover.
- Expiração é da **operação** (cancelar/retry/fallback/replan), não da missão. `buildExpiryRecord` só marca `killsMission` para `USER_DEADLINE_EXCEEDED`/`MISSION_BUDGET_EXCEEDED`; `killsWorker` é sempre `false`.
- Proibido no caminho crítico: `MISSION_WALL_CLOCK`, `STALE_BY_AGE_ONLY`, `PID_AS_LIVENESS_AUTHORITY`. `TIMEOUT != PASS`.
- Validar antes de concluir: `npm run validate:timeout-architecture` (bloqueante, no agregado `validate:governance-enforcement`) e `npm run verify:timeout-architecture-e2e` (runtime real).

Canonical source: `docs/architecture/timeout-architecture.md`, `config/timeout-policy.json`, `engine/shared/executionDeadline.js`, `engine/engineeringMission/progressPolicy.js`, `qa-mesh/meshLease.js`.

## Stack Versions

- `AI_MEMORY/stack-versions.md` is the canonical declared-stack reference (Node, npm, package version, RAG pins, embedding model, compose images). The "Versões da Stack" page (`/dev/stack-versions`) mirrors it plus live runtime versions from `/version` and `/system/status`.
- Whenever the stack changes (Node/npm, package version, RAG pins or embedding model, `docker-compose.prod.yml` images), run `npm run stack:versions:sync` and commit `AI_MEMORY/stack-versions.md` (the report in `reports/` is a git-ignored byproduct).
- Validate before concluding: `npm run validate:stack-versions`.
- The sync script only updates the managed block (`<!-- STACK_VERSIONS_AUTO_START -->` … `<!-- STACK_VERSIONS_AUTO_END -->`); never hand-edit that block.

Canonical source: `scripts/stack-versions.js`.

## Audit Entry Point (external audit via git)

- The single versioned entry point for external audit is `AI_MEMORY/evidence/AUDIT_ENTRYPOINT.json`
  (human-readable: `AUDIT_ENTRYPOINT.md`). It carries `auditEpoch` (sha256 of its payload) plus the
  SHA-256 of every canonical proof on disk.
- Why it exists: `reports/*.json` and `governance/*.json` are git-ignored, so an auditor reading only
  git cannot see the proof; the root closure pointers are stale and maintained by no gate.
- **After any governance-relevant change** (new governed run, new seal, gate result change, queue
  change), regenerate it: `node tools/audit/generate-audit-entrypoint.js` — never hand-edit the
  artifact, every field is derived from live sources.
- The generator lives in `tools/audit/`, deliberately outside `SOURCE_ROOTS`, so regenerating and
  committing it does **not** change the `sourceFingerprint` and does not invalidate a sealed release.


