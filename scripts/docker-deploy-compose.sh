#!/bin/bash

# Script para deploy usando docker-compose no servidor remoto
# Uso: ./scripts/docker-deploy-compose.sh [--host HOST] [--user USER] [--dir DIR]

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

# Variáveis padrão (valores padrão definidos aqui)
DEPLOY_HOST="${DEPLOY_HOST:-10.10.2.30}"
SSH_PASSWORD="${SSH_PASSWORD:-resu100gabao}"

# Detecta diretório do projeto automaticamente
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

REMOTE_HOST="${DEPLOY_HOST}"
REMOTE_USER="${DEPLOY_USER:-root}"
# Usa DEPLOY_DIR se definido, senão usa o diretório do projeto atual
REMOTE_DIR="${DEPLOY_DIR:-$PROJECT_ROOT}"
TEMP_DIR="/tmp/r-agent2-deploy-$$"

# Exporta SSHPASS com valor padrão se não estiver definido
if [ -z "$SSHPASS" ]; then
    export SSHPASS="$SSH_PASSWORD"
fi

# Verifica se sshpass está disponível
if ! command -v sshpass &> /dev/null; then
    error "sshpass não está instalado. Instale com: apt-get install sshpass ou yum install sshpass"
    exit 1
fi

# Configura SSH com senha
export SSHPASS="$SSH_PASSWORD"
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 -o ServerAliveInterval=5 -o ServerAliveCountMax=2"
SSH_CMD="sshpass -e ssh $SSH_OPTS"
RSYNC_CMD="rsync -avz --progress -e 'sshpass -e ssh $SSH_OPTS'"

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
        --password)
            SSH_PASSWORD="$2"
            export SSHPASS="$SSH_PASSWORD"
            shift 2
            ;;
        *)
            error "Argumento desconhecido: $1"
            echo "Uso: $0 [--host HOST] [--user USER] [--dir DIR] [--password PASSWORD]"
            exit 1
            ;;
    esac
done

# Diretório raiz do projeto
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

section "Deploy usando Docker Compose"

info "Configuração:"
echo "  Host: $REMOTE_HOST"
echo "  User: $REMOTE_USER"
echo "  Diretório: $REMOTE_DIR"

# Testa conexão SSH
section "Testando Conexão SSH"
info "Testando conexão com $REMOTE_HOST..."
info "  Aguarde, isso pode levar alguns segundos..."

# Testa ping primeiro (mais rápido)
info "  Testando conectividade de rede..."
if ping -c 1 -W 2 "$REMOTE_HOST" &>/dev/null; then
    info "  ✅ Ping OK"
else
    error "  ❌ Ping falhou - servidor pode estar offline"
    error "Verifique se $REMOTE_HOST está acessível"
    exit 1
fi

# Testa conexão SSH com timeout explícito no SSH
info "  Testando SSH..."
SSH_TEST=$(sshpass -e ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 -o ServerAliveInterval=5 -o ServerAliveCountMax=2 ${REMOTE_USER}@${REMOTE_HOST} "echo 'Conexão OK'" 2>&1)
SSH_EXIT=$?

if [ $SSH_EXIT -eq 0 ] && echo "$SSH_TEST" | grep -q "Conexão OK"; then
    info "✅ Conexão SSH estabelecida"
elif [ $SSH_EXIT -eq 255 ]; then
    if echo "$SSH_TEST" | grep -qE "(Connection refused|Connection timed out|No route to host)"; then
        error "❌ Servidor inacessível: $REMOTE_HOST"
        error "Verifique se o servidor está online e o SSH está rodando"
        echo "Detalhes: $(echo "$SSH_TEST" | grep -vE "Warning|Permanently" | head -2)"
    else
        error "❌ Erro de autenticação SSH"
        echo "Detalhes: $(echo "$SSH_TEST" | grep -vE "Warning|Permanently" | head -3)"
    fi
    exit 1
else
    warn "⚠️  Resposta inesperada do servidor (código: $SSH_EXIT)"
    echo "$SSH_TEST" | grep -vE "Warning|Permanently" | head -3
    info "Continuando mesmo assim..."
