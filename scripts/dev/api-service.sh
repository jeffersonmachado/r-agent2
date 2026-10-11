#!/usr/bin/env bash
#
# Supervisão da API de desenvolvimento do r-agent2 via systemd --user.
#
# PROBLEMA QUE ESTE SCRIPT ELIMINA (medido 2026-10-01 e 2026-10-11): a API subida no
# terminal (`kill ... && setsid nohup node api/server.js > log 2>&1 &`) MORRE quando o
# terminal é reaproveitado/limpo, porque o `&` se aplica à CADEIA inteira e o job leva
# SIGTERM. Sintoma enganoso: log termina no MEIO de um tick, SEM stack trace, e o proxy
# do Vite devolve 500 (parece bug de página) até a tela cair no login.
#
# A correção não é "lembrar de não fazer isso": é tirar a API da dependência de terminal
# e deixar quem sabe supervisionar fazer isso (systemd), com a configuração TRAVADA por
# teste versionado (tests/unit/dev/apiServiceUnit.test.js).
#
# Uso:
#   bash scripts/dev/api-service.sh install    # renderiza a unit, habilita e sobe
#   bash scripts/dev/api-service.sh restart
#   bash scripts/dev/api-service.sh status
#   bash scripts/dev/api-service.sh logs [n]
#   bash scripts/dev/api-service.sh check      # health 200? se não, reinicia; exit!=0 bloqueia
#   bash scripts/dev/api-service.sh uninstall
set -euo pipefail

UNIT_NAME="ragent2-api-dev"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEMPLATE="$ROOT/scripts/dev/${UNIT_NAME}.service.template"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_PATH="$UNIT_DIR/${UNIT_NAME}.service"
LOG_FILE="${RAGENT2_API_LOG:-$HOME/seal-logs/${UNIT_NAME}.service.log}"
HEALTH_URL="${RAGENT2_HEALTH_URL:-http://127.0.0.1:3001/health}"

info() { printf '[api-service] %s\n' "$*"; }
fail() { printf '[api-service] ERRO: %s\n' "$*" >&2; exit 1; }

require_systemd() {
  command -v systemctl >/dev/null 2>&1 || fail "systemctl não encontrado — esta prevenção exige systemd --user."
  systemctl --user show-environment >/dev/null 2>&1 \
    || fail "systemctl --user indisponível nesta sessão (sem D-Bus de usuário)."
}

