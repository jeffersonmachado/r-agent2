#!/bin/bash

###############################################################################
# Script para reconstruir e fazer deploy do frontend em Docker
# 
# Uso em PRODUÇÃO (em 10.10.2.30):
#   bash /opt/results/ria/r-agent2/scripts/rebuild-frontend-docker.sh
#
# Uso com variáveis customizadas:
#   VITE_API_BASE_URL=/r-agent2/api bash /opt/results/ria/r-agent2/scripts/rebuild-frontend-docker.sh
#
###############################################################################

set -e

# Cores para output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Variáveis
PROJECT_DIR="/opt/results/ria/r-agent2"
VITE_API_BASE_URL="${VITE_API_BASE_URL:-/r-agent2/api}"
VITE_BASE_PATH="${VITE_BASE_PATH:-/r-agent2/}"
IMAGE_NAME="r-agent2-frontend"
IMAGE_TAG="latest"
CONTAINER_NAME="r-agent2-frontend-prod"
LOG_FILE="/tmp/frontend-rebuild-$(date +%Y%m%d-%H%M%S).log"

log() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $*" | tee -a "$LOG_FILE"
}

success() {
    echo -e "${GREEN}✓ $*${NC}" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}✗ $*${NC}" | tee -a "$LOG_FILE"
    exit 1
}

warning() {
    echo -e "${YELLOW}⚠ $*${NC}" | tee -a "$LOG_FILE"
}

###############################################################################
# Pre-flight checks
###############################################################################

log "🔍 Verificando pré-requisitos..."

# Verifica se está em produção (10.10.2.30) ou pode ser local
if [[ -d "$PROJECT_DIR" ]]; then
    cd "$PROJECT_DIR" || error "Não conseguir acessar $PROJECT_DIR"
    success "Diretório encontrado: $PROJECT_DIR"
else
    error "Diretório não encontrado: $PROJECT_DIR"
fi

# Verifica Docker
if ! command -v docker &> /dev/null; then
    error "Docker não está instalado"
fi
success "Docker disponível"

# Verifica Docker Compose
if ! command -v docker-compose &> /dev/null; then
    error "Docker Compose não está instalado"
fi
success "Docker Compose disponível"

# Verifica arquivo docker-compose
if [[ ! -f "docker-compose.prod.yml" ]]; then
    error "docker-compose.prod.yml não encontrado"
fi
success "docker-compose.prod.yml encontrado"

###############################################################################
# Rebuild do Frontend
###############################################################################

log ""
log "🔨 Reconstruindo imagem Docker do Frontend..."
log "   - VITE_API_BASE_URL: $VITE_API_BASE_URL"
log "   - VITE_BASE_PATH: $VITE_BASE_PATH"
log "   - Imagem: $IMAGE_NAME:$IMAGE_TAG"
log "   - Logs: $LOG_FILE"
log ""

# Build da imagem
if docker build \
    -f "./frontend/Dockerfile" \
    -t "${IMAGE_NAME}:${IMAGE_TAG}" \
    --build-arg "VITE_API_BASE_URL=$VITE_API_BASE_URL" \
    --build-arg "VITE_BASE_PATH=$VITE_BASE_PATH" \
    . >> "$LOG_FILE" 2>&1; then
    success "Imagem reconstruída com sucesso: $IMAGE_NAME:$IMAGE_TAG"
else
    error "Falha ao reconstruir imagem. Logs em: $LOG_FILE"
fi

###############################################################################
# Verify Build
###############################################################################

log ""
log "🧪 Verificando imagem construída..."

if docker inspect "${IMAGE_NAME}:${IMAGE_TAG}" > /dev/null 2>&1; then
    IMAGE_SIZE=$(docker images "${IMAGE_NAME}:${IMAGE_TAG}" --format "{{.Size}}")
    success "Imagem verificada. Tamanho: $IMAGE_SIZE"
else
    error "Imagem não encontrada após build"
fi

###############################################################################
# Update Container via Docker Compose
###############################################################################

log ""
log "📦 Atualizando container via docker-compose..."

