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

# Função para executar comando e mostrar comando + resultado
run_cmd() {
    local cmd="$1"
    local description="${2:-Executando comando}"
    echo -e "${YELLOW}[COMANDO]${NC} $description"
    echo -e "${YELLOW}[COMANDO]${NC} $cmd"
    echo ""
    eval "$cmd"
    local exit_code=$?
    echo ""
    if [ $exit_code -eq 0 ]; then
        echo -e "${GREEN}[RESULTADO]${NC} Comando executado com sucesso (exit code: $exit_code)"
    else
        echo -e "${RED}[RESULTADO]${NC} Comando falhou (exit code: $exit_code)"
    fi
    echo ""
    return $exit_code
}

# Função para executar comando SSH e mostrar comando + resultado
run_ssh_cmd() {
    local remote_cmd="$1"
    local description="${2:-Executando comando SSH}"
    local full_cmd="$SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} \"$remote_cmd\""
    echo -e "${YELLOW}[COMANDO SSH]${NC} $description"
    echo -e "${YELLOW}[COMANDO SSH]${NC} $full_cmd"
    echo -e "${YELLOW}[COMANDO REMOTO]${NC} $remote_cmd"
    echo ""
    eval "$full_cmd" 2>&1 | grep -vE "(Warning|Permanently)" || true
    local exit_code=${PIPESTATUS[0]}
    echo ""
    if [ $exit_code -eq 0 ]; then
        echo -e "${GREEN}[RESULTADO]${NC} Comando SSH executado com sucesso (exit code: $exit_code)"
    else
        echo -e "${RED}[RESULTADO]${NC} Comando SSH falhou (exit code: $exit_code)"
    fi
    echo ""
    return $exit_code
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
# Timeouts aumentados para permitir builds longos (npm ci pode demorar vários minutos)
# ServerAliveInterval=30: envia keepalive a cada 30 segundos
# ServerAliveCountMax=20: permite até 20 intervalos sem resposta (20*30 = 10 minutos)
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=30 -o ServerAliveInterval=30 -o ServerAliveCountMax=20 -o TCPKeepAlive=yes"
SSH_CMD="sshpass -e ssh $SSH_OPTS"
RSYNC_CMD="rsync -avz --progress --delete -e 'sshpass -e ssh $SSH_OPTS'"

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
PING_CMD="ping -c 1 -W 2 $REMOTE_HOST"
echo -e "${YELLOW}[COMANDO]${NC} Testando conectividade de rede"
echo -e "${YELLOW}[COMANDO]${NC} $PING_CMD"
echo ""
if ping -c 1 -W 2 "$REMOTE_HOST" &>/dev/null; then
    info "  ✅ Ping OK"
else
    error "  ❌ Ping falhou - servidor pode estar offline"
    error "Verifique se $REMOTE_HOST está acessível"
    exit 1
fi
echo ""

# Testa conexão SSH com timeout explícito no SSH
info "  Testando SSH..."
SSH_TEST_CMD="sshpass -e ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=30 -o ServerAliveInterval=30 -o ServerAliveCountMax=20 -o TCPKeepAlive=yes ${REMOTE_USER}@${REMOTE_HOST} \"echo 'Conexão OK'\""
echo -e "${YELLOW}[COMANDO SSH]${NC} Testando conexão SSH"
echo -e "${YELLOW}[COMANDO SSH]${NC} $SSH_TEST_CMD"
echo ""
SSH_TEST=$(eval "$SSH_TEST_CMD" 2>&1)
SSH_EXIT=$?
echo -e "${GREEN}[RESULTADO]${NC} Exit code: $SSH_EXIT"
echo ""

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
echo -e "${YELLOW}[COMANDO SSH]${NC} Verificando versão do Docker"
echo -e "${YELLOW}[COMANDO SSH]${NC} $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} \"docker --version\""
echo -e "${YELLOW}[COMANDO REMOTO]${NC} docker --version"
echo ""
DOCKER_CHECK=$($SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "docker --version" 2>&1)
DOCKER_EXIT=${PIPESTATUS[0]}
echo "$DOCKER_CHECK" | grep -vE "(Warning|Permanently)" || true
echo ""
if echo "$DOCKER_CHECK" | grep -q "Docker version"; then
    DOCKER_VERSION=$(echo "$DOCKER_CHECK" | grep "Docker version" | head -1)
    info "✅ $DOCKER_VERSION"
    echo -e "${GREEN}[RESULTADO]${NC} Docker encontrado (exit code: $DOCKER_EXIT)"
else
    error "Docker não está instalado no servidor remoto."
    echo "Resposta: $(echo "$DOCKER_CHECK" | head -2)"
    exit 1
fi
echo ""

info "Verificando docker-compose..."
echo -e "${YELLOW}[COMANDO SSH]${NC} Verificando versão do docker-compose"
echo -e "${YELLOW}[COMANDO SSH]${NC} $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} \"docker-compose --version 2>/dev/null || docker compose version 2>/dev/null\""
echo -e "${YELLOW}[COMANDO REMOTO]${NC} docker-compose --version 2>/dev/null || docker compose version 2>/dev/null"
echo ""
COMPOSE_CHECK=$($SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "docker-compose --version 2>/dev/null || docker compose version 2>/dev/null" 2>&1)
COMPOSE_EXIT=${PIPESTATUS[0]}
echo "$COMPOSE_CHECK" | grep -vE "(Warning|Permanently)" || true
echo ""
if echo "$COMPOSE_CHECK" | grep -qE "(version|compose)"; then
    COMPOSE_VERSION=$(echo "$COMPOSE_CHECK" | head -1)
    info "✅ $COMPOSE_VERSION"
    if echo "$COMPOSE_CHECK" | grep -qi "docker-compose"; then
        DOCKER_COMPOSE="docker-compose"
    else
        DOCKER_COMPOSE="docker compose"
    fi
    echo -e "${GREEN}[RESULTADO]${NC} docker-compose encontrado (exit code: $COMPOSE_EXIT)"
else
    error "docker-compose não está instalado no servidor remoto."
    echo "Resposta: $(echo "$COMPOSE_CHECK" | head -2)"
    exit 1
fi
echo ""

# Cria diretório no servidor
section "Preparando Diretório no Servidor"
info "Criando diretório $REMOTE_DIR no servidor..."
echo -e "${YELLOW}[COMANDO SSH]${NC} Criando diretório no servidor"
echo -e "${YELLOW}[COMANDO SSH]${NC} $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} \"mkdir -p $REMOTE_DIR\""
echo -e "${YELLOW}[COMANDO REMOTO]${NC} mkdir -p $REMOTE_DIR"
echo ""
$SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "mkdir -p $REMOTE_DIR" 2>&1 | grep -vE "(Warning|Permanently)" || true
MKDIR_EXIT=${PIPESTATUS[0]}
echo ""
echo -e "${GREEN}[RESULTADO]${NC} Diretório criado (exit code: $MKDIR_EXIT)"
info "✅ Diretório preparado"
echo ""

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
    "redis"
    "lib"
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
RSYNC_CMD_FULL="rsync -avz --progress --delete ${EXCLUDE_LIST[@]} -e \"sshpass -e ssh $SSH_OPTS\" \"${RSYNC_SOURCES[@]}\" \"${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/\""
echo -e "${YELLOW}[COMANDO RSYNC]${NC} Sincronizando arquivos"
echo -e "${YELLOW}[COMANDO RSYNC]${NC} $RSYNC_CMD_FULL"
echo ""
rsync -avz --progress --delete \
    "${EXCLUDE_LIST[@]}" \
    -e "sshpass -e ssh $SSH_OPTS" \
    "${RSYNC_SOURCES[@]}" \
    "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/" \
    2>&1 | grep -vE "(Warning|Permanently|building file list|sent|total size|speedup)" || true
RSYNC_EXIT=${PIPESTATUS[0]}
echo ""
echo -e "${GREEN}[RESULTADO]${NC} Sincronização concluída (exit code: $RSYNC_EXIT)"
info "✅ Arquivos necessários sincronizados"
echo ""

# Verifica se .env existe no servidor, se não, cria silenciosamente a partir de env.example
section "Verificando Arquivo .env"
info "Verificando arquivo .env no servidor..."
echo -e "${YELLOW}[COMANDO SSH]${NC} Verificando se .env existe"
echo -e "${YELLOW}[COMANDO SSH]${NC} $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} \"test -f ${REMOTE_DIR}/.env\""
echo -e "${YELLOW}[COMANDO REMOTO]${NC} test -f ${REMOTE_DIR}/.env"
echo ""
if ! $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "test -f ${REMOTE_DIR}/.env" 2>&1 | grep -vE "(Warning|Permanently)" > /dev/null; then
    ENV_TEST_EXIT=${PIPESTATUS[0]}
    echo -e "${GREEN}[RESULTADO]${NC} .env não encontrado (exit code: $ENV_TEST_EXIT)"
    echo ""
    warn ".env não encontrado. Criando a partir de env.example (sem pausa interativa)..."
    echo -e "${YELLOW}[COMANDO SSH]${NC} Criando .env a partir de env.example"
    echo -e "${YELLOW}[COMANDO SSH]${NC} $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} \"cd ${REMOTE_DIR} && if [ -f env.example ]; then cp env.example .env; fi\""
    echo -e "${YELLOW}[COMANDO REMOTO]${NC} cd ${REMOTE_DIR} && if [ -f env.example ]; then cp env.example .env; fi"
    echo ""
    $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_DIR} && if [ -f env.example ]; then cp env.example .env; fi" 2>&1 | grep -vE "(Warning|Permanently)" || true
    ENV_CREATE_EXIT=${PIPESTATUS[0]}
    echo ""
    echo -e "${GREEN}[RESULTADO]${NC} .env criado (exit code: $ENV_CREATE_EXIT)"
    warn "IMPORTANTE: edite o arquivo .env no servidor quando tiver tempo (mas o deploy continua)."
