#!/bin/bash

# Script para iniciar API (com nodemon) e Frontend (Vite) juntos em desenvolvimento

# Cores para output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}Iniciando servidores de desenvolvimento (nodemon + Vite)...${NC}"

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
    kill $API_PID $FRONTEND_PID 2>/dev/null
    exit
}

trap cleanup SIGINT SIGTERM

# Verifica se a porta 3000 está em uso
if check_port 3000; then
    echo -e "${YELLOW}Aviso: Porta 3000 já está em uso${NC}"
    echo -e "${YELLOW}Verificando se é a API do projeto...${NC}"
    
    # Tenta encontrar o processo
    API_PROCESS=$(ps aux | grep -E "(node|nodemon).*server.js" | grep -v grep | awk '{print $2}' | head -1)
    
    if [ -n "$API_PROCESS" ]; then
        echo -e "${GREEN}API já está rodando (PID: $API_PROCESS)${NC}"
        echo -e "${BLUE}Usando API existente...${NC}"
        API_PID=$API_PROCESS
        USE_EXISTING_API=true
    else
        echo -e "${RED}Erro: Porta 3000 está em uso por outro processo${NC}"
        echo -e "${YELLOW}Execute: lsof -ti:3000 | xargs kill${NC}"
        echo -e "${YELLOW}Ou use uma porta diferente: API_PORT=3001 npm run dev:api${NC}"
        exit 1
    fi
else
    # Inicia a API com nodemon em background
    echo -e "${GREEN}Iniciando API com nodemon na porta 3000...${NC}"
    # Usa npx para executar nodemon (que está em devDependencies)
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

# Verifica se a porta do frontend está em uso
if check_port $FRONTEND_PORT; then
    echo -e "${YELLOW}Aviso: Porta ${FRONTEND_PORT} já está em uso${NC}"
    echo -e "${YELLOW}Verificando se é o frontend do projeto...${NC}"
    
    # Tenta encontrar o processo Vite
    FRONTEND_PROCESS=$(ps aux | grep -E "vite|node.*frontend" | grep -v grep | awk '{print $2}' | head -1)
    
    if [ -n "$FRONTEND_PROCESS" ]; then
        echo -e "${GREEN}Frontend já está rodando (PID: $FRONTEND_PROCESS)${NC}"
        echo -e "${BLUE}Usando frontend existente...${NC}"
        FRONTEND_PID=$FRONTEND_PROCESS
        USE_EXISTING_FRONTEND=true
    else
        echo -e "${RED}Erro: Porta ${FRONTEND_PORT} está em uso por outro processo${NC}"
        echo -e "${YELLOW}Execute: lsof -ti:${FRONTEND_PORT} | xargs kill${NC}"
        exit 1
    fi
else
    # Inicia o frontend (Vite)
    echo -e "${GREEN}Iniciando Frontend (Vite) na porta ${FRONTEND_PORT}...${NC}"
    cd frontend
    npm start &
    FRONTEND_PID=$!
    cd ..
    USE_EXISTING_FRONTEND=false
fi

echo -e "${BLUE}Servidores iniciados!${NC}"
echo -e "${GREEN}API (nodemon): http://localhost:3000${NC}"
echo -e "${GREEN}Frontend (Vite): http://localhost:${FRONTEND_PORT}${NC}"
echo ""

if [ "$USE_EXISTING_API" = true ] && [ "$USE_EXISTING_FRONTEND" = true ]; then
    echo -e "${YELLOW}Aviso: Ambos os servidores já estavam rodando. Nenhum será parado ao pressionar Ctrl+C${NC}"
    echo -e "${BLUE}Pressione Ctrl+C para sair${NC}"
    wait
elif [ "$USE_EXISTING_API" = true ]; then
    echo -e "${YELLOW}Aviso: API já estava rodando. Não será parada ao pressionar Ctrl+C${NC}"
    echo -e "${BLUE}Pressione Ctrl+C para parar apenas o frontend${NC}"
    wait $FRONTEND_PID
elif [ "$USE_EXISTING_FRONTEND" = true ]; then
    echo -e "${YELLOW}Aviso: Frontend já estava rodando. Não será parado ao pressionar Ctrl+C${NC}"
    echo -e "${BLUE}Pressione Ctrl+C para parar apenas a API${NC}"
    wait $API_PID
else
    echo -e "${BLUE}Pressione Ctrl+C para parar ambos os servidores${NC}"
    wait
fi

