#!/bin/bash

# Script para update de arquivos do Frontend sem qualquer build/install.
# Uso: ./scripts/docker-deploy-frontend-only-copy.sh [--host HOST] [--user USER] [--password PASSWORD]
#
# NOTA: Este é o modo mais rápido para updates de código do frontend.
# - Sincroniza: apenas frontend/ (código fonte)
# - NO npm install / NO docker build
# - Reinicia: apenas o container frontend
#
# ATENÇÃO: Em ambientes sem bind mount do frontend, essa estratégia pode não surtir efeito
# (imagem pode continuar servindo build já empacotado).

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Funções de log
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
SSH_PASSWORD="${SSH_PASSWORD:?Erro: SSH_PASSWORD não definida}"
USE_SSH_DIRECT="${DEPLOY_USE_SSH_DIRECT:-false}"

# Detecta diretório do projeto
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$PROJECT_ROOT"

REMOTE_HOST="${DEPLOY_HOST}"
REMOTE_USER="${DEPLOY_USER:-root}"
REMOTE_DIR="${DEPLOY_DIR:-/opt/results/ria/r-agent2}"

# Timeouts aumentados (SSH pode ser lento em redes lentas)
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=60 -o ServerAliveInterval=30 -o ServerAliveCountMax=60 -o TCPKeepAlive=yes"

if [ "$USE_SSH_DIRECT" = "true" ]; then
    SSH_CMD="ssh $SSH_OPTS"
    RSYNC_SSH_TRANSPORT="ssh $SSH_OPTS"
else
    if [ -z "$SSHPASS" ]; then
        export SSHPASS="$SSH_PASSWORD"
    fi

    if ! command -v sshpass &> /dev/null; then
        error "sshpass nao esta instalado"
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
            exit 1
            ;;
    esac
done

cd "$ROOT_DIR"

section "Copy-Only Frontend Update - Apenas Codigo Fonte"

info "Modo: copia de codigo frontend (sem npm install, sem build)"
echo ""
info "Configuracao:"
echo "  Host: $REMOTE_HOST"
echo "  User: $REMOTE_USER"
echo "  Diretorio: $REMOTE_DIR"

# Testa conexão SSH
section "Testando Conexao SSH"
info "Conectando a ${REMOTE_USER}@${REMOTE_HOST}:22 (timeout=60s)..."

SSH_TEST=$(eval "$SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} \"echo 'SSH_OK'\"" 2>&1)
if [ $? -ne 0 ]; then
    error "SSH falhou para ${REMOTE_USER}@${REMOTE_HOST}"
    echo "Erro: $SSH_TEST"
    echo ""
    error "Dicas de troubleshoot:"
    echo "  1. Verifique: ssh -v -o ConnectTimeout=60 ${REMOTE_USER}@${REMOTE_HOST}"
    echo "  2. Verifique firewall/rede: nc -zv ${REMOTE_HOST} 22"
    echo "  3. Verifique credenciais/acesso SSH"
    exit 1
fi

info "Conexao SSH OK"
echo ""

# Verifica Docker disponível
section "Verificando Docker no Servidor"
DOCKER_CMD=$($SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "command -v docker >/dev/null 2>&1 && echo docker")
if [ -z "$DOCKER_CMD" ]; then
    error "Docker nao encontrado no servidor"
    exit 1
fi
info "Docker encontrado"
echo ""

# Resolve diretório remoto (prioriza mount real do container frontend)
section "Resolvendo Diretorio Remoto"
REMOTE_DIR_FROM_CONTAINER=$($SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "docker inspect --format '{{range .Mounts}}{{println .Source}}{{end}}' r-agent2-frontend-prod 2>/dev/null | awk '/\\/frontend(\\/dist|\\/build)?$/ { sub(/\\/frontend(\\/dist|\\/build)?$/, \"\", \$0); print; exit }'")
if [ -n "$REMOTE_DIR_FROM_CONTAINER" ]; then
    RESOLVED_REMOTE_DIR="$REMOTE_DIR_FROM_CONTAINER"
else
    RESOLVED_REMOTE_DIR=$($SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "for d in '${REMOTE_DIR}' /opt/r-agent2 /opt/results/ria/r-agent2 /root/r-agent2 /opt/aprende-ai; do if [ -d \"\$d\" ] && [ -d \"\$d/frontend\" ]; then echo \"\$d\"; break; fi; done")
fi
if [ -z "$RESOLVED_REMOTE_DIR" ]; then
    error "Nao foi possivel localizar diretorio remoto da aplicacao"
    exit 1
