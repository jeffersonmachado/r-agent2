#!/bin/bash

# Script para build e push das imagens Docker no servidor remoto
# Uso: ./scripts/docker-push-remote.sh [--host HOST] [--user USER] [--registry REGISTRY] [--tag TAG] [--latest]

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
REMOTE_HOST="${DEPLOY_HOST:-}"
REMOTE_USER="${DEPLOY_USER:-root}"
REMOTE_DIR="${DEPLOY_DIR:-/opt/r-agent2}"
REGISTRY="${DOCKER_REGISTRY:-}"
TAG="${DOCKER_TAG:-latest}"
PUSH_LATEST=false
IMAGE_PREFIX="r-agent2"
USE_SSH_KEY=false
SSH_KEY=""
SSH_PASSWORD="${SSH_PASSWORD:-}"
USE_SSHPASS=false

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
        --dir)
            REMOTE_DIR="$2"
            shift 2
            ;;
        --registry)
            REGISTRY="$2"
            shift 2
            ;;
        --tag)
            TAG="$2"
            shift 2
            ;;
        --latest)
            PUSH_LATEST=true
            shift
            ;;
        --prefix)
            IMAGE_PREFIX="$2"
            shift 2
            ;;
        --ssh-key)
            SSH_KEY="$2"
            USE_SSH_KEY=true
            shift 2
            ;;
        --ssh-password)
            SSH_PASSWORD="$2"
            USE_SSHPASS=true
            shift 2
            ;;
        *)
            error "Argumento desconhecido: $1"
            echo "Uso: $0 [--host HOST] [--user USER] [--registry REGISTRY] [--tag TAG] [--latest] [--ssh-key KEY] [--ssh-password PASSWORD]"
            exit 1
            ;;
    esac
done

# PORTEIRO DE PUBLICAÇÃO (Fase 2 / MISSÃO C) — mesmo motivo de `docker-push.sh`: publicação
# remota de imagens também é PUBLICAÇÃO e não pode existir sem decisão canônica em GO definitivo.
. "$(dirname "${BASH_SOURCE[0]}")/governance/publication-gate.sh"
rap_publication_gate "docker-push-remote"

# Validação
if [ -z "$REMOTE_HOST" ]; then
    error "Host remoto não especificado."
    echo "Use --host ou export DEPLOY_HOST=seu-servidor.com"
    exit 1
fi

# Configura SSH
SSH_OPTS=""
SSH_PASS_CMD=""

if [ "$USE_SSHPASS" = true ] && [ -n "$SSH_PASSWORD" ]; then
    if ! command -v sshpass &> /dev/null; then
        error "sshpass não está instalado. Instale com: apt-get install sshpass ou yum install sshpass"
        exit 1
    fi
    SSH_PASS_CMD="sshpass -p '${SSH_PASSWORD}'"
    SSH_OPTS="-o StrictHostKeyChecking=no"
elif [ "$USE_SSH_KEY" = true ] && [ -n "$SSH_KEY" ]; then
    SSH_OPTS="-i $SSH_KEY"
fi

SSH_CMD="${SSH_PASS_CMD} ssh ${SSH_OPTS} ${REMOTE_USER}@${REMOTE_HOST}"
SCP_CMD="${SSH_PASS_CMD} scp ${SSH_OPTS}"

# Funções auxiliares para executar comandos SSH/SCP
ssh_exec() {
    eval "$SSH_CMD \"$1\""
}

scp_exec() {
    eval "$SCP_CMD $*"
}

# Diretório raiz do projeto
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

section "Build e Push Docker no Servidor Remoto"

info "Configuração:"
echo "  Host: $REMOTE_HOST"
echo "  User: $REMOTE_USER"
echo "  Diretório: $REMOTE_DIR"
echo "  Registry: ${REGISTRY:-Docker Hub (padrão)}"
echo "  Tag: $TAG"
echo "  Prefix: $IMAGE_PREFIX"
echo "  Push latest: $PUSH_LATEST"

# Testa conexão SSH
section "Testando Conexão SSH"
info "Testando conexão com $REMOTE_HOST..."
if ! ssh_exec "echo 'Conexão OK'" &> /dev/null; then
    error "Não foi possível conectar ao servidor remoto."
    error "Verifique:"
    echo "  - Host e usuário estão corretos"
    echo "  - SSH está configurado"
    echo "  - Chave SSH está autorizada (se usando)"
    exit 1
