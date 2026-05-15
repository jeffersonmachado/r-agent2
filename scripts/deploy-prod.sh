#!/usr/bin/env bash

# Orquestrador de deploy de produção (wrapper sobre scripts já existentes)
# Uso: ./scripts/deploy-prod.sh [--frontend-only|--api-only|--no-build] [--skip-migrate] [--skip-smoke]

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

REMOTE_HOST="${DEPLOY_HOST:-10.10.2.30}"
REMOTE_USER="${DEPLOY_USER:-root}"
REMOTE_DIR="${DEPLOY_DIR:-/opt/results/ria/r-agent2}"
SSH_PASSWORD="${SSH_PASSWORD:?Erro: SSH_PASSWORD não definida}"
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 -o ServerAliveInterval=30 -o ServerAliveCountMax=3"

FRONTEND_ONLY=false
API_ONLY=false
NO_BUILD=false
SKIP_MIGRATE=false
SKIP_SMOKE=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --frontend-only)
            FRONTEND_ONLY=true
            shift
            ;;
        --api-only)
            API_ONLY=true
            shift
            ;;
        --no-build)
            NO_BUILD=true
            shift
            ;;
        --skip-migrate)
            SKIP_MIGRATE=true
            shift
            ;;
        --skip-smoke)
            SKIP_SMOKE=true
            shift
            ;;
        -h|--help)
            echo "Uso: $0 [--frontend-only|--api-only|--no-build] [--skip-migrate] [--skip-smoke]"
            exit 0
            ;;
        *)
            error "Argumento desconhecido: $1"
            echo "Uso: $0 [--frontend-only|--api-only|--no-build] [--skip-migrate] [--skip-smoke]"
            exit 1
            ;;
    esac
done

if [[ "$FRONTEND_ONLY" == "true" && "$API_ONLY" == "true" ]]; then
    error "Não é possível usar --frontend-only e --api-only ao mesmo tempo."
    exit 1
fi

if [[ "$NO_BUILD" == "true" && ( "$FRONTEND_ONLY" == "true" || "$API_ONLY" == "true" ) ]]; then
    error "--no-build não deve ser combinado com --frontend-only/--api-only."
    exit 1
fi

section "Orquestração de Deploy Produção"
info "Configuração:"
echo "  Host: $REMOTE_HOST"
echo "  User: $REMOTE_USER"
echo "  Diretório remoto: $REMOTE_DIR"
echo "  Frontend only: $FRONTEND_ONLY"
echo "  API only: $API_ONLY"
echo "  No build: $NO_BUILD"
echo "  Skip migrate: $SKIP_MIGRATE"
echo "  Skip smoke: $SKIP_SMOKE"

section "Pre-check Local"
command -v ssh >/dev/null 2>&1 || { error "ssh não encontrado"; exit 1; }
command -v npm >/dev/null 2>&1 || { error "npm não encontrado"; exit 1; }
command -v curl >/dev/null 2>&1 || { error "curl não encontrado"; exit 1; }
command -v sshpass >/dev/null 2>&1 || { error "sshpass não encontrado"; exit 1; }

if [[ -z "${SSHPASS:-}" ]]; then
    export SSHPASS="$SSH_PASSWORD"
fi

for required_script in deploy:remote:ssh deploy:remote:ssh:nobuild deploy:remote:ssh:frontend deploy:remote:ssh:api; do
    if ! npm pkg get "scripts.$required_script" 2>/dev/null | grep -qv null; then
        error "Script obrigatório ausente no package.json: $required_script"
        exit 1
    fi
done
info "✅ Pre-check local concluído"

section "Validação de SSH Remoto"
if ! sshpass -e ssh $SSH_OPTS "${REMOTE_USER}@${REMOTE_HOST}" "echo 'Conexão SSH OK'" >/dev/null 2>&1; then
    error "Falha no SSH via sshpass para ${REMOTE_USER}@${REMOTE_HOST}"
    error "Verifique SSHPASS/SSH_PASSWORD, conectividade e acesso ao host remoto."
    exit 1
fi
info "✅ SSH remoto validado"

section "Backup Leve Remoto"
RELEASE_TS="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="${REMOTE_DIR}/backups/light/${RELEASE_TS}"
sshpass -e ssh $SSH_OPTS "${REMOTE_USER}@${REMOTE_HOST}" "set -e; mkdir -p '${BACKUP_DIR}'; [ -f '${REMOTE_DIR}/docker-compose.prod.yml' ] && cp '${REMOTE_DIR}/docker-compose.prod.yml' '${BACKUP_DIR}/docker-compose.prod.yml' || true; [ -f '${REMOTE_DIR}/.env' ] && cp '${REMOTE_DIR}/.env' '${BACKUP_DIR}/.env' || true"
info "✅ Backup leve criado em ${BACKUP_DIR}"

