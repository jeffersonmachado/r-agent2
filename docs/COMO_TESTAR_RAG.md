# Como Testar os RAGs

Este guia explica como testar os dois tipos de RAG (Retrieval-Augmented Generation) do sistema.

## 📋 Índice

1. [Visão Geral](#visão-geral)
2. [Tipos de RAG](#tipos-de-rag)
3. [Pré-requisitos](#pré-requisitos)
4. [Testes Manuais](#testes-manuais)
5. [Testes Automatizados](#testes-automatizados)
6. [Testes de Integração](#testes-de-integração)
7. [Troubleshooting](#troubleshooting)

---

## Visão Geral

O sistema possui **dois tipos de RAG** com propósitos diferentes:

### 1. RAG Chatbot (Serviço Python)
- **Objetivo:** Melhorar respostas do chatbot usando documentos indexados
- **Tecnologia:** Serviço Python FastAPI com embeddings e busca vetorial
- **Uso:** Integrado no `aiNode.js` quando `useRag` está habilitado

### 2. RAG RPA Test (Arquivos Estáticos)
- **Objetivo:** Guiar geração de testes RPA usando schemas e regras
- **Tecnologia:** Arquivos JSON estáticos em `api/data/rag/`
- **Uso:** Integrado no `rpaTestGeneratorService.js` para validação

---

## Tipos de RAG

### RAG Chatbot

**Componentes:**
1. **Serviço Python (FastAPI)** - `/rag-service/`
   - Endpoints: `/rag/health`, `/rag/query`, `/rag/index`
   - Responsável por embeddings, busca vetorial e geração de respostas

2. **Serviço Node.js** - `api/services/ragService.js`
   - Cliente HTTP que chama o serviço Python
   - Integração com o sistema principal

**Fluxo:**
```
Usuário pergunta → aiNode.js → ragService.js → Python RAG Service → Busca vetorial → Resposta melhorada
```

### RAG RPA Test

**Componentes:**
1. **Arquivos RAG** - `api/data/rag/`
   - Schemas, actions, selectors, restrictions, rules
   - Usados para construir prompts estruturados

2. **Serviço de Geração** - `api/services/rpaTestGeneratorService.js`
   - Constrói prompts usando arquivos RAG
   - Valida planos RPA gerados

**Fluxo:**
```
Fluxo a testar → rpaTestGeneratorService.js → Carrega arquivos RAG → Constrói prompt → IA gera teste → Validação
```

**Estrutura de Arquivos:**
```
api/data/rag/
├── chatbot/              # RAG para chatbot (schemas de fluxos)
│   ├── schema/flow.schema.json
│   ├── nodes/node.types.json
│   └── rules/connection.rules.json
│
└── [rpa/]                # RAG para testes RPA
    ├── schema/rpa.schema.json
    ├── actions/rpa.actions.json
    ├── pages/frontend.pages.json
    ├── selectors/frontend.selectors.json
    ├── restrictions/rpa.restrictions.json
    └── rules/project.rules.json
```

---

## Pré-requisitos

### 1. Instalar Dependências

**Python (RAG Service):**
```bash
cd rag-service
pip install -r requirements.txt
```

**Node.js (já instalado):**
```bash
npm install
```

### 2. Configurar Variáveis de Ambiente

Crie um arquivo `.env` no diretório `rag-service/`:

```env
# Servidor
HOST=0.0.0.0
PORT=8000
DEBUG=true

# Embeddings
EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2

# LLM (opcional - para geração de respostas)
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini
OPENAI_API_KEY=sk-...  # Opcional

# Autenticação interna obrigatória do serviço RAG (mínimo de 32 bytes)
RAG_INTERNAL_TOKEN=replace-with-a-random-secret-at-least-32-bytes

# Banco de dados (vector store Postgres/pgvector)
DATABASE_URL=postgresql://user:pass@localhost:5432/ragent
```

### 3. Iniciar o Serviço RAG

```bash
cd rag-service
uvicorn main:app --reload
```

O serviço estará disponível em `http://localhost:8000`

---

## Testes Manuais

### RAG Chatbot (Serviço Python)

#### 1. Health Check

Verifique se o serviço está rodando:

```bash
curl http://localhost:8000/rag/health \
  -H "X-RAG-Internal-Token: $RAG_INTERNAL_TOKEN"
```

**Resposta esperada:**
```json
{
  "status": "healthy",
  "vectorStore": "postgres",
  "embeddingModel": "sentence-transformers/all-MiniLM-L6-v2",
  "indexedDocuments": 0,
  "indexedChunks": 0
}
```

### 2. Indexar um Documento

Antes de fazer consultas, você precisa indexar documentos:

```bash
curl -X POST http://localhost:8000/rag/index \
  -H "Content-Type: application/json" \
  -H "X-RAG-Internal-Token: $RAG_INTERNAL_TOKEN" \
  -d '{
    "document": {
      "id": "doc-001",
      "tenantId": "tenant-001",
      "domain": "OPERATIONAL",
      "classification": "PRODUCTION",
      "sensitivity": "INTERNAL",
      "title": "Guia de Atendimento",
      "content": "Para resetar sua senha, acesse o menu Configurações > Segurança > Redefinir Senha. Você receberá um email com instruções.",
      "metadata": {
        "category": "suporte",
        "source": "manual"
      },
      "permissions": {
        "roles": ["agent", "admin"]
      },
      "status": "active"
    }
  }'
```

**Resposta esperada:**
```json
{
  "success": true,
  "documentId": "doc-001",
  "chunksCreated": 1
}
```

### 3. Consultar RAG

Faça uma consulta para testar a busca e geração de resposta:

```bash
curl -X POST http://localhost:8000/rag/query \
  -H "Content-Type: application/json" \
  -H "X-RAG-Internal-Token: $RAG_INTERNAL_TOKEN" \
  -d '{
    "query": "Como resetar minha senha?",
    "tenantId": "tenant-001",
    "filters": {
      "roles": ["agent"]
    },
    "options": {
      "topK": 5,
      "minScore": 0.6,
      "maxTokens": 1000
    }
  }'
```

**Resposta esperada:**
```json
{
  "success": true,
  "response": "Para resetar sua senha, acesse o menu Configurações > Segurança > Redefinir Senha...",
  "sources": [
    {
      "chunkId": "chunk-001",
      "documentId": "doc-001",
      "title": "Chunk 1",
      "score": 0.85,
      "excerpt": "Para resetar sua senha, acesse o menu Configurações..."
    }
  ],
  "confidence": 0.85,
  "metadata": {
    "chunksSearched": 5,
    "chunksFound": 1
  }
}
```

#### 4. Testar via Node.js

Teste o serviço Node.js que chama o Python:

```bash
node -e "
const ragService = require('./api/services/ragService');

async function test() {
  // Verificar disponibilidade
  const available = await ragService.isRagAvailable();
  console.log('RAG disponível:', available);
  
  // Indexar documento
  const indexResult = await ragService.indexDocument({
    id: 'doc-test-001',
    title: 'Teste',
    content: 'Este é um documento de teste para verificar o RAG.',
    metadata: { category: 'test' }
  }, 'tenant-001');
  console.log('Indexação:', indexResult);
  
  // Consultar
  const queryResult = await ragService.queryRag(
    'O que é este documento?',
    'tenant-001'
  );
  console.log('Consulta:', queryResult);
}

test().catch(console.error);
"
```

---

### RAG RPA Test (Arquivos Estáticos)

O RAG RPA Test não usa o serviço Python, mas sim arquivos JSON estáticos que guiam a geração de testes RPA.

#### 1. Verificar Estrutura de Arquivos

```bash
# Verificar se os arquivos RAG existem
ls -la api/data/rag/

# Estrutura esperada:
# api/data/rag/
# ├── chatbot/              # RAG para chatbot
# │   ├── schema/flow.schema.json
# │   ├── nodes/node.types.json
# │   └── rules/connection.rules.json
# ├── schema/rpa.schema.json
# ├── actions/rpa.actions.json
# ├── pages/frontend.pages.json
# ├── selectors/frontend.selectors.json
# ├── restrictions/rpa.restrictions.json
# └── rules/project.rules.json
```

#### 2. Validar JSON dos Arquivos RAG

```bash
# Validar schema RPA
cat api/data/rag/schema/rpa.schema.json | jq .

# Validar actions
cat api/data/rag/actions/rpa.actions.json | jq .

# Validar selectors
cat api/data/rag/selectors/frontend.selectors.json | jq .
```

#### 3. Testar Carregamento dos Arquivos RAG

```bash
node -e "
const path = require('path');
const fs = require('fs');

const RAG_BASE = path.join(__dirname, 'api/data/rag');

// Testar carregamento de arquivos RAG
function loadRagFile(category, filename) {
  const filePath = path.join(RAG_BASE, category, filename);
  if (fs.existsSync(filePath)) {
    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    console.log(\`✅ \${category}/\${filename}: OK (\${Object.keys(content).length} chaves)\`);
    return content;
  } else {
    console.error(\`❌ \${category}/\${filename}: NÃO ENCONTRADO\`);
    return null;
  }
}

console.log('Testando arquivos RAG RPA Test...\n');

// Schema
loadRagFile('schema', 'rpa.schema.json');

// Actions
loadRagFile('actions', 'rpa.actions.json');

// Pages
loadRagFile('pages', 'frontend.pages.json');

// Selectors
loadRagFile('selectors', 'frontend.selectors.json');

// Restrictions
loadRagFile('restrictions', 'rpa.restrictions.json');

// Rules
loadRagFile('rules', 'project.rules.json');

console.log('\n✅ Teste de carregamento concluído!');
"
```

#### 4. Testar Validação de Plano RPA

```bash
node -e "
const validateRpaPlan = require('./api/utils/validateRpaPlan');

// Plano RPA de teste
const testPlan = {
  name: 'Teste RPA',
  steps: [
    {
      type: 'navigate',
      url: 'http://localhost:5173',
      selector: 'body'
    },
    {
      type: 'click',
      selector: 'button#test-button'
    }
  ]
};

// Validar
const result = validateRpaPlan(testPlan);
console.log('Resultado da validação:', JSON.stringify(result, null, 2));
"
```

#### 5. Testar Geração de Prompt RPA

```bash
node -e "
const rpaTestGenerator = require('./api/services/rpaTestGeneratorService');

// Fluxo de teste
const testFlow = {
  id: 'flow-test',
  name: 'Fluxo de Teste',
  nodes: [
    { id: 'start', type: 'start' },
    { id: 'message', type: 'message', config: { text: 'Olá!' } },
    { id: 'end', type: 'end' }
  ],
  edges: [
    { from: 'start', to: 'message' },
    { from: 'message', to: 'end' }
  ]
};

// Construir prompt
const prompt = rpaTestGenerator.buildRpaTestGenerationPrompt(testFlow, {});
console.log('Prompt gerado:');
console.log(prompt.substring(0, 500) + '...');
"
```

#### 6. Testar Integração Completa (via API)

```bash
# 1. Iniciar o servidor
npm start

# 2. Gerar teste RPA via API (se houver endpoint)
curl -X POST http://localhost:3000/api/flows/flow-id/generate-rpa-test \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{
    "flowId": "flow-test-id"
  }'
```

---

## Testes Automatizados

### Testes Python (pytest)

Execute os testes do serviço Python:

```bash
cd rag-service
pytest tests/ -v
```

**Cobertura:**
```bash
pytest tests/ --cov=. --cov-report=html
```

### Testes Node.js (Jest)

#### RAG Chatbot

Execute os testes do serviço Node.js:

```bash
npm test -- ragService
```

#### RAG RPA Test

Teste a validação de planos RPA:

```bash
npm test -- validateRpaPlan
```

Teste o gerador de testes RPA:

```bash
npm test -- rpaTestGenerator
```

Ou execute todos os testes:

```bash
npm test
```

---

## Testes de Integração

### RAG Chatbot - Fluxo Completo

1. **Indexar múltiplos documentos:**
```bash
# Documento 1
curl -X POST http://localhost:8000/rag/index \
  -H "Content-Type: application/json" \
  -H "X-RAG-Internal-Token: $RAG_INTERNAL_TOKEN" \
  -d '{
    "document": {
      "id": "doc-001",
      "tenantId": "tenant-001",
      "domain": "OPERATIONAL",
      "classification": "PRODUCTION",
      "sensitivity": "INTERNAL",
      "title": "Reset de Senha",
      "content": "Para resetar sua senha, acesse Configurações > Segurança."
    }
  }'

# Documento 2
curl -X POST http://localhost:8000/rag/index \
  -H "Content-Type: application/json" \
  -H "X-RAG-Internal-Token: $RAG_INTERNAL_TOKEN" \
  -d '{
    "document": {
      "id": "doc-002",
      "tenantId": "tenant-001",
      "domain": "OPERATIONAL",
      "classification": "PRODUCTION",
      "sensitivity": "INTERNAL",
      "title": "Cancelamento",
      "content": "Para cancelar sua conta, entre em contato com o suporte."
    }
  }'
```

2. **Consultar com diferentes queries:**
```bash
# Query 1 - Deve encontrar doc-001
curl -X POST http://localhost:8000/rag/query \
  -H "Content-Type: application/json" \
  -H "X-RAG-Internal-Token: $RAG_INTERNAL_TOKEN" \
  -d '{
    "query": "Como faço para resetar minha senha?",
    "tenantId": "tenant-001"
  }'

# Query 2 - Deve encontrar doc-002
curl -X POST http://localhost:8000/rag/query \
  -H "Content-Type: application/json" \
  -H "X-RAG-Internal-Token: $RAG_INTERNAL_TOKEN" \
  -d '{
    "query": "Quero cancelar minha conta",
    "tenantId": "tenant-001"
  }'

# Query 3 - Não deve encontrar nada
curl -X POST http://localhost:8000/rag/query \
  -H "Content-Type: application/json" \
  -H "X-RAG-Internal-Token: $RAG_INTERNAL_TOKEN" \
  -d '{
    "query": "Como fazer um bolo de chocolate?",
    "tenantId": "tenant-001"
  }'
```

### 2. Teste de Performance

Teste com múltiplas consultas simultâneas:

```bash
# Criar script de teste
cat > test_performance.sh << 'EOF'
#!/bin/bash
for i in {1..10}; do
  curl -X POST http://localhost:8000/rag/query \
    -H "Content-Type: application/json" \
    -H "X-RAG-Internal-Token: $RAG_INTERNAL_TOKEN" \
    -d "{\"query\": \"Teste $i\", \"tenantId\": \"tenant-001\"}" &
done
wait
EOF

chmod +x test_performance.sh
./test_performance.sh
```

### RAG Chatbot - Teste de Filtros

Teste filtros por roles, agentId, etc:

```bash
# Indexar documento com permissões específicas
curl -X POST http://localhost:8000/rag/index \
  -H "Content-Type: application/json" \
  -H "X-RAG-Internal-Token: $RAG_INTERNAL_TOKEN" \
  -d '{
    "document": {
      "id": "doc-admin",
      "tenantId": "tenant-001",
      "domain": "OPERATIONAL",
      "classification": "PRODUCTION",
      "sensitivity": "INTERNAL",
      "title": "Documento Admin",
      "content": "Este documento só é visível para admins.",
      "permissions": {
        "roles": ["admin"]
      }
    }
  }'

# Consultar como admin (deve encontrar)
curl -X POST http://localhost:8000/rag/query \
  -H "Content-Type: application/json" \
  -H "X-RAG-Internal-Token: $RAG_INTERNAL_TOKEN" \
  -d '{
    "query": "documento admin",
    "tenantId": "tenant-001",
    "filters": {
      "roles": ["admin"]
    }
  }'

# Consultar como user (não deve encontrar)
curl -X POST http://localhost:8000/rag/query \
  -H "Content-Type: application/json" \
  -H "X-RAG-Internal-Token: $RAG_INTERNAL_TOKEN" \
  -d '{
    "query": "documento admin",
    "tenantId": "tenant-001",
    "filters": {
      "roles": ["user"]
    }
  }'
```

### RAG RPA Test - Fluxo Completo

1. **Verificar arquivos RAG:**
```bash
# Listar todos os arquivos RAG
find api/data/rag -name "*.json" -type f

# Validar estrutura JSON
for file in $(find api/data/rag -name "*.json"); do
  echo "Validando: $file"
  cat "$file" | jq . > /dev/null && echo "✅ OK" || echo "❌ ERRO"
done
```

2. **Testar validação de plano RPA:**
```bash
# Criar plano válido
cat > test_plan.json << 'EOF'
{
  "name": "Teste de Validação",
  "steps": [
    {
      "type": "navigate",
      "url": "http://localhost:5173",
      "selector": "body"
    }
  ]
}
EOF

# Validar
node -e "
const validateRpaPlan = require('./api/utils/validateRpaPlan');
const plan = require('./test_plan.json');
const result = validateRpaPlan(plan);
console.log(JSON.stringify(result, null, 2));
"
```

3. **Testar geração de teste RPA completo:**
```bash
# Via API (se disponível)
curl -X POST http://localhost:3000/api/flows/FLOW_ID/generate-rpa-test \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN"
```

---

## Troubleshooting

### RAG Chatbot

#### Problema: Serviço não inicia

**Solução:**
```bash
# Verificar se a porta está em uso
lsof -i :8000

# Verificar logs
cd rag-service
uvicorn main:app --reload --log-level debug
```

#### Problema: Embeddings não carregam

**Solução:**
```bash
# O modelo será baixado automaticamente na primeira execução
# Verifique sua conexão com a internet
# Verifique espaço em disco (modelos podem ser grandes)
```

#### Problema: Nenhum chunk encontrado

**Possíveis causas:**
1. Documentos não foram indexados
2. Score mínimo muito alto (`minScore`)
3. Query muito diferente dos documentos indexados

**Solução:**
```bash
# Verificar documentos indexados
curl http://localhost:8000/rag/health \
  -H "X-RAG-Internal-Token: $RAG_INTERNAL_TOKEN"

# Reduzir minScore
curl -X POST http://localhost:8000/rag/query \
  -H "Content-Type: application/json" \
  -H "X-RAG-Internal-Token: $RAG_INTERNAL_TOKEN" \
  -d '{
    "query": "sua query",
    "tenantId": "tenant-001",
    "options": {
      "minScore": 0.3
    }
  }'
```

#### Problema: Timeout nas requisições

**Solução:**
- Aumentar timeout no `ragService.js`:
```javascript
const RAG_TIMEOUT = 10000; // 10 segundos
```

- Verificar se o serviço Python está respondendo:
```bash
curl http://localhost:8000/rag/health \
  -H "X-RAG-Internal-Token: $RAG_INTERNAL_TOKEN"
```

#### Problema: Erro de LLM

**Solução:**
- Se não tiver API key do OpenAI, o serviço ainda funciona mas não gera respostas
- As respostas serão apenas os chunks encontrados
- Configure `OPENAI_API_KEY` no `.env` para habilitar geração de respostas

### RAG RPA Test

#### Problema: Arquivos RAG não encontrados

**Solução:**
```bash
# Verificar se os arquivos existem
ls -la api/data/rag/

# Verificar permissões
chmod -R 644 api/data/rag/**/*.json

# Recriar estrutura se necessário
mkdir -p api/data/rag/{schema,actions,pages,selectors,restrictions,rules}
```

#### Problema: JSON inválido nos arquivos RAG

**Solução:**
```bash
# Validar todos os arquivos JSON
for file in $(find api/data/rag -name "*.json"); do
  if ! cat "$file" | jq . > /dev/null 2>&1; then
    echo "❌ JSON inválido: $file"
    cat "$file" | jq .  # Mostra o erro
  fi
done
```

#### Problema: Validação de plano RPA falha

**Solução:**
```bash
# Verificar se o validador está carregando os arquivos corretamente
node -e "
const validateRpaPlan = require('./api/utils/validateRpaPlan');
console.log('Validador carregado:', typeof validateRpaPlan);
"
```

#### Problema: Prompt RPA não inclui arquivos RAG

**Solução:**
```bash
# Verificar se o serviço está carregando os arquivos
node -e "
const rpaTestGenerator = require('./api/services/rpaTestGeneratorService');
const prompts = rpaTestGenerator.loadRpaTestPrompts();
console.log('Prompts carregados:', Object.keys(prompts || {}));
"
```

---

## Scripts Úteis

### Script de Teste Completo

Crie um arquivo `test_rag.sh`:

```bash
#!/bin/bash

BASE_URL="http://localhost:8000"
: "${RAG_INTERNAL_TOKEN:?Defina RAG_INTERNAL_TOKEN com pelo menos 32 bytes}"

echo "1. Health Check..."
curl -s "${BASE_URL}/rag/health" \
  -H "X-RAG-Internal-Token: $RAG_INTERNAL_TOKEN" | jq

echo -e "\n2. Indexando documento..."
curl -s -X POST "${BASE_URL}/rag/index" \
  -H "Content-Type: application/json" \
  -H "X-RAG-Internal-Token: $RAG_INTERNAL_TOKEN" \
  -d '{
    "document": {
      "id": "test-doc",
      "tenantId": "test-tenant",
      "domain": "OPERATIONAL",
      "classification": "PRODUCTION",
      "sensitivity": "INTERNAL",
      "title": "Teste",
      "content": "Este é um documento de teste para verificar o funcionamento do RAG."
    }
  }' | jq

echo -e "\n3. Consultando RAG..."
curl -s -X POST "${BASE_URL}/rag/query" \
  -H "Content-Type: application/json" \
  -H "X-RAG-Internal-Token: $RAG_INTERNAL_TOKEN" \
  -d '{
    "query": "O que é este documento?",
    "tenantId": "test-tenant"
  }' | jq

echo -e "\n✅ Teste completo!"
```

Torne executável e execute:
```bash
chmod +x test_rag.sh
./test_rag.sh
```

---

## Próximos Passos

1. ✅ Criar testes automatizados (pytest para Python, Jest para Node.js)
2. ✅ Adicionar testes de carga
3. ✅ Monitorar métricas de performance
4. ✅ Implementar cache de respostas
5. ✅ Adicionar logging estruturado

---

## Referências

- [Documentação FastAPI](https://fastapi.tiangolo.com/)
- [pgvector](https://github.com/pgvector/pgvector)
- [Sentence Transformers](https://www.sbert.net/)