fi
info "Conexão SSH estabelecida!"

# Verifica Docker no servidor remoto
section "Verificando Docker no Servidor"
info "Verificando instalação do Docker..."
if ! ssh_exec "command -v docker &> /dev/null"; then
    error "Docker não está instalado no servidor remoto."
    exit 1
fi
info "Docker encontrado!"

# Verifica se o projeto existe no servidor
section "Verificando Projeto no Servidor"
info "Verificando se o projeto existe em $REMOTE_DIR..."

# Cria diretório base
ssh_exec "mkdir -p ${REMOTE_DIR}"

# Copia projeto usando tar (mais eficiente)
info "Copiando projeto para o servidor (isso pode levar alguns minutos)..."
cd "$ROOT_DIR"
tar --exclude='node_modules' \
    --exclude='.git' \
    --exclude='coverage' \
    --exclude='dist' \
    --exclude='build' \
    --exclude='*.log' \
    -czf /tmp/r-agent2-build.tar.gz \
    api/ frontend/ rag-service/ \
    package.json package-lock.json \
    docker-compose.prod.yml env.example 2>/dev/null || \
tar --exclude='node_modules' \
    --exclude='.git' \
    --exclude='coverage' \
    --exclude='dist' \
    --exclude='build' \
    --exclude='*.log' \
    -czf /tmp/r-agent2-build.tar.gz \
    api/ frontend/ rag-service/ \
    package.json \
    docker-compose.prod.yml env.example

scp_exec /tmp/r-agent2-build.tar.gz ${REMOTE_USER}@${REMOTE_HOST}:/tmp/
ssh_exec "cd ${REMOTE_DIR} && tar -xzf /tmp/r-agent2-build.tar.gz && rm /tmp/r-agent2-build.tar.gz"
rm -f /tmp/r-agent2-build.tar.gz

info "Projeto copiado com sucesso!"

# Cria script de build e push no servidor
section "Criando Script de Build e Push no Servidor"
BUILD_PUSH_SCRIPT=$(cat <<'EOFBUILD'
#!/bin/bash
set -e

REGISTRY="${1:-}"
TAG="${2:-latest}"
IMAGE_PREFIX="${3:-r-agent2}"
PUSH_LATEST="${4:-false}"
REMOTE_DIR="${5:-/opt/r-agent2}"

cd "$REMOTE_DIR"

# Constrói nome completo da imagem
build_image_name() {
    local service=$1
    if [ -z "$REGISTRY" ]; then
        echo "${IMAGE_PREFIX}-${service}:${TAG}"
    else
        REGISTRY=$(echo "$REGISTRY" | sed 's|/$||')
        echo "${REGISTRY}/${IMAGE_PREFIX}-${service}:${TAG}"
    fi
}

# Constrói nome da imagem latest
build_latest_name() {
    local service=$1
    if [ -z "$REGISTRY" ]; then
        echo "${IMAGE_PREFIX}-${service}:latest"
    else
        REGISTRY=$(echo "$REGISTRY" | sed 's|/$||')
        echo "${REGISTRY}/${IMAGE_PREFIX}-${service}:latest"
    fi
}

echo "=== Build e Push R-Agent2 ==="
echo "Registry: ${REGISTRY:-Docker Hub}"
echo "Tag: $TAG"
echo "Push latest: $PUSH_LATEST"

# Login no registry se necessário
if [ -n "$REGISTRY" ] && [ "$REGISTRY" != "docker.io" ]; then
    echo "Fazendo login no registry..."
    docker login "$REGISTRY" || {
        echo "ERRO: Não foi possível fazer login no registry"
        exit 1
    }
fi

# Build e push da API
echo ""
echo "=== Build API ==="
API_IMAGE=$(build_image_name "api")
echo "Construindo: $API_IMAGE"
docker build -t "$API_IMAGE" -f api/Dockerfile .
if [ "$PUSH_LATEST" = "true" ]; then
    API_LATEST=$(build_latest_name "api")
    docker tag "$API_IMAGE" "$API_LATEST"
    echo "Tagged as: $API_LATEST"
fi

# Build e push do Frontend
echo ""
echo "=== Build Frontend ==="
FRONTEND_IMAGE=$(build_image_name "frontend")
echo "Construindo: $FRONTEND_IMAGE"
docker build -t "$FRONTEND_IMAGE" -f frontend/Dockerfile ./frontend
if [ "$PUSH_LATEST" = "true" ]; then
    FRONTEND_LATEST=$(build_latest_name "frontend")
    docker tag "$FRONTEND_IMAGE" "$FRONTEND_LATEST"
    echo "Tagged as: $FRONTEND_LATEST"
fi

# Build e push do RAG Service
echo ""
echo "=== Build RAG Service ==="
RAG_IMAGE=$(build_image_name "rag-service")
echo "Construindo: $RAG_IMAGE"
docker build -t "$RAG_IMAGE" -f rag-service/Dockerfile ./rag-service
if [ "$PUSH_LATEST" = "true" ]; then
    RAG_LATEST=$(build_latest_name "rag-service")
    docker tag "$RAG_IMAGE" "$RAG_LATEST"
    echo "Tagged as: $RAG_LATEST"
fi

# Push das imagens
echo ""
echo "=== Push das Imagens ==="
echo "Fazendo push de $API_IMAGE..."
docker push "$API_IMAGE"

if [ "$PUSH_LATEST" = "true" ]; then
    echo "Fazendo push de $API_LATEST..."
    docker push "$API_LATEST"
fi

echo "Fazendo push de $FRONTEND_IMAGE..."
docker push "$FRONTEND_IMAGE"

if [ "$PUSH_LATEST" = "true" ]; then
    echo "Fazendo push de $FRONTEND_LATEST..."
    docker push "$FRONTEND_LATEST"
fi

echo "Fazendo push de $RAG_IMAGE..."
docker push "$RAG_IMAGE"

if [ "$PUSH_LATEST" = "true" ]; then
    echo "Fazendo push de $RAG_LATEST..."
    docker push "$RAG_LATEST"
fi

echo ""
echo "=== Build e Push Concluído! ==="
echo "Imagens publicadas:"
echo "  - $API_IMAGE"
echo "  - $FRONTEND_IMAGE"
echo "  - $RAG_IMAGE"
if [ "$PUSH_LATEST" = "true" ]; then
    echo "  - $API_LATEST"
    echo "  - $FRONTEND_LATEST"
    echo "  - $RAG_LATEST"
fi
EOFBUILD
)

