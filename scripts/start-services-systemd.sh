#!/bin/bash
# Script para iniciar serviços usando systemctl

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}🔄 Iniciando serviços usando systemctl...${NC}"

# Inicia Redis
echo -e "${YELLOW}📦 Iniciando Redis...${NC}"
sudo systemctl start redis-server
sudo systemctl enable redis-server
sleep 2

# Verifica Redis
if redis-cli -p 6379 ping > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Redis está rodando${NC}"
else
    echo -e "${RED}❌ Redis não está respondendo${NC}"
    echo -e "${YELLOW}   Verifique com: sudo systemctl status redis-server${NC}"
fi

# Detecta diretório do projeto automaticamente
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RAG_SERVICE_SOURCE="${RAG_SERVICE_SOURCE:-$PROJECT_ROOT/rag-service/r-agent2-rag.service}"

# Copia arquivo de serviço do RAG se não existir
RAG_SERVICE_FILE="/etc/systemd/system/r-agent2-rag.service"
if [ ! -f "$RAG_SERVICE_FILE" ]; then
    if [ ! -f "$RAG_SERVICE_SOURCE" ]; then
        echo -e "${RED}❌ Arquivo de serviço não encontrado: $RAG_SERVICE_SOURCE${NC}"
        echo -e "${YELLOW}   Defina RAG_SERVICE_SOURCE ou execute este script do diretório do projeto${NC}"
        exit 1
    fi
    echo -e "${YELLOW}📝 Criando serviço systemd para RAG...${NC}"
    sudo cp "$RAG_SERVICE_SOURCE" "$RAG_SERVICE_FILE"
    sudo systemctl daemon-reload
    echo -e "${GREEN}✅ Serviço systemd criado${NC}"
fi

# Inicia RAG Service
echo -e "${YELLOW}🚀 Iniciando RAG Service...${NC}"
sudo systemctl start r-agent2-rag
sudo systemctl enable r-agent2-rag
sleep 3

# Verifica RAG Service
if curl -s http://localhost:8001/rag/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ RAG Service está rodando${NC}"
    echo -e "${BLUE}   Health check:${NC}"
    curl -s http://localhost:8001/rag/health | python3 -m json.tool 2>/dev/null || echo "   (Resposta recebida)"
else
    echo -e "${YELLOW}⚠️  RAG Service pode estar iniciando...${NC}"
    echo -e "${YELLOW}   Verifique com: sudo systemctl status r-agent2-rag${NC}"
    echo -e "${YELLOW}   Logs: sudo journalctl -u r-agent2-rag -f${NC}"
fi

echo ""
echo -e "${BLUE}📋 Status dos serviços:${NC}"
echo -e "${GREEN}Redis:${NC}"
sudo systemctl status redis-server --no-pager | head -3 || true
echo ""
echo -e "${GREEN}RAG Service:${NC}"
sudo systemctl status r-agent2-rag --no-pager | head -3 || true

echo ""
echo -e "${BLUE}📝 Comandos úteis:${NC}"
echo -e "   Ver status: ${GREEN}sudo systemctl status redis-server r-agent2-rag${NC}"
echo -e "   Ver logs RAG: ${GREEN}sudo journalctl -u r-agent2-rag -f${NC}"
echo -e "   Parar serviços: ${GREEN}sudo systemctl stop redis-server r-agent2-rag${NC}"
