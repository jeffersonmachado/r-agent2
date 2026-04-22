#!/bin/bash

# Script para instalar e configurar nodemon

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}Configurando gerenciadores de processos...${NC}"

# Instala nodemon como dependência de desenvolvimento
echo -e "${YELLOW}Instalando nodemon...${NC}"
npm install --save-dev nodemon

# Cria diretório de logs
mkdir -p logs

echo -e "${GREEN}✓ Configuração concluída!${NC}"
echo ""
echo -e "${BLUE}Comandos úteis:${NC}"
echo -e "  Desenvolvimento: ${GREEN}npm run dev:api${NC} (nodemon)"
echo ""

