#!/bin/bash
# ============================================================================
# Script de Backup do PostgreSQL para Produção
# ============================================================================
# Este script faz backup do banco de dados PostgreSQL em produção
# Uso: ./scripts/backup-postgres.sh
# ============================================================================

set -euo pipefail

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configurações
CONTAINER_NAME="${POSTGRES_CONTAINER:-r-agent2-postgres-prod}"
BACKUP_DIR="${BACKUP_DIR:-./backups/postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Carregar variáveis de ambiente do .env se existir
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

# Valores padrão
PGUSER="${PGUSER:-postgres}"
PGPASSWORD="${PGPASSWORD:-postgres}"
PGDATABASE="${PGDATABASE:-r_agent2}"
PGHOST="${PGHOST:-postgres}"

# Criar diretório de backup se não existir
mkdir -p "$BACKUP_DIR"

echo -e "${GREEN}[Backup] Iniciando backup do PostgreSQL...${NC}"
echo -e "${YELLOW}Container: ${CONTAINER_NAME}${NC}"
echo -e "${YELLOW}Database: ${PGDATABASE}${NC}"
echo -e "${YELLOW}Destino: ${BACKUP_DIR}${NC}"

# Verificar se o container está rodando
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo -e "${RED}[Erro] Container ${CONTAINER_NAME} não está rodando!${NC}"
    exit 1
fi

# Nome do arquivo de backup
BACKUP_FILE="${BACKUP_DIR}/backup_${PGDATABASE}_${TIMESTAMP}.sql.gz"

# Fazer backup
echo -e "${GREEN}[Backup] Executando pg_dump...${NC}"
if docker exec -e PGPASSWORD="${PGPASSWORD}" "${CONTAINER_NAME}" \
    pg_dump -U "${PGUSER}" -d "${PGDATABASE}" \
    --no-owner --no-acl --clean --if-exists \
    | gzip > "${BACKUP_FILE}"; then
    echo -e "${GREEN}[Backup] ✅ Backup criado com sucesso: ${BACKUP_FILE}${NC}"
    
    # Mostrar tamanho do backup
    BACKUP_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
    echo -e "${GREEN}[Backup] Tamanho: ${BACKUP_SIZE}${NC}"
else
    echo -e "${RED}[Erro] Falha ao criar backup!${NC}"
    exit 1
fi

# Limpar backups antigos
echo -e "${YELLOW}[Backup] Limpando backups antigos (mais de ${RETENTION_DAYS} dias)...${NC}"
find "${BACKUP_DIR}" -name "backup_*.sql.gz" -type f -mtime +${RETENTION_DAYS} -delete
echo -e "${GREEN}[Backup] ✅ Limpeza concluída${NC}"

# Listar backups disponíveis
echo -e "${GREEN}[Backup] Backups disponíveis:${NC}"
ls -lh "${BACKUP_DIR}"/backup_*.sql.gz 2>/dev/null | tail -5 || echo "Nenhum backup encontrado"

echo -e "${GREEN}[Backup] ✅ Processo concluído com sucesso!${NC}"
