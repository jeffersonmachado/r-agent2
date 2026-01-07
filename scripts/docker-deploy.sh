#!/bin/bash

# Script para deploy da plataforma em Docker no servidor remoto
# Uso: ./scripts/docker-deploy.sh [--prod|--dev] [--build] [--pull] [--host HOST] [--user USER]

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

# Variáveis padrão (valores padrão definidos aqui)
DEPLOY_HOST="${DEPLOY_HOST:-10.10.2.30}"
SSH_PASSWORD="${SSH_PASSWORD:-resu100gabao}"

REMOTE_HOST="${DEPLOY_HOST}"
REMOTE_USER="${DEPLOY_USER:-root}"
REMOTE_DIR="${DEPLOY_DIR:-/opt/results/ria/r-agent2}"

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

# Variáveis padrão
MODE="prod"
BUILD=true
PULL=false
COMPOSE_FILE="docker-compose.prod.yml"
BUILD_SERVICE=""  # vazio = todas as imagens, ou nome do serviço (ex: frontend)

# Processa argumentos
while [[ $# -gt 0 ]]; do
    case $1 in
        --prod)
            MODE="prod"
            COMPOSE_FILE="docker-compose.prod.yml"
            shift
            ;;
        --dev)
            MODE="dev"
            COMPOSE_FILE="docker-compose.yml"
            shift
            ;;
        --build)
            BUILD=true
            shift
            ;;
        --no-build)
            BUILD=false
            shift
            ;;
        --pull)
            PULL=true
            shift
            ;;
        --frontend-only)
            BUILD_SERVICE="frontend"
            shift
            ;;
        --api-only)
            BUILD_SERVICE="api"
            shift
            ;;
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
            echo "Uso: $0 [--prod|--dev] [--build|--no-build] [--pull] [--frontend-only] [--api-only] [--host HOST] [--user USER] [--dir DIR] [--password PASSWORD]"
            exit 1
            ;;
    esac
done

# Diretório raiz do projeto
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

section "Deploy R-Agent2 - Modo: $MODE (Servidor Remoto)"

info "Configuração:"
echo "  Host: $REMOTE_HOST"
echo "  User: $REMOTE_USER"
echo "  Diretório: $REMOTE_DIR"
echo "  Modo: $MODE"
echo "  Build: $BUILD"
echo "  Serviço de build: ${BUILD_SERVICE:-todos}"
echo "  Pull: $PULL"

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

# Verifica Docker e docker-compose no servidor (sem falsos negativos por causa de warnings)
section "Verificando Docker no Servidor"
info "Verificando instalação do Docker..."
DOCKER_CHECK=$($SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "docker --version" 2>&1)
if echo "$DOCKER_CHECK" | grep -q "Docker version"; then
    DOCKER_VERSION=$(echo "$DOCKER_CHECK" | grep "Docker version" | head -1)
    info "✅ $DOCKER_VERSION"
else
    error "Docker não está instalado no servidor remoto."
    echo "Resposta: $(echo "$DOCKER_CHECK" | head -2)"
    exit 1
fi

info "Verificando docker-compose..."
COMPOSE_CHECK=$($SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "docker-compose --version 2>/dev/null || docker compose version 2>/dev/null" 2>&1)
if echo "$COMPOSE_CHECK" | grep -qE "(version|compose)"; then
    COMPOSE_VERSION=$(echo "$COMPOSE_CHECK" | head -1)
    info "✅ $COMPOSE_VERSION"
    if echo "$COMPOSE_CHECK" | grep -qi "docker-compose"; then
        DOCKER_COMPOSE="docker-compose"
    else
        DOCKER_COMPOSE="docker compose"
    fi
else
    error "docker-compose não está instalado no servidor remoto."
    echo "Resposta: $(echo "$COMPOSE_CHECK" | head -2)"
    exit 1
fi

# Cria diretório no servidor
section "Preparando Diretório no Servidor"
info "Criando diretório $REMOTE_DIR no servidor..."
$SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "mkdir -p $REMOTE_DIR" 2>&1 | grep -vE "(Warning|Permanently)" || true
info "✅ Diretório preparado"

