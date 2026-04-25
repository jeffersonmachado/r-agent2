#!/bin/bash

# Script para atualizar configuração Apache do r-agent2 no servidor remoto
# Uso: ./scripts/fix-apache-config-remote.sh

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }
section() { echo -e "\n${BLUE}=== $1 ===${NC}\n"; }

# Variáveis
JUMP_HOST="10.10.2.9"
REMOTE_HOST="10.10.2.30"
REMOTE_USER="root"
SSH_PASSWORD="${SSH_PASSWORD:-resu100gabao}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# SSH command com jump host
SSH_OPTS="-o ProxyCommand=\"sshpass -p '$SSH_PASSWORD' ssh -o StrictHostKeyChecking=no -W %h:%p ${REMOTE_USER}@${JUMP_HOST}\" -o StrictHostKeyChecking=no"
SSH_CMD="sshpass -p '$SSH_PASSWORD' ssh $SSH_OPTS"

section "Atualizando Configuração Apache do r-agent2"

info "Configuração:"
echo "  Jump Host: $JUMP_HOST"
echo "  Servidor: $REMOTE_HOST"
echo "  Apache Container: secure-httpd"
echo ""

# Teste conexão
section "Testando Conectividade"
if ! eval "$SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} \"echo 'OK'\" &>/dev/null"; then
    error "SSH falhou"
    exit 1
fi
info "✅ SSH OK"
echo ""

# Criar arquivo temporário com a nova config
TEMP_FILE="/tmp/r-agent2-vhost-update.conf"

# Config corrigida para Docker
cat > "$TEMP_FILE" <<'EOF'
# ============================================================================
# Configuração Apache para r-agent2 (Apache em container na rede Docker)
# Data: 2026-04-23
# Descrição: Proxy reverso para r-agent2 com upstreams Docker
# ============================================================================

# WebSocket do r-agent2 (tempo real)
# IMPORTANTE: Deve vir ANTES do ProxyPass geral para upgrade correto
ProxyPass        "/r-agent2/ws"  "ws://r-agent2-api-prod:3000/api/ws"
ProxyPassReverse "/r-agent2/ws"  "ws://r-agent2-api-prod:3000/api/ws"
ProxyPass        "/r-agent2/api/ws"  "ws://r-agent2-api-prod:3000/api/ws"
ProxyPassReverse "/r-agent2/api/ws"  "ws://r-agent2-api-prod:3000/api/ws"

# API HTTP do r-agent2
ProxyPass        "/r-agent2/api/"  "http://r-agent2-api-prod:3000/api/" nocanon
ProxyPassReverse "/r-agent2/api/"  "http://r-agent2-api-prod:3000/api/"

# Assets e imagens do r-agent2
ProxyPass        "/r-agent2/assets"  "http://r-agent2-frontend-prod:80/assets" nocanon
ProxyPassReverse "/r-agent2/assets"  "http://r-agent2-frontend-prod:80/assets"
ProxyPass        "/r-agent2/images"  "http://r-agent2-frontend-prod:80/images" nocanon
ProxyPassReverse "/r-agent2/images"  "http://r-agent2-frontend-prod:80/images"

# Frontend r-agent2 (SPA React)
ProxyPass        "/r-agent2"  "http://r-agent2-frontend-prod:80" nocanon
ProxyPassReverse "/r-agent2"  "http://r-agent2-frontend-prod:80"

# Headers para WebSocket
<LocationMatch "^/r-agent2/(api/)?ws">
    ProxyPassReverse "ws://r-agent2-api-prod:3000/api/ws"
    ProxyPreserveHost On
</LocationMatch>

# Cookies
ProxyPassReverseCookiePath "/" "/r-agent2/"
EOF

info "Arquivo de configuração preparado: $TEMP_FILE"
echo ""

# Copiar arquivo para o servidor remoto
section "Copiando Configuração para Servidor Remoto"
info "Copiando para /tmp/r-agent2-vhost-update.conf no servidor..."

