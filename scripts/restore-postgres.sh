#!/bin/bash
# ============================================================================
# Script de Restore do PostgreSQL para Produção
# ============================================================================
# Este script restaura um backup do banco de dados PostgreSQL
# Uso: ./scripts/restore-postgres.sh <arquivo_backup.sql.gz>
# ============================================================================

set -euo pipefail

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Verificar argumentos
if [ $# -eq 0 ]; then
    echo -e "${RED}[Erro] Forneça o arquivo de backup como argumento${NC}"
    echo -e "${YELLOW}Uso: $0 <arquivo_backup.sql.gz>${NC}"
    exit 1
fi

BACKUP_FILE="$1"

# Verificar se o arquivo existe
if [ ! -f "$BACKUP_FILE" ]; then
    echo -e "${RED}[Erro] Arquivo de backup não encontrado: ${BACKUP_FILE}${NC}"
    exit 1
fi

# Configurações
CONTAINER_NAME="${POSTGRES_CONTAINER:-r-agent2-postgres-prod}"

# Carregar variáveis de ambiente do .env se existir
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

# Valores padrão
PGUSER="${PGUSER:-postgres}"
PGPASSWORD="${PGPASSWORD:-postgres}"
PGDATABASE="${PGDATABASE:-r_agent2}"

echo -e "${YELLOW}[Restore] ⚠️  ATENÇÃO: Esta operação irá SOBRESCREVER o banco de dados atual!${NC}"
echo -e "${YELLOW}Container: ${CONTAINER_NAME}${NC}"
echo -e "${YELLOW}Database: ${PGDATABASE}${NC}"
echo -e "${YELLOW}Backup: ${BACKUP_FILE}${NC}"
echo ""
read -p "Tem certeza que deseja continuar? (digite 'sim' para confirmar): " CONFIRM

if [ "$CONFIRM" != "sim" ]; then
    echo -e "${RED}[Restore] Operação cancelada${NC}"
    exit 0
fi

# Verificar se o container está rodando
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo -e "${RED}[Erro] Container ${CONTAINER_NAME} não está rodando!${NC}"
    exit 1
fi

# Restaurar backup
echo -e "${GREEN}[Restore] Restaurando backup...${NC}"
if gunzip -c "$BACKUP_FILE" | docker exec -i -e PGPASSWORD="${PGPASSWORD}" "${CONTAINER_NAME}" \
    psql -U "${PGUSER}" -d "${PGDATABASE}"; then
    echo -e "${GREEN}[Restore] ✅ Backup restaurado com sucesso!${NC}"
else
    echo -e "${RED}[Erro] Falha ao restaurar backup!${NC}"
    exit 1
fi

echo -e "${GREEN}[Restore] ✅ Processo concluído com sucesso!${NC}"
