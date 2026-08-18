#!/usr/bin/env bash
# =============================================================================
# scripts/smoke/run-scheduled-production-health-smoke.sh
#
# Regera a evidência canônica de smoke contínuo do QA Waves:
#   qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json
#   qa/smoke/qa-waves-scheduled-operational-smoke.json  (modo production_health)
#
# A evidência tem validade de 48h no gate de governança
# (validate:qa-governance → continuousValidationStatus.maxAgeHours). Este
# wrapper existe para ser agendado (cron diário) e manter o gate verde.
#
# Pré-requisitos (stack viva REAL — o modo production_health recusa fixture):
#   - API em http://localhost:3001
#   - Frontend em http://localhost:5173
#   - PostgreSQL, Redis e rag-service acessíveis (.env carregado via --env-file)
#
# Se a stack não estiver no ar, o script registra SKIP no log e sai 0 (não
# gera evidência falsa nem quebra o cron; o gate degradará para STALE/NO_GO
# de forma explícita quando a evidência vencer).
#
# Uso:
#   ./scripts/smoke/run-scheduled-production-health-smoke.sh
#   crontab: 23 4 * * * /opt/results/ria/r-agent2/scripts/smoke/run-scheduled-production-health-smoke.sh
# =============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$PROJECT_ROOT/logs/qa"
LOG_FILE="$LOG_DIR/scheduled-production-health-smoke.log"
API_URL="${API_URL:-http://localhost:3001}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:5173}"

mkdir -p "$LOG_DIR"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >> "$LOG_FILE"; }

# Rotação simples: mantém o log abaixo de ~5 MB
if [[ -f "$LOG_FILE" ]] && [[ "$(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)" -gt 5242880 ]]; then
  tail -c 1048576 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
fi

# Stack viva obrigatória — sem ela, pular (evidência vencida continua explícita).
# Vale qualquer resposta HTTP (até 404/401): o que importa é o servidor no ar.
reachable() {
  local code
  code="$(curl -s -o /dev/null --max-time 10 -w '%{http_code}' "$1" 2>/dev/null)"
  [[ "$code" != "000" && -n "$code" ]]
}

if ! reachable "$API_URL/"; then
  log "SKIP api=$API_URL indisponível — smoke não executado"
  exit 0
fi
if ! reachable "$FRONTEND_URL/"; then
  log "SKIP frontend=$FRONTEND_URL indisponível — smoke não executado"
  exit 0
fi

log "START mode=production_health api=$API_URL frontend=$FRONTEND_URL"

cd "$PROJECT_ROOT"
FRONTEND_URL="$FRONTEND_URL" \
API_URL="$API_URL" \
QA_WAVES_SCHEDULED_MODE=production_health \
node --env-file-if-exists=.env scripts/smoke/qa-waves-scheduled-operational-smoke.js >> "$LOG_FILE" 2>&1
EXIT_CODE=$?

if [[ $EXIT_CODE -eq 0 ]]; then
  log "END status=GO exit=0"
else
  log "END status=NO_GO exit=$EXIT_CODE"
fi
exit $EXIT_CODE
