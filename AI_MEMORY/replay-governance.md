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

`docs/governance/REPLAY_OPERATIONAL_STATUS.md` says support and fitness prod-like replays are valid and signed, but full WhatsApp -> AI -> handoff -> human -> backend mutation chronology is still a gap.

