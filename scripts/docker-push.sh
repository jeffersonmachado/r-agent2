#!/bin/bash

# Script para build e push das imagens Docker para registry
# Uso: ./scripts/docker-push.sh [--registry REGISTRY] [--tag TAG] [--latest]

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

# Verifica se Docker está instalado
if ! command -v docker &> /dev/null; then
    error "Docker não está instalado."
    exit 1
fi

# Variáveis padrão
REGISTRY="${DOCKER_REGISTRY:-}"
TAG="${DOCKER_TAG:-latest}"
PUSH_LATEST=false
IMAGE_PREFIX="r-agent2"

# Processa argumentos
while [[ $# -gt 0 ]]; do
    case $1 in
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
        *)
            error "Argumento desconhecido: $1"
            echo "Uso: $0 [--registry REGISTRY] [--tag TAG] [--latest] [--prefix PREFIX]"
            exit 1
            ;;
    esac
done

# Se não especificado, tenta usar variável de ambiente ou padrão
if [ -z "$REGISTRY" ]; then
    warn "Registry não especificado. Usando Docker Hub padrão."
    warn "Para usar registry customizado: export DOCKER_REGISTRY=seu-registry.com"
    REGISTRY=""
fi

# Constrói nome completo da imagem
build_image_name() {
    local service=$1
    if [ -z "$REGISTRY" ]; then
        echo "${IMAGE_PREFIX}-${service}:${TAG}"
    else
        # Remove trailing slash se houver
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

# Diretório raiz do projeto
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

section "Build e Push das Imagens Docker"

info "Configuração:"
echo "  Registry: ${REGISTRY:-Docker Hub (padrão)}"
echo "  Tag: $TAG"
echo "  Prefix: $IMAGE_PREFIX"
echo "  Push latest: $PUSH_LATEST"

# Verifica se está logado no Docker
if [ -n "$REGISTRY" ] && [ "$REGISTRY" != "docker.io" ]; then
    info "Verificando login no registry..."
    if ! docker info | grep -q "Username"; then
        warn "Parece que você não está logado no registry."
        read -p "Deseja fazer login agora? (s/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Ss]$ ]]; then
            docker login "$REGISTRY"
        fi
    fi
fi

# Build e push da API
section "Build API"
API_IMAGE=$(build_image_name "api")
info "Construindo: $API_IMAGE"
docker build -t "$API_IMAGE" -f api/Dockerfile .
if [ "$PUSH_LATEST" = true ]; then
    API_LATEST=$(build_latest_name "api")
    docker tag "$API_IMAGE" "$API_LATEST"
    info "Tagged as: $API_LATEST"
fi

# Build e push do Frontend
section "Build Frontend"
FRONTEND_IMAGE=$(build_image_name "frontend")
info "Construindo: $FRONTEND_IMAGE"
docker build -t "$FRONTEND_IMAGE" -f frontend/Dockerfile ./frontend
if [ "$PUSH_LATEST" = true ]; then
    FRONTEND_LATEST=$(build_latest_name "frontend")
    docker tag "$FRONTEND_IMAGE" "$FRONTEND_LATEST"
    info "Tagged as: $FRONTEND_LATEST"
fi

# Build e push do RAG Service
section "Build RAG Service"
RAG_IMAGE=$(build_image_name "rag-service")
info "Construindo: $RAG_IMAGE"
docker build -t "$RAG_IMAGE" -f rag-service/Dockerfile ./rag-service
if [ "$PUSH_LATEST" = true ]; then
    RAG_LATEST=$(build_latest_name "rag-service")
    docker tag "$RAG_IMAGE" "$RAG_LATEST"
    info "Tagged as: $RAG_LATEST"
fi

# Push das imagens
section "Push das Imagens"

read -p "Deseja fazer push das imagens para o registry? (s/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Ss]$ ]]; then
    info "Fazendo push de $API_IMAGE..."
    docker push "$API_IMAGE"
    
    if [ "$PUSH_LATEST" = true ]; then
        info "Fazendo push de $API_LATEST..."
        docker push "$API_LATEST"
    fi
    
    info "Fazendo push de $FRONTEND_IMAGE..."
    docker push "$FRONTEND_IMAGE"
    
    if [ "$PUSH_LATEST" = true ]; then
        info "Fazendo push de $FRONTEND_LATEST..."
        docker push "$FRONTEND_LATEST"
    fi
    
    info "Fazendo push de $RAG_IMAGE..."
    docker push "$RAG_IMAGE"
    
    if [ "$PUSH_LATEST" = true ]; then
        info "Fazendo push de $RAG_LATEST..."
        docker push "$RAG_LATEST"
    fi
    
    section "Push Concluído!"
    info "Imagens publicadas:"
    echo "  - $API_IMAGE"
    echo "  - $FRONTEND_IMAGE"
    echo "  - $RAG_IMAGE"
    if [ "$PUSH_LATEST" = true ]; then
        echo "  - $API_LATEST"
        echo "  - $FRONTEND_LATEST"
        echo "  - $RAG_LATEST"
    fi
else
    warn "Push cancelado. Imagens construídas localmente."
    info "Para fazer push manualmente:"
    echo "  docker push $API_IMAGE"
    echo "  docker push $FRONTEND_IMAGE"
    echo "  docker push $RAG_IMAGE"
fi

section "Concluído!"

