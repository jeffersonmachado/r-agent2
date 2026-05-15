#!/bin/bash

# Script para deploy em servidor Docker remoto
# Uso: ./scripts/docker-deploy-remote.sh [--host HOST] [--user USER] [--registry REGISTRY] [--tag TAG]

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
SSH_PASSWORD="${SSH_PASSWORD:?Erro: SSH_PASSWORD não definida}"

REMOTE_HOST="${DEPLOY_HOST}"
REMOTE_USER="${DEPLOY_USER:-root}"
REMOTE_DIR="${DEPLOY_DIR:-/opt/r-agent2}"
REGISTRY="${DOCKER_REGISTRY:-}"
TAG="${DOCKER_TAG:-latest}"
IMAGE_PREFIX="r-agent2"
USE_SSH_KEY=false
SSH_KEY=""

# Exporta SSHPASS com valor padrão se não estiver definido
if [ -z "$SSHPASS" ]; then
    export SSHPASS="$SSH_PASSWORD"
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
        --prefix)
            IMAGE_PREFIX="$2"
            shift 2
            ;;
        --ssh-key)
            SSH_KEY="$2"
            USE_SSH_KEY=true
            shift 2
            ;;
        *)
            error "Argumento desconhecido: $1"
            echo "Uso: $0 [--host HOST] [--user USER] [--dir DIR] [--registry REGISTRY] [--tag TAG] [--ssh-key KEY]"
            exit 1
            ;;
    esac
done

# Validação
if [ -z "$REMOTE_HOST" ]; then
    error "Host remoto não especificado."
    echo "Use --host ou export DEPLOY_HOST=seu-servidor.com"
    exit 1
fi

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

# Configura SSH
SSH_OPTS=""
if [ "$USE_SSH_KEY" = true ] && [ -n "$SSH_KEY" ]; then
    SSH_OPTS="-i $SSH_KEY"
fi

SSH_CMD="ssh $SSH_OPTS ${REMOTE_USER}@${REMOTE_HOST}"
SCP_CMD="scp $SSH_OPTS"

# Diretório raiz do projeto
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

section "Deploy em Servidor Remoto"

info "Configuração:"
echo "  Host: $REMOTE_HOST"
echo "  User: $REMOTE_USER"
echo "  Diretório: $REMOTE_DIR"
echo "  Registry: ${REGISTRY:-Docker Hub (padrão)}"
echo "  Tag: $TAG"

# Testa conexão SSH
section "Testando Conexão SSH"
info "Testando conexão com $REMOTE_HOST..."
if ! $SSH_CMD "echo 'Conexão OK'" &> /dev/null; then
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
if ! $SSH_CMD "command -v docker &> /dev/null"; then
    error "Docker não está instalado no servidor remoto."
    exit 1
fi
info "Docker encontrado!"

# Cria diretório no servidor
section "Preparando Diretório no Servidor"
info "Criando diretório $REMOTE_DIR no servidor..."
$SSH_CMD "mkdir -p $REMOTE_DIR" || true

# Copia arquivos necessários
section "Copiando Arquivos para o Servidor"
info "Copiando docker-compose.prod.yml..."
$SCP_CMD docker-compose.prod.yml ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/

info "Copiando env.example..."
$SCP_CMD env.example ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/

# Verifica se .env existe no servidor, se não, cria
info "Verificando arquivo .env no servidor..."
if ! $SSH_CMD "test -f ${REMOTE_DIR}/.env"; then
    warn ".env não encontrado. Criando a partir de env.example..."
    $SSH_CMD "cp ${REMOTE_DIR}/env.example ${REMOTE_DIR}/.env"
    warn "IMPORTANTE: Edite o arquivo .env no servidor antes de continuar!"
    read -p "Pressione Enter após editar o .env no servidor..."
fi

# Cria script de deploy no servidor
section "Criando Script de Deploy no Servidor"
DEPLOY_SCRIPT=$(cat <<'EOF'
#!/bin/bash
set -e

REGISTRY="${1:-}"
TAG="${2:-latest}"
IMAGE_PREFIX="${3:-r-agent2}"

# Constrói nome da imagem
build_image_name() {
    local service=$1
    if [ -z "$REGISTRY" ]; then
        echo "${IMAGE_PREFIX}-${service}:${TAG}"
    else
        REGISTRY=$(echo "$REGISTRY" | sed 's|/$||')
        echo "${REGISTRY}/${IMAGE_PREFIX}-${service}:${TAG}"
    fi
}

echo "=== Deploy R-Agent2 ==="
echo "Registry: ${REGISTRY:-Docker Hub}"
echo "Tag: $TAG"

# Login no registry se necessário
if [ -n "$REGISTRY" ] && [ "$REGISTRY" != "docker.io" ]; then
    echo "Fazendo login no registry..."
    docker login "$REGISTRY" || true
fi

# Pull das imagens
echo "Fazendo pull das imagens..."
API_IMAGE=$(build_image_name "api")
FRONTEND_IMAGE=$(build_image_name "frontend")
RAG_IMAGE=$(build_image_name "rag-service")

docker pull "$API_IMAGE" || echo "Aviso: Não foi possível fazer pull de $API_IMAGE"
docker pull "$FRONTEND_IMAGE" || echo "Aviso: Não foi possível fazer pull de $FRONTEND_IMAGE"
docker pull "$RAG_IMAGE" || echo "Aviso: Não foi possível fazer pull de $RAG_IMAGE"

# Atualiza docker-compose.prod.yml com as imagens corretas
sed -i "s|image: r-agent2-api:latest|image: $API_IMAGE|g" docker-compose.prod.yml
sed -i "s|image: r-agent2-frontend:latest|image: $FRONTEND_IMAGE|g" docker-compose.prod.yml
sed -i "s|image: r-agent2-rag-service:latest|image: $RAG_IMAGE|g" docker-compose.prod.yml

# Para containers existentes
echo "Parando containers existentes..."
docker-compose -f docker-compose.prod.yml down || true

# Inicia os serviços
echo "Iniciando serviços..."
docker-compose -f docker-compose.prod.yml up -d

# Aguarda um pouco
sleep 5

# Mostra status
echo "Status dos containers:"
docker-compose -f docker-compose.prod.yml ps

echo "=== Deploy Concluído ==="
EOF
)

# Envia script para o servidor
echo "$DEPLOY_SCRIPT" | $SSH_CMD "cat > ${REMOTE_DIR}/deploy.sh"
$SSH_CMD "chmod +x ${REMOTE_DIR}/deploy.sh"

# Executa deploy no servidor
section "Executando Deploy no Servidor"
info "Executando deploy remoto..."
$SSH_CMD "cd ${REMOTE_DIR} && ./deploy.sh \"$REGISTRY\" \"$TAG\" \"$IMAGE_PREFIX\""

section "Deploy Concluído!"

info "Serviços devem estar disponíveis em:"
echo "  - Frontend: http://${REMOTE_HOST}:8080"
echo "  - API: http://${REMOTE_HOST}:3000"
echo "  - RAG Service: http://${REMOTE_HOST}:8000"

info "Para ver logs no servidor:"
echo "  ssh ${REMOTE_USER}@${REMOTE_HOST} 'cd ${REMOTE_DIR} && docker-compose -f docker-compose.prod.yml logs -f'"

info "Para parar os serviços:"
echo "  ssh ${REMOTE_USER}@${REMOTE_HOST} 'cd ${REMOTE_DIR} && docker-compose -f docker-compose.prod.yml down'"

