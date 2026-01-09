#!/bin/bash

# Script para iniciar API, Frontend e RAG Service juntos em desenvolvimento

# Cores para output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}Iniciando servidores de desenvolvimento...${NC}"

# Função para verificar se porta está em uso
check_port() {
    local port=$1
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1 || fuser $port/tcp >/dev/null 2>&1; then
        return 0  # Porta em uso
    else
        return 1  # Porta livre
    fi
}

# Função para limpar processos ao sair
cleanup() {
    echo -e "\n${BLUE}Parando servidores...${NC}"
    kill $API_PID $FRONTEND_PID $RAG_PID 2>/dev/null
    exit
}

trap cleanup SIGINT SIGTERM

# Detecta diretório do projeto
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RAG_SERVICE_DIR="${RAG_SERVICE_DIR:-$PROJECT_ROOT/rag-service}"
RAG_PORT=8000

# Verifica se a porta 3000 está em uso
if check_port 3000; then
    echo -e "${YELLOW}Aviso: Porta 3000 já está em uso${NC}"
    echo -e "${YELLOW}Verificando se é a API do projeto...${NC}"
    
    # Tenta encontrar o processo (nodemon ou node direto)
    API_PROCESS=$(ps aux | grep -E "(nodemon|node).*server.js" | grep -v grep | awk '{print $2}' | head -1)
    
    if [ -n "$API_PROCESS" ]; then
        echo -e "${GREEN}API já está rodando (PID: $API_PROCESS)${NC}"
        echo -e "${BLUE}Usando API existente...${NC}"
        API_PID=$API_PROCESS
        USE_EXISTING_API=true
    else
        echo -e "${RED}Erro: Porta 3000 está em uso por outro processo${NC}"
        echo -e "${YELLOW}Execute: lsof -ti:3000 | xargs kill${NC}"
        echo -e "${YELLOW}Ou use uma porta diferente: API_PORT=3001 npm run dev${NC}"
        exit 1
    fi
else
    # Inicia a API com nodemon em background (para auto-reload)
    echo -e "${GREEN}Iniciando API com nodemon na porta 3000...${NC}"
    npx --yes nodemon api/server.js &
    API_PID=$!
    USE_EXISTING_API=false
    
    # Aguarda um pouco para a API iniciar
    sleep 2
    
    # Verifica se a API está rodando
    if ! kill -0 $API_PID 2>/dev/null; then
        echo -e "${RED}Erro: API não iniciou corretamente${NC}"
        exit 1
    fi
fi

# Lê porta do frontend (variável de ambiente tem precedência sobre config.json)
FRONTEND_PORT=5173

# Primeiro tenta ler da variável de ambiente
if [ -n "$FRONTEND_PORT_ENV" ]; then
    FRONTEND_PORT=$FRONTEND_PORT_ENV
# Se não houver variável de ambiente, lê do config.json
elif [ -f "api/data/config.json" ]; then
    # Procura especificamente dentro da seção "frontend"
    CONFIG_PORT=$(grep -A 5 '"frontend"' api/data/config.json | grep -o '"port"[[:space:]]*:[[:space:]]*[0-9]*' | grep -o '[0-9]*' | head -1)
    if [ -n "$CONFIG_PORT" ]; then
        FRONTEND_PORT=$CONFIG_PORT
    fi
fi

# Verifica se a porta 8000 (RAG) está em uso
if check_port $RAG_PORT; then
    echo -e "${YELLOW}Aviso: Porta $RAG_PORT (RAG) já está em uso${NC}"
    echo -e "${YELLOW}Verificando se é o RAG service do projeto...${NC}"
    
    # Tenta encontrar o processo uvicorn
    RAG_PROCESS=$(ps aux | grep "uvicorn main:app" | grep -v grep | awk '{print $2}' | head -1)
    
    if [ -n "$RAG_PROCESS" ]; then
        echo -e "${GREEN}RAG Service já está rodando (PID: $RAG_PROCESS)${NC}"
        echo -e "${BLUE}Usando RAG Service existente...${NC}"
        RAG_PID=$RAG_PROCESS
        USE_EXISTING_RAG=true
    else
        echo -e "${RED}Erro: Porta $RAG_PORT está em uso por outro processo${NC}"
        echo -e "${YELLOW}Execute: lsof -ti:$RAG_PORT | xargs kill${NC}"
        exit 1
    fi
