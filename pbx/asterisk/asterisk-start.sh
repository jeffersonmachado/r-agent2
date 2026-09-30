#!/bin/sh
# Start do container Asterisk: renderiza o manager.conf a partir do template
# (segredo + ACL no MESMO bloco) no /etc/asterisk GRAVÁVEL (tmpfs montado pelo
# compose) e só então sobe o Asterisk. Fail-closed: sem AMI_SECRET o container
# não sobe — o AMI nunca roda com segredo default.
#
# Por que o render acontece aqui e não no manager.conf (medido 2026-09-19, ver
# AI_MEMORY/security-finding-pbx-ami-exposure.md):
#   - `secret = ${ENV(AMI_SECRET)}` faz o parser descartar a SEÇÃO inteira;
#   - `#include` com o segredo reinicia a seção e a ACL fica INERTE.
# O config estático do repositório é montado ro em /etc/asterisk-static; o
# manager.conf versionado NÃO EXISTE mais — só o template.
set -e

STATIC_ETC="${ASTERISK_STATIC_ETC:-/etc/asterisk-static}"
TARGET_ETC="${ASTERISK_TARGET_ETC:-/etc/asterisk}"
TEMPLATE="${ASTERISK_MANAGER_TEMPLATE:-$STATIC_ETC/manager.conf.template}"

if [ -z "${AMI_SECRET:-}" ]; then
  echo "asterisk[ami]: AMI_SECRET ausente; o AMI nao sobe com segredo default (fail-closed)" >&2
  exit 1
fi

if [ ! -f "$TEMPLATE" ]; then
  echo "asterisk[ami]: template $TEMPLATE nao encontrado (mount do config estatico quebrado?)" >&2
  exit 1
fi

for f in "$STATIC_ETC"/*; do
  base="${f##*/}"
  case "$base" in
    conf)
      # Em prod, /etc/asterisk/conf e um volume compartilhado com a API
      # (contextos realtime gerados em runtime): nunca sobrescrever.
      [ -e "$TARGET_ETC/conf" ] || cp -a "$f" "$TARGET_ETC/conf"
      ;;
    manager.conf|manager.conf.template)
      : # manager.conf NASCE renderizado do template; nunca copiar versao estatica
      ;;
    *)
      cp -a "$f" "$TARGET_ETC/"
      ;;
  esac
done

umask 077
# bindaddr: 0.0.0.0 dentro de netns de container (compose) é seguro — a
# publicação controla a exposição. Em host-network o start é invocado com
# AMI_BINDADDR=127.0.0.1 para o AMI não vazar pelo gateway docker0.
AMI_BINDADDR="${AMI_BINDADDR:-0.0.0.0}"
# Rede autorizada na ACL do AMI: MESMA variável que fixa a subnet da rede
# default nos composes. Default histórico 172.30.0.0/16; fora dele a ACL
# (deny final, primeira correspondência decide) derruba a própria API.
AMI_ACL_PLATFORM_NET="${AMI_ACL_PLATFORM_NET:-172.30.0.0/16}"
# envsubst só enxerga variáveis EXPORTADAS: sem export, os defaults acima
# viram string vazia (bindaddr) ou literal ${...} (permit) — e o parser do
# Asterisk descarta a seção [ragent2] inteira ("There is no manager called
# ragent2", medido 2026-09-20 no test stack).
export AMI_BINDADDR AMI_ACL_PLATFORM_NET
envsubst '$AMI_SECRET $AMI_BINDADDR $AMI_ACL_PLATFORM_NET' < "$TEMPLATE" > "$TARGET_ETC/manager.conf"
chmod 600 "$TARGET_ETC/manager.conf"
echo "asterisk[ami]: manager.conf renderizado do template (segredo + ACL no mesmo bloco; valor nao exibido)"

# DSN ODBC dirigido por ambiente (opt-in). Sem estes valores o container usa o
# /etc/odbc.ini montado do repositório, exatamente como antes — prod e test não mudam.
PBX_ODBC_PORT="${PBX_ODBC_PORT:-5432}"
if [ -n "${PBX_ODBC_HOST:-}" ] && [ -n "${PBX_ODBC_DB:-}" ] && [ -n "${PBX_ODBC_USER:-}" ] && [ -n "${PBX_ODBC_PASSWORD:-}" ]; then
  envsubst < /etc/asterisk-odbc.template > /tmp/odbc.ini
  export ODBCINI=/tmp/odbc.ini
  echo "asterisk[odbc]: DSN renderizado do template (host=$PBX_ODBC_HOST port=$PBX_ODBC_PORT db=$PBX_ODBC_DB user=$PBX_ODBC_USER)"
else
  echo "asterisk[odbc]: PBX_ODBC_* ausente/parcial; usando /etc/odbc.ini montado (default canonico)"
fi

# Preflight de conectividade do DSN antes de subir o Asterisk.
# res_odbc resolve o DSN no load (pre-connect => yes) e, se o Postgres ainda nao
# estiver acessivel nesse instante, o backend de CDR (cdr_adaptive_odbc) fica
# sem conexao e PARA de gravar CDR em silencio — nenhuma retentativa o recupera,
# so um `module reload` manual. Medido em 2026-09-30: falha de conexao gravada
# no boot (13:22) e ~10h de chamadas atendidas sem nenhum CDR real, zerando o
# sinal `cdr` da prova PBX prod-like e travando o converge de governanca.
# Esperar a porta aqui elimina o race de boot.
if [ -n "${PBX_ODBC_HOST:-}" ] && [ -n "${PBX_ODBC_PORT:-}" ] && command -v bash >/dev/null 2>&1; then
  _odbc_wait="${PBX_ODBC_WAIT_ATTEMPTS:-60}"
  _odbc_try=0
  while [ "$_odbc_try" -lt "$_odbc_wait" ]; do
    if bash -c "exec 3<>/dev/tcp/${PBX_ODBC_HOST}/${PBX_ODBC_PORT}" 2>/dev/null; then
      echo "asterisk[odbc]: Postgres acessivel em ${PBX_ODBC_HOST}:${PBX_ODBC_PORT} (tentativa $((_odbc_try + 1)))"
      break
    fi
    _odbc_try=$((_odbc_try + 1))
    sleep 1
  done
  if [ "$_odbc_try" -ge "$_odbc_wait" ]; then
    echo "asterisk[odbc]: AVISO Postgres inacessivel em ${PBX_ODBC_HOST}:${PBX_ODBC_PORT} apos ${_odbc_wait}s; CDR nao gravara ate o banco responder" >&2
  fi
fi

exec asterisk -f -vvvvv -d
