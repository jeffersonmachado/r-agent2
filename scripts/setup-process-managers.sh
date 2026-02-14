#!/bin/bash

# Script para instalar e configurar PM2 e nodemon

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}Configurando gerenciadores de processos...${NC}"

# Instala PM2 globalmente (recomendado para produção)
if ! command -v pm2 &> /dev/null; then
    echo -e "${YELLOW}Instalando PM2 globalmente...${NC}"
    npm install -g pm2
    echo -e "${GREEN}PM2 instalado!${NC}"
else
    echo -e "${GREEN}PM2 já está instalado${NC}"
fi

# Instala nodemon como dependência de desenvolvimento
echo -e "${YELLOW}Instalando nodemon...${NC}"
npm install --save-dev nodemon

# Cria diretório de logs
mkdir -p logs

echo -e "${GREEN}✓ Configuração concluída!${NC}"
echo ""
echo -e "${BLUE}Comandos úteis:${NC}"
echo -e "  Desenvolvimento: ${GREEN}npm run dev:api${NC} (nodemon)"
echo -e "  Produção: ${GREEN}npm run pm2:start${NC} (PM2)"
echo ""

