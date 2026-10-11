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
#   prod-like requer containers no Docker local (docker-compose.yml) para
#   simular o ambiente real (não usa Vite/dev server nem fixtures):
#   - API em http://localhost:3001   (docker: host 3001 -> container 3000)
#   - Frontend em http://localhost:8080 (docker nginx: 8080 -> 80)
#   - PostgreSQL, Redis e rag-service acessíveis (.env carregado via --env-file)
#   - Observação de estado host-side: o smoke lê o Postgres do CONTAINER
#     (porta resolvida via `docker port chatbot-postgres`, fallback PG_HOST_PORT/5432)
#     através de TEST_DATABASE_URL — o observador precisa enxergar o mesmo banco
#     em que a stack escreve (override: QA_SMOKE_OBSERVE_DATABASE_URL).
#
# Política de agendamento: este cron respeita a MESMA política do QA Mesh
# (opt-in explícito + fail-closed). Sem enabled:true persistido (toggle da UI)
# ou QA_MESH_SCHEDULER_ENABLED=true — ou com QA_MESH_SCHEDULER_DISABLED=true —
# o smoke é pulado (SKIP) e não gera/atualiza evidência.
#
# Serviços de DEV: antes de validar a stack Docker, o script derruba os serviços
# de dev (API node, frontend Vite, RAG uvicorn) para liberar :3001/:5173/:8001 e
# evitar conflito de porta (o Docker expõe a API em :3001).
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
FRONTEND_URL="${FRONTEND_URL:-http://localhost:8080}"

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

# Derruba os serviços de dev (API node, frontend Vite, RAG uvicorn) para liberar
# as portas :3001/:5173/:8001 antes do prod-like validar a stack Docker — sem
# isso o Docker não consegue expor a API em :3001 (conflito de porta). Chamado
# apenas depois do gate de política (agendamento explicitamente habilitado).
stop_dev_services() {
  log "STOP dev services (liberando 3001/5173/8001 para a stack Docker)"
  # A API de dev é SUPERVISIONADA (systemd --user `ragent2-api-dev`, Restart=always):
  # matar o PROCESSO não libera :3001 — o systemd o revive em ~3 s, a porta volta a
  # ficar ocupada e a stack prod-like não consegue expor a API (o smoke vira SKIP/
  # NO_GO). E este smoke é pré-requisito BLOQUEANTE do `consolidate` da selagem.
  # Quem manda na API é a UNIDADE, então é ela que precisa ser parada — e religada
  # no fim (ver restore_dev_api).
  if systemctl --user cat ragent2-api-dev >/dev/null 2>&1; then
    if bash "$PROJECT_ROOT/scripts/dev/api-service.sh" stop >/dev/null 2>&1; then
      log "  API dev PARADA pela unidade (ragent2-api-dev)"
    else
      log "  AVISO: não consegui parar a unidade — :3001 pode permanecer ocupada"
    fi
  else
    # Sem unidade instalada, o processo é solto e o pkill é o único caminho.
    pkill -f "node api/server\.js" 2>/dev/null && log "  API dev encerrada" || log "  API dev não estava rodando"
  fi
  pkill -f "vite --configLoader" 2>/dev/null && log "  frontend Vite encerrado" || log "  frontend Vite não estava rodando"
  pkill -f "uvicorn main:app" 2>/dev/null && log "  RAG uvicorn encerrado" || log "  RAG uvicorn não estava rodando"
  # SIGTERM é assíncrono: aguarda as portas serem liberadas antes do reachability.
  sleep 2
}

# Devolve a API de dev ao operador. Sem isto, TODO smoke agendado deixaria o ambiente
# sem API (antes disso o serviço era solto; com supervisão seria incoerente parar a
# unidade e não subir de volta).
restore_dev_api() {
  if systemctl --user cat ragent2-api-dev >/dev/null 2>&1; then
    if bash "$PROJECT_ROOT/scripts/dev/api-service.sh" start >/dev/null 2>&1; then
      log "API dev REATIVADA pela unidade (ragent2-api-dev)"
    else
      log "AVISO: API dev não voltou — rode: npm run dev:api:service start"
    fi
  fi
}

# ── Alinhamento com a política de agendamento do QA Mesh ──
# O smoke contínuo é uma execução agendada; respeita a MESMA política do
# scheduler do QA Mesh (opt-in explícito + fail-closed):
#   - QA_MESH_SCHEDULER_DISABLED=true  → kill-switch, sempre desliga.
#   - caso contrário, só roda se o estado persistido tiver enabled:true
#     (toggle na UI) ou QA_MESH_SCHEDULER_ENABLED=true.
if [ "${QA_MESH_SCHEDULER_DISABLED:-}" = "true" ]; then
  log "SKIP scheduler_disabled_env (política QA Mesh) — smoke não executado"
  exit 0
fi
scheduler_enabled="$(node -e "const fs=require('fs');try{const s=JSON.parse(fs.readFileSync('$PROJECT_ROOT/qa-mesh/scheduler-state.json','utf8'));process.stdout.write(s.enabled===true?'true':'false')}catch(e){process.stdout.write('false')}" 2>/dev/null)"
if [ "$scheduler_enabled" != "true" ] && [ "${QA_MESH_SCHEDULER_ENABLED:-}" != "true" ]; then
  log "SKIP scheduler_not_explicitly_enabled (política QA Mesh) — smoke não executado"
  exit 0
fi