section "Deploy Remoto (Wrapper)"
DEPLOY_NPM_SCRIPT="deploy:remote:ssh"
if [[ "$FRONTEND_ONLY" == "true" ]]; then
    DEPLOY_NPM_SCRIPT="deploy:remote:ssh:frontend"
elif [[ "$API_ONLY" == "true" ]]; then
    DEPLOY_NPM_SCRIPT="deploy:remote:ssh:api"
elif [[ "$NO_BUILD" == "true" ]]; then
    DEPLOY_NPM_SCRIPT="deploy:remote:ssh:nobuild"
fi

info "Executando npm run ${DEPLOY_NPM_SCRIPT} com sshpass (padrão legado)"
DEPLOY_HOST="$REMOTE_HOST" DEPLOY_USER="$REMOTE_USER" DEPLOY_DIR="$REMOTE_DIR" SSH_PASSWORD="$SSH_PASSWORD" SSHPASS="$SSHPASS" npm run "$DEPLOY_NPM_SCRIPT"
info "✅ Deploy remoto concluído"

if [[ "$SKIP_MIGRATE" != "true" && "$FRONTEND_ONLY" != "true" ]]; then
    section "Migrate (Opcional)"
    warn "Tentando migração dentro do container API (quando disponível)..."
    sshpass -e ssh $SSH_OPTS "${REMOTE_USER}@${REMOTE_HOST}" "cd '${REMOTE_DIR}' && (docker compose -f docker-compose.prod.yml exec -T api node api/db/migrate.js || docker-compose -f docker-compose.prod.yml exec -T api node api/db/migrate.js)"
    info "✅ Migração concluída"
else
    section "Migrate (Opcional)"
    warn "Migração pulada por flag/contexto."
fi

section "Release Tracking"
CURRENT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo 'sem-git')"
TRACKING_LINE="${RELEASE_TS} | host=${REMOTE_HOST} | mode=${DEPLOY_NPM_SCRIPT} | sha=${CURRENT_SHA}"
sshpass -e ssh $SSH_OPTS "${REMOTE_USER}@${REMOTE_HOST}" "mkdir -p '${REMOTE_DIR}/releases' && printf '%s\n' '${TRACKING_LINE}' > '${REMOTE_DIR}/releases/latest.txt'"
info "✅ Release registrada em ${REMOTE_DIR}/releases/latest.txt"

if [[ "$SKIP_SMOKE" != "true" ]]; then
    section "Smoke Test (Opcional)"
    smoke_fail=0

    if curl -fsS "https://www.results.com.br/r-agent2/login" >/dev/null; then
        info "✅ Login público respondeu"
    else
        error "❌ Falha no endpoint público /login"
        smoke_fail=1
    fi

    if curl -fsS "https://www.results.com.br/r-agent2/api/system/status" >/dev/null; then
        info "✅ API pública /api/system/status respondeu"
    else
        warn "⚠ Falha no endpoint público /api/system/status"
        smoke_fail=1
    fi

    if sshpass -e ssh $SSH_OPTS "${REMOTE_USER}@${REMOTE_HOST}" "curl -fsS http://127.0.0.1:3001/health >/dev/null"; then
        info "✅ API interna /health respondeu"
    else
        warn "⚠ Falha no endpoint interno da API (/health)"
        smoke_fail=1
    fi

    if npm pkg get scripts.system:release-gate 2>/dev/null | grep -qv null; then
        if npm run system:release-gate; then
            info "✅ system:release-gate OK"
        else
            warn "⚠ system:release-gate falhou"
            smoke_fail=1
        fi
    else
        warn "system:release-gate não existe no package.json, pulando validação"
    fi

    if [[ "$smoke_fail" -ne 0 ]]; then
        warn "Smoke test finalizou com alertas/falhas."
    else
        info "✅ Smoke test concluído sem falhas"
    fi
else
    section "Smoke Test (Opcional)"
    warn "Smoke test pulado por flag."
fi

section "Orientação de Rollback Manual"
echo "1) Acesse o servidor: ssh ${REMOTE_USER}@${REMOTE_HOST}"
echo "2) Entre no diretório: cd ${REMOTE_DIR}"
echo "3) Consulte backups leves: ls -lah backups/light"
echo "4) Restaure arquivos, se necessário:"
echo "   cp backups/light/<release>/docker-compose.prod.yml docker-compose.prod.yml"
echo "   cp backups/light/<release>/.env .env"
echo "5) Reaplique stack anterior: docker compose -f docker-compose.prod.yml up -d"
echo "6) Verifique status: docker compose -f docker-compose.prod.yml ps"

section "Deploy Produção Finalizado"
info "Fluxo de orquestração executado sobre o padrão existente (sem remover scripts legados)."
