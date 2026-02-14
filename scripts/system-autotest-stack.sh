#!/usr/bin/env bash
set -euo pipefail

#
# Runner unificado (stack) para validar o sistema inteiro.
#
# Faz:
# - sobe docker-compose.test.yml
# - espera readiness (API/Frontend/RAG)
# - executa:
#   - npm run system:validate
#   - frontend tests (vitest)
#   - rag-service tests (pytest) via container
# - derruba stack (mesmo em falha)
#

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

mkdir -p qa/smoke
L01_STATUS="not_run"
L02_STATUS="not_run"
L03_STATUS="not_run"
L04_STATUS="not_run"
L05_STATUS="not_run"
L01_LOG_PATH="qa/smoke/l01-physical-queue.log"
L02_LOG_PATH="qa/smoke/l02-ura-publish-rollback.log"
L03_LOG_PATH="qa/smoke/l03-pbx-voice-tts-asr.log"
L04_LOG_PATH="qa/smoke/l04-pbx-call-events-runtime.log"
L05_LOG_PATH="qa/smoke/l05-chatpro-omnichannel.log"
L01_EVIDENCE_PATH="qa/l01-physical-queue-evidence.json"
L02_EVIDENCE_PATH="qa/l02-ura-publish-rollback-evidence.json"
L03_EVIDENCE_PATH="qa/l03-pbx-voice-tts-asr-evidence.json"
L04_EVIDENCE_PATH="qa/l04-pbx-call-events-runtime-evidence.json"
L05_EVIDENCE_PATH="qa/l05-chatpro-omnichannel-evidence.json"
SMOKE_EVIDENCE_SUMMARY_PATH="${SMOKE_EVIDENCE_SUMMARY_PATH:-qa/smoke-evidence.json}"

run_with_log() {
  local status_var="$1"
  local log_path="$2"
  shift 2
  local timeout_sec="${RUN_WITH_LOG_TIMEOUT_SEC:-0}"
  case "$status_var" in
    L01_STATUS) timeout_sec="${L01_TIMEOUT_SEC:-$timeout_sec}" ;;
    L02_STATUS) timeout_sec="${L02_TIMEOUT_SEC:-$timeout_sec}" ;;
    L03_STATUS) timeout_sec="${L03_TIMEOUT_SEC:-$timeout_sec}" ;;
    L04_STATUS) timeout_sec="${L04_TIMEOUT_SEC:-$timeout_sec}" ;;
    L05_STATUS) timeout_sec="${L05_TIMEOUT_SEC:-$timeout_sec}" ;;
  esac
  set +e
  if command -v timeout >/dev/null 2>&1 && [[ "$timeout_sec" =~ ^[0-9]+$ ]] && [[ "$timeout_sec" -gt 0 ]]; then
    timeout --signal=TERM --kill-after=30s "${timeout_sec}s" "$@" 2>&1 | tee "$log_path"
  else
    "$@" 2>&1 | tee "$log_path"
  fi
  local cmd_rc=${PIPESTATUS[0]}
  set -e
  if [[ "$cmd_rc" -eq 0 ]]; then
    printf -v "$status_var" '%s' "pass"
    return 0
  fi
  printf -v "$status_var" '%s' "fail"
  return "$cmd_rc"
}

