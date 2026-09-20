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
envsubst '$AMI_SECRET $AMI_BINDADDR' < "$TEMPLATE" > "$TARGET_ETC/manager.conf"
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

exec asterisk -f -vvvvv -d