else
    ENV_TEST_EXIT=${PIPESTATUS[0]}
    echo -e "${GREEN}[RESULTADO]${NC} .env encontrado (exit code: $ENV_TEST_EXIT)"
    info "✅ Arquivo .env encontrado"
fi
echo ""

# Pull de imagens base se solicitado
if [ "$PULL" = true ]; then
    section "Atualizando Imagens Base"
    info "Fazendo pull das imagens base no servidor..."
    PULL_CMD="cd ${REMOTE_DIR} && $DOCKER_COMPOSE -f $COMPOSE_FILE pull"
    echo -e "${YELLOW}[COMANDO SSH]${NC} Fazendo pull das imagens base"
    echo -e "${YELLOW}[COMANDO SSH]${NC} $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} \"$PULL_CMD\""
    echo -e "${YELLOW}[COMANDO REMOTO]${NC} $PULL_CMD"
    echo ""
    $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "$PULL_CMD" 2>&1 | while IFS= read -r line; do
        if echo "$line" | grep -qE "(Pulling|Pulled|Downloading|Downloaded|Already|Digest)"; then
            echo "  $line"
        fi
    done
    PULL_EXIT=${PIPESTATUS[0]}
    echo ""
    echo -e "${GREEN}[RESULTADO]${NC} Pull concluído (exit code: $PULL_EXIT)"
    info "✅ Imagens base atualizadas"
    echo ""