# Para o container antigo
if docker-compose -f docker-compose.prod.yml ps "${CONTAINER_NAME}" 2>/dev/null | grep -q "running"; then
    log "Parando container antigo: $CONTAINER_NAME"
    docker-compose -f docker-compose.prod.yml stop "${CONTAINER_NAME}" >> "$LOG_FILE" 2>&1
    success "Container parado"
else
    log "Container $CONTAINER_NAME não está rodando (isso é ok)"
fi

# Remove container se existir
if docker-compose -f docker-compose.prod.yml ps "${CONTAINER_NAME}" 2>/dev/null | grep -q "stopped"; then
    log "Removendo container antigo: $CONTAINER_NAME"
    docker-compose -f docker-compose.prod.yml rm -f "${CONTAINER_NAME}" >> "$LOG_FILE" 2>&1
    success "Container removido"
fi

# Inicia novo container
log "Iniciando novo container..."
if docker-compose -f docker-compose.prod.yml up -d ${CONTAINER_NAME} >> "$LOG_FILE" 2>&1; then
    success "Novo container iniciado"
else
    error "Falha ao iniciar novo container. Logs em: $LOG_FILE"
fi

###############################################################################
# Health Check
###############################################################################

log ""
log "🏥 Realizando health check..."

sleep 5

# Tenta acessar healthcheck
RETRY_COUNT=0
MAX_RETRIES=12

while [[ $RETRY_COUNT -lt $MAX_RETRIES ]]; do
    if docker exec "${CONTAINER_NAME}" curl -sf http://localhost/ > /dev/null 2>&1; then
        success "Container está saudável ✅"
        break
    else
        RETRY_COUNT=$((RETRY_COUNT + 1))
        if [[ $RETRY_COUNT -lt $MAX_RETRIES ]]; then
            warning "Aguardando container ficar saudável... (tentativa $RETRY_COUNT/$MAX_RETRIES)"
            sleep 5
        fi
    fi
done

if [[ $RETRY_COUNT -ge $MAX_RETRIES ]]; then
    error "Container não ficou saudável após $MAX_RETRIES tentativas"
fi

###############################################################################
# Verificar Configuração
###############################################################################

log ""
log "🔐 Verificando se VITE_API_BASE_URL foi compilado corretamente..."

# Extrai um arquivo JS para verificar
SAMPLE_JS=$(docker exec "${CONTAINER_NAME}" find /usr/share/nginx/html -name "*.js" | head -1)

if [[ -n "$SAMPLE_JS" ]]; then
    if docker exec "${CONTAINER_NAME}" grep -q "r-agent2/api" "$SAMPLE_JS"; then
        success "VITE_API_BASE_URL compilado corretamente ✅"
        success "String 'r-agent2/api' encontrada no bundle"
    else
        warning "Não consegui confirmar VITE_API_BASE_URL no bundle"
        warning "Verifique manualmente no DevTools"
    fi
else
    warning "Não consegui encontrar arquivo JS para verificação"
fi

###############################################################################
# Summary
###############################################################################

log ""
log "════════════════════════════════════════════════════════════════════════════"
log "                        ✅ FRONTEND REBUILD CONCLUÍDO"
log "════════════════════════════════════════════════════════════════════════════"
log ""
log "Imagem Docker:     $IMAGE_NAME:$IMAGE_TAG"
log "Container:         $CONTAINER_NAME"
log "VITE_API_BASE_URL: $VITE_API_BASE_URL"
log "VITE_BASE_PATH:    $VITE_BASE_PATH"
log ""
log "📍 Próximos passos:"
log "   1. Verificar no browser: https://www.results.com.br/r-agent2/crm"
log "   2. Pressionar F12 para abrir DevTools"
log "   3. Ir em Console"
log "   4. Procurar por 'r-agent2/api' para confirmar URL correta"
log "   5. Testar GET /r-agent2/api/crm/accounts"
log ""
log "📝 Logs completos: $LOG_FILE"
log ""

success "Deploy concluído! 🎉"