write_smoke_evidence_summary() {
  SMOKE_EVIDENCE_SUMMARY_PATH="$SMOKE_EVIDENCE_SUMMARY_PATH" \
  L01_STATUS="$L01_STATUS" \
  L02_STATUS="$L02_STATUS" \
  L03_STATUS="$L03_STATUS" \
  L04_STATUS="$L04_STATUS" \
  L05_STATUS="$L05_STATUS" \
  L01_LOG_PATH="$L01_LOG_PATH" \
  L02_LOG_PATH="$L02_LOG_PATH" \
  L03_LOG_PATH="$L03_LOG_PATH" \
  L04_LOG_PATH="$L04_LOG_PATH" \
  L05_LOG_PATH="$L05_LOG_PATH" \
  L01_EVIDENCE_PATH="$L01_EVIDENCE_PATH" \
  L02_EVIDENCE_PATH="$L02_EVIDENCE_PATH" \
  L03_EVIDENCE_PATH="$L03_EVIDENCE_PATH" \
  L04_EVIDENCE_PATH="$L04_EVIDENCE_PATH" \
  L05_EVIDENCE_PATH="$L05_EVIDENCE_PATH" \
  node -e "const fs=require('fs');const p=process.env;const out=String(p.SMOKE_EVIDENCE_SUMMARY_PATH||'qa/smoke-evidence.json');const read=(f)=>{try{return JSON.parse(fs.readFileSync(f,'utf8'));}catch(_){return null;}};const summary={generatedAt:new Date().toISOString(),smokes:{l01:{status:p.L01_STATUS||'unknown',logPath:p.L01_LOG_PATH||null,evidencePath:p.L01_EVIDENCE_PATH||null,evidence:read(p.L01_EVIDENCE_PATH||'')},l02:{status:p.L02_STATUS||'unknown',logPath:p.L02_LOG_PATH||null,evidencePath:p.L02_EVIDENCE_PATH||null,evidence:read(p.L02_EVIDENCE_PATH||'')},l03:{status:p.L03_STATUS||'unknown',logPath:p.L03_LOG_PATH||null,evidencePath:p.L03_EVIDENCE_PATH||null,evidence:read(p.L03_EVIDENCE_PATH||'')},l04:{status:p.L04_STATUS||'unknown',logPath:p.L04_LOG_PATH||null,evidencePath:p.L04_EVIDENCE_PATH||null,evidence:read(p.L04_EVIDENCE_PATH||'')},l05:{status:p.L05_STATUS||'unknown',logPath:p.L05_LOG_PATH||null,evidencePath:p.L05_EVIDENCE_PATH||null,evidence:read(p.L05_EVIDENCE_PATH||'')}}};fs.mkdirSync(require('path').dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(summary,null,2)+'\n','utf8');console.log('[autotest-stack] Smoke evidence summary:', out);"
}

echo "[autotest-stack] Preparando token RPA..."
export RPA_TOKEN="$(node -e "const { getOrCreateRpaToken } = require('./tests/rpa/utils/rpaTokenManager'); process.stdout.write(getOrCreateRpaToken());")"

cleanup() {
  write_smoke_evidence_summary || true
  echo
  echo "[autotest-stack] Limpando stack..."
  bash ./scripts/test-stack-down.sh || true
}
trap cleanup EXIT

echo "[autotest-stack] Subindo stack..."
bash ./scripts/test-stack-up.sh

echo "[autotest-stack] Aguardando readiness..."
API_TEST_PORT="${API_TEST_PORT:-13001}"
FRONTEND_TEST_PORT="${FRONTEND_TEST_PORT:-15173}"
RAG_TEST_PORT="${RAG_TEST_PORT:-18001}"
API_BASE_URL="http://localhost:${API_TEST_PORT}"
FRONTEND_BASE_URL="http://localhost:${FRONTEND_TEST_PORT}"
RAG_BASE_URL="http://localhost:${RAG_TEST_PORT}"
API_URL="${API_BASE_URL}" FRONTEND_URL="${FRONTEND_BASE_URL}" RAG_URL="${RAG_BASE_URL}" bash ./scripts/wait-ready.sh

echo
echo "[autotest-stack] Verificando login RPA via API..."
node -e "const token=process.env.RPA_TOKEN||''; const base='${API_BASE_URL}'; fetch(base + '/auth/rpa/login',{method:'POST',headers:{'Content-Type':'application/json'},body: JSON.stringify({token, tenantId:'system'})}).then(async r=>{const t=await r.text().catch(()=>'' ); console.log('[rpa-login]', r.status, t); if(r.status>=400) process.exit(1);}).catch(e=>{ console.error(e); process.exit(1); })"