fi

# Build das imagens no servidor remoto
if [ "$BUILD" = true ]; then
    section "Construindo Imagens Docker no Servidor"
    if [ -n "$BUILD_SERVICE" ]; then
        info "Construindo APENAS o serviço '$BUILD_SERVICE' no servidor remoto (isso pode levar vários minutos)..."
    else
        info "Construindo TODAS as imagens no servidor remoto (isso pode levar vários minutos)..."
    fi
    warn "⚠️  ATENÇÃO: O build pode demorar 10-20 minutos. A conexão SSH foi configurada para manter-se ativa durante builds longos."
    warn "⚠️  Se a conexão cair, você pode executar apenas o build do serviço que falhou usando --frontend-only ou --api-only"
    
    if [ "$MODE" = "prod" ]; then
        info "Modo: Produção (--no-cache)"
        if [ -n "$BUILD_SERVICE" ]; then
            # Para frontend e api usamos Dockerfiles dedicados, pois
            # docker compose build não sabe o contexto/Dockerfile se não houver 'build:' no compose.
            if [ "$BUILD_SERVICE" = "frontend" ]; then
                # Importante: o Dockerfile do frontend assume contexto na raiz do projeto,
                # pois faz COPY de 'engine/' e 'frontend/...'. Por isso o contexto precisa ser '.'
                # (diretório REMOTE_DIR) e não './frontend'.
                BUILD_CMD="docker build --build-arg VITE_BASE_PATH=/r-agent2/ -t r-agent2-frontend:latest -f frontend/Dockerfile ."
            elif [ "$BUILD_SERVICE" = "api" ]; then
                BUILD_CMD="docker build -t r-agent2-api:latest -f api/Dockerfile ."
            elif [ "$BUILD_SERVICE" = "rag-service" ]; then
                BUILD_CMD="docker build -t r-agent2-rag-service:latest -f rag-service/Dockerfile rag-service/"
            else
                BUILD_CMD="$DOCKER_COMPOSE -f $COMPOSE_FILE build --no-cache $BUILD_SERVICE"
            fi
        else
            # Construir TODAS as imagens necessárias
            # docker compose build só constrói serviços com 'build:', então precisamos construir manualmente
            # as imagens que só têm 'image:' definido (api e rag-service)
            info "Construindo imagens que não têm build no compose (API e RAG Service)..."
            
            # Build API
            info "Construindo imagem da API..."
            API_BUILD_CMD="docker build -t r-agent2-api:latest -f api/Dockerfile ."
            echo -e "${YELLOW}[COMANDO REMOTO]${NC} cd ${REMOTE_DIR} && $API_BUILD_CMD"
            $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_DIR} && $API_BUILD_CMD" 2>&1 | grep -vE "(Warning|Permanently)" || true
            API_BUILD_EXIT=${PIPESTATUS[0]}
            if [ $API_BUILD_EXIT -ne 0 ]; then
                error "❌ Build da API FALHOU"
                exit 1
            fi
            
            # Build RAG Service
            info "Construindo imagem do RAG Service..."
            RAG_BUILD_CMD="docker build -t r-agent2-rag-service:latest -f rag-service/Dockerfile rag-service/"
            echo -e "${YELLOW}[COMANDO REMOTO]${NC} cd ${REMOTE_DIR} && $RAG_BUILD_CMD"
            $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_DIR} && $RAG_BUILD_CMD" 2>&1 | grep -vE "(Warning|Permanently)" || true
            RAG_BUILD_EXIT=${PIPESTATUS[0]}
            if [ $RAG_BUILD_EXIT -ne 0 ]; then
                error "❌ Build do RAG Service FALHOU"
                exit 1
            fi
            
            # Build serviços que têm build no compose (frontend e redis)
            info "Construindo serviços com build no compose (Frontend e Redis)..."
            BUILD_CMD="$DOCKER_COMPOSE -f $COMPOSE_FILE build --no-cache"
        fi
        
        # Executa build apenas se BUILD_CMD estiver definido (não foi construído manualmente)
        if [ -n "$BUILD_CMD" ]; then
            # Executa build e mostra saída em tempo real
            echo -e "${YELLOW}[COMANDO SSH]${NC} Construindo imagens Docker (modo produção)"
            echo -e "${YELLOW}[COMANDO SSH]${NC} $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} \"cd ${REMOTE_DIR} && $BUILD_CMD\""
            echo -e "${YELLOW}[COMANDO REMOTO]${NC} cd ${REMOTE_DIR} && $BUILD_CMD"
            echo ""
            echo -e "${BLUE}[SAÍDA DO COMANDO DOCKER COMPOSE]${NC}"
            echo ""
            # Executa o comando e mostra saída em tempo real, filtrando apenas warnings do SSH
            # Usa um pipe nomeado ou arquivo temporário para capturar código de saída
            TEMP_OUTPUT=$(mktemp)
            # Executa o comando, mostra saída em tempo real e salva em arquivo temporário
            $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_DIR} && $BUILD_CMD" 2>&1 | tee "$TEMP_OUTPUT" | grep -vE "(Warning|Permanently)" || true
            # Captura o código de saída do SSH (primeiro comando do pipe)
            BUILD_EXIT_CODE=${PIPESTATUS[0]}
            rm -f "$TEMP_OUTPUT"
            echo ""
            echo -e "${GREEN}[RESULTADO]${NC} Build concluído (exit code: $BUILD_EXIT_CODE)"
            echo ""
            
            # Verifica se build falhou
            if [ $BUILD_EXIT_CODE -ne 0 ]; then
                error "❌ Build FALHOU com código de saída $BUILD_EXIT_CODE"
                if [ $BUILD_EXIT_CODE -eq 255 ]; then
                    error "Possível timeout de conexão SSH durante o build."
                    error "Sugestões:"
                    error "  1. Tente novamente executando apenas o serviço que falhou:"
                    error "     ./scripts/docker-deploy.sh --prod --build --frontend-only"
                    error "  2. Verifique se o servidor tem recursos suficientes (memória/CPU)"
                    error "  3. Verifique a conectividade de rede com o servidor"
                else
                    error "Verifique os erros acima e corrija antes de continuar"
                fi
                exit 1
            fi
        fi
    else
        info "Modo: Desenvolvimento"
        if [ -n "$BUILD_SERVICE" ]; then
            BUILD_CMD="$DOCKER_COMPOSE -f $COMPOSE_FILE build $BUILD_SERVICE"
        else
            BUILD_CMD="$DOCKER_COMPOSE -f $COMPOSE_FILE build"
        fi
        
        # Executa build e mostra saída em tempo real
        echo -e "${YELLOW}[COMANDO SSH]${NC} Construindo imagens Docker (modo desenvolvimento)"
        echo -e "${YELLOW}[COMANDO SSH]${NC} $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} \"cd ${REMOTE_DIR} && $BUILD_CMD\""
        echo -e "${YELLOW}[COMANDO REMOTO]${NC} cd ${REMOTE_DIR} && $BUILD_CMD"
        echo ""
        echo -e "${BLUE}[SAÍDA DO COMANDO DOCKER COMPOSE]${NC}"
        echo ""
        # Executa o comando e mostra saída em tempo real, filtrando apenas warnings do SSH
        # Usa um pipe nomeado ou arquivo temporário para capturar código de saída
        TEMP_OUTPUT=$(mktemp)
        # Executa o comando, mostra saída em tempo real e salva em arquivo temporário
        $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_DIR} && $BUILD_CMD" 2>&1 | tee "$TEMP_OUTPUT" | grep -vE "(Warning|Permanently)" || true
        # Captura o código de saída do SSH (primeiro comando do pipe)
        BUILD_EXIT_CODE=${PIPESTATUS[0]}
        rm -f "$TEMP_OUTPUT"
        echo ""
        echo -e "${GREEN}[RESULTADO]${NC} Build concluído (exit code: $BUILD_EXIT_CODE)"
        echo ""
        
        # Verifica se build falhou
        if [ $BUILD_EXIT_CODE -ne 0 ]; then
            error "❌ Build FALHOU com código de saída $BUILD_EXIT_CODE"
            if [ $BUILD_EXIT_CODE -eq 255 ]; then
                error "Possível timeout de conexão SSH durante o build."
                error "Sugestões:"
                error "  1. Tente novamente executando apenas o serviço que falhou:"
                error "     ./scripts/docker-deploy.sh --dev --build --frontend-only"
                error "  2. Verifique se o servidor tem recursos suficientes (memória/CPU)"
                error "  3. Verifique a conectividade de rede com o servidor"
            else
                error "Verifique os erros acima e corrija antes de continuar"
            fi
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
    # não derrubamos todo o cluster, apenas recriamos o serviço alto.
    section "Recriando Serviço $BUILD_SERVICE"
    info "Recriando apenas o serviço '$BUILD_SERVICE' (os demais permanecem em execução)..."
    UP_CMD="cd ${REMOTE_DIR} && $DOCKER_COMPOSE -f $COMPOSE_FILE up -d $BUILD_SERVICE"
    echo -e "${YELLOW}[COMANDO SSH]${NC} Recriando serviço $BUILD_SERVICE"
    echo -e "${YELLOW}[COMANDO SSH]${NC} $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} \"$UP_CMD\""
    echo -e "${YELLOW}[COMANDO REMOTO]${NC} $UP_CMD"
    echo ""
    $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "$UP_CMD" 2>&1 | while IFS= read -r line; do
        if echo "$line" | grep -qE "(Creating|Starting|Started|Recreating|Up|healthy|Container)"; then
            echo "  $line"
        fi
    done
    UP_EXIT=${PIPESTATUS[0]}
    echo ""
    echo -e "${GREEN}[RESULTADO]${NC} Serviço recriado (exit code: $UP_EXIT)"
    info "✅ Serviço '$BUILD_SERVICE' recriado"
    echo ""