# Sincroniza apenas arquivos necessários para build com Docker
section "Sincronizando Arquivos para o Servidor"
info "Copiando apenas arquivos necessários para build (isso pode levar alguns minutos)..."

# Lista de exclusões genéricas (para evitar lixo em diretórios incluídos)
EXCLUDE_LIST=(
    "--exclude=node_modules"
    "--exclude=.git"
    "--exclude=coverage"
    "--exclude=dist"
    "--exclude=build"
    "--exclude=*.log"
    "--exclude=.env"
    "--exclude=.DS_Store"
    "--exclude=*.swp"
    "--exclude=*.swo"
    "--exclude=.vscode"
    "--exclude=.idea"
    "--exclude=__pycache__"
    "--exclude=*.pyc"
    "--exclude=.pytest_cache"
    "--exclude=htmlcov"
    "--exclude=.coverage"
    "--exclude=venv"
    "--exclude=.venv"
    "--exclude=*/venv"
)

# Conjuntos de paths a sincronizar (mínimo para rebuild com docker-compose.prod.yml)
SYNC_PATHS=(
    "docker-compose.prod.yml"
    "package.json"
    "package-lock.json"
    "env.example"
    "api"
    "frontend"
    "engine"
    "rag-service"
    "infra"
    "contracts"
    "config"
    "qa"
    "tests"
)

info "  Diretórios/arquivos que serão sincronizados:"
for p in "${SYNC_PATHS[@]}"; do
    echo "    - $p"
done

# Monta lista completa de fontes com caminho absoluto (sempre usando ROOT_DIR)
RSYNC_SOURCES=()
for p in "${SYNC_PATHS[@]}"; do
    ABS_PATH="${ROOT_DIR}/$p"
    if [ -e "$ABS_PATH" ]; then
        RSYNC_SOURCES+=("$ABS_PATH")
    fi
done

if [ ${#RSYNC_SOURCES[@]} -eq 0 ]; then
    error "Nenhum caminho válido encontrado para sincronizar. Verifique SYNC_PATHS no script."
    exit 1
fi

# Usa explicitamente paths absolutos no rsync (ex.: /opt/results/ria/r-agent2/api/)
rsync -avz --progress \
    "${EXCLUDE_LIST[@]}" \
    -e "sshpass -e ssh $SSH_OPTS" \
    "${RSYNC_SOURCES[@]}" \
    "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/" \
    2>&1 | grep -vE "(Warning|Permanently|building file list|sent|total size|speedup)" || true

info "✅ Arquivos necessários sincronizados"

# Verifica se .env existe no servidor, se não, cria silenciosamente a partir de env.example
section "Verificando Arquivo .env"
info "Verificando arquivo .env no servidor..."
if ! $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "test -f ${REMOTE_DIR}/.env" 2>&1 | grep -vE "(Warning|Permanently)" > /dev/null; then
    warn ".env não encontrado. Criando a partir de env.example (sem pausa interativa)..."
    $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_DIR} && if [ -f env.example ]; then cp env.example .env; fi" 2>&1 | grep -vE "(Warning|Permanently)" || true
    warn "IMPORTANTE: edite o arquivo .env no servidor quando tiver tempo (mas o deploy continua)."
else
    info "✅ Arquivo .env encontrado"
fi

# Pull de imagens base se solicitado
if [ "$PULL" = true ]; then
    section "Atualizando Imagens Base"
    info "Fazendo pull das imagens base no servidor..."
    $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_DIR} && $DOCKER_COMPOSE -f $COMPOSE_FILE pull" 2>&1 | while IFS= read -r line; do
        if echo "$line" | grep -qE "(Pulling|Pulled|Downloading|Downloaded|Already|Digest)"; then
            echo "  $line"
        fi
    done
    info "✅ Imagens base atualizadas"
fi

