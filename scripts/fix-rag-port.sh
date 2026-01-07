#!/bin/bash
# Script para corrigir conflito de porta do RAG Service

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${YELLOW}🔍 Verificando porta 8000...${NC}"

# Encontra processo na porta 8000
PORT_PID=$(lsof -ti:8000 2>/dev/null | head -1)

if [ -z "$PORT_PID" ]; then
    echo -e "${GREEN}✅ Porta 8000 está livre${NC}"
else
    echo -e "${YELLOW}📋 Processo encontrado na porta 8000: PID $PORT_PID${NC}"
    ps -p $PORT_PID -o pid,user,cmd || true
    
    # Verifica se é o processo do systemd
    SYSTEMD_PID=$(systemctl show r-agent2-rag.service --property MainPID --value 2>/dev/null || echo "0")
    
    if [ "$PORT_PID" = "$SYSTEMD_PID" ]; then
        echo -e "${GREEN}✅ Este é o processo do systemd, está correto${NC}"
        exit 0
    fi
    
    echo -e "${YELLOW}🗑️  Matando processo órfão PID $PORT_PID...${NC}"
    sudo kill -9 $PORT_PID 2>/dev/null || {
        echo -e "${RED}❌ Não foi possível matar o processo${NC}"
        echo -e "${YELLOW}   Execute manualmente: sudo kill -9 $PORT_PID${NC}"
        exit 1
    }
    
    sleep 2
    
    # Verifica se foi morto
    if ps -p $PORT_PID > /dev/null 2>&1; then
        echo -e "${RED}⚠️  Processo ainda está rodando${NC}"
        exit 1
    else
        echo -e "${GREEN}✅ Processo morto com sucesso${NC}"
    fi
fi

# Para o serviço systemd se estiver rodando
echo -e "${YELLOW}🔄 Parando RAG Service...${NC}"
sudo systemctl stop r-agent2-rag.service 2>/dev/null || true
sleep 2

# Reinicia o serviço
echo -e "${YELLOW}🔄 Reiniciando RAG Service...${NC}"
sudo systemctl start r-agent2-rag.service
sleep 5

# Verifica status
echo -e "${YELLOW}🔍 Verificando status...${NC}"
if systemctl is-active --quiet r-agent2-rag.service; then
    echo -e "${GREEN}✅ RAG Service está ativo${NC}"
    
    # Testa o endpoint
    echo -e "${YELLOW}🔍 Testando endpoint /rag/health...${NC}"
    for i in {1..5}; do
        if curl -s http://localhost:8000/rag/health > /dev/null 2>&1; then
            echo -e "${GREEN}✅ Endpoint /rag/health está funcionando!${NC}"
            curl -s http://localhost:8000/rag/health | python3 -m json.tool 2>/dev/null || curl -s http://localhost:8000/rag/health
            exit 0
        else
            if [ $i -lt 5 ]; then
                echo -e "${YELLOW}   Tentativa $i/5: Aguardando...${NC}"
                sleep 2
            fi
        fi
    done
    
    echo -e "${RED}❌ Endpoint /rag/health não está respondendo${NC}"
    echo -e "${YELLOW}   Verifique os logs: sudo journalctl -u r-agent2-rag -n 20${NC}"
    exit 1
else
    echo -e "${RED}❌ RAG Service não está ativo${NC}"
    echo -e "${YELLOW}   Verifique os logs: sudo journalctl -u r-agent2-rag -n 20${NC}"
    exit 1
fi
