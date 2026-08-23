#!/bin/bash

# Script para reiniciar o serviço RAG Python

set -e

# Detecta diretório do projeto automaticamente
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# Usa RAG_SERVICE_DIR se definido, senão detecta automaticamente
RAG_SERVICE_DIR="${RAG_SERVICE_DIR:-$PROJECT_ROOT/rag-service}"
RAG_PORT=8001

echo "🔄 Reiniciando serviço RAG..."

# Encontra e para o processo uvicorn existente
UVICORN_PID=$(ps aux | grep "uvicorn main:app" | grep -v grep | awk '{print $2}' | head -1)

if [ -n "$UVICORN_PID" ]; then
    echo "⏹️  Parando processo uvicorn existente (PID: $UVICORN_PID)..."
    kill $UVICORN_PID 2>/dev/null || true
    sleep 2
    
    # Verifica se o processo foi parado
    if ps -p $UVICORN_PID > /dev/null 2>&1; then
        echo "⚠️  Processo ainda está rodando, forçando parada..."
        kill -9 $UVICORN_PID 2>/dev/null || true
        sleep 1
    fi
fi

# Verifica se a porta está livre
if lsof -Pi :$RAG_PORT -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo "⚠️  Porta $RAG_PORT ainda está em uso. Tentando liberar..."
    PORT_PID=$(lsof -ti:$RAG_PORT)
    if [ -n "$PORT_PID" ]; then
        kill -9 $PORT_PID 2>/dev/null || true
        sleep 1
    fi
fi

# Navega para o diretório do serviço RAG
cd "$RAG_SERVICE_DIR"

# Carrega o .env (RAG_INTERNAL_TOKEN, DATABASE_URL etc.) para o processo uvicorn.
# Sem isso o serviço sobe bloqueado: [SECURITY] RAG_INTERNAL_TOKEN ausente.
if [ -f ".env" ]; then
    echo "📋 Carregando .env do rag-service..."
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
fi

# Verifica se há um ambiente virtual
if [ -d "venv" ]; then
    echo "📦 Usando ambiente virtual..."
    source venv/bin/activate
    UVICORN_CMD="venv/bin/uvicorn"
elif command -v uvicorn &> /dev/null; then
    echo "📦 Usando uvicorn do sistema..."
    UVICORN_CMD="uvicorn"
else
    echo "❌ Erro: uvicorn não encontrado!"
    echo "   Instale as dependências: cd $RAG_SERVICE_DIR && pip install -r requirements.txt"
    exit 1
fi

# Inicia o serviço em background
echo "🚀 Iniciando serviço RAG na porta $RAG_PORT..."
nohup $UVICORN_CMD main:app --host 0.0.0.0 --port $RAG_PORT > /tmp/rag-service.log 2>&1 &
NEW_PID=$!

# Aguarda um pouco para o serviço iniciar
sleep 3

# Verifica se o serviço está rodando
if ps -p $NEW_PID > /dev/null 2>&1; then
    echo "✅ Serviço RAG iniciado (PID: $NEW_PID)"
    
    # Testa o endpoint de health
    echo "🔍 Testando endpoint de health..."
    sleep 2
    if curl -s http://localhost:$RAG_PORT/rag/health > /dev/null 2>&1; then
        echo "✅ Serviço RAG está respondendo corretamente!"
        curl -s http://localhost:$RAG_PORT/rag/health | python3 -m json.tool 2>/dev/null || echo "   (Resposta recebida)"
    else
        echo "⚠️  Serviço iniciado mas não está respondendo ainda. Verifique os logs:"
        echo "   tail -f /tmp/rag-service.log"
    fi
else
    echo "❌ Erro: Serviço não iniciou corretamente!"
    echo "   Verifique os logs: tail -f /tmp/rag-service.log"
    exit 1
fi

echo ""
echo "📋 Informações úteis:"
echo "   - Logs: tail -f /tmp/rag-service.log"
echo "   - Health check: curl http://localhost:$RAG_PORT/rag/health"
echo "   - Parar serviço: pkill -f 'uvicorn main:app'"
