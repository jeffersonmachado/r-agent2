# RAG para Desenvolvimento

## 📋 Visão Geral

Este documento explica como configurar e usar o RAG em ambiente de desenvolvimento local.

## 🏗️ Configuração de Desenvolvimento

### **Tenant Padrão: `tenant-demo`**

Em desenvolvimento, o sistema usa o tenant `tenant-demo` por padrão:

```javascript
// api/data/config.json
{
  "api": {
  },
  "rag": {
    "serviceUrl": "http://localhost:8000",  // ← Serviço RAG local
    "timeout": 5000,
    "tenants": {
      "tenant-demo": {  // ← Configuração específica do tenant-demo
        "serviceUrl": "http://localhost:8000",
        "timeout": 5000,
        "domains": {
          "chatbot": {
            "sources": ["knowledge_base", "product_docs", "chat_upload"],
            "defaultCategory": "general",
            "enabled": true
          },
          "rpa": {
            "sources": ["knowledge_base", "product_docs"],
            "defaultCategory": "rpa",
            "enabled": true
          }
        }
      }
    }
  }
}
```

## 🚀 Iniciando o Ambiente de Desenvolvimento

### **1. Iniciar o Serviço RAG (Python)**

```bash
cd rag-service

# Instalar dependências
pip install -r requirements.txt

# Iniciar servidor (modo desenvolvimento com reload)
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

O serviço estará disponível em: `http://localhost:8000`

### **2. Verificar se o RAG está rodando**

```bash
curl http://localhost:8000/rag/health
```

**Resposta esperada:**
```json
{
  "status": "healthy",
  "vectorStore": "faiss",
  "embeddingModel": "sentence-transformers/all-MiniLM-L6-v2",
  "indexedDocuments": 0,
  "indexedChunks": 0
}
```

### **3. Iniciar a API Node.js**

```bash
# Na raiz do projeto
node api/server.js
```

A API estará disponível em: `http://localhost:3000`

### **4. Iniciar o Frontend**

```bash
cd frontend
npm start
```

O frontend estará disponível em: `http://localhost:5173`

### **5. Usar Script de Desenvolvimento (Recomendado)**

```bash
# Script que inicia API e Frontend juntos
./scripts/start-dev.sh
```

## 📁 Estrutura de Arquivos em Desenvolvimento

### **Vector Store do Tenant Demo**

```
rag-service/data/vector_store/
  ├── tenant-demo.index          ← Índice FAISS do tenant-demo
  └── tenant-demo.metadata.json  ← Metadados dos chunks do tenant-demo
```

### **Documentos RAG**

```
api/data/
  └── rag_documents.json  ← Todos os documentos (incluindo tenant-demo)
```

## 🔧 Configuração de Variáveis de Ambiente

### **Serviço RAG (Python)**

Crie um arquivo `.env` em `rag-service/`:

```env
# Servidor
HOST=0.0.0.0
PORT=8000
DEBUG=true

# Embeddings
EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2
EMBEDDING_DIMENSION=384

# Chunking
CHUNK_SIZE=500
CHUNK_OVERLAP=50
CHUNK_STRATEGY=sentence

# Vector Store
VECTOR_STORE_TYPE=faiss
VECTOR_STORE_PATH=./data/vector_store

# LLM (opcional - para geração de respostas)
LLM_PROVIDER=openai
LLM_MODEL=gpt-3.5-turbo
OPENAI_API_KEY=sk-...  # Opcional
```

### **API Node.js**

As configurações estão em `api/data/config.json`:

```json
{
  "rag": {
    "serviceUrl": "http://localhost:8000",
    "timeout": 5000
  }
}
```

Ou via variável de ambiente:

```bash
export RAG_SERVICE_URL=http://localhost:8000
export RAG_TIMEOUT=5000
```

## 🧪 Testando o RAG em Desenvolvimento

### **1. Indexar um Documento**

```bash
curl -X POST http://localhost:8000/rag/index \
  -H "Content-Type: application/json" \
  -d '{
    "document": {
      "id": "doc-test-001",
      "tenantId": "tenant-demo",
      "title": "Documento de Teste",
      "content": "Este é um documento de teste para o RAG em desenvolvimento.",
      "metadata": {
        "source": "manual",
        "category": "general"
      },
      "permissions": {
        "roles": null,
        "agents": null
      },
      "status": "active"
    }
  }'
```

**Resposta esperada:**
```json
{
  "success": true,
  "documentId": "doc-test-001",
  "chunksCreated": 1
}
```

### **2. Consultar o RAG**

```bash
curl -X POST http://localhost:8000/rag/query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "O que é um documento de teste?",
    "tenantId": "tenant-demo",
    "filters": {},
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
  "response": "Um documento de teste é usado para...",
  "sources": [
    {
      "documentId": "doc-test-001",
      "chunkId": "chunk-...",
      "content": "Este é um documento de teste...",
      "score": 0.95
    }
  ],
  "confidence": 0.95
}
```

### **3. Verificar Documentos Indexados**

```bash
# Via API Node.js
curl http://localhost:3000/api/rag/documents?tenantId=tenant-demo
```

## 📝 Usando o RAG no Frontend (Desenvolvimento)

### **Upload de Arquivo**