sshpass -p "$SSH_PASSWORD" scp \
    -o ProxyCommand="sshpass -p '$SSH_PASSWORD' ssh -o StrictHostKeyChecking=no -W %h:%p ${REMOTE_USER}@${JUMP_HOST}" \
    -o StrictHostKeyChecking=no \
    "$TEMP_FILE" \
    "${REMOTE_USER}@${REMOTE_HOST}:/tmp/r-agent2-vhost-update.conf" 2>&1 | grep -v "^Permanently\|^Warning" || true

if [ ${PIPESTATUS[0]} -ne 0 ]; then
    error "SCP falhou"
    exit 1
fi

info "✅ Arquivo copiado"
echo ""

# Atualizar dentro do container Apache
section "Atualizando Configuração no Container Apache"
info "Atualizando /usr/local/apache2/conf/vhosts/00-results.conf..."

# Backup da config atual
eval "$SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} \"docker exec secure-httpd cp /usr/local/apache2/conf/vhosts/00-results.conf /usr/local/apache2/conf/vhosts/00-results.conf.backup.$(date +%Y%m%d-%H%M%S)\"" 2>&1 | tail -5
info "✅ Backup criado"

# Substituir apenas a seção do r-agent2
eval "$SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} \"docker exec secure-httpd sh -c 'cat /tmp/r-agent2-vhost-update.conf > /usr/local/apache2/conf/vhosts/00-results.conf'\"" 2>&1 | tail -5
info "✅ Configuração atualizada"
echo ""

# Testar configuração do Apache
section "Validando Configuração Apache"
info "Executando apache2ctl configtest..."

CONFIG_TEST=$(eval "$SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} \"docker exec secure-httpd apachectl configtest 2>&1\"")
if echo "$CONFIG_TEST" | grep -q "Syntax OK"; then
    info "✅ Configuração válida"
else
    warn "⚠️  Possível problema na configuração:"
    echo "$CONFIG_TEST"
fi
echo ""

# Reload Apache
section "Recarregando Apache"
info "Executando graceful reload..."

eval "$SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} \"docker exec secure-httpd apachectl graceful\"" 2>&1 | tail -10
if [ ${PIPESTATUS[0]} -eq 0 ]; then
    info "✅ Apache recarregado"
else
    error "Reload falhou, tentando restart..."
    eval "$SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} \"docker restart secure-httpd\"" 2>&1 | tail -5
    if [ ${PIPESTATUS[0]} -eq 0 ]; then
        info "✅ Container reiniciado"
    else
        error "Restart também falhou"
        exit 1
    fi
fi
echo ""

# Testar proxy
section "Testando Proxy do r-agent2"
info "Aguardando Apache ficar pronto..."
sleep 2

info "Testando /r-agent2/api/ via localhost..."
CURL_TEST=$(eval "$SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} \"curl -s -o /dev/null -w '%{http_code}' http://localhost/r-agent2/api/system/info 2>&1\"")
echo "  Status HTTP: $CURL_TEST"

if [ "$CURL_TEST" = "200" ] || [ "$CURL_TEST" = "401" ] || [ "$CURL_TEST" = "403" ]; then
    info "✅ Proxy funcional"
else
    warn "⚠️  Status inesperado: $CURL_TEST"
fi
echo ""

section "✅ Configuração Concluída!"
echo ""
info "Próximos passos:"
echo "  1. Testar https://www.results.com.br/r-agent2/"
echo "  2. Verificar logs: docker logs -f secure-httpd"
echo "  3. Se houver problemas, rollback com:"
echo "     docker exec secure-httpd cp /usr/local/apache2/conf/vhosts/00-results.conf.backup.* /usr/local/apache2/conf/vhosts/00-results.conf"
echo ""

# Limpar arquivo temporário
rm -f "$TEMP_FILE"