# ── O stack prod-like VAI rodar? Checar ANTES de derrubar os serviços de dev ──
#
# Medido em 2026-09-28 07:23Z (cron `23 4 * * *`): `stop_dev_services()` era a
# PRIMEIRA coisa executada e o wrapper terminava em SKIP — mas Vite e RAG de dev
# já estavam mortos, o que abortou a fase `final` de um `release:seal` em
# andamento com 11 gaps de infra (`net::ERR_CONNECTION_REFUSED at
# http://localhost:5173`, `RAG_INDEX_FAILED::Falha ao conectar`). Derrubar
# runtime de desenvolvimento só se justifica quando o stack do Docker realmente
# vai executar o smoke; sem ele não há evidência a produzir de qualquer forma.
#
# `restarting` conta como "vai rodar": um container em crash-loop por porta
# ocupada precisa que o teardown libere :3001 na próxima tentativa.
prod_like_api_container_state() {
  if ! command -v docker >/dev/null 2>&1; then
    printf 'no-docker'
    return
  fi
  docker inspect --format '{{.State.Status}}' chatbot-api 2>/dev/null || printf 'absent'
}
container_state="$(prod_like_api_container_state)"
case "$container_state" in
  running|restarting) ;;
  *)
    log "SKIP prod_like_api_container_${container_state} — API do stack não está no ar; serviços de dev PRESERVADOS. Suba o stack: docker compose -f docker-compose.yml up -d --no-deps api rag-service"
    exit 0
    ;;
esac

# O smoke autentica pelo SPA servido em FRONTEND_URL, cujo proxy interno
# (nginx → api:3000) exige a API do STACK no ar. Se essa API estiver fora,
# :3001 pode estar ocupada por outro processo (ex.: API de dev que o pkill
# acima não casa, por caminho absoluto ou supervisor), a checagem
# `reachable "$API_URL/"` passa e o smoke morre em `ensureAuthenticated` com
# `page.waitForFunction: Timeout 30000ms` — foi exatamente o que aconteceu no
# cron de 2026-09-25/26/27 (API do stack parada desde 2026-09-22 22:42), com a
# evidência decaindo em silêncio. Falha rápida, explícita e sem evidência falsa.
# A sonda roda ANTES do teardown porque só fala com o nginx do container (:8080)
# — assim um SKIP aqui também não custa o runtime de dev.
prod_like_proxy_code() {
  curl -s -o /dev/null --max-time 10 -w '%{http_code}' \
    "${FRONTEND_URL%/}/r-agent2/api/health" 2>/dev/null
}
proxy_code="$(prod_like_proxy_code)"
if [[ "$proxy_code" != "200" ]]; then
  log "SKIP prod_like_api_unreachable_through_frontend code=${proxy_code:-000} frontend=$FRONTEND_URL — serviços de dev PRESERVADOS; suba o stack (docker compose -f docker-compose.yml up -d --no-deps api rag-service)"
  exit 0
fi

# ── Stack confirmado: agora sim libera as portas para o prod-like ──
stop_dev_services

if ! reachable "$API_URL/"; then
  log "SKIP api=$API_URL indisponível — smoke não executado"
  exit 0
fi
if ! reachable "$FRONTEND_URL/"; then
  log "SKIP frontend=$FRONTEND_URL indisponível — smoke não executado"
  exit 0
fi

log "START mode=production_health api=$API_URL frontend=$FRONTEND_URL"

# ── Observação de estado host-side ──
# O observador (stateSnapshotService) roda no HOST, mas a API prod-like escreve
# no Postgres do CONTAINER. Sem apontar o observador para o mesmo banco, os
# snapshots before/after não veem as mutações reais (mutation_provenance_missing).
# A porta publicada é resolvida do container (docker port) porque PG_HOST_PORT
# pode não estar no .env; credenciais default = as do docker-compose.yml.
# Override explícito: QA_SMOKE_OBSERVE_DATABASE_URL ou TEST_DATABASE_URL.
if [ -z "${TEST_DATABASE_URL:-}" ]; then
  observe_pg_port=""
  if command -v docker >/dev/null 2>&1; then
    observe_pg_port="$(docker port chatbot-postgres 5432 2>/dev/null | head -n1 | sed 's/.*://')"
  fi
  observe_pg_port="${observe_pg_port:-${PG_HOST_PORT:-5432}}"
  export TEST_DATABASE_URL="${QA_SMOKE_OBSERVE_DATABASE_URL:-postgresql://results_app:StrongPass@127.0.0.1:${observe_pg_port}/results_saas}"
  log "OBSERVE db=127.0.0.1:${observe_pg_port}/results_saas (Postgres do container prod-like)"
fi

cd "$PROJECT_ROOT"
# --env-file-if-exists exige Node >= 22.12; cron pode resolver um Node mais antigo.
if node --help 2>/dev/null | grep -q -- '--env-file-if-exists'; then
  FRONTEND_URL="$FRONTEND_URL" \
  API_URL="$API_URL" \
  QA_WAVES_SCHEDULED_MODE=production_health \
  node --env-file-if-exists=.env scripts/smoke/qa-waves-scheduled-operational-smoke.js >> "$LOG_FILE" 2>&1
else
  if [[ -f .env ]]; then
    set -a
    # shellcheck disable=SC1091
    . ./.env
    set +a
  fi
  FRONTEND_URL="$FRONTEND_URL" \
  API_URL="$API_URL" \
  QA_WAVES_SCHEDULED_MODE=production_health \
  node scripts/smoke/qa-waves-scheduled-operational-smoke.js >> "$LOG_FILE" 2>&1
fi
EXIT_CODE=$?

# Devolve a API de dev (parada em stop_dev_services para liberar :3001 à stack).
restore_dev_api

if [[ $EXIT_CODE -eq 0 ]]; then
  log "END status=GO exit=0"
else
  log "END status=NO_GO exit=$EXIT_CODE"
fi
exit $EXIT_CODE
