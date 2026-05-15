#!/bin/bash

# Script para hotpatch da API sem recriar o container
# Uso: ./scripts/docker-deploy-api-only-hotpatch.sh [--host HOST] [--user USER] [--password PASSWORD]
# 
# Este script copia apenas os arquivos da API para o container em execução,
# instala dependências e reinicia apenas o serviço da API (sem rebuild).
# Muito mais rápido do que deploy:remote:ssh:api completo (~2-5 min vs ~15-20 min).

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Função para imprimir mensagens
info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

section() {
    echo -e "\n${BLUE}=== $1 ===${NC}\n"
}

# Variáveis padrão
DEPLOY_HOST="${DEPLOY_HOST:-10.10.2.30}"
SSH_PASSWORD="${SSH_PASSWORD:?Erro: SSH_PASSWORD não definida}"
USE_SSH_DIRECT="${DEPLOY_USE_SSH_DIRECT:-false}"

# Detecta diretório do projeto automaticamente
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$PROJECT_ROOT"

REMOTE_HOST="${DEPLOY_HOST}"
REMOTE_USER="${DEPLOY_USER:-root}"
REMOTE_DIR="${DEPLOY_DIR:-/opt/results/ria/r-agent2}"

# Timeouts aumentados (SSH pode ser lento em redes lentas)
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=60 -o ServerAliveInterval=30 -o ServerAliveCountMax=60 -o TCPKeepAlive=yes"

if [ "$USE_SSH_DIRECT" = "true" ]; then
    info "Modo SSH direto habilitado"
    SSH_CMD="ssh $SSH_OPTS"
    RSYNC_SSH_TRANSPORT="ssh $SSH_OPTS"
else
    if [ -z "$SSHPASS" ]; then
        export SSHPASS="$SSH_PASSWORD"
    fi

    if ! command -v sshpass &> /dev/null; then
        error "sshpass não está instalado"
        exit 1
    fi

    export SSHPASS="$SSH_PASSWORD"
    SSH_CMD="sshpass -e ssh $SSH_OPTS"
    RSYNC_SSH_TRANSPORT="sshpass -e ssh $SSH_OPTS"
fi

# Processa argumentos
while [[ $# -gt 0 ]]; do
    case $1 in
        --host)
            REMOTE_HOST="$2"
            shift 2
            ;;
        --user)
            REMOTE_USER="$2"
            shift 2
            ;;
        --password)
            SSH_PASSWORD="$2"
            if [ "$USE_SSH_DIRECT" != "true" ]; then
                export SSHPASS="$SSH_PASSWORD"
            fi
            shift 2
            ;;
        *)
            error "Argumento desconhecido: $1"
            echo "Uso: $0 [--host HOST] [--user USER] [--password PASSWORD]"
            exit 1
            ;;
    esac
done

cd "$ROOT_DIR"

section "Hotpatch API - Sem Rebuild de Container"

info "Configuração:"
echo "  Host: $REMOTE_HOST"
echo "  User: $REMOTE_USER"
echo "  Diretório: $REMOTE_DIR"
echo "  Método: Cópia de arquivos + npm ci no container"

# Testa conexão SSH
section "Testando Conexão SSH"
info "Conectando a ${REMOTE_USER}@${REMOTE_HOST}:22 (timeout=60s)..."

SSH_TEST=$(eval "$SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} \"echo 'SSH_OK'\"" 2>&1)
if [ $? -ne 0 ]; then
    error "SSH falhou para ${REMOTE_USER}@${REMOTE_HOST}"
    echo "Erro: $SSH_TEST"
    echo ""
    error "Dicas de troubleshoot:"
    echo "  1. Verifique: ssh -v -o ConnectTimeout=60 root@10.10.2.30"
    echo "  2. Verifique firewall/rede: nc -zv 10.10.2.30 22"
    echo "  3. Verifique credenciais: ssh-copy-id root@10.10.2.30"
    exit 1
fi

info "✅ SSH conectado"
echo ""

# Verifica docker e docker-compose
section "Verificando Docker no Servidor"
DOCKER_VERSION=$($SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "docker --version 2>/dev/null || echo 'NOT_FOUND'" 2>/dev/null | head -1)
if echo "$DOCKER_VERSION" | grep -q "NOT_FOUND"; then
    error "Docker não encontrado no servidor"
    exit 1
fi
info "✅ Docker: $(echo "$DOCKER_VERSION" | head -c 50)"

COMPOSE_CMD=$($SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "docker-compose --version 2>/dev/null >/dev/null && echo 'docker-compose' || echo 'docker compose'" 2>/dev/null | tail -1)
if [ -z "$COMPOSE_CMD" ]; then
    error "docker-compose não disponível"
    exit 1
fi
info "✅ docker-compose pronto"
echo ""

