#!/bin/bash
# Script para verificar o que está usando a porta 8000

echo "🔍 Verificando processos na porta 8000..."

# Tenta usar lsof com sudo, se não conseguir, usa métodos alternativos
if command -v lsof > /dev/null 2>&1; then
    echo "📋 Usando lsof:"
    sudo lsof -i :8000 2>/dev/null || echo "   (lsof requer sudo, tentando métodos alternativos)"
fi

echo ""
echo "📋 Usando ss:"
ss -tlnp 2>/dev/null | grep :8000 || echo "   Nenhum processo encontrado com ss"

echo ""
echo "📋 Processos uvicorn:"
ps aux | grep "uvicorn" | grep -v grep || echo "   Nenhum processo uvicorn encontrado"

echo ""
echo "📋 Containers Docker:"
docker ps --format "table {{.Names}}\t{{.Ports}}" | grep -E "(NAMES|8000)" || echo "   Nenhum container usando porta 8000"

echo ""
echo "📋 Serviço systemd RAG:"
systemctl is-active r-agent2-rag 2>/dev/null && echo "   ✅ Ativo" || echo "   ❌ Inativo"
