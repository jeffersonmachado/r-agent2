#!/bin/bash

# Script para rebuild rápido da API (alternativa ao hotpatch)
# Uso: ./scripts/docker-deploy-api-only-quickbuild.sh [--host HOST] [--user USER] [--password PASSWORD]
# 
# Este script faz rebuild APENAS da imagem da API (sem os outros serviços).
# - Sincroniza: api/, config/, contracts/, lib/, package*.json, Dockerfile*
# - Build: Apenas API (não toca em frontend/rag-service/redis)
# - Reinicia: Apenas API
# - Tempo estimado: 3-8 minutos (vs 15-20 min do deploy completo)

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
SSH_PASSWORD="${SSH_PASSWORD:-resu100gabao}"
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

section "Quick Build API - Apenas a Imagem da API"

info "Configuração:"
echo "  Host: $REMOTE_HOST"
echo "  User: $REMOTE_USER"
echo "  Diretório: $REMOTE_DIR"
echo "  Método: Sincroniza API + quickbuild"

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

# Verifica docker
section "Verificando Docker"
DOCKER_VERSION=$($SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "docker --version 2>/dev/null || echo 'NOT_FOUND'" 2>&1 | head -1)
if echo "$DOCKER_VERSION" | grep -q "NOT_FOUND"; then
    error "Docker não encontrado no servidor"
    exit 1
fi
info "✅ Docker: $(echo "$DOCKER_VERSION" | head -c 50)"

COMPOSE_CMD=$($SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "docker-compose --version 2>/dev/null >/dev/null && echo 'docker-compose' || echo 'docker compose'" 2>&1)
if [ -z "$COMPOSE_CMD" ]; then
    error "docker-compose não disponível"
    exit 1
fi
info "✅ docker-compose pronto"
echo ""

# Sincroniza apenas arquivos da API + Dockerfiles
section "Sincronizando Arquivos da API"
info "Copiando: api/, config/, contracts/, lib/, Dockerfile*, package*.json..."

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

# Apenas o necessário para rebuild da API (com trailing /)
SYNC_PATHS=(
    "${ROOT_DIR}/api/"
    "${ROOT_DIR}/config/"
    "${ROOT_DIR}/contracts/"
    "${ROOT_DIR}/lib/"
    "${ROOT_DIR}/package.json"
    "${ROOT_DIR}/package-lock.json"
)

echo "  Paths sincronizados:"
echo "    - api/"
echo "    - config/"
echo "    - contracts/"
echo "    - lib/"
echo "    - package*.json"
echo ""

info "Executando rsync (pode levar alguns segundos)..."
rsync -avz --delete \
    "${EXCLUDE_LIST[@]}" \
    -e "$RSYNC_SSH_TRANSPORT" \
    "${SYNC_PATHS[@]}" \
    "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/" \
    2>&1 | tee /tmp/rsync-quickbuild.log | tail -10

RSYNC_EXIT=${PIPESTATUS[0]}
if [ $RSYNC_EXIT -ne 0 ]; then
    error "rsync falhou com exit code $RSYNC_EXIT"
    echo "Log completo em: /tmp/rsync-quickbuild.log"
    exit 1
fi

info "✅ Arquivos sincronizados"
echo ""

# Build apenas da API no servidor
section "Construindo Imagem da API"
info "Executando docker build para a API (isso pode levar 3-5 minutos)..."
warn "⚠️  Build em execução... aguarde"

# Build da imagem base primeiro (se não existir, docker reutiliza cache)
info "Construindo imagem base da API..."
BASE_BUILD_CMD="cd ${REMOTE_DIR} && docker build --build-arg BUILDKIT_INLINE_CACHE=1 -t r-agent2-api-base:test -f api/Dockerfile.base . 2>&1"
$SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "$BASE_BUILD_CMD" | tail -30
BASE_EXIT=${PIPESTATUS[0]}

if [ $BASE_EXIT -ne 0 ]; then
    error "Build da imagem base falhou com exit code $BASE_EXIT"
    exit 1
fi

info "✅ Imagem base construída"
echo ""

# Build da API
info "Construindo imagem da API..."
API_BUILD_CMD="cd ${REMOTE_DIR} && docker build --build-arg BUILDKIT_INLINE_CACHE=1 -t r-agent2-api:latest -f api/Dockerfile . 2>&1"
$SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "$API_BUILD_CMD" | tail -30
API_EXIT=${PIPESTATUS[0]}

if [ $API_EXIT -ne 0 ]; then
    error "Build da API falhou com exit code $API_EXIT"
    exit 1
fi

info "✅ Imagem da API construída"
echo ""

# Reinicia apenas o serviço da API
section "Reiniciando Serviço da API"
info "Reiniciando container com a nova imagem..."

RESTART_CMD="cd ${REMOTE_DIR} && $COMPOSE_CMD -f docker-compose.prod.yml up -d --no-deps api"
$SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "$RESTART_CMD" 2>&1
RESTART_EXIT=$?

if [ $RESTART_EXIT -ne 0 ]; then
    error "Reinício falhou com exit code $RESTART_EXIT"
    exit 1
fi

info "✅ Container reiniciado com nova imagem"
echo ""

# Aguarda container ficar pronto
section "Aguardando Container Ficar Pronto"
info "Verificando saúde do container..."

for i in {1..30}; do
    HEALTH=$($SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "docker inspect --format='{{.State.Status}}' r-agent2-api-prod 2>/dev/null || echo 'error'" 2>&1)
    if [ "$HEALTH" = "running" ]; then
        info "✅ Container está running (tentativa $i/30)"
        break
    fi
    if [ $i -eq 30 ]; then
        error "Container não ficou pronto após 30 segundos"
        echo "Status: $HEALTH"
        exit 1
    fi
    sleep 1
    if [ $((i % 5)) -eq 0 ]; then
        info "Aguardando container... ($i/30)"
    fi
done

echo ""
section "✅ Build Rápido Concluído!"
echo ""
info "Tempo estimado: 3-8 minutos (sincronização + rebuild + restart)"
info "Para verificar status:"
echo "  - Logs: docker logs -f r-agent2-api-prod"
echo "  - Status: docker ps | grep r-agent2-api"
echo ""