# NODE precisa ser ABSOLUTO: a unit não herda o PATH do shell (e /usr/bin/node é um
# Node antigo, sem --env-file-if-exists — armadilha já medida neste repo).
resolve_node() {
  local node_bin
  node_bin="$(command -v node || true)"
  [ -n "$node_bin" ] || fail "node não encontrado no PATH."
  case "$node_bin" in
    /*) printf '%s' "$node_bin" ;;
    *) fail "não consegui resolver o caminho absoluto do node (recebi '$node_bin')." ;;
  esac
}

render_unit() {
  local node_bin="$1"
  mkdir -p "$UNIT_DIR" "$(dirname "$LOG_FILE")"
  [ -f "$TEMPLATE" ] || fail "template ausente: $TEMPLATE"
  # Substituição por linhas de comando (nunca por expressão regular com `&`, que
  # reinsere o casamento): evita corromper a unit quando um caminho tem `&` ou `/`.
  sed -e "s|{{ROOT}}|$ROOT|g" -e "s|{{NODE}}|$node_bin|g" -e "s|{{LOG}}|$LOG_FILE|g" \
    "$TEMPLATE" > "$UNIT_PATH.tmp"
  mv "$UNIT_PATH.tmp" "$UNIT_PATH"
  info "unit renderizada: $UNIT_PATH"
}

main_pid() { systemctl --user show -p MainPID --value "$UNIT_NAME" 2>/dev/null || true; }

# Processo `api/server.js` que NÃO é o do serviço é resíduo: ele segura a porta 3001,
# faz o serviço novo morrer com EADDRINUSE e ainda responde /health — o operador fala
# com um processo de configuração desconhecida. Aqui o resíduo é removido por PID,
# e o aviso nomeia o que foi morto (nunca `pkill` por substring, que acerta o próprio
# shell do comando).
reap_strays() {
  local service_pid; service_pid="$(main_pid)"
  local killed=0 pid
  for pid in $(pgrep -f 'api/server\.js' 2>/dev/null || true); do
    [ "$pid" = "$$" ] && continue
    [ -n "$service_pid" ] && [ "$pid" = "$service_pid" ] && continue
    # Confere na cmdline que é mesmo a API (defesa contra o pgrep casar com o próprio comando).
    if tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q 'api/server\.js'; then
      kill -TERM "$pid" 2>/dev/null || true
      info "resíduo fora do serviço encerrado (pid $pid) — ele seguraria a porta 3001"
      killed=$((killed + 1))
    fi
  done
  [ "$killed" -gt 0 ] && sleep 2 || true
}

health_code() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" 2>/dev/null || printf '000'
}

cmd_install() {
  require_systemd
  local node_bin; node_bin="$(resolve_node)"
  render_unit "$node_bin"
  systemctl --user daemon-reload
  systemctl --user enable "$UNIT_NAME" >/dev/null 2>&1 || true
  reap_strays
  systemctl --user reset-failed "$UNIT_NAME" >/dev/null 2>&1 || true
  systemctl --user restart "$UNIT_NAME"
  info "aguardando health…"
  local i code
  for i in $(seq 1 30); do
    code="$(health_code)"
    [ "$code" = "200" ] && { info "API no ar sob systemd (health 200). Log: $LOG_FILE"; return 0; }
    sleep 1
  done
  fail "API não respondeu 200 em 30s (último código: $code). Veja: journalctl --user -u $UNIT_NAME -n 80"
}

cmd_restart() { require_systemd; reap_strays; systemctl --user reset-failed "$UNIT_NAME" >/dev/null 2>&1 || true; systemctl --user restart "$UNIT_NAME"; info "reiniciada"; }

cmd_status() {
  require_systemd
  systemctl --user status "$UNIT_NAME" --no-pager 2>&1 | head -14 || true
  info "health: $(health_code) | resíduos fora do serviço: $(reap_strays_report)"
}

# Só REPORTA (não mata) — usado pelo status, para não alterar estado ao observar.
reap_strays_report() {
  local service_pid; service_pid="$(main_pid)"
  local n=0 pid
  for pid in $(pgrep -f 'api/server\.js' 2>/dev/null || true); do
    [ "$pid" = "$$" ] && continue
    [ -n "$service_pid" ] && [ "$pid" = "$service_pid" ] && continue
    if tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q 'api/server\.js'; then n=$((n + 1)); fi
  done
  printf '%s' "$n"
}

cmd_logs() { tail -n "${1:-60}" "$LOG_FILE" 2>/dev/null || info "sem log em $LOG_FILE"; }

# `check` é a defesa em profundidade: usado por quem quer garantir a API viva antes de
# um ciclo longo (mesh/selagem/regressão). Sai != 0 quando não conseguiu restaurar.
cmd_check() {
  require_systemd
  local code; code="$(health_code)"
  if [ "$code" = "200" ]; then
    info "health 200 — OK"
    reap_strays_report | grep -q '^0$' || fail "há processo da API FORA do serviço (resíduo) — rode: $0 install"
    return 0
  fi
  info "health=$code — restaurando via systemd"
  systemctl --user reset-failed "$UNIT_NAME" >/dev/null 2>&1 || true
  reap_strays
  systemctl --user start "$UNIT_NAME"
  local i
  for i in $(seq 1 30); do
    code="$(health_code)"
    [ "$code" = "200" ] && { info "restaurada (health 200)"; return 0; }
    sleep 1
  done
  fail "não consegui restaurar a API (health=$code). Veja: journalctl --user -u $UNIT_NAME -n 80"
}

cmd_uninstall() {
  require_systemd
  systemctl --user disable --now "$UNIT_NAME" >/dev/null 2>&1 || true
  rm -f "$UNIT_PATH"
  systemctl --user daemon-reload
  info "unidade removida"
}

case "${1:-}" in
  install) cmd_install ;;
  restart) cmd_restart ;;
  status) cmd_status ;;
  logs) shift; cmd_logs "${1:-60}" ;;
  check) cmd_check ;;
  uninstall) cmd_uninstall ;;
  *)
    cat <<'USAGE'
uso: bash scripts/dev/api-service.sh <install|restart|status|logs|check|uninstall>

  install    renderiza a unit versionada, habilita no boot e sobe a API supervisionada
  restart    reinicia a API (após mudança de código do backend)
  status     estado da unit, health e resíduos fora do serviço
  logs [n]   últimas n linhas do log da API (default 60)
  check      health 200? se não, restaura via systemd (exit != 0 se não conseguir)
  uninstall  remove a unit (a API volta a depender de quem a subir)
USAGE
    exit 2 ;;
esac
