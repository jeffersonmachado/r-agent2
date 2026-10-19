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
# SEGUNDO SINAL (medido em 2026-10-14): o backend REGISTRADO **não basta**.
#   "Last fail connection attempt" presente em `odbc show <DSN>` ⇒ DEGRADADO,
#   mesmo com backend registrado e 1 conexão ativa (o CDR para em silêncio).
#   Ver `falha_conexao_odbc()` para a evidência e a política fail-closed.
#   Os dois sinais são independentes: um cobre "backend não registrado", o outro
#   "backend registrado sobre uma conexão que falhou".
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

# ATENÇÃO (defeito medido em 2026-10-18): NUNCA usar `grep -q` em pipeline com
# `set -o pipefail` quando o produtor pode escrever DEPOIS da linha que casa.
# `grep -q` sai no primeiro casamento, o produtor recebe SIGPIPE e a pipeline
# retorna 141 — sob carga isso acontece de forma intermitente e o script passa a
# declarar DEGRADED um Asterisk saudável (falso negativo que bloqueia o preflight
# do converge e queima um ciclo de ~40 min). `grep` sem `-q` consome todo o
# stream e preserva o mesmo exit code de casamento. Regressão:
# `tests/unit/pbx/pbxCdrHealthSigpipe.test.js`.
ponte_escutando() {
  command -v ss >/dev/null 2>&1 || return 1
  ss -ltn 2>/dev/null | grep -F ":$PORTA" >/dev/null
}

docker_ok() {
  command -v docker >/dev/null 2>&1 || return 1
  docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep true >/dev/null
}

asterisk_ok() {
  docker exec "$CONTAINER" asterisk -rx "core show uptime" >/dev/null 2>&1
}

# Backend de CDR registrado no engine? (sinal real de que o CDR vai gravar)
backend_registrado() {
  # `grep` sem `-q` de propósito: ver nota de pipefail acima. O `cdr show status`
  # real continua imprimindo backends DEPOIS da linha casada; com `grep -q` o
  # `docker exec` morria por SIGPIPE e a função mentia "não registrado".
  docker exec "$CONTAINER" asterisk -rx "cdr show status" 2>/dev/null | grep 'Adaptive ODBC' >/dev/null
}

# Conexão ODBC do DSN usada pelo backend (0 conexões = backend sem banco)
#
# `head -n1` fecha o pipe no primeiro casamento e mata o `docker exec` por
# SIGPIPE (mesma armadilha do `grep -q`); `sed -n '1p'` lê o stream inteiro e
# imprime só a primeira linha, sem sinalizar o produtor.
conexoes_odbc() {
  docker exec "$CONTAINER" asterisk -rx "odbc show $DSN" 2>/dev/null \
    | sed -n 's/.*Number of active connections: \([0-9]\+\).*/\1/p' | sed -n '1p'
}

# Última tentativa FALHA de conexão do DSN (string vazia = nenhuma registrada).
#
# SEGUNDO SINAL, medido em 2026-10-14 (recorrência do defeito de 2026-10-13):
# o backend pode estar REGISTRADO e com 1 conexão ativa e MESMO ASSIM não gravar
# CDR. O container reiniciou às 21:05:26, `odbc show` registrou a falha no MESMO
# instante do boot e o passo 1/12 do converge reprovou com
# `pbxProdLike.cdr=false` / `hangupCauses=false` / `omnichannel.pbx=false` —
# enquanto este script dizia `status=OK` (backend registrado + 1 conexão), ou
# seja: o sinal do backend sozinho NÃO distingue o estado degradado. O
# `module reload` de res_odbc/cdr_adaptive_odbc LIMPA a linha e o CDR volta na
# hora (smoke enterprise ok=true, 11/11 sinais).
#
# Política fail-closed: uma tentativa falha registrada torna o caminho NÃO
# confiável até o reload. O custo de recarregar é ~1 s e é a recuperação
# documentada; o de ignorar é perder um ciclo de selagem de ~40 min.
falha_conexao_odbc() {
  docker exec "$CONTAINER" asterisk -rx "odbc show $DSN" 2>/dev/null \
    | sed -n 's/.*Last fail connection attempt: \(.*\)$/\1/p' | sed -n '1p' | tr -d '\r'
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
  local ultima_falha
  ultima_falha="$(falha_conexao_odbc)"
  if [ -n "$ultima_falha" ]; then
    achado "motivo=odbc_ultima_tentativa_falhou ($ultima_falha) — backend registrado, mas a conexão ODBC não é confiável: o CDR para de gravar em silêncio"
    return 1
  fi
  return 0
}

case "$ACAO" in
  check)
    if diagnosticar; then
      achado "status=OK backend=AdaptiveODBC porta=$PORTA odbc=sem_falha_registrada"
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
      achado "status=OK backend=AdaptiveODBC porta=$PORTA odbc=sem_falha_registrada (nada a fazer)"
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
