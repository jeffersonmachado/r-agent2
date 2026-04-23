#!/bin/bash

# Script para testar o serviço RAG
# Uso: ./scripts/test_rag.sh

set -e

BASE_URL="${RAG_SERVICE_URL:-http://localhost:8001}"
TENANT_ID="test-tenant-$(date +%s)"

echo "🧪 Testando Serviço RAG"
echo "URL: $BASE_URL"
echo "Tenant ID: $TENANT_ID"
echo ""

# Cores para output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Função para verificar resposta
check_response() {
    local status=$1
    local expected=$2
    if [ "$status" -eq "$expected" ]; then
        echo -e "${GREEN}✅ Passou${NC}"
        return 0
    else
        echo -e "${RED}❌ Falhou (Status: $status, Esperado: $expected)${NC}"
        return 1
    fi
}

# Função para fazer requisição e verificar
test_endpoint() {
    local method=$1
    local endpoint=$2
    local data=$3
    local expected_status=$4
    local description=$5
    
    echo -n "Testando: $description... "
    
    if [ -n "$data" ]; then
        response=$(curl -s -w "\n%{http_code}" -X "$method" "$BASE_URL$endpoint" \
            -H "Content-Type: application/json" \
            -d "$data")
    else
        response=$(curl -s -w "\n%{http_code}" -X "$method" "$BASE_URL$endpoint")
    fi
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if check_response "$http_code" "$expected_status"; then
        echo "$body" | jq . 2>/dev/null || echo "$body"
        return 0
    else
        echo "Resposta: $body"
        return 1
    fi
}

# Contador de testes
PASSED=0
FAILED=0

echo "1️⃣  Health Check"
if test_endpoint "GET" "/rag/health" "" 200 "Health check"; then
    ((PASSED++))
else
    ((FAILED++))
fi
echo ""

echo "2️⃣  Indexar Documento"
DOC_ID="test-doc-$(date +%s)"
INDEX_DATA=$(cat <<EOF
{
  "document": {
    "id": "$DOC_ID",
    "tenantId": "$TENANT_ID",
    "title": "Documento de Teste",
    "content": "Para resetar sua senha, acesse o menu Configurações > Segurança > Redefinir Senha. Você receberá um email com instruções detalhadas sobre como criar uma nova senha.",
    "metadata": {
      "category": "suporte",
      "source": "test"
    },
    "status": "active"
  }
}
EOF
)

if test_endpoint "POST" "/rag/index" "$INDEX_DATA" 200 "Indexar documento"; then
    ((PASSED++))
else
    ((FAILED++))
fi
echo ""

echo "3️⃣  Consultar RAG"
QUERY_DATA=$(cat <<EOF
{
  "query": "Como resetar minha senha?",
  "tenantId": "$TENANT_ID",
  "options": {
    "topK": 5,
    "minScore": 0.5
  }
}
EOF
)

if test_endpoint "POST" "/rag/query" "$QUERY_DATA" 200 "Consultar RAG"; then
    ((PASSED++))
else
    ((FAILED++))
fi
echo ""

echo "4️⃣  Consulta sem Resultados"
QUERY_NO_RESULTS=$(cat <<EOF
{
  "query": "Como fazer um bolo de chocolate?",
  "tenantId": "$TENANT_ID",
  "options": {
    "minScore": 0.9
  }
}
EOF
)

if test_endpoint "POST" "/rag/query" "$QUERY_NO_RESULTS" 200 "Consulta sem resultados"; then
    ((PASSED++))
else
    ((FAILED++))
fi
echo ""

echo "5️⃣  Validação - Query Vazia"
INVALID_QUERY=$(cat <<EOF
{
  "query": "",
  "tenantId": "$TENANT_ID"
}
EOF
)

if test_endpoint "POST" "/rag/query" "$INVALID_QUERY" 400 "Query vazia (deve falhar)"; then
    ((PASSED++))
else
    ((FAILED++))
fi
echo ""

echo "6️⃣  Validação - Sem Tenant ID"
INVALID_TENANT=$(cat <<EOF
{
  "query": "Teste",
  "tenantId": ""
}
EOF
)

if test_endpoint "POST" "/rag/query" "$INVALID_TENANT" 400 "Sem tenant ID (deve falhar)"; then
    ((PASSED++))
else
    ((FAILED++))
fi
echo ""

# Resumo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Resumo dos Testes"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✅ Passou: $PASSED${NC}"
echo -e "${RED}❌ Falhou: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 Todos os testes passaram!${NC}"
    exit 0
else
    echo -e "${RED}⚠️  Alguns testes falharam${NC}"
    exit 1
fi

