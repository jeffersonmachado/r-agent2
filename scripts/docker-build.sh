#!/bin/bash

# Script para build das imagens Docker
# Uso: ./scripts/docker-build.sh [--all|--api|--frontend|--rag]

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
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

# Verifica se Docker está instalado
if ! command -v docker &> /dev/null; then
    error "Docker não está instalado. Por favor, instale o Docker primeiro."
    exit 1
fi

# Verifica se docker-compose está instalado
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    error "docker-compose não está instalado. Por favor, instale o docker-compose primeiro."
    exit 1
fi

# Determina qual comando usar (docker-compose ou docker compose)
if command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE="docker-compose"
else
    DOCKER_COMPOSE="docker compose"
fi

# Diretório raiz do projeto
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Função para build de um serviço específico
build_service() {
    local service=$1
    info "Construindo imagem para $service..."
    
    case $service in
        api)
            docker build -t r-agent2-api:latest -f api/Dockerfile .
            ;;
        frontend)
            docker build -t r-agent2-frontend:latest -f frontend/Dockerfile ./frontend
            ;;
        rag)
            docker build -t r-agent2-rag-service:latest -f rag-service/Dockerfile ./rag-service
            ;;
        *)
            error "Serviço desconhecido: $service"
            exit 1
            ;;
    esac
    
    info "Imagem $service construída com sucesso!"
}

# Processa argumentos
if [ $# -eq 0 ] || [ "$1" == "--all" ]; then
    info "Construindo todas as imagens..."
    build_service api
    build_service frontend
    build_service rag
    info "Todas as imagens foram construídas com sucesso!"
elif [ "$1" == "--api" ]; then
    build_service api
elif [ "$1" == "--frontend" ]; then
    build_service frontend
elif [ "$1" == "--rag" ]; then
    build_service rag
else
    error "Argumento inválido: $1"
    echo "Uso: $0 [--all|--api|--frontend|--rag]"
    exit 1
fi

info "Build concluído!"