else
    # Inicia o RAG Service
    echo -e "${GREEN}Iniciando RAG Service na porta $RAG_PORT...${NC}"
    
    # Navega para o diretório do serviço RAG
    cd "$RAG_SERVICE_DIR"
    
    # Verifica se há um ambiente virtual
    if [ -d "venv" ]; then
        echo -e "${BLUE}Usando ambiente virtual do RAG service...${NC}"
        UVICORN_CMD="venv/bin/uvicorn"
    elif command -v uvicorn &> /dev/null; then
        echo -e "${BLUE}Usando uvicorn do sistema...${NC}"
        UVICORN_CMD="uvicorn"
    else
        echo -e "${RED}Erro: uvicorn não encontrado!${NC}"
        echo -e "${YELLOW}Instale as dependências: cd $RAG_SERVICE_DIR && pip install -r requirements.txt${NC}"
        cd "$PROJECT_ROOT"
        exit 1
    fi
    
    # Inicia o RAG service em background com reload
    $UVICORN_CMD main:app --reload --host 0.0.0.0 --port $RAG_PORT > /tmp/rag-service-dev.log 2>&1 &
    RAG_PID=$!
    USE_EXISTING_RAG=false
    
    # Volta para o diretório raiz
    cd "$PROJECT_ROOT"
    
    # Aguarda um pouco para o RAG service iniciar
    sleep 3
    
    # Verifica se o RAG service está rodando
    if ! kill -0 $RAG_PID 2>/dev/null; then
        echo -e "${RED}Erro: RAG Service não iniciou corretamente${NC}"
        echo -e "${YELLOW}Verifique os logs: tail -f /tmp/rag-service-dev.log${NC}"
        exit 1
    fi
    
    # Testa o endpoint de health
    sleep 2
    if curl -s http://localhost:$RAG_PORT/rag/health > /dev/null 2>&1; then
        echo -e "${GREEN}RAG Service iniciado com sucesso!${NC}"
    else
        echo -e "${YELLOW}Aviso: RAG Service iniciado mas ainda não está respondendo${NC}"
        echo -e "${YELLOW}Verifique os logs: tail -f /tmp/rag-service-dev.log${NC}"
    fi
fi

# Inicia o frontend
echo -e "${GREEN}Iniciando Frontend na porta ${FRONTEND_PORT}...${NC}"
cd frontend
npm start &
FRONTEND_PID=$!
cd ..

echo -e "${BLUE}Servidores iniciados!${NC}"
echo -e "${GREEN}API: http://localhost:3000${NC}"
echo -e "${GREEN}Frontend: http://localhost:${FRONTEND_PORT}${NC}"
echo -e "${GREEN}RAG Service: http://localhost:$RAG_PORT${NC}"

if [ "$USE_EXISTING_API" = true ] || [ "$USE_EXISTING_RAG" = true ]; then
    if [ "$USE_EXISTING_API" = true ]; then
        echo -e "${YELLOW}Aviso: API já estava rodando. Não será parada ao pressionar Ctrl+C${NC}"
    fi
    if [ "$USE_EXISTING_RAG" = true ]; then
        echo -e "${YELLOW}Aviso: RAG Service já estava rodando. Não será parado ao pressionar Ctrl+C${NC}"
    fi
    echo -e "${BLUE}Pressione Ctrl+C para parar os servidores iniciados por este script${NC}"
    wait $FRONTEND_PID
else
    echo -e "${BLUE}Pressione Ctrl+C para parar todos os servidores${NC}"
    wait
fi

