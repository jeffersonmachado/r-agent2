#!/bin/bash
# Script para verificar e criar systemadmin no container

echo "=== Verificando systemadmin no container ==="

# Verifica se o container está rodando
CONTAINER_NAME="r-agent2-api-prod"
if ! docker ps | grep -q "$CONTAINER_NAME"; then
    echo "❌ Container $CONTAINER_NAME não está rodando"
    exit 1
fi

echo "✅ Container está rodando"

# Verifica se o arquivo agents.json existe no volume
echo ""
echo "=== Verificando arquivo agents.json ==="
docker exec $CONTAINER_NAME ls -la /app/api/data/agents.json 2>/dev/null && echo "✅ Arquivo existe" || echo "❌ Arquivo não existe"

# Mostra conteúdo do arquivo
echo ""
echo "=== Conteúdo do agents.json ==="
docker exec $CONTAINER_NAME cat /app/api/data/agents.json 2>/dev/null | jq '.[] | select(.username == "systemadmin")' || echo "❌ systemadmin não encontrado"

# Verifica logs de inicialização
echo ""
echo "=== Logs de inicialização (systemadmin) ==="
docker logs $CONTAINER_NAME 2>&1 | grep -i "systemadmin\|Init\|Super Admin" | tail -20

