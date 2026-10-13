#!/usr/bin/env bash
# =============================================================================
# scripts/pbx-cdr-health.sh
#
# Saúde do caminho de CDR do Asterisk (ponte host<->Postgres + backend ODBC).
#
# POR QUE EXISTE (defeito medido em 2026-10-13, com um ciclo de ~40 min perdido):
#   o preflight do converge valida apenas que a PORTA da ponte (15432) escuta.
#   Quando o Postgres não responde no boot do container, o `cdr_adaptive_odbc`
#   para de gravar EM SILÊNCIO e NÃO volta sozinho: a porta está de pé, o
#   preflight passa, e o passo 1/12 (`enterprise proof smoke`) reprova com
#   `pbxProdLike.cdr=false` / `hangupCauses=false` / `omnichannel.pbx=false`.
#   O operador só descobre isso ~1 min depois de começar um ciclo de 40 min.
#
# SINAL PRECISO (e não o óbvio): `cdr show status` lista os backends REGISTRADOS.
#   Saudável  → "* Registered Backends / Adaptive ODBC" aparece.
#   Degradado → "Adaptive ODBC" AUSENTE (o backend não está registrado no engine
#               de CDR, então nenhum CDR é gravado mesmo com call em curso).
#   O `Use Count` do módulo é 0 mesmo no estado SAUDÁVEL — não serve de sinal.
#
# Uso:
#   bash scripts/pbx-cdr-health.sh check    # 0 = saudável | 1 = degradado (imprime motivo)
#   bash scripts/pbx-cdr-health.sh ensure   # garante ponte + recupera o backend
#
# Exit: 0 saudável/recuperado | 1 indisponível (fail-closed: nunca "ok" sem sinal)
# =============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORTA="${PBX_ODBC_PORT:-15432}"
CONTAINER="${PBX_ASTERISK_CONTAINER:-chatbot-asterisk}"
DSN="${PBX_ODBC_DSN:-asterisk_pg}"
# Injetável para teste (o teste NÃO pode subir um socat real na máquina).
BRIDGE="${PBX_BRIDGE_SCRIPT:-$ROOT/scripts/pbx-host-db-bridge.sh}"
ACAO="${1:-check}"

achado() { printf '[pbx-cdr] %s\n' "$*"; }

ponte_escutando() {
  command -v ss >/dev/null 2>&1 || return 1
  ss -ltn 2>/dev/null | grep -qF ":$PORTA"
}

docker_ok() {
  command -v docker >/dev/null 2>&1 || return 1
  docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true
}

asterisk_ok() {
  docker exec "$CONTAINER" asterisk -rx "core show uptime" >/dev/null 2>&1
}

# Backend de CDR registrado no engine? (sinal real de que o CDR vai gravar)
backend_registrado() {
  docker exec "$CONTAINER" asterisk -rx "cdr show status" 2>/dev/null | grep -q 'Adaptive ODBC'
}

# Conexão ODBC do DSN usada pelo backend (0 conexões = backend sem banco)
conexoes_odbc() {
  docker exec "$CONTAINER" asterisk -rx "odbc show $DSN" 2>/dev/null \
    | sed -n 's/.*Number of active connections: \([0-9]\+\).*/\1/p' | head -n1
}

recuperar() {
  achado "aplicando reload de res_odbc.so + cdr_adaptive_odbc.so (recuperação do backend)"
  docker exec "$CONTAINER" asterisk -rx "module reload res_odbc.so" 2>&1 | sed 's/^/[pbx-cdr]   /'
  docker exec "$CONTAINER" asterisk -rx "module reload cdr_adaptive_odbc.so" 2>&1 | sed 's/^/[pbx-cdr]   /'
}

diagnosticar() {
  if ! ponte_escutando; then
    achado "motivo=ponte_ausente (porta $PORTA não escuta)"
    return 1
  fi
  if ! docker_ok; then
    achado "motivo=container_ausente ($CONTAINER não está rodando)"
    return 1
  fi
  if ! asterisk_ok; then
    achado "motivo=asterisk_sem_console (não respondeu a 'core show uptime')"
    return 1
  fi
  if ! backend_registrado; then
    local cx
    cx="$(conexoes_odbc)"
    achado "motivo=cdr_backend_nao_registrado (Adaptive ODBC ausente em 'cdr show status'; conexões ODBC=$cx)"
    return 1
  fi
  return 0
}

case "$ACAO" in
  check)
    if diagnosticar; then
      achado "status=OK backend=AdaptiveODBC porta=$PORTA"
      exit 0
    fi
    achado "status=DEGRADED — recupere com: bash scripts/pbx-cdr-health.sh ensure"
    exit 1
    ;;
  ensure)
    # 1) ponte primeiro: sem ela o reload não adianta (o backend precisa do banco).
    if ! ponte_escutando; then
      achado "ponte ausente — iniciando pbx-host-db-bridge.sh"
      if ! bash "$BRIDGE" start; then
        achado "status=UNAVAILABLE motivo=ponte_nao_subiu"
        exit 1
      fi
    fi
    if diagnosticar; then
      achado "status=OK backend=AdaptiveODBC porta=$PORTA (nada a fazer)"
      exit 0
    fi
    recuperar
    if diagnosticar; then
      achado "status=RECOVERED backend=AdaptiveODBC porta=$PORTA"
      exit 0
    fi
    achado "status=UNAVAILABLE motivo=backend_nao_registrado_apos_reload"
    exit 1
    ;;
  *)
    echo "uso: bash scripts/pbx-cdr-health.sh <check|ensure>" >&2
    exit 2
    ;;
esac