fi

# Verifica Docker e docker-compose no servidor
section "Verificando Docker no Servidor"
info "Verificando Docker..."
DOCKER_CHECK=$(timeout 10 $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "docker --version" 2>&1)
if echo "$DOCKER_CHECK" | grep -q "Docker version"; then
    DOCKER_VERSION=$(echo "$DOCKER_CHECK" | grep "Docker version" | head -1)
    info "✅ $DOCKER_VERSION"
else
    error "❌ Docker não encontrado no servidor"
    echo "Resposta: $(echo "$DOCKER_CHECK" | head -2)"
    exit 1
fi

info "Verificando docker-compose..."
COMPOSE_CHECK=$(timeout 10 $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "docker-compose --version 2>/dev/null || docker compose version 2>/dev/null" 2>&1)
if echo "$COMPOSE_CHECK" | grep -qE "(version|compose)"; then
    COMPOSE_VERSION=$(echo "$COMPOSE_CHECK" | head -1)
    info "✅ $COMPOSE_VERSION"
else
    error "❌ docker-compose não encontrado no servidor"
    echo "Resposta: $(echo "$COMPOSE_CHECK" | head -2)"
    exit 1
fi

# Verifica imagens locais
section "Verificando Imagens Locais"
IMAGES=("r-agent2-api:latest" "r-agent2-frontend:latest" "r-agent2-rag-service:latest")
MISSING_IMAGES=()

for img in "${IMAGES[@]}"; do
    if docker image inspect "$img" &>/dev/null; then
        SIZE=$(docker image inspect "$img" --format='{{.Size}}' | numfmt --to=iec-i --suffix=B 2>/dev/null || docker image inspect "$img" --format='{{.Size}}')
        info "✅ $img ($SIZE)"
    else
        error "❌ $img não encontrada"
        MISSING_IMAGES+=("$img")
    fi
done

