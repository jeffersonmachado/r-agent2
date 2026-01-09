#!/bin/bash
# Script para instalar o serviço RAG do systemd com detecção automática de caminhos

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}📦 Instalando serviço RAG do systemd...${NC}"

# Detecta diretório do projeto automaticamente
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RAG_SERVICE_DIR="${RAG_SERVICE_DIR:-$PROJECT_ROOT/rag-service}"

# Verifica se o diretório do serviço RAG existe
if [ ! -d "$RAG_SERVICE_DIR" ]; then
    echo -e "${RED}❌ Diretório do serviço RAG não encontrado: $RAG_SERVICE_DIR${NC}"
    echo -e "${YELLOW}   Defina RAG_SERVICE_DIR ou execute este script do diretório do projeto${NC}"
    exit 1
fi

# Verifica se o venv existe
if [ ! -d "$RAG_SERVICE_DIR/venv" ]; then
    echo -e "${YELLOW}⚠️  Ambiente virtual não encontrado em $RAG_SERVICE_DIR/venv${NC}"
    echo -e "${YELLOW}   Criando ambiente virtual...${NC}"
    cd "$RAG_SERVICE_DIR"
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
    echo -e "${GREEN}✅ Ambiente virtual criado${NC}"
fi

# Caminho do template e arquivo de serviço
TEMPLATE_FILE="$RAG_SERVICE_DIR/r-agent2-rag.service.template"
SERVICE_FILE="/etc/systemd/system/r-agent2-rag.service"

# Verifica se o template existe
if [ ! -f "$TEMPLATE_FILE" ]; then
    echo -e "${RED}❌ Template não encontrado: $TEMPLATE_FILE${NC}"
    exit 1
fi

# Gera o arquivo de serviço substituindo as variáveis
echo -e "${YELLOW}📝 Gerando arquivo de serviço...${NC}"
sed "s|%RAG_SERVICE_DIR%|$RAG_SERVICE_DIR|g" "$TEMPLATE_FILE" | sudo tee "$SERVICE_FILE" > /dev/null

# Recarrega systemd
echo -e "${YELLOW}🔄 Recarregando systemd...${NC}"
sudo systemctl daemon-reload

echo -e "${GREEN}✅ Serviço instalado com sucesso!${NC}"
echo ""
echo -e "${BLUE}📋 Informações:${NC}"
echo -e "   Diretório do serviço: ${GREEN}$RAG_SERVICE_DIR${NC}"
echo -e "   Arquivo de serviço: ${GREEN}$SERVICE_FILE${NC}"
echo ""
echo -e "${BLUE}📝 Comandos úteis:${NC}"
echo -e "   Iniciar: ${GREEN}sudo systemctl start r-agent2-rag${NC}"
echo -e "   Parar: ${GREEN}sudo systemctl stop r-agent2-rag${NC}"
echo -e "   Status: ${GREEN}sudo systemctl status r-agent2-rag${NC}"
echo -e "   Logs: ${GREEN}sudo journalctl -u r-agent2-rag -f${NC}"
echo -e "   Habilitar no boot: ${GREEN}sudo systemctl enable r-agent2-rag${NC}"