1. Acesse: `http://localhost:5173/generate-system`
2. Faça upload de arquivos
3. Os arquivos serão automaticamente:
   - Processados (OCR, extração de texto, etc.)
   - Categorizados por IA
   - Indexados no RAG do `tenant-demo`

### **Consulta RAG em Chat**

O RAG é usado automaticamente quando:
- Um nó AI está configurado com `useRag: true`
- O fluxo está rodando no tenant `tenant-demo`
- O serviço RAG está disponível em `http://localhost:8000`

## 🐛 Debugging em Desenvolvimento

### **1. Verificar Logs do Serviço RAG**

```bash
# Logs do uvicorn (modo desenvolvimento)
cd rag-service
uvicorn main:app --reload --log-level debug
```

### **2. Verificar Logs da API Node.js**

Os logs aparecem no console quando você roda:

```bash
node api/server.js
```

### **3. Verificar Status do Vector Store**

```bash
curl http://localhost:8000/rag/health
```

**Informações retornadas:**
- `indexedDocuments`: Número de documentos indexados
- `indexedChunks`: Número total de chunks
- `vectorStore`: Tipo de vector store (faiss)
- `embeddingModel`: Modelo de embeddings usado

### **4. Limpar Dados de Desenvolvimento**

```bash
# Limpar vector store do tenant-demo
rm -rf rag-service/data/vector_store/tenant-demo.*

# Limpar documentos RAG (cuidado: remove todos os documentos)
rm api/data/rag_documents.json
```

## 🔄 Fluxo Completo em Desenvolvimento

```
1. Desenvolvedor faz upload de arquivo
   ↓
2. Frontend envia para API Node.js
   ↓
3. API processa arquivo (OCR, extração, etc.)
   ↓
4. API cria documento com tenantId="tenant-demo"
   ↓
5. API chama serviço RAG em localhost:8000
   ↓
6. Serviço RAG indexa no vector store do tenant-demo
   ↓
7. Documento salvo em api/data/rag_documents.json
   ↓
8. Consultas RAG usam vector store do tenant-demo
```

## 🎯 Dicas para Desenvolvimento

### **1. Usar Tenant Isolado**

Cada desenvolvedor pode criar seu próprio tenant para testes:

```javascript
// Criar documento para tenant específico
await createDocument(documentData, "dev-joao");
```

### **2. Limpar Dados Regularmente**

Em desenvolvimento, é comum limpar e recriar dados:

```bash
# Limpar vector store
rm -rf rag-service/data/vector_store/*

# Recriar documentos de teste
node scripts/seed.js --tenant=tenant-demo
```

### **3. Usar Modo Debug**

Ative logs detalhados:

```bash
# Python
export DEBUG=true
uvicorn main:app --reload --log-level debug

# Node.js
export NODE_ENV=development
node api/server.js
```

### **4. Testar com Dados Reais**

Use o seed para criar dados de teste:

```bash
# Criar dados de exemplo
node scripts/seed.js --tenant=tenant-demo

# Isso cria:
# - Documentos RAG de exemplo
# - Prompts RAG de exemplo
# - Fluxos de exemplo
```

## 📊 Monitoramento em Desenvolvimento

### **Estatísticas do RAG**

```bash
# Via API Node.js
curl http://localhost:3000/api/rag/documents/stats?tenantId=tenant-demo
```

**Resposta:**
```json
{
  "total": 10,
  "indexed": 8,
  "notIndexed": 2,
  "bySource": {
    "manual": 5,
    "file_upload": 3,
    "web_scraping": 2
  },
  "byCategory": {
    "general": 6,
    "rpa": 2,
    "promocoes": 2
  },
  "totalChunks": 45
}
```

## 🚨 Problemas Comuns

### **1. Serviço RAG não está respondendo**

```bash
# Verificar se está rodando
curl http://localhost:8000/rag/health

# Se não responder, verificar porta
lsof -i :8000

# Reiniciar serviço
cd rag-service
uvicorn main:app --reload
```

### **2. Documentos não estão sendo indexados**

- Verificar se o serviço RAG está rodando
- Verificar logs da API Node.js
- Verificar se `tenantId` está correto (`tenant-demo`)
- Verificar se o conteúdo do documento não está vazio

### **3. Consultas RAG retornam vazio**

- Verificar se há documentos indexados: `curl http://localhost:8000/rag/health`
- Verificar se o `tenantId` na consulta corresponde ao tenant dos documentos
- Verificar se o `minScore` não está muito alto
- Verificar se há chunks no vector store: `ls -la rag-service/data/vector_store/`

## 📚 Referências

- **Documentação RAG por Tenant**: `docs/RAG_POR_TENANT.md`
- **Como Testar RAG**: `docs/COMO_TESTAR_RAG.md`
- **README do Serviço RAG**: `rag-service/README.md`
- **Configuração**: `api/data/config.json`

## 🔗 Comandos Úteis

```bash
# Iniciar tudo (RAG + API + Frontend)
./scripts/start-dev.sh

# Apenas RAG
cd rag-service && uvicorn main:app --reload

# Apenas API
node api/server.js

# Apenas Frontend
cd frontend && npm start

# Verificar saúde do RAG
curl http://localhost:8000/rag/health

# Listar documentos do tenant-demo
curl http://localhost:3000/api/rag/documents?tenantId=tenant-demo

# Limpar e recriar dados
rm -rf rag-service/data/vector_store/*
node scripts/seed.js --tenant=tenant-demo
```

