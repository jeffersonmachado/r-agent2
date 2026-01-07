#!/bin/bash
# Script para corrigir e reiniciar serviços RAG e Redis

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}🔧 Corrigindo serviços...${NC}"

# Para todos os processos uvicorn (incluindo os rodando como root)
echo -e "${YELLOW}⏹️  Parando processos uvicorn existentes...${NC}"

# Lista processos uvicorn na porta 8000
UVICORN_PIDS=$(ps aux | grep "uvicorn.*8000" | grep -v grep | awk '{print $2}')
if [ -n "$UVICORN_PIDS" ]; then
    echo -e "${YELLOW}   Encontrados processos: $UVICORN_PIDS${NC}"
    for pid in $UVICORN_PIDS; do
        sudo kill $pid 2>/dev/null || sudo kill -9 $pid 2>/dev/null || true
    done
    sleep 2
fi

# Para processos uvicorn gerais
sudo pkill -f "uvicorn main:app" || true
sleep 2

# Verifica se ainda há processos
if pgrep -f "uvicorn.*8000" > /dev/null; then
    echo -e "${YELLOW}⚠️  Ainda há processos uvicorn na porta 8000, forçando parada...${NC}"
    for pid in $(pgrep -f "uvicorn.*8000"); do
        sudo kill -9 $pid 2>/dev/null || true
    done
    sleep 1
fi

# Verifica se a porta 8000 está livre
if lsof -i :8000 > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Porta 8000 ainda está em uso, tentando liberar...${NC}"
    PORT_PID=$(lsof -ti:8000 | head -1)
    if [ -n "$PORT_PID" ]; then
        sudo kill -9 $PORT_PID 2>/dev/null || true
        sleep 1
    fi
fi

# Reinicia Redis
echo -e "${YELLOW}🔄 Reiniciando Redis...${NC}"
sudo systemctl restart redis-server
sleep 2

# Verifica Redis
if redis-cli -p 6379 ping > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Redis está rodando${NC}"
else
    echo -e "${RED}❌ Redis não está respondendo${NC}"
fi

# Reinicia RAG Service
echo -e "${YELLOW}🔄 Reiniciando RAG Service...${NC}"
sudo systemctl restart r-agent2-rag
sleep 5

# Verifica RAG Service
echo -e "${YELLOW}🔍 Verificando RAG Service...${NC}"
for i in {1..5}; do
    if curl -s http://localhost:8000/rag/health > /dev/null 2>&1; then
        echo -e "${GREEN}✅ RAG Service está respondendo${NC}"
        curl -s http://localhost:8000/rag/health | python3 -m json.tool 2>/dev/null || echo "   (Resposta recebida)"
        break
    else
        if [ $i -lt 5 ]; then
            echo -e "${YELLOW}   Tentativa $i/5: Aguardando RAG Service iniciar...${NC}"
            sleep 2
        else
            echo -e "${RED}❌ RAG Service não está respondendo após 10 segundos${NC}"
            echo -e "${YELLOW}   Verifique os logs: sudo journalctl -u r-agent2-rag -n 50${NC}"
        fi
    fi
done

echo ""
echo -e "${BLUE}📋 Status final:${NC}"
echo -e "${GREEN}Redis:${NC}"
redis-cli -p 6379 ping 2>&1 || echo "   Não disponível"

echo ""
echo -e "${GREEN}RAG Service:${NC}"
curl -s http://localhost:8000/rag/health 2>&1 | head -3 || echo "   Não disponível"
