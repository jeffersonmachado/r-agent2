#!/bin/bash

# Script para deploy usando docker save/load (sem registry)
# Uso: ./scripts/docker-deploy-save-load.sh [--host HOST] [--user USER] [--dir DIR]

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

# Variáveis padrão
# Valores padrão definidos aqui
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

# Configura SSH com senha (usando variável de ambiente para evitar problemas com aspas)
export SSHPASS="$SSH_PASSWORD"
SSH_CMD="sshpass -e ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=30"
SCP_CMD="sshpass -e scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=30"
# Rsync com progresso e sshpass
RSYNC_SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=30"
RSYNC_CMD="rsync -avz --progress -e 'sshpass -e ssh $RSYNC_SSH_OPTS'"

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
            shift 2
            ;;
        *)
            error "Argumento desconhecido: $1"
            echo "Uso: $0 [--host HOST] [--user USER] [--dir DIR]"
            exit 1
            ;;
    esac
done

# Diretório raiz do projeto
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

section "Deploy usando Docker Save/Load"

info "Configuração:"
echo "  Host: $REMOTE_HOST"
echo "  User: $REMOTE_USER"
echo "  Diretório: $REMOTE_DIR"

# Verifica imagens locais
section "Verificando Imagens Locais"
IMAGES=("r-agent2-api:latest" "r-agent2-frontend:latest" "r-agent2-rag-service:latest")
MISSING_IMAGES=()

for img in "${IMAGES[@]}"; do
    if docker image inspect "$img" &>/dev/null; then
        info "✅ $img encontrada"
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
    info "  Destino: $TEMP_DIR/${FILENAME}.tar"
    
    # Salva com progresso
    if command -v pv &> /dev/null; then
        docker save "$img" | pv -s $(docker image inspect "$img" --format='{{.Size}}') > "$TEMP_DIR/${FILENAME}.tar"
    else
        docker save "$img" -o "$TEMP_DIR/${FILENAME}.tar" 2>&1 | while IFS= read -r line; do
            echo "    $line"
        done
    fi
    
    SIZE=$(du -h "$TEMP_DIR/${FILENAME}.tar" | cut -f1)
    info "  ✅ Concluído! Tamanho: $SIZE"
done

# Copia arquivos necessários
section "Copiando Arquivos para o Servidor"
info "Criando diretório no servidor..."
if $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "mkdir -p $REMOTE_DIR" 2>&1 | grep -vE "(Warning|Permanently)"; then
    info "  ✅ Diretório criado"
else
    warn "  ⚠️  Aviso ao criar diretório (pode já existir)"
fi

info "Copiando docker-compose.prod.yml..."
if rsync -avz --progress -e "sshpass -e ssh $RSYNC_SSH_OPTS" docker-compose.prod.yml ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/ 2>&1 | grep -vE "(Warning|Permanently|debug1)"; then
    info "  ✅ docker-compose.prod.yml copiado"
else
    error "  ❌ Erro ao copiar docker-compose.prod.yml"
    exit 1
fi

# Copia imagens
section "Copiando Imagens para o Servidor"
CURRENT=0
for img in "${IMAGES[@]}"; do
    CURRENT=$((CURRENT + 1))
    FILENAME=$(echo "$img" | tr '/:' '_')
    SIZE=$(du -h "$TEMP_DIR/${FILENAME}.tar" | cut -f1)
    info "[$CURRENT/$TOTAL_IMAGES] Copiando ${FILENAME}.tar ($SIZE)..."
    info "  Isso pode demorar alguns minutos..."
    echo ""
    
    # Usa rsync com progresso
    rsync -avz --progress -e "sshpass -e ssh $RSYNC_SSH_OPTS" "$TEMP_DIR/${FILENAME}.tar" ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/ 2>&1 | while IFS= read -r line; do
        # Mostra todas as linhas de progresso do rsync
        if echo "$line" | grep -qE "(^\s+[0-9,]+%|sent|total size|speedup|building|file list)"; then
            echo "    $line"
        fi
    done
    
    if [ $? -eq 0 ]; then
        echo ""
        info "  ✅ ${FILENAME}.tar copiado com sucesso"
    else
        echo ""
        error "  ❌ Erro ao copiar ${FILENAME}.tar"
        exit 1
    fi
done

# Carrega imagens no servidor
section "Carregando Imagens no Servidor"
CURRENT=0
for img in "${IMAGES[@]}"; do
    CURRENT=$((CURRENT + 1))
    FILENAME=$(echo "$img" | tr '/:' '_')
    info "[$CURRENT/$TOTAL_IMAGES] Carregando $img..."
    
    # Carrega imagem e mostra progresso
    $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "cd $REMOTE_DIR && echo 'Carregando imagem...' && docker load -i ${FILENAME}.tar 2>&1 && echo 'Limpando arquivo temporário...' && rm -f ${FILENAME}.tar && echo 'Imagem carregada!'" 2>&1 | while IFS= read -r line; do
        if echo "$line" | grep -qE "(Loading|Loaded|sha256|Cleaning|Imagem)"; then
            echo "    $line"
        fi
    done
    
    if [ $? -eq 0 ]; then
        info "  ✅ $img carregada com sucesso"
    else
        error "  ❌ Erro ao carregar $img"
        exit 1
    fi
done

# Deploy no servidor
section "Fazendo Deploy no Servidor"
DEPLOY_SCRIPT=$(cat <<EOF
#!/bin/bash
set -e
cd ${REMOTE_DIR}

echo "=== Parando Containers Existentes ==="
docker-compose -f docker-compose.prod.yml down || true

echo "=== Iniciando Containers ==="
docker-compose -f docker-compose.prod.yml up -d

echo "=== Aguardando Inicialização ==="
sleep 10

echo "=== Status dos Containers ==="
docker-compose -f docker-compose.prod.yml ps

echo "=== Testando Frontend ==="
curl -s -o /dev/null -w "Frontend Status: %{http_code}\n" http://127.0.0.1:8086/ || echo "Frontend ainda não está pronto"

echo "=== Testando API ==="
curl -s -o /dev/null -w "API Status: %{http_code}\n" http://127.0.0.1:3001/health || echo "API ainda não está pronto"

echo "=== Deploy Concluído ==="
EOF
)

echo "$DEPLOY_SCRIPT" | $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "cat > ${REMOTE_DIR}/deploy.sh && chmod +x ${REMOTE_DIR}/deploy.sh" 2>&1 | grep -vE "(Warning|Permanently)" || true

info "Executando deploy no servidor..."
info "  Isso pode levar alguns minutos..."
$SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_DIR} && ./deploy.sh" 2>&1 | while IFS= read -r line; do
    if echo "$line" | grep -qE "(===|Status|Testando|Concluído|Error|error)"; then
        echo "  $line"
    else
        echo "    $line"
    fi
done

section "Deploy Concluído!"

info "Serviços devem estar disponíveis em:"
echo "  - Frontend: http://${REMOTE_HOST}:8086"
echo "  - API: http://${REMOTE_HOST}:3001"
echo "  - RAG Service: http://${REMOTE_HOST}:8002"

info "Para ver logs:"
echo "  sshpass -p '$SSH_PASSWORD' ssh ${REMOTE_USER}@${REMOTE_HOST} 'cd ${REMOTE_DIR} && docker-compose -f docker-compose.prod.yml logs -f'"

info "Para ver status:"
echo "  sshpass -p '$SSH_PASSWORD' ssh ${REMOTE_USER}@${REMOTE_HOST} 'cd ${REMOTE_DIR} && docker-compose -f docker-compose.prod.yml ps'"