echo
echo "[autotest-stack] Rodando selftest read-only..."
node -e "const base='${API_BASE_URL}'; fetch(base + '/health/selftest').then(r=>r.json()).then(j=>{ console.log('[selftest]', j.status); if(!j||!j.status) process.exit(2); if(String(j.status).toUpperCase()==='FAIL') process.exit(1); }).catch(e=>{ console.error(e); process.exit(2); })"

echo
echo "[autotest-stack] Exportando URLs padrão para RPA..."
export TEST_BASE_URL="${API_BASE_URL}"
export TEST_API_URL="${API_BASE_URL}"
export TEST_FRONTEND_URL="${FRONTEND_BASE_URL}"
export RPA_IGNORE_API_CONSOLE_ERRORS="true"
export TEST_USERNAME="admin"
export TEST_USER_PASSWORD="admin123"
export TEST_ADMIN_USERNAME="admin"
export TEST_ADMIN_PASSWORD="admin123"
export TEST_TENANT_ID="system"

echo
echo "[autotest-stack] Seeding flows mínimos para RPA..."
node ./scripts/seed-rpa-flows.js

echo
echo "[autotest-stack] Rodando validação oficial (contratos + unit/flow/stress + RPA)..."
npm run system:validate

echo
echo "[autotest-stack] Rodando smoke test PBX (Realtime/ODBC)..."
API_URL="${API_BASE_URL}" bash ./scripts/test-pbx-realtime.sh

echo
echo "[autotest-stack] Rodando smoke test L-02 (URA publish/rollback + auditoria)..."
run_with_log L02_STATUS "$L02_LOG_PATH" env URA_PUBLISH_ROLLBACK_EVIDENCE_PATH="$L02_EVIDENCE_PATH" node ./scripts/test-ura-publish-rollback-smoke.js

echo
echo "[autotest-stack] Rodando smoke test L-03 (PBX TTS+ASR runtime de voz + chamada real)..."
run_with_log L03_STATUS "$L03_LOG_PATH" env PBX_VOICE_TTS_ASR_EVIDENCE_PATH="$L03_EVIDENCE_PATH" node ./scripts/test-pbx-voice-tts-asr-smoke.js

echo
echo "[autotest-stack] Rodando smoke test L-04 (PBX call events -> runtime trigger)..."
run_with_log L04_STATUS "$L04_LOG_PATH" env PBX_CALL_EVENTS_RUNTIME_EVIDENCE_PATH="$L04_EVIDENCE_PATH" node ./scripts/test-pbx-call-events-runtime-smoke.js

echo
echo "[autotest-stack] Rodando smoke test Voice Runtime (ingestão + métricas + selftest)..."
node ./scripts/test-voice-runtime-smoke.js

echo
echo "[autotest-stack] Rodando smoke test Filas Físicas (kiosk/panel/station + métricas)..."
run_with_log L01_STATUS "$L01_LOG_PATH" env PHYSICAL_QUEUE_EVIDENCE_PATH="$L01_EVIDENCE_PATH" node ./scripts/test-physical-queue-smoke.js

echo
echo "[autotest-stack] Rodando smoke test WhatsApp QR (conexão + evento + status)..."
node ./scripts/test-whatsapp-qr-smoke.js

echo
echo "[autotest-stack] Rodando smoke test Inbox/Support/TicketMaintenance (UX-01)..."
run_with_log L05_STATUS "$L05_LOG_PATH" env INBOX_RUNTIME_EVIDENCE_PATH="$L05_EVIDENCE_PATH" node ./scripts/test-inbox-runtime-smoke.js

echo
echo "[autotest-stack] Rodando testes do frontend (Vitest)..."
(
  cd frontend
  if [ -d node_modules ]; then
    npm test -- --run
  else
    npm ci
    npm test -- --run
  fi
)

echo
echo "[autotest-stack] Rodando testes do rag-service (pytest) dentro do container..."
mkdir -p rag-service/test-results
docker compose -f docker-compose.test.yml exec -T rag-service pytest --junitxml=/test-results/junit.xml

echo
echo "[autotest-stack] ✅ Tudo passou."
