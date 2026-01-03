#!/bin/bash

# Script para gerar arquivo ZIP do projeto r-agent2
# Exclui node_modules, coverage, arquivos temporários e outros arquivos desnecessários

set -e

# Cores para output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Diretório do projeto
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_NAME="r-agent2"
OUTPUT_DIR="$(dirname "$PROJECT_DIR")"
ZIP_FILE="${OUTPUT_DIR}/${PROJECT_NAME}.zip"

echo -e "${YELLOW}Gerando ZIP do projeto ${PROJECT_NAME}...${NC}"

# Remove o zip anterior se existir
if [ -f "$ZIP_FILE" ]; then
    echo "Removendo ZIP anterior..."
    rm -f "$ZIP_FILE"
fi

# Gera o novo ZIP
cd "$OUTPUT_DIR"

zip -r "$ZIP_FILE" "$PROJECT_NAME" \
    -x "*/node_modules/*" \
    -x "*/frontend/node_modules/*" \
    -x "*/coverage/*" \
    -x "*/.git/*" \
    -x "*/.vscode/*" \
    -x "*/.idea/*" \
    -x "*/dist/*" \
    -x "*/frontend/dist/*" \
    -x "*/build/*" \
    -x "*/logs/*" \
    -x "*/.pm2/*" \
    -x "*/__pycache__/*" \
    -x "*.pyc" \
    -x "*.pyo" \
    -x "*.log" \
    -x "*.swp" \
    -x "*.swo" \
    -x "*~" \
    -x "*.DS_Store" \
    -x "*.tsbuildinfo" \
    -x "*/.env" \
    -x "*/.env.local" \
    -x "*/.env.*.local" \
    -q

# Verifica se o arquivo foi criado
if [ -f "$ZIP_FILE" ]; then
    FILE_SIZE=$(du -h "$ZIP_FILE" | cut -f1)
    echo -e "${GREEN}✓ ZIP gerado com sucesso!${NC}"
    echo "  Arquivo: $ZIP_FILE"
    echo "  Tamanho: $FILE_SIZE"
else
    echo "Erro: Falha ao gerar o ZIP"
    exit 1
fi
