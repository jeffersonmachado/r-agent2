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

cleanup() {
  echo
  echo "[autotest-stack] Limpando stack..."
  bash ./scripts/test-stack-down.sh || true
}
trap cleanup EXIT

echo "[autotest-stack] Subindo stack..."
bash ./scripts/test-stack-up.sh

echo "[autotest-stack] Aguardando readiness..."
API_URL="http://localhost:3001" FRONTEND_URL="http://localhost:5173" RAG_URL="http://localhost:8001" bash ./scripts/wait-ready.sh

echo
echo "[autotest-stack] Rodando selftest read-only..."
node -e "fetch('http://localhost:3001/health/selftest').then(r=>r.json()).then(j=>{ console.log('[selftest]', j.status); if(!j||!j.status) process.exit(2); if(String(j.status).toUpperCase()==='FAIL') process.exit(1); }).catch(e=>{ console.error(e); process.exit(2); })"

echo
echo "[autotest-stack] Exportando URLs padrão para RPA..."
export TEST_BASE_URL="http://localhost:3001"
export TEST_API_URL="http://localhost:3001"
export TEST_FRONTEND_URL="http://localhost:5173"

echo
echo "[autotest-stack] Seeding flows mínimos para RPA..."
node ./scripts/seed-rpa-flows.js

echo
echo "[autotest-stack] Rodando validação oficial (contratos + unit/flow/stress + RPA)..."
npm run system:validate

echo
echo "[autotest-stack] Rodando smoke test PBX (Realtime/ODBC)..."
bash ./scripts/test-pbx-realtime.sh

echo
echo "[autotest-stack] Rodando testes do frontend (Vitest)..."
(
  cd frontend
  npm ci
  npm test -- --run
)

echo
echo "[autotest-stack] Rodando testes do rag-service (pytest) dentro do container..."
mkdir -p rag-service/test-results
docker compose -f docker-compose.test.yml exec -T rag-service pytest --junitxml=/test-results/junit.xml

echo
echo "[autotest-stack] ✅ Tudo passou."

