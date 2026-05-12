# Final Hardening GO Summary

Generated at: 2026-05-12

## Final status

- Consolidated gate status: GO
- Official go/no-go report: /tmp/r-agent2-enterprise-runtime/qa/go-no-go-report.json
- Consolidated readiness report: governance/final-readiness-report.json
- Enterprise proof report: /tmp/r-agent2-enterprise-runtime/qa/enterprise/enterprise-proof-report.json

## Delta: before vs after

### Before

- `pbx_prod_like` had missing real proof for `dtmf`, `transfer`, and `replayTimeline`
- `omnichannel_unified_replay` was blocked by PBX proof incompleteness
- `go-no-go` stayed in `NO_GO` because runtime-root execution did not see mirrored `validate`, `release-gate`, `smoke`, and `runtime-governance` evidence
- `platform-readiness` reported `gap-vertical-beauty` because the vertical had real mesh scenarios but `journeyCount` stayed at `0`

### After

- `pbx_prod_like` is fully green with real signals for `originate`, `ivr`, `tts`, `asr`, `dtmf`, `transfer`, `hangupCauses`, `cdr`, `recordings`, and `replayTimeline`
- `omnichannel_unified_replay` is fully green, including `pbx`
- `go-no-go` now resolves evidence runtime-root first and falls back to workspace mirrors when the runtime copy is not present yet
- `platform-readiness` now enriches vertical coverage with real QA mesh scenarios and infers valid journeys when the registry already contains the real domain flow
- `beauty` moved from `tested` with `journeyCount: 0` to `production-like` with `journeyCount: 2`
- Consolidated gate moved from `NO_GO` to `GO`

## Evidence used

- L03 PBX evidence: /tmp/r-agent2-enterprise-runtime/qa/l03-pbx-voice-tts-asr-evidence.json
- L04 PBX runtime evidence: /tmp/r-agent2-enterprise-runtime/qa/l04-pbx-call-events-runtime-evidence.json
- L05 omnichannel evidence: /tmp/r-agent2-enterprise-runtime/qa/l05-chatpro-omnichannel-evidence.json
- Enterprise proof: /tmp/r-agent2-enterprise-runtime/qa/enterprise/enterprise-proof-report.json
- Go/no-go: /tmp/r-agent2-enterprise-runtime/qa/go-no-go-report.json
- Readiness: governance/final-readiness-report.json

## Root-cause fixes applied

- PBX enterprise summarization now reads the current L03/L04 evidence shape instead of stale assumptions
- PBX smoke now emits real DTMF and transfer proof through the voice runtime path
- PBX reload automation now reloads `cdr_adaptive_odbc` both on demand and after migrations/seed in the API container
- Tools under `tools/system` now support runtime-root-first, workspace-fallback evidence resolution
- Platform readiness no longer undercounts vertical journeys when the real scenario exists in `qa-mesh/meshRegistry.json` but has not been mirrored yet into `qa/qa-waves/scenario-store.json`
- Heuristic journey inference can now be used silently by readiness code, and the AI provider is lazy-loaded only when AI inference is actually requested

## Validation executed

- `TEST_BASE_URL=http://localhost:13001 AMI_ORIGINATE_ENABLED=true PBX_SELFTEST_EXTENSION=9191 L03_SELFTEST_EXTENSION=9191 RUNTIME_ROOT=/tmp/r-agent2-enterprise-runtime node scripts/test-pbx-voice-tts-asr-smoke.js`
- `RUNTIME_ROOT=/tmp/r-agent2-enterprise-runtime TEST_BASE_URL=http://localhost:3001 TEST_WHATSAPP_PHONE_NUMBER_ID=test_phone_id ENTERPRISE_PROOF_RUN_DEPENDENCIES=0 node scripts/smoke/qa-waves-enterprise-proof-smoke.js`
- `docker compose -f docker-compose.test.yml build api`
- `docker compose -f docker-compose.test.yml up -d api`
- `POST /api/pbx/reload` on `http://localhost:13001` returned `200` with `core=true`, `pjsip=true`, `odbc=true`, `cdr=true`
- `RUNTIME_ROOT=/tmp/r-agent2-enterprise-runtime node tools/system/go-no-go.js`

## Files changed in this closing slice

- tools/system/lib/runtime-paths.js
- tools/system/runtime-governance.js
- tools/system/validate.js
- tools/system/release-gate.js
- tools/system/go-no-go.js
- tools/system/platform-readiness.js
- qa/qa-waves/services/journeyInferenceService.js