# Build das imagens no servidor remoto
if [ "$BUILD" = true ]; then
    section "Construindo Imagens Docker no Servidor"
    if [ -n "$BUILD_SERVICE" ]; then
        info "Construindo APENAS o serviço '$BUILD_SERVICE' no servidor remoto (isso pode levar vários minutos)..."
    else
        info "Construindo TODAS as imagens no servidor remoto (isso pode levar vários minutos)..."
    fi
    
    if [ "$MODE" = "prod" ]; then
        info "Modo: Produção (--no-cache)"
        if [ -n "$BUILD_SERVICE" ]; then
            # Para frontend e api usamos Dockerfiles dedicados, pois
            # docker compose build não sabe o contexto/Dockerfile se não houver 'build:' no compose.
            if [ "$BUILD_SERVICE" = "frontend" ]; then
                BUILD_CMD="docker build -t r-agent2-frontend:latest -f frontend/Dockerfile ."
            elif [ "$BUILD_SERVICE" = "api" ]; then
                BUILD_CMD="docker build -t r-agent2-api:latest -f api/Dockerfile ."
            else
                BUILD_CMD="$DOCKER_COMPOSE -f $COMPOSE_FILE build --no-cache $BUILD_SERVICE"
            fi
        else
            BUILD_CMD="$DOCKER_COMPOSE -f $COMPOSE_FILE build --no-cache"
        fi
        # Executa build e captura código de saída
        BUILD_OUTPUT=$($SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_DIR} && $BUILD_CMD" 2>&1)
        BUILD_EXIT_CODE=$?
        
        # Filtra e mostra saída relevante
        echo "$BUILD_OUTPUT" | while IFS= read -r line; do
            if echo "$line" | grep -qE "(Step|Building|Successfully|built|tagged|ERROR|error|failed)"; then
                echo "  $line"
            fi
        done
        
        # Verifica se build falhou
        if [ $BUILD_EXIT_CODE -ne 0 ]; then
            error "❌ Build FALHOU com código de saída $BUILD_EXIT_CODE"
            error "Verifique os erros acima e corrija antes de continuar"
            exit 1
        fi
    else
        info "Modo: Desenvolvimento"
        if [ -n "$BUILD_SERVICE" ]; then
            BUILD_CMD="$DOCKER_COMPOSE -f $COMPOSE_FILE build $BUILD_SERVICE"
        else
            BUILD_CMD="$DOCKER_COMPOSE -f $COMPOSE_FILE build"
        fi
        
        # Executa build e captura código de saída
        BUILD_OUTPUT=$($SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_DIR} && $BUILD_CMD" 2>&1)
        BUILD_EXIT_CODE=$?
        
        # Filtra e mostra saída relevante
        echo "$BUILD_OUTPUT" | while IFS= read -r line; do
            if echo "$line" | grep -qE "(Step|Building|Successfully|built|tagged|ERROR|error|failed)"; then
                echo "  $line"
            fi
        done
        
        # Verifica se build falhou
        if [ $BUILD_EXIT_CODE -ne 0 ]; then
            error "❌ Build FALHOU com código de saída $BUILD_EXIT_CODE"
            error "Verifique os erros acima e corrija antes de continuar"
            exit 1
        fi
    fi
    
    info "✅ Build concluído com sucesso"
else
    info "⚠️  Build pulado (use --build para construir)"
fi

# Para containers existentes / restart
if [ -n "$BUILD_SERVICE" ]; then
    # Quando estamos em modo serviço único (ex: --frontend-only),
    # não derrubamos todo o cluster, apenas recriamos o serviço alvo.
    section "Recriando Serviço $BUILD_SERVICE"
    info "Recriando apenas o serviço '$BUILD_SERVICE' (os demais permanecem em execução)..."
    $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_DIR} && $DOCKER_COMPOSE -f $COMPOSE_FILE up -d $BUILD_SERVICE" 2>&1 | while IFS= read -r line; do
        if echo "$line" | grep -qE "(Creating|Starting|Started|Recreating|Up|healthy|Container)"; then
            echo "  $line"
        fi
    done
    info "✅ Serviço '$BUILD_SERVICE' recriado"
else
    # Modo padrão: derruba e sobe todo o stack
    section "Parando Containers Existentes"
    info "Parando containers existentes..."
    $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_DIR} && $DOCKER_COMPOSE -f $COMPOSE_FILE down" 2>&1 | grep -vE "(Warning|Permanently)" || true
    info "✅ Containers parados"

    section "Iniciando Serviços"
    if [ "$MODE" = "prod" ]; then
        info "Iniciando em modo produção..."
    else
        info "Iniciando em modo desenvolvimento..."
    fi

    $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_DIR} && $DOCKER_COMPOSE -f $COMPOSE_FILE up -d" 2>&1 | while IFS= read -r line; do
        if echo "$line" | grep -qE "(Creating|Starting|Started|Up|healthy|Container)"; then
            echo "  $line"
        fi
    done

    info "✅ Serviços iniciados"