# Envia script para o servidor
echo "$BUILD_PUSH_SCRIPT" | ssh_exec "cat > ${REMOTE_DIR}/build-push.sh"
ssh_exec "chmod +x ${REMOTE_DIR}/build-push.sh"

# Executa build e push no servidor
section "Executando Build e Push no Servidor"
info "Executando build e push remoto..."
ssh_exec "cd ${REMOTE_DIR} && ./build-push.sh \"$REGISTRY\" \"$TAG\" \"$IMAGE_PREFIX\" \"$PUSH_LATEST\" \"$REMOTE_DIR\""

section "Build e Push Concluído!"

info "Imagens publicadas a partir do servidor $REMOTE_HOST:"
if [ -z "$REGISTRY" ]; then
    echo "  - ${IMAGE_PREFIX}-api:${TAG}"
    echo "  - ${IMAGE_PREFIX}-frontend:${TAG}"
    echo "  - ${IMAGE_PREFIX}-rag-service:${TAG}"
    if [ "$PUSH_LATEST" = true ]; then
        echo "  - ${IMAGE_PREFIX}-api:latest"
        echo "  - ${IMAGE_PREFIX}-frontend:latest"
        echo "  - ${IMAGE_PREFIX}-rag-service:latest"
    fi
else
    REGISTRY=$(echo "$REGISTRY" | sed 's|/$||')
    echo "  - ${REGISTRY}/${IMAGE_PREFIX}-api:${TAG}"
    echo "  - ${REGISTRY}/${IMAGE_PREFIX}-frontend:${TAG}"
    echo "  - ${REGISTRY}/${IMAGE_PREFIX}-rag-service:${TAG}"
    if [ "$PUSH_LATEST" = true ]; then
        echo "  - ${REGISTRY}/${IMAGE_PREFIX}-api:latest"
        echo "  - ${REGISTRY}/${IMAGE_PREFIX}-frontend:latest"
        echo "  - ${REGISTRY}/${IMAGE_PREFIX}-rag-service:latest"
    fi
fi

