# Replay Governance

Replay artifacts are provenance records for operational journeys. They must be traceable, tamper-aware and linked to QA/release decisions.

## Required controls

- `replayHash`
- checksum
- signature
- provenance
- linkage to scenario/journey/release
- tamper detection
- semantic validation where available
- package contamination checks

## Canonical sources

- `docs/governance/REPLAY_OPERATIONAL_STATUS.md`
- `docs/COMO_USAR_REPLAY.md`
- `docs/rpa-reliability-handbook/12-api-and-replay-contract.md`
- `core/rpa/replaySystem.js`
- `lib/replaySystem.js`
- `governance/replay-integrity.js`
- `governance/replay-consistency-engine.js`
- `governance/replay-hardening-engine.js`
- `governance/tamper-detector.js`
- `governance/replay-integrity-report.json`
- `governance/tamper-detection-report.json`

## Current state

Observed on 2026-08-14: **NO_GO**. Existing promoted prod-like artifacts use the legacy public `gov-sha256` format and do not satisfy the current keyed signature contract. The validators accept only fresh `hmac-sha256` signatures bound to the exact enterprise report/subjects and fail closed when the signing key, proof binding or current seal is absent.

RPA/replay runtime controls now require authenticated tenant scope for list/get/delete/cancel/download, tenant-specific runtime/artifact keys and WebSocket delivery only to authenticated clients of the same tenant. Replays and manifests are redacted before persistence, signed with `REPLAY_SIGNING_KEY`/`ENCRYPTION_KEY` (minimum 32 bytes) and rejected on tamper. The tenant supplied by the trusted boundary overrides any tenant embedded in an artifact before signing.

Do not infer current validity from `docs/governance/REPLAY_OPERATIONAL_STATUS.md`; use `npm run validate:replay-governance` and `governance/replay-integrity-report.json`.

## Replay é exclusivo de interações via UI (2026-08-25)

- Princípio: **replay** = reprodução de interação via UI (RPA de navegador). Operações de backend não geram replay por padrão.
- Serviços backend agora têm replay **opt-in** (default OFF), mantendo o `RecordingSystem` (log operacional):
  - `messageProcessor` → `ENABLE_MESSAGE_REPLAY`
  - `ragService` → `ENABLE_RAG_REPLAY`
  - `webScrapingService` → `ENABLE_SCRAPING_REPLAY`
  - `generationOrchestrator` → `ENABLE_GENERATION_REPLAY`
  - `qaService` → `ENABLE_QA_REPLAY`
  - `pipelineOrchestrator` → `ENABLE_PIPELINE_REPLAY`
  - `rpaFlowPipelineService` → `ENABLE_RPA_PIPELINE_REPLAY`
- `ReplaySystem` (`lib/replaySystem.js`) ganhou a opção `enabled` (default `true`): com `enabled: false`, `start()` não grava e `save()` retorna `null`; os métodos `record*` já no-op via `isRecording`.
- Replays de UI (`context: 'rpa'`) permanecem sempre ativos. QA Mesh (`qa-mesh/meshEvidence/*/replays/`) e agent-os são evidência de governança, não replay de UI.

## Fix: screenshots não podem ser truncados pela redação (2026-08-25)

- `redactText` (`lib/rpaSecurity.js`) aplicava `.slice(0, 4000)` em **toda** string, inclusive base64 de screenshot — o PNG era cortado no meio e a imagem aparecia em branco no player.
- `redactDeep` agora isenta campos de imagem (chave com `screenshot` e valores `data:image/...`) do truncamento; a redação de segredos (senhas, Bearer, tokens de URL) permanece.
- Regressão: `tests/unit/rpaTenantIsolation.test.js`.