if [ ${#MISSING_IMAGES[@]} -gt 0 ]; then
    error "Imagens faltando. Execute: docker-compose -f docker-compose.prod.yml build"
    exit 1
fi

# Cria diretório temporário
mkdir -p "$TEMP_DIR"
trap "rm -rf $TEMP_DIR" EXIT

# Salva imagens
section "Salvando Imagens"
TOTAL_IMAGES=${#IMAGES[@]}
CURRENT=0
for img in "${IMAGES[@]}"; do
    CURRENT=$((CURRENT + 1))
    FILENAME=$(echo "$img" | tr '/:' '_')
    info "[$CURRENT/$TOTAL_IMAGES] Salvando $img..."
    
    docker save "$img" -o "$TEMP_DIR/${FILENAME}.tar" 2>&1 &
    SAVE_PID=$!
    
    # Mostra progresso enquanto salva
    while kill -0 $SAVE_PID 2>/dev/null; do
        if [ -f "$TEMP_DIR/${FILENAME}.tar" ]; then
            SIZE=$(du -h "$TEMP_DIR/${FILENAME}.tar" 2>/dev/null | cut -f1 || echo "0")
            echo -ne "\r    Salvando... $SIZE"
        fi
        sleep 1
    done
    wait $SAVE_PID
    echo ""
    
    SIZE=$(du -h "$TEMP_DIR/${FILENAME}.tar" | cut -f1)
    info "  ✅ Concluído! Tamanho: $SIZE"
done

# Prepara servidor remoto
section "Preparando Servidor Remoto"
info "Criando diretório no servidor..."
$SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "mkdir -p $REMOTE_DIR" 2>&1 | grep -vE "(Warning|Permanently)" || true

# Copia docker-compose.prod.yml
info "Copiando docker-compose.prod.yml..."
rsync -avz --progress -e "sshpass -e ssh $SSH_OPTS" docker-compose.prod.yml ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/ 2>&1 | grep -vE "(Warning|Permanently)" || true
info "  ✅ docker-compose.prod.yml copiado"

# Copia imagens com rsync (mostra progresso)
section "Copiando Imagens para o Servidor"
CURRENT=0
for img in "${IMAGES[@]}"; do
    CURRENT=$((CURRENT + 1))
    FILENAME=$(echo "$img" | tr '/:' '_')
    SIZE=$(du -h "$TEMP_DIR/${FILENAME}.tar" | cut -f1)
    info "[$CURRENT/$TOTAL_IMAGES] Copiando ${FILENAME}.tar ($SIZE)..."
    echo ""
    
    rsync -avz --progress -e "sshpass -e ssh $SSH_OPTS" "$TEMP_DIR/${FILENAME}.tar" ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/ 2>&1 | grep -vE "(Warning|Permanently)" || true
    
    echo ""
    info "  ✅ ${FILENAME}.tar copiado"
done

# Carrega imagens no servidor
section "Carregando Imagens no Servidor"
CURRENT=0
for img in "${IMAGES[@]}"; do
    CURRENT=$((CURRENT + 1))
    FILENAME=$(echo "$img" | tr '/:' '_')
    info "[$CURRENT/$TOTAL_IMAGES] Carregando $img..."
    
    $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "cd $REMOTE_DIR && docker load -i ${FILENAME}.tar 2>&1 && rm -f ${FILENAME}.tar" 2>&1 | while IFS= read -r line; do
        if echo "$line" | grep -qE "(Loading|Loaded|sha256)"; then
            echo "    $line"
        fi
    done
    
    info "  ✅ $img carregada"
done

# Deploy com docker-compose
section "Fazendo Deploy com Docker Compose"
info "Parando containers existentes..."
$SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "cd $REMOTE_DIR && docker-compose -f docker-compose.prod.yml down 2>&1 || docker compose -f docker-compose.prod.yml down 2>&1 || true" 2>&1 | grep -vE "(Warning|Permanently)" || true

info "Iniciando containers..."
$SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "cd $REMOTE_DIR && docker-compose -f docker-compose.prod.yml up -d 2>&1 || docker compose -f docker-compose.prod.yml up -d 2>&1" 2>&1 | while IFS= read -r line; do
    if echo "$line" | grep -qE "(Creating|Starting|Started|Up|healthy)"; then
        echo "  $line"
    fi
done

info "Aguardando inicialização..."
sleep 10

# Mostra status
section "Status dos Containers"
$SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "cd $REMOTE_DIR && docker-compose -f docker-compose.prod.yml ps 2>&1 || docker compose -f docker-compose.prod.yml ps 2>&1" 2>&1 | grep -vE "(Warning|Permanently)" || true

# Testa serviços
section "Testando Serviços"
info "Testando Frontend..."
FRONTEND_STATUS=$($SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8086/ 2>&1 || echo '000'" 2>&1 | tail -1)
if [ "$FRONTEND_STATUS" = "200" ]; then
    info "  ✅ Frontend: HTTP $FRONTEND_STATUS"
else
    warn "  ⚠️  Frontend: HTTP $FRONTEND_STATUS (pode estar iniciando)"
fi

info "Testando API..."
API_STATUS=$($SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/health 2>&1 || echo '000'" 2>&1 | tail -1)
if [ "$API_STATUS" = "200" ]; then
    info "  ✅ API: HTTP $API_STATUS"
else
    warn "  ⚠️  API: HTTP $API_STATUS (pode estar iniciando)"
fi

section "Deploy Concluído!"

info "Serviços disponíveis em:"
echo "  - Frontend: http://${REMOTE_HOST}:8086"
echo "  - API: http://${REMOTE_HOST}:3001"
echo "  - RAG Service: http://${REMOTE_HOST}:8002"

info "Para ver logs:"
echo "  sshpass -p '$SSH_PASSWORD' ssh ${REMOTE_USER}@${REMOTE_HOST} 'cd ${REMOTE_DIR} && docker-compose -f docker-compose.prod.yml logs -f'"

info "Para ver status:"
echo "  sshpass -p '$SSH_PASSWORD' ssh ${REMOTE_USER}@${REMOTE_HOST} 'cd ${REMOTE_DIR} && docker-compose -f docker-compose.prod.yml ps'"