# Verifica container da API em execução
section "Verificando Container da API"
CONTAINER_CHECK=$($SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "docker ps --format '{{.Names}}' | grep -i 'api-prod\|api$' | head -1" 2>/dev/null | tail -1)
if [ -z "$CONTAINER_CHECK" ]; then
    error "Container de API não está em execução"
    error "Containers disponíveis:"
    $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "docker ps --format 'table {{.Names}}\t{{.Status}}'" 2>&1 | head -10
    exit 1
fi

info "✅ Container encontrado: $CONTAINER_CHECK"
echo ""

# Sincroniza apenas arquivos da API
section "Sincronizando Arquivos da API"
info "Copiando: api/, config/, contracts/, lib/, package*.json..."

EXCLUDE_LIST=(
    "--exclude=node_modules"
    "--exclude=.git"
    "--exclude=.env"
    "--exclude=.DS_Store"
    "--exclude=*.log"
    "--exclude=__pycache__"
    "--exclude=dist"
    "--exclude=build"
    "--exclude=.vscode"
    "--exclude=.idea"
)

# Apenas os diretórios mínimos para API
SYNC_PATHS=(
    "${ROOT_DIR}/docker-compose.prod.yml"
    "${ROOT_DIR}/api"
    "${ROOT_DIR}/config"
    "${ROOT_DIR}/contracts"
    "${ROOT_DIR}/lib"
    "${ROOT_DIR}/tools"
    "${ROOT_DIR}/package.json"
    "${ROOT_DIR}/package-lock.json"
)

echo "  Paths sincronizados:"
echo "    - docker-compose.prod.yml"
echo "    - api/"
echo "    - config/"
echo "    - contracts/"
echo "    - lib/"
echo "    - tools/"
echo "    - package*.json"
echo ""

info "Executando rsync (pode levar alguns segundos)..."
rsync -avz --delete \
    "${EXCLUDE_LIST[@]}" \
    -e "$RSYNC_SSH_TRANSPORT" \
    "${SYNC_PATHS[@]}" \
    "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/" \
    2>&1 | tee /tmp/rsync-hotpatch.log | tail -10

RSYNC_EXIT=${PIPESTATUS[0]}
if [ $RSYNC_EXIT -ne 0 ]; then
    error "rsync falhou com exit code $RSYNC_EXIT"
    echo "Log completo em: /tmp/rsync-hotpatch.log"
    exit 1
fi

info "✅ Arquivos sincronizados"
echo ""

# Instala dependências e reinicia no container
section "Instalando Dependências no Container"
info "Executando npm ci --omit=dev no container $CONTAINER_CHECK..."

CONTAINER_CMD="cd /app && npm ci --omit=dev"
$SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "docker exec $CONTAINER_CHECK bash -c '$CONTAINER_CMD'" 2>&1 | tail -30
INSTALL_EXIT=${PIPESTATUS[0]}

if [ $INSTALL_EXIT -ne 0 ]; then
    error "npm ci falhou no container com exit code $INSTALL_EXIT"
    warn "Tente reiniciar o container manualmente:"
    warn "  docker-compose -f docker-compose.prod.yml restart api"
    exit 1
fi

info "✅ Dependências instaladas"
echo ""

# Reinicia apenas o serviço da API (sem recriar volumes/config)
section "Reiniciando Serviço da API"
info "Reiniciando container (sem rebuild)..."

RESTART_CMD="cd ${REMOTE_DIR} && $COMPOSE_CMD -f docker-compose.prod.yml restart api"
$SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "$RESTART_CMD" 2>&1
RESTART_EXIT=$?

if [ $RESTART_EXIT -ne 0 ]; then
    error "Reinício do container falhou com exit code $RESTART_EXIT"
    exit 1
fi

info "✅ Container reiniciado"
echo ""

# Aguarda container ficar pronto
section "Aguardando Container Ficar Pronto"
info "Verificando saúde do container..."

for i in {1..30}; do
    HEALTH=$($SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "docker inspect --format='{{.State.Status}}' $CONTAINER_CHECK 2>/dev/null || echo 'error'" 2>&1)
    if [ "$HEALTH" = "running" ]; then
        info "✅ Container está running (tentativa $i/30)"
        break
    fi
    if [ $i -eq 30 ]; then
        error "Container não ficou pronto após 30 segundos"
        echo "Status final: $HEALTH"
        exit 1
    fi
    sleep 1
    if [ $((i % 5)) -eq 0 ]; then
        info "Aguardando container... ($i/30)"
    fi
done

echo ""
section "✅ Hotpatch Concluído!"
echo ""
info "Downtime estimado: ~30 segundos (npm ci + restart)"
info "Para verificar status:"
echo "  - Logs: docker logs -f $CONTAINER_CHECK"
echo "  - Status: docker ps | grep $CONTAINER_CHECK"
echo ""
