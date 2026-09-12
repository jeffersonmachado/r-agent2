#!/usr/bin/env bash
#
# pbx-host-db-bridge.sh — ponte dev entre o container Asterisk e o PostgreSQL do HOST.
#
# PROBLEMA QUE ISTO RESOLVE
# -------------------------
# No ambiente de desenvolvimento desta estação a API roda como processo no host e usa o
# PostgreSQL NATIVO do host (ex.: `r_agent2` em 127.0.0.1:5432), enquanto o serviço
# `asterisk` roda em container e usa outro PostgreSQL. Resultado: o Asterisk grava CDR e lê
# dialplan Realtime de um banco que a aplicação nunca lê. O sintoma observado foi
# `pbxProdLike.signals.cdr=false` na prova enterprise (RAP-068), mesmo com a chamada real
# sendo originada, atendida e com CDR gravado — em outro banco.
#
# O PostgreSQL do host escuta apenas em 127.0.0.1, portanto é inalcançável a partir da rede
# bridge do Docker. Este script publica o Postgres do host na interface do gateway da bridge
# (172.17.0.1 por padrão) usando `socat`, para que o container `asterisk` possa alcançá-lo.
#
# USO
# ---
#   scripts/pbx-host-db-bridge.sh start   # idempotente
#   scripts/pbx-host-db-bridge.sh status
#   scripts/pbx-host-db-bridge.sh stop
#
# Combinado com (no .env do host):
#   PBX_ODBC_HOST=172.17.0.1
#   PBX_ODBC_PORT=15432
#   PBX_ODBC_DB=r_agent2
#   PBX_ODBC_USER=postgres
#   PBX_ODBC_PASSWORD=<senha do DATABASE_URL>
#
# ESCOPO
# ------
# Ferramenta EXCLUSIVA DE DESENVOLVIMENTO. Não é usada por `docker-compose.yml`,
# `docker-compose.prod.yml` nem `docker-compose.test.yml` — nesses ambientes o Asterisk e o
# Postgres convivem na mesma rede e o DSN do repositório já está correto. Este script existe
# porque o host de dev roda a API fora do Docker.
#
set -euo pipefail

ACTION="${1:-start}"

# Bind: interface da bridge do Docker (não 0.0.0.0 — evita expor o banco de dev na rede local).
BIND_ADDR="${PBX_ODBC_BRIDGE_BIND:-}"
LISTEN_PORT="${PBX_ODBC_PORT:-15432}"
TARGET_ADDR="${PBX_ODBC_BRIDGE_TARGET:-127.0.0.1:5432}"

RUNTIME_DIR="${PBX_ODBC_BRIDGE_RUNTIME_DIR:-$HOME/.local/share/ragent2-runtime/pbx}"
PID_FILE="$RUNTIME_DIR/host-db-bridge.pid"
LOG_FILE="$RUNTIME_DIR/host-db-bridge.log"

resolve_bind_addr() {
  if [ -n "$BIND_ADDR" ]; then
    printf '%s' "$BIND_ADDR"
    return 0
  fi
  if command -v docker >/dev/null 2>&1; then
    local gw
    gw="$(docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}' 2>/dev/null || true)"
    if [ -n "$gw" ]; then
      printf '%s' "$gw"
      return 0
    fi
  fi
  printf '172.17.0.1'
}

is_listening() {
  local addr="$1"
  command -v ss >/dev/null 2>&1 || return 1
  ss -ltn 2>/dev/null | grep -qF "$addr:$LISTEN_PORT"
}

running_pid() {
  if [ -f "$PID_FILE" ]; then
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      printf '%s' "$pid"
      return 0
    fi
  fi
  return 1
}

case "$ACTION" in
  start)
    if ! command -v socat >/dev/null 2>&1; then
      echo "socat não encontrado. Instale (apt-get install -y socat) ou rode o Asterisk e o Postgres no mesmo compose." >&2
      exit 1
    fi

    BIND_ADDR="$(resolve_bind_addr)"

    if is_listening "$BIND_ADDR"; then
      echo "já ativo: $BIND_ADDR:$LISTEN_PORT -> $TARGET_ADDR"
      exit 0
    fi

    if pid="$(running_pid)"; then
      echo "processo já em execução (pid=$pid), aguardando bind em $BIND_ADDR:$LISTEN_PORT" >&2
    fi

    mkdir -p "$RUNTIME_DIR"
    setsid nohup socat \
      "TCP-LISTEN:${LISTEN_PORT},fork,reuseaddr,bind=${BIND_ADDR}" \
      "TCP:${TARGET_ADDR}" \
      >>"$LOG_FILE" 2>&1 < /dev/null &
    echo $! > "$PID_FILE"

    for _ in $(seq 1 20); do
      if is_listening "$BIND_ADDR"; then
        echo "ativo: $BIND_ADDR:$LISTEN_PORT -> $TARGET_ADDR (pid=$(cat "$PID_FILE"))"
        exit 0
      fi
      sleep 0.25
    done

    echo "falha ao abrir $BIND_ADDR:$LISTEN_PORT. Log: $LOG_FILE" >&2
    tail -n 20 "$LOG_FILE" 2>/dev/null >&2 || true
    exit 1
    ;;

  status)
    BIND_ADDR="$(resolve_bind_addr)"
    if is_listening "$BIND_ADDR"; then
      echo "ATIVO: $BIND_ADDR:$LISTEN_PORT -> $TARGET_ADDR"
      exit 0
    fi
    echo "INATIVO ($BIND_ADDR:$LISTEN_PORT)"
    exit 1
    ;;

  stop)
    if pid="$(running_pid)"; then
      kill "$pid" 2>/dev/null || true
      sleep 1
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
    # Processos filhos do fork do socat ficam órfãos; encerra os que casam com a porta.
    pkill -f "socat TCP-LISTEN:${LISTEN_PORT},fork,reuseaddr,bind=" 2>/dev/null || true
    echo "parado"
    ;;

  *)
    echo "uso: $0 {start|status|stop}" >&2
    exit 2
    ;;
esac
