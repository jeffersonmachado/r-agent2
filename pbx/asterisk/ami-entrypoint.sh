#!/bin/sh
# ami-entrypoint.sh — injeta a credencial e a ACL do AMI ANTES do Asterisk subir.
#
# POR QUE ESTE ARQUIVO EXISTE
#
# O segredo do AMI estava literal em `pbx/asterisk/etc/asterisk/manager.conf`,
# versionado no repositório. Junto com a exposição de rede, isso permitiu que o
# container de pesquisa (que baixa conteúdo ARBITRÁRIO da internet) autenticasse
# no AMI com privilégio `system,all` — controle total do PBX. Ver
# `AI_MEMORY/security-finding-pbx-ami-exposure.md`.
#
# A tentativa anterior usou `${ENV(AMI_SECRET)}` no manager.conf. MEDIDO: com
# literal o usuário existe (`manager show user ragent2` -> secret: <Set>), com
# `${ENV(...)}` a seção inteira é descartada e o AMI deixa de existir. Não usar.
#
# O mecanismo que FUNCIONA (medido em 2026-09-19 com container de prova) é
# `#include`: o manager.conf inclui `conf/manager-ami.conf`, e é este script que
# gera esse arquivo a partir do ambiente. `conf/` já é volume gravável no
# compose (compartilhado com os contextos realtime gerados pela API).
#
# FAIL-CLOSED: sem AMI_SECRET o container NÃO sobe. Um default aqui seria uma
# credencial publicada — foi exatamente o que o commit anterior tentou consertar
# e não conseguiu.

set -eu

AMI_INCLUDE_DIR="${AMI_INCLUDE_DIR:-/etc/asterisk/conf}"
AMI_INCLUDE_FILE="${AMI_INCLUDE_DIR}/manager-ami.conf"
AMI_USERNAME="${AMI_USERNAME:-ragent2}"
AMI_PERMIT_CIDR="${AMI_PERMIT_CIDR:-172.30.0.0/16}"

if [ -z "${AMI_SECRET:-}" ]; then
  echo "[ami-entrypoint] ERRO: AMI_SECRET não definida." >&2
  echo "[ami-entrypoint] O segredo do AMI não tem default: gere um valor forte" >&2
  echo "[ami-entrypoint] (ex: openssl rand -hex 32) e defina AMI_SECRET." >&2
  exit 1
fi

# Validação defensiva: um CIDR malformado viraria `permit = lixo`, e uma ACL
# inválida pode ser interpretada como "sem restrição" — o oposto do objetivo.
case "${AMI_PERMIT_CIDR}" in
  *[!0-9./]*) echo "[ami-entrypoint] ERRO: AMI_PERMIT_CIDR inválido: ${AMI_PERMIT_CIDR}" >&2; exit 1 ;;
esac
case "${AMI_PERMIT_CIDR}" in
  */*) : ;;
  *) echo "[ami-entrypoint] ERRO: AMI_PERMIT_CIDR precisa de prefixo CIDR: ${AMI_PERMIT_CIDR}" >&2; exit 1 ;;
esac

mkdir -p "${AMI_INCLUDE_DIR}"

# Escrita atômica: o Asterisk pode recarregar a qualquer momento; um arquivo
# meio escrito produziria uma ACL parcial.
umask 077
cat > "${AMI_INCLUDE_FILE}.tmp" <<EOF
; GERADO em runtime por ami-entrypoint.sh a partir do ambiente.
; NÃO versionar: este arquivo contém o segredo do AMI.
; A ordem das regras importa: a ÚLTIMA correspondência decide (medido), por isso
; o \`deny\` final é o que fecha.
[${AMI_USERNAME}]
secret = ${AMI_SECRET}
read = all
write = all
deny = 0.0.0.0/0.0.0.0
permit = 127.0.0.1/255.255.255.255
permit = ${AMI_PERMIT_CIDR}
EOF

mv "${AMI_INCLUDE_FILE}.tmp" "${AMI_INCLUDE_FILE}"

# O usuário `asterisk` precisa ler; se não existir, root lê de qualquer forma.
chmod 0640 "${AMI_INCLUDE_FILE}" 2>/dev/null || true
chgrp asterisk "${AMI_INCLUDE_FILE}" 2>/dev/null || true

echo "[ami-entrypoint] manager-ami.conf gerado (usuário=${AMI_USERNAME}, permit=${AMI_PERMIT_CIDR})"

# Entrega o controle para o entrypoint ORIGINAL da imagem, preservando o
# `command:` do compose. Se a imagem não tiver o entrypoint esperado, executa o
# comando direto — mas alto, para o fallback não passar em silêncio.
if [ -x /usr/local/bin/entrypoint.sh ]; then
  exec /usr/local/bin/entrypoint.sh "$@"
fi
echo "[ami-entrypoint] AVISO: /usr/local/bin/entrypoint.sh ausente; executando comando direto" >&2
exec "$@"