fi

# Aguarda os serviços iniciarem
section "Aguardando Serviços Iniciarem"
info "Aguardando 10 segundos para serviços iniciarem..."
sleep 10

if [ -n "$BUILD_SERVICE" ]; then
    # Health check focado no serviço alterado
    section "Verificando Saúde dos Serviços (modo serviço único)"
    info "Aguardando alguns segundos para o serviço '$BUILD_SERVICE' estabilizar..."
    sleep 10

    if [ "$BUILD_SERVICE" = "frontend" ]; then
        info "Verificando Frontend..."
        if $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "curl -f http://localhost:8086 &> /dev/null" 2>&1 | grep -vE "(Warning|Permanently)" > /dev/null; then
            info "✓ Frontend está respondendo"
        else
            warn "⚠ Frontend não está respondendo ainda (pode estar iniciando)"
        fi
    fi

    section "Deploy Concluído (serviço único)!"
    info "Serviços principais no servidor $REMOTE_HOST:"
    echo "  - Frontend: http://$REMOTE_HOST:8086"
    echo "  - API: http://$REMOTE_HOST:3001"
    echo "  - RAG Service: http://$REMOTE_HOST:8002"
    echo ""
    info "Para ver logs:"
    echo "  ssh ${REMOTE_USER}@${REMOTE_HOST} 'cd ${REMOTE_DIR} && $DOCKER_COMPOSE -f $COMPOSE_FILE logs -f $BUILD_SERVICE'"
else
    # Health check completo (modo stack inteiro)
    section "Status dos Containers"
    $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_DIR} && $DOCKER_COMPOSE -f $COMPOSE_FILE ps" 2>&1 | grep -vE "(Warning|Permanently)" || true

    section "Logs Iniciais (últimas 20 linhas)"
    $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_DIR} && $DOCKER_COMPOSE -f $COMPOSE_FILE logs --tail=20" 2>&1 | grep -vE "(Warning|Permanently)" || true

    section "Verificando Saúde dos Serviços"
    info "Aguardando mais 10 segundos para health checks..."
    sleep 10

    info "Verificando API..."
    if $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "curl -f http://localhost:3001/health &> /dev/null" 2>&1 | grep -vE "(Warning|Permanently)" > /dev/null; then
        info "✓ API está respondendo"
    else
        warn "⚠ API não está respondendo ainda (pode estar iniciando)"
    fi

    info "Verificando Frontend..."
    if $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "curl -f http://localhost:8086 &> /dev/null" 2>&1 | grep -vE "(Warning|Permanently)" > /dev/null; then
        info "✓ Frontend está respondendo"
    else
        warn "⚠ Frontend não está respondendo ainda (pode estar iniciando)"
    fi

    info "Verificando RAG Service..."
    if $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "curl -f http://localhost:8002/rag/health &> /dev/null" 2>&1 | grep -vE "(Warning|Permanently)" > /dev/null; then
        info "✓ RAG Service está respondendo"
    else
        warn "⚠ RAG Service não está respondendo ainda (pode estar iniciando)"
    fi

    section "Deploy Concluído!"

    info "Serviços disponíveis no servidor $REMOTE_HOST:"
    echo "  - Frontend: http://$REMOTE_HOST:8086"
    echo "  - API: http://$REMOTE_HOST:3001"
    echo "  - RAG Service: http://$REMOTE_HOST:8002"
    echo ""
    info "Para ver os logs:"
    echo "  ssh ${REMOTE_USER}@${REMOTE_HOST} 'cd ${REMOTE_DIR} && $DOCKER_COMPOSE -f $COMPOSE_FILE logs -f'"
    info "Para parar os serviços:"
    echo "  ssh ${REMOTE_USER}@${REMOTE_HOST} 'cd ${REMOTE_DIR} && $DOCKER_COMPOSE -f $COMPOSE_FILE down'"
fi