else
    # Modo padrão: derruba e sobe todo o stack
    section "Parando Containers Existentes"
    info "Parando containers existentes..."
    DOWN_CMD="cd ${REMOTE_DIR} && $DOCKER_COMPOSE -f $COMPOSE_FILE down"
    echo -e "${YELLOW}[COMANDO SSH]${NC} Parando containers"
    echo -e "${YELLOW}[COMANDO SSH]${NC} $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} \"$DOWN_CMD\""
    echo -e "${YELLOW}[COMANDO REMOTO]${NC} $DOWN_CMD"
    echo ""
    $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "$DOWN_CMD" 2>&1 | grep -vE "(Warning|Permanently)" || true
    DOWN_EXIT=${PIPESTATUS[0]}
    echo ""
    echo -e "${GREEN}[RESULTADO]${NC} Containers parados (exit code: $DOWN_EXIT)"
    info "✅ Containers parados"
    echo ""

    section "Iniciando Serviços"
    if [ "$MODE" = "prod" ]; then
        info "Iniciando em modo produção..."
    else
        info "Iniciando em modo desenvolvimento..."
    fi

    # Verifica se as imagens necessárias existem
    info "Verificando se as imagens Docker existem..."
    CHECK_IMAGES_CMD="cd ${REMOTE_DIR} && docker images --format '{{.Repository}}:{{.Tag}}' | grep -E 'r-agent2-(api|frontend|rag-service|redis):latest' || echo 'Imagens faltando'"
    IMAGES_CHECK=$($SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "$CHECK_IMAGES_CMD" 2>&1 | grep -vE "(Warning|Permanently)" || true)
    MISSING_IMAGES=""
    for img in r-agent2-api:latest r-agent2-frontend:latest r-agent2-rag-service:latest r-agent2-redis:latest; do
        if ! echo "$IMAGES_CHECK" | grep -q "$img"; then
            MISSING_IMAGES="$MISSING_IMAGES $img"
        fi
    done
    if [ -n "$MISSING_IMAGES" ]; then
        error "❌ Imagens faltando:$MISSING_IMAGES"
        error "Execute o build primeiro ou verifique se as imagens foram construídas corretamente"
        exit 1
    else
        info "✅ Todas as imagens necessárias estão presentes"
    fi
    echo ""

    # Cria os volumes necessários antes de iniciar os serviços
    section "Criando Volumes Docker"
    info "Criando volumes necessários..."
    
    # O Docker Compose adiciona um prefixo baseado no nome do projeto (geralmente o nome do diretório)
    # O prefixo padrão é o nome do diretório onde está o docker-compose.yml
    # Vamos descobrir o prefixo real verificando o nome do diretório remoto
    GET_PROJECT_NAME_CMD="cd ${REMOTE_DIR} && basename \$(pwd) | tr '[:upper:]' '[:lower:]' | tr -cd '[:alnum:]-'"
    PROJECT_NAME=$($SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "$GET_PROJECT_NAME_CMD" 2>&1 | grep -vE "(Warning|Permanently)" | head -1 | tr -d '\r\n' || echo "r-agent2")
    
    # Baseado nos volumes definidos no docker-compose.prod.yml: redis-data, rag-vector-store, api-data
    VOLUME_PREFIX="${PROJECT_NAME}"
    VOLUMES_TO_CREATE=("${VOLUME_PREFIX}_redis-data" "${VOLUME_PREFIX}_rag-vector-store" "${VOLUME_PREFIX}_api-data")
    
    info "Verificando/criando volumes com prefixo '${VOLUME_PREFIX}':"
    for vol in "${VOLUMES_TO_CREATE[@]}"; do
        # Verifica se o volume existe
        CHECK_VOL_CMD="docker volume inspect $vol >/dev/null 2>&1 && echo 'exists' || echo 'not_exists'"
        VOL_EXISTS=$($SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_DIR} && $CHECK_VOL_CMD" 2>&1 | grep -vE "(Warning|Permanently)" | head -1 | tr -d '\r\n' || echo "not_exists")
        
        if [ "$VOL_EXISTS" = "exists" ]; then
            info "  ✓ Volume $vol já existe"
        else
            # Tenta criar o volume
            CREATE_VOL_CMD="docker volume create $vol 2>&1"
            echo -e "${YELLOW}[COMANDO REMOTO]${NC} docker volume create $vol"
            VOL_OUTPUT=$($SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_DIR} && $CREATE_VOL_CMD" 2>&1 | grep -vE "(Warning|Permanently)" || true)
            if echo "$VOL_OUTPUT" | grep -qE "Created|$vol"; then
                info "  ✓ Volume $vol criado com sucesso"
            else
                warn "  ⚠ Aviso ao criar volume $vol: $VOL_OUTPUT"
                warn "  (O Docker Compose tentará criar automaticamente se necessário)"
            fi
        fi
    done
    echo ""
    info "✅ Volumes verificados/criados"
    echo ""

    # Copia dados sincronizados para o volume Docker (se existirem)
    section "Copiando Dados para Volume Docker"
    info "Verificando se há dados sincronizados para copiar para o volume..."
    
    # Verifica se o diretório api/data existe no servidor
    CHECK_DATA_DIR_CMD="cd ${REMOTE_DIR} && test -d api/data && ls api/data/*.json 2>/dev/null | head -1 || echo ''"
    DATA_FILES=$($SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "$CHECK_DATA_DIR_CMD" 2>&1 | grep -vE "(Warning|Permanently)" | head -1 || echo "")
    
    if [ -n "$DATA_FILES" ]; then
        info "Dados encontrados em ${REMOTE_DIR}/api/data, copiando para o volume..."
        
        # Copia dados do diretório sincronizado para o volume usando container temporário
        COPY_DATA_CMD="cd ${REMOTE_DIR} && docker run --rm -v ${VOLUME_PREFIX}_api-data:/data -v \$(pwd)/api/data:/source alpine sh -c 'cp -r /source/* /data/ 2>/dev/null && echo \"Dados copiados\" || echo \"Aviso: alguns arquivos podem não ter sido copiados\"'"
        echo -e "${YELLOW}[COMANDO REMOTO]${NC} Copiando dados para volume Docker"
        $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "$COPY_DATA_CMD" 2>&1 | grep -vE "(Warning|Permanently)" || true
        COPY_EXIT=${PIPESTATUS[0]}
        
        if [ $COPY_EXIT -eq 0 ]; then
            info "✅ Dados copiados para o volume Docker"
        else
            warn "⚠️  Aviso: pode ter havido problemas ao copiar dados para o volume"
        fi
    else
        info "Nenhum dado encontrado em ${REMOTE_DIR}/api/data (volume será inicializado vazio)"
    fi
    echo ""

    UP_CMD="cd ${REMOTE_DIR} && $DOCKER_COMPOSE -f $COMPOSE_FILE up -d"
    echo -e "${YELLOW}[COMANDO SSH]${NC} Iniciando serviços"
    echo -e "${YELLOW}[COMANDO SSH]${NC} $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} \"$UP_CMD\""
    echo -e "${YELLOW}[COMANDO REMOTO]${NC} $UP_CMD"
    echo ""
    
    # Captura saída completa para diagnóstico
    TEMP_UP_OUTPUT=$(mktemp)
    $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "$UP_CMD" 2>&1 | tee "$TEMP_UP_OUTPUT" | grep -vE "(Warning|Permanently)" || true
    UP_EXIT=${PIPESTATUS[0]}
    
    # Mostra saída filtrada (apenas linhas importantes)
    echo ""
    if [ $UP_EXIT -eq 0 ]; then
        echo -e "${GREEN}[RESULTADO]${NC} Serviços iniciados (exit code: $UP_EXIT)"
        info "✅ Serviços iniciados"
    else
        echo -e "${RED}[RESULTADO]${NC} Falha ao iniciar serviços (exit code: $UP_EXIT)"
        error "❌ Erro ao iniciar serviços"
        echo ""
        info "Saída completa do comando:"
        cat "$TEMP_UP_OUTPUT" | grep -vE "(Warning|Permanently)" || true
        echo ""
        info "Verificando erros específicos..."
        ERROR_OUTPUT=$(cat "$TEMP_UP_OUTPUT" | grep -iE "(error|failed|cannot|unable|missing)" || true)
        if [ -n "$ERROR_OUTPUT" ]; then
            echo "$ERROR_OUTPUT" | head -10
        fi
        echo ""
        info "Verificando status dos containers criados..."
        $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_DIR} && docker ps -a --filter 'name=r-agent2' --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'" 2>&1 | grep -vE "(Warning|Permanently)" || true
        echo ""
        error "Verifique os erros acima e corrija antes de continuar"
        rm -f "$TEMP_UP_OUTPUT"
        exit 1
    fi
    rm -f "$TEMP_UP_OUTPUT"
    echo ""
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
        HEALTH_CMD="curl -f http://localhost:8086 &> /dev/null"
        echo -e "${YELLOW}[COMANDO SSH]${NC} Verificando saúde do Frontend"
        echo -e "${YELLOW}[COMANDO SSH]${NC} $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} \"$HEALTH_CMD\""
        echo -e "${YELLOW}[COMANDO REMOTO]${NC} $HEALTH_CMD"
        echo ""
        if $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "$HEALTH_CMD" 2>&1 | grep -vE "(Warning|Permanently)" > /dev/null; then
            HEALTH_EXIT=${PIPESTATUS[0]}
            echo -e "${GREEN}[RESULTADO]${NC} Frontend está respondendo (exit code: $HEALTH_EXIT)"
            info "✓ Frontend está respondendo"
        else
            HEALTH_EXIT=${PIPESTATUS[0]}
            echo -e "${YELLOW}[RESULTADO]${NC} Frontend não está respondendo ainda (exit code: $HEALTH_EXIT)"
            warn "⚠ Frontend não está respondendo ainda (pode estar iniciando)"
        fi
        echo ""
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
    PS_CMD="cd ${REMOTE_DIR} && $DOCKER_COMPOSE -f $COMPOSE_FILE ps"
    echo -e "${YELLOW}[COMANDO SSH]${NC} Verificando status dos containers"
    echo -e "${YELLOW}[COMANDO SSH]${NC} $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} \"$PS_CMD\""
    echo -e "${YELLOW}[COMANDO REMOTO]${NC} $PS_CMD"
    echo ""
    $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "$PS_CMD" 2>&1 | grep -vE "(Warning|Permanently)" || true
    PS_EXIT=${PIPESTATUS[0]}
    echo ""
    echo -e "${GREEN}[RESULTADO]${NC} Status verificado (exit code: $PS_EXIT)"
    echo ""

    # Verifica se os containers estão realmente rodando
    info "Verificando se containers estão rodando..."
    CHECK_CONTAINERS_CMD="cd ${REMOTE_DIR} && docker ps -a --filter 'name=r-agent2' --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'"
    echo -e "${YELLOW}[COMANDO SSH]${NC} Verificando containers não rodando"
    echo -e "${YELLOW}[COMANDO SSH]${NC} $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} \"$CHECK_CONTAINERS_CMD\""
    echo -e "${YELLOW}[COMANDO REMOTO]${NC} $CHECK_CONTAINERS_CMD"
    echo ""
    CONTAINER_STATUS=$($SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "$CHECK_CONTAINERS_CMD" 2>&1 | grep -vE "(Warning|Permanently)" || true)
    echo "$CONTAINER_STATUS"
    echo ""
    
    # Verifica containers não rodando
    NOT_RUNNING=$(echo "$CONTAINER_STATUS" | grep -vE "(Up|NAMES|^$)" || true)
    if [ -n "$NOT_RUNNING" ]; then
        warn "⚠ Alguns containers não estão rodando:"
        echo "$NOT_RUNNING"
        echo ""
        
        # Verifica se containers existem mas não estão rodando
        for container in api frontend rag-service redis; do
            CONTAINER_NAME="r-agent2-${container}-prod"
            EXISTS_CMD="cd ${REMOTE_DIR} && docker ps -a --filter 'name=^${CONTAINER_NAME}$' --format '{{.Names}}'"
            EXISTS=$($SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "$EXISTS_CMD" 2>&1 | grep -vE "(Warning|Permanently)" || true)
            
            if [ -n "$EXISTS" ]; then
                # Container existe, verifica status
                STATUS_CMD="cd ${REMOTE_DIR} && docker inspect ${CONTAINER_NAME} --format '{{.State.Status}}' 2>/dev/null || echo 'não encontrado'"
                STATUS=$($SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "$STATUS_CMD" 2>&1 | grep -vE "(Warning|Permanently)" || true)
                
                if [ "$STATUS" != "running" ]; then
                    info "Container ${container} está em status: $STATUS"
                    if [ "$STATUS" != "não encontrado" ]; then
                        info "Mostrando logs de erro do container ${container}..."
                        LOGS_ERR_CMD="cd ${REMOTE_DIR} && docker logs ${CONTAINER_NAME} --tail=50 2>&1"
                        $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "$LOGS_ERR_CMD" 2>&1 | grep -vE "(Warning|Permanently)" | tail -30 || true
                        echo ""
                        
                        # Verifica se há erro de imagem
                        IMAGE_CMD="cd ${REMOTE_DIR} && docker inspect ${CONTAINER_NAME} --format '{{.Config.Image}}' 2>/dev/null || echo 'imagem não encontrada'"
                        IMAGE=$($SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "$IMAGE_CMD" 2>&1 | grep -vE "(Warning|Permanently)" || true)
                        info "Imagem esperada: $IMAGE"
                        
                        # Verifica se a imagem existe
                        IMAGE_EXISTS_CMD="cd ${REMOTE_DIR} && docker images --format '{{.Repository}}:{{.Tag}}' | grep -q '^${IMAGE}$' && echo 'existe' || echo 'não existe'"
                        IMAGE_EXISTS=$($SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "$IMAGE_EXISTS_CMD" 2>&1 | grep -vE "(Warning|Permanently)" || true)
                        if [ "$IMAGE_EXISTS" != "existe" ]; then
                            error "❌ Imagem $IMAGE não encontrada! Execute o build primeiro."
                        fi
                        echo ""
                    fi
                fi
            else
                warn "Container ${container} não foi criado"
            fi
        done
    else
        info "✅ Todos os containers estão rodando"
    fi
    echo ""

    section "Logs Iniciais (últimas 30 linhas)"
    LOGS_CMD="cd ${REMOTE_DIR} && $DOCKER_COMPOSE -f $COMPOSE_FILE logs --tail=30"
    echo -e "${YELLOW}[COMANDO SSH]${NC} Obtendo logs iniciais"
    echo -e "${YELLOW}[COMANDO SSH]${NC} $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} \"$LOGS_CMD\""
    echo -e "${YELLOW}[COMANDO REMOTO]${NC} $LOGS_CMD"
    echo ""
    $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "$LOGS_CMD" 2>&1 | grep -vE "(Warning|Permanently)" || true
    LOGS_EXIT=${PIPESTATUS[0]}
    echo ""
    echo -e "${GREEN}[RESULTADO]${NC} Logs obtidos (exit code: $LOGS_EXIT)"
    echo ""

    section "Verificando Saúde dos Serviços"
    info "Aguardando mais 20 segundos para health checks..."
    sleep 20

    # Verifica API
    info "Verificando API..."
    HEALTH_API_CMD="curl -f -s -o /dev/null -w '%{http_code}' http://localhost:3001/health"
    echo -e "${YELLOW}[COMANDO SSH]${NC} Verificando saúde da API"
    echo -e "${YELLOW}[COMANDO SSH]${NC} $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} \"$HEALTH_API_CMD\""
    echo -e "${YELLOW}[COMANDO REMOTO]${NC} $HEALTH_API_CMD"
    echo ""
    HEALTH_API_OUTPUT=$($SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "$HEALTH_API_CMD" 2>&1 | grep -vE "(Warning|Permanently)" || true)
    HEALTH_API_EXIT=${PIPESTATUS[0]}
    if [ $HEALTH_API_EXIT -eq 0 ] && echo "$HEALTH_API_OUTPUT" | grep -qE "^200$"; then
        echo -e "${GREEN}[RESULTADO]${NC} API está respondendo (HTTP 200)"
        info "✓ API está respondendo"
    else
        echo -e "${RED}[RESULTADO]${NC} API não está respondendo (exit code: $HEALTH_API_EXIT, output: $HEALTH_API_OUTPUT)"
        error "❌ API não está respondendo"
        info "Verificando logs da API..."
        $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_DIR} && docker logs r-agent2-api-prod --tail=50" 2>&1 | grep -vE "(Warning|Permanently)" | tail -30 || true
    fi
    echo ""

    # Verifica Frontend
    info "Verificando Frontend..."
    HEALTH_FRONTEND_CMD="curl -f -s -o /dev/null -w '%{http_code}' http://localhost:8086"
    echo -e "${YELLOW}[COMANDO SSH]${NC} Verificando saúde do Frontend"
    echo -e "${YELLOW}[COMANDO SSH]${NC} $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} \"$HEALTH_FRONTEND_CMD\""
    echo -e "${YELLOW}[COMANDO REMOTO]${NC} $HEALTH_FRONTEND_CMD"
    echo ""
    HEALTH_FRONTEND_OUTPUT=$($SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "$HEALTH_FRONTEND_CMD" 2>&1 | grep -vE "(Warning|Permanently)" || true)
    HEALTH_FRONTEND_EXIT=${PIPESTATUS[0]}
    if [ $HEALTH_FRONTEND_EXIT -eq 0 ] && echo "$HEALTH_FRONTEND_OUTPUT" | grep -qE "^200$"; then
        echo -e "${GREEN}[RESULTADO]${NC} Frontend está respondendo (HTTP 200)"
        info "✓ Frontend está respondendo"
    else
        echo -e "${RED}[RESULTADO]${NC} Frontend não está respondendo (exit code: $HEALTH_FRONTEND_EXIT, output: $HEALTH_FRONTEND_OUTPUT)"
        error "❌ Frontend não está respondendo"
        info "Verificando logs do Frontend..."
        $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_DIR} && docker logs r-agent2-frontend-prod --tail=50" 2>&1 | grep -vE "(Warning|Permanently)" | tail -30 || true
        info "Verificando se API está healthy (frontend depende da API)..."
        $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_DIR} && docker inspect r-agent2-api-prod --format '{{.State.Health.Status}}' 2>/dev/null || echo 'Health check não disponível'" 2>&1 | grep -vE "(Warning|Permanently)" || true
    fi
    echo ""

    # Verifica RAG Service
    info "Verificando RAG Service..."
    HEALTH_RAG_CMD="curl -f -s -o /dev/null -w '%{http_code}' http://localhost:8002/rag/health"
    echo -e "${YELLOW}[COMANDO SSH]${NC} Verificando saúde do RAG Service"
    echo -e "${YELLOW}[COMANDO SSH]${NC} $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} \"$HEALTH_RAG_CMD\""
    echo -e "${YELLOW}[COMANDO REMOTO]${NC} $HEALTH_RAG_CMD"
    echo ""
    HEALTH_RAG_OUTPUT=$($SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "$HEALTH_RAG_CMD" 2>&1 | grep -vE "(Warning|Permanently)" || true)
    HEALTH_RAG_EXIT=${PIPESTATUS[0]}
    if [ $HEALTH_RAG_EXIT -eq 0 ] && echo "$HEALTH_RAG_OUTPUT" | grep -qE "^200$"; then
        echo -e "${GREEN}[RESULTADO]${NC} RAG Service está respondendo (HTTP 200)"
        info "✓ RAG Service está respondendo"
    else
        echo -e "${YELLOW}[RESULTADO]${NC} RAG Service não está respondendo ainda (exit code: $HEALTH_RAG_EXIT, output: $HEALTH_RAG_OUTPUT)"
        warn "⚠ RAG Service não está respondendo ainda (pode estar iniciando)"
    fi
    echo ""

    section "Deploy Concluído!"

    info "Serviços disponíveis no servidor $REMOTE_HOST:"
    echo "  - Frontend: http://$REMOTE_HOST:8086"
    echo "  - API: http://$REMOTE_HOST:3001"
    echo "  - RAG Service: http://$REMOTE_HOST:8002"
    echo ""
    info "Para ver os logs:"
    echo "  ssh ${REMOTE_USER}@${REMOTE_HOST} 'cd ${REMOTE_DIR} && $DOCKER_COMPOSE -f $COMPOSE_FILE logs -f'"
    info "Para ver logs de um serviço específico:"
    echo "  ssh ${REMOTE_USER}@${REMOTE_HOST} 'cd ${REMOTE_DIR} && docker logs r-agent2-api-prod -f'"
    echo "  ssh ${REMOTE_USER}@${REMOTE_HOST} 'cd ${REMOTE_DIR} && docker logs r-agent2-frontend-prod -f'"
    info "Para parar os serviços:"
    echo "  ssh ${REMOTE_USER}@${REMOTE_HOST} 'cd ${REMOTE_DIR} && $DOCKER_COMPOSE -f $COMPOSE_FILE down'"
fi