fi
if [ "$RESOLVED_REMOTE_DIR" != "$REMOTE_DIR" ]; then
    warn "Diretorio configurado nao encontrado/invalido; usando diretorio detectado: $RESOLVED_REMOTE_DIR"
fi
REMOTE_DIR="$RESOLVED_REMOTE_DIR"
info "Diretorio remoto em uso: $REMOTE_DIR"
echo ""

# Sincroniza frontend
section "Sincronizando Codigo do Frontend"
info "Copiando apenas frontend/ para o servidor..."

EXCLUDE_LIST=(
    "--exclude=node_modules"
    "--exclude=.git"
    "--exclude=.env"
    "--exclude=.DS_Store"
    "--exclude=*.log"
    "--exclude=dist"
    "--exclude=build"
    "--exclude=.vscode"
    "--exclude=.idea"
    "--exclude=Dockerfile*"
    "--exclude=.dockerignore"
)

SYNC_PATHS=(
    "${ROOT_DIR}/frontend/"
)

info "Executando rsync (pode levar alguns segundos)..."
rsync -avz --delete \
    "${EXCLUDE_LIST[@]}" \
    -e "$RSYNC_SSH_TRANSPORT" \
    "${SYNC_PATHS[@]}" \
    "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/" \
    2>&1 | tee /tmp/rsync-frontend-copy.log | tail -10

RSYNC_EXIT=${PIPESTATUS[0]}
if [ $RSYNC_EXIT -ne 0 ]; then
    error "rsync falhou com exit code $RSYNC_EXIT"
    echo "Log completo em: /tmp/rsync-frontend-copy.log"
    tail -20 /tmp/rsync-frontend-copy.log
    exit 1
fi

info "Codigo sincronizado com sucesso"
echo ""

# Reinicia frontend
section "Reiniciando Container Frontend"
info "Reiniciando Frontend (recarregando codigo)..."

COMPOSE_FILE=$($SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "for f in docker-compose.prod.yml docker-compose.prod.yaml docker-compose.yml docker-compose.yaml compose.yml compose.yaml; do if [ -f '${REMOTE_DIR}/'\"\$f\" ]; then echo \"\$f\"; break; fi; done")

RESTART_EXIT=0
if [ -n "$COMPOSE_FILE" ]; then
    COMPOSE_CMD=$($SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "if command -v docker-compose >/dev/null 2>&1; then echo docker-compose; elif docker compose version >/dev/null 2>&1; then echo 'docker compose'; fi")
    if [ -n "$COMPOSE_CMD" ]; then
        RESTART_CMD="cd ${REMOTE_DIR} && $COMPOSE_CMD -f ${COMPOSE_FILE} restart frontend"
        $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "$RESTART_CMD" 2>&1 || RESTART_EXIT=$?
    else
        RESTART_EXIT=1
    fi
else
    RESTART_EXIT=1
fi

if [ $RESTART_EXIT -ne 0 ]; then
    warn "Restart via compose falhou/nao disponivel; tentando docker restart r-agent2-frontend-prod"
    $SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "docker restart r-agent2-frontend-prod" 2>&1
    RESTART_EXIT=$?
fi

if [ $RESTART_EXIT -ne 0 ]; then
    error "Reinicio falhou com exit code $RESTART_EXIT"
    exit 1
fi

info "Container reiniciado"
echo ""

# Aguarda pronto
section "Aguardando Container Ficar Pronto"
info "Verificando estado do container..."

for i in {1..20}; do
    HEALTH=$($SSH_CMD ${REMOTE_USER}@${REMOTE_HOST} "docker inspect --format='{{.State.Status}}' r-agent2-frontend-prod 2>/dev/null || echo 'error'" 2>&1)
    if [ "$HEALTH" = "running" ]; then
        info "Container esta running (tentativa $i/20)"
        break
    fi
    if [ $i -eq 20 ]; then
        error "Container nao ficou pronto apos 20 segundos"
        echo "Status final: $HEALTH"
        exit 1
    fi
    sleep 1
    if [ $((i % 5)) -eq 0 ]; then
        info "Aguardando... ($i/20)"
    fi
done

echo ""
section "Update Concluido"
echo ""
info "Downtime: ~10-20 segundos (apenas restart)"
info "Para verificar status:"
echo "  - Logs: docker logs -f r-agent2-frontend-prod"
echo "  - Status: docker ps | grep r-agent2-frontend"
echo ""