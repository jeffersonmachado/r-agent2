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

# ── Governança do ambiente de execução (Fase 2) ────────────────────────────────
#
# O smoke prod-like precisa de :3001/:5173/:8001 LIVRES, mas NÃO pode deixar o
# ambiente do operador danificado depois. Duas armadilhas já custaram ciclos:
#   1. Matar o PROCESSO não libera a porta — os serviços de dev são supervisionados
#      (systemd --user, Restart=always) e voltam em segundos. Quem manda é a UNIDADE.
#   2. Parar e não religar (ou religar o que ESTAVA DESLIGADO) desloca o estado do
#      ambiente. Um smoke agendado não pode escolher por quem opera.
#
# Política: SNAPSHOT do que estava no ar → parar SÓ o que estava no ar → restaurar
# SÓ o que foi parado, inclusive em saída antecipada (trap EXIT/INT/TERM).
#
# Reconciliação (SIGKILL/host crash — o trap NÃO roda): o estado desejado volta com
#   npm run dev:services:start all   (ou: bash scripts/dev/service.sh start all)
# e o desvio residual é detectável por `service.sh status <svc>`
# (`residuos_fora_da_unidade` > 0) e pelo preflight do converge.
SERVICOS_DEV="api rag frontend"
SNAPSHOT_ARQUIVO=""
RESTORE_CONCLUIDO=0
# Serviços que ESTE smoke parou e que NÃO voltaram para a unidade (porta servida
# por outro processo/stack, ou unidade que não subiu). Restauração incompleta
# invalida o "GO": o smoke não pode declarar sucesso deixando o ambiente do
# operador em estado diferente do inicial.
RESTORE_FALHAS=0

# Política de estado compartilhada com `service.sh` (deve_parar/deve_restaurar):
# mantê-la em um único lugar evita que teardown e restauração discordem sobre o que
# significa "estava no ar" — foi exatamente essa discordância que religou o RAG que
# o operador havia deixado parado (medido em 2026-10-11).
# shellcheck source=../dev/lib/servicos-dev-state.sh
. "$PROJECT_ROOT/scripts/dev/lib/servicos-dev-state.sh"

dev_service_cmd() { bash "$PROJECT_ROOT/scripts/dev/service.sh" "$1" "$2"; }

# Unidade instalada? Sem unidade o serviço é solto (modelo legado) e não há como
# reconhecer "estava no ar sob supervisão" — nesse caso não mexemos no que não
# podemos restaurar de forma determinística.
unidade_instalada() { systemctl --user cat "$(dev_unidade "$1")" >/dev/null 2>&1; }

# ATENÇÃO (2ª ocorrência do mesmo defeito, medida em 2026-10-11): `systemctl is-active`
# imprime "inactive" E retorna 3 — um `|| echo unknown` acrescenta uma SEGUNDA linha
# ("inactive\nunknown"), que entra no snapshot como campo fantasma e fazia o loop
# processar um serviço inexistente. Capturar e normalizar, nunca encadear com `||`.
estado_unidade() {
  local e
  e="$(systemctl --user is-active "$(dev_unidade "$1")" 2>/dev/null)"
  [ -n "$e" ] || e="unknown"
  printf '%s' "$e"
}

snapshot_dev_state() {
  SNAPSHOT_ARQUIVO="$(mktemp -t ragent2-smoke-snapshot.XXXXXX)"
  local s ativo health
  for s in $SERVICOS_DEV; do
    if unidade_instalada "$s"; then
      ativo="$(estado_unidade "$s")"
      [ -n "$ativo" ] || ativo="unknown"
    else
      ativo="sem_unidade"
    fi
    case "$s" in
      api) health="$(curl -s -o /dev/null --max-time 3 -w '%{http_code}' http://127.0.0.1:3001/health 2>/dev/null)" ;;
      rag) health="$(curl -s -o /dev/null --max-time 3 -w '%{http_code}' http://127.0.0.1:8001/health 2>/dev/null)" ;;
      frontend) health="$(curl -s -o /dev/null --max-time 3 -w '%{http_code}' http://127.0.0.1:5173/ 2>/dev/null)" ;;
    esac
    # `|` como delimitador: campos nunca contêm vazio ambíguo e o `read` não desloca
    # colunas (a comparação frágil com a string "000" foi removida junto).
    printf '%s|%s|%s\n' "$s" "$ativo" "${health:-000}" >> "$SNAPSHOT_ARQUIVO"
  done
  log "SNAPSHOT dev services: $(tr '\n' ';' < "$SNAPSHOT_ARQUIVO")"
}

stop_dev_services() {
  log "STOP dev services (liberando 3001/5173/8001 para a stack Docker)"
  : > "${SNAPSHOT_ARQUIVO}.parados"
  local s estado health
  while IFS='|' read -r s estado health; do
    [ -n "$s" ] || continue
    if ! deve_parar "$estado" "$health"; then
      log "  [$s] PRESERVADO ($(descrever_estado "$estado" "$health")) — já estava parado/ausente; não será religado"
      continue
    fi
    if dev_service_cmd stop "$s" >/dev/null 2>&1; then
      printf '%s|parado|%s|%s\n' "$s" "$estado" "$health" >> "${SNAPSHOT_ARQUIVO}.parados"
      log "  [$s] PARADO pela unidade ($(descrever_estado "$estado" "$health"))"
    else
      log "  AVISO: [$s] não consegui parar pela unidade — a porta pode seguir ocupada"
    fi
  done < "$SNAPSHOT_ARQUIVO"
  # SIGTERM é assíncrono: aguarda as portas serem liberadas antes do reachability.
  sleep 2
}

# Restauração IDEMPOTENTE: chamada no fim normal e pelo trap. Só religa o que ESTE
# smoke parou — serviço que já estava desligado permanece desligado.
restore_dev_state() {
  [ "$RESTORE_CONCLUIDO" = "1" ] && return 0
  RESTORE_CONCLUIDO=1
  [ -n "$SNAPSHOT_ARQUIVO" ] && [ -f "$SNAPSHOT_ARQUIVO.parados" ] || return 0
  local s marca estado health code
  local RESTORE_FALHAS_LOCAL=0
  while IFS='|' read -r s marca estado health; do
    [ -n "$s" ] || continue
    deve_restaurar "$marca" || continue
    if dev_service_cmd start "$s" >/dev/null 2>&1; then
      case "$s" in
        api) code="$(curl -s -o /dev/null --max-time 5 -w '%{http_code}' http://127.0.0.1:3001/health 2>/dev/null)" ;;
        rag) code="$(curl -s -o /dev/null --max-time 5 -w '%{http_code}' http://127.0.0.1:8001/health 2>/dev/null)" ;;
        frontend) code="$(curl -s -o /dev/null --max-time 5 -w '%{http_code}' http://127.0.0.1:5173/ 2>/dev/null)" ;;
      esac
      # `health` prova que ALGUÉM responde na porta — não prova QUEM (defeito
      # medido em 2026-10-13: aqui o 200 vinha do container `chatbot-api` da
      # stack prod-like, com a unidade de dev parada). Só declarar RESTAURADO
      # quando a porta for servida por um processo DA UNIDADE.
      if porta_pertence_a_unidade "$s"; then
        log "  [$s] RESTAURADO (health=${code:-000}) — estado inicial era $(descrever_estado "$estado" "$health")"
      else
        RESTORE_FALHAS_LOCAL=$((RESTORE_FALHAS_LOCAL + 1))
        log "  FALHA: [$s] health=${code:-000}, mas a porta $(dev_porta "$s") NÃO é servida pela unidade $(dev_unidade "$s") — respondendo ali: pids [$(dev_pids_na_porta "$(dev_porta "$s")" | tr '\n' ' ')]. A unidade NÃO está atendendo o operador (EADDRINUSE enquanto a porta estiver ocupada)"
      fi
    else
      RESTORE_FALHAS_LOCAL=$((RESTORE_FALHAS_LOCAL + 1))
      log "  AVISO: [$s] NÃO voltou — rode: npm run dev:services:start $s"
    fi
  done < "${SNAPSHOT_ARQUIVO}.parados"
  if [ "$RESTORE_FALHAS_LOCAL" -gt 0 ]; then
    RESTORE_FALHAS=$((RESTORE_FALHAS + RESTORE_FALHAS_LOCAL))
    log "  RESTAURAÇÃO INCOMPLETA: $RESTORE_FALHAS_LOCAL serviço(s) não voltaram para a unidade (ambiente do operador NÃO restaurado)"
  fi
  return 0
}

# Saída antecipada (SKIP) ou interrupção: o ambiente do operador volta como estava.
on_exit() {
  local rc=$?
  restore_dev_state
  rm -f "$SNAPSHOT_ARQUIVO" "${SNAPSHOT_ARQUIVO}.parados" 2>/dev/null || true
  # Mesma regra da saída normal: restauração incompleta não pode sair como 0.
  if [ "$rc" -eq 0 ] && [ "$RESTORE_FALHAS" -gt 0 ]; then
    rc=3
  fi
  return $rc
}
trap on_exit EXIT INT TERM

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
snapshot_dev_state
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

# Devolve ao operador os serviços de dev que ESTE smoke parou (api/rag/frontend).
# O trap on_exit cobre também as saídas antecipadas; aqui é a saída normal, para o
# log registrar a restauração ANTES do veredito final.
restore_dev_state

# Restauração incompleta é estado terminal próprio (3): o check pode ter passado,
# mas o ambiente do operador NÃO voltou — declarar GO aqui seria falso verde.
if [[ $EXIT_CODE -eq 0 ]] && [[ $RESTORE_FALHAS -gt 0 ]]; then
  EXIT_CODE=3
fi

if [[ $EXIT_CODE -eq 0 ]]; then
  log "END status=GO exit=0"
elif [[ $EXIT_CODE -eq 3 ]]; then
  log "END status=RESTORE_INCOMPLETO exit=3 falhas=$RESTORE_FALHAS"
else
  log "END status=NO_GO exit=$EXIT_CODE"
fi
exit $EXIT_CODE
