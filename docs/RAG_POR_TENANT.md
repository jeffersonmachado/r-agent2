# Como Funciona o RAG por Tenant

## 📋 Visão Geral

O sistema RAG (Retrieval-Augmented Generation) implementa **isolamento completo por tenant**, garantindo que cada tenant tenha seu próprio conjunto de documentos, índices vetoriais e consultas completamente separados.

## 🏗️ Arquitetura de Isolamento

### 1. **Armazenamento de Documentos (Node.js)**

Os documentos são armazenados no **PostgreSQL** (tabela `rag_documents`) e cada documento possui um campo `tenantId`/`tenant_key`:

```javascript
{
  id: "doc-123",
  tenantId: "tenant-abc",  // ← Isolamento por tenant
  title: "Documento",
  content: "Conteúdo...",
  metadata: { ... }
}
```

### 2. **Vector Store por Tenant (PostgreSQL/pgvector)**

O vector store é persistido no **PostgreSQL** via **pgvector** (tabela `rag_chunks`), usando `tenant_key` como chave de isolamento.

### 3. **Handles de runtime por tenant**

O serviço Python pode reutilizar um objeto `VectorStore` leve por tenant, mas
esse objeto é apenas um wrapper tenant-bound. Documentos, chunks, embeddings e
o enforcement de acesso permanecem no PostgreSQL; não existe fallback de dados
em memória.

## 🔄 Fluxo de Funcionamento

### **Indexação de Documentos**

1. **Criação do Documento (Node.js)**
   ```javascript
   // api/services/ragDocumentsService.js
   const document = {
     id: "doc-123",
     tenantId: "tenant-abc",  // ← Obrigatório
     title: "Documento",
     content: "Conteúdo...",
     // ...
   };
   await createDocument(documentData, tenantId);
   ```

2. **Indexação no Vector Store (Python)**
   ```python
   # rag-service/api/routes/index.py
   vector_store = get_vector_store(document.tenantId)  # wrapper vinculado ao tenant
   vector_store.add_chunks(chunks, embeddings)
   ```

3. **Persistência**
   - Chunks e embeddings são gravados no Postgres (`rag_chunks`)
   - Isolamento por `tenant_key` + `document_id`

### **Consulta RAG**

1. **Requisição com tenantId (Node.js)**
   ```javascript
   // api/services/ragService.js
   const ragResult = await queryRag(
     query,
     tenantId,  // ← Obrigatório
     context,
     filters
   );
   ```

2. **Busca no Vector Store do Tenant (Python)**
   ```python
   # rag-service/api/routes/query.py
   vector_store = get_vector_store(request.tenantId)  # wrapper vinculado ao tenant
   chunks = vector_store.search(query_embedding, top_k=top_k, filters=filters)
   ```

3. **Resultados Isolados**
   - Apenas chunks do tenant especificado são retornados
   - Não há vazamento de dados entre tenants

## 🔒 Garantias de Isolamento

### **1. Validação de tenantId**

Todas as operações exigem `tenantId`:

```python
# rag-service/api/routes/query.py
if not request.tenantId:
    raise HTTPException(status_code=400, detail="tenantId é obrigatório")
```

```javascript
// api/services/ragService.js
if (!tenantId) {
  throw new Error('tenantId é obrigatório');
}
```

### **2. Filtragem por Tenant**

**Node.js (documentos):** `ragDocumentsService` exige `tenantId`, consulta
`rag_documents` por `tenant_key` e usa seu `Map` apenas como cache leve. Falha
de PostgreSQL resulta em `PERSISTENCE_REQUIRED`; o cache nunca vira fonte
alternativa de verdade.

**Python (recuperação):** `vector_store.search` inclui `c.tenant_key = %s` no
`WHERE`, junto com domínio, classificação, sensitivity, ACL e estado do
documento pai, antes de calcular similaridade.

### **3. Persistência Isolada**

O isolamento é garantido no banco via filtro por `tenant_key` na tabela `rag_chunks` durante indexação e busca.

## 📊 Configuração por Tenant

### **URL do Serviço RAG**

Cada tenant pode ter sua própria URL do serviço RAG:

```javascript
// api/services/ragService.js
function getRagServiceUrl(tenantId) {
  const ragConfig = config.get('rag', {});
  const tenantsConfig = ragConfig.tenants || {};
  const tenantConfig = tenantsConfig[tenantId];
  
  if (tenantConfig && tenantConfig.serviceUrl) {
    return tenantConfig.serviceUrl;  // ← URL específica do tenant
  }
  
  return DEFAULT_RAG_SERVICE_URL;  // ← URL padrão
}
```

### **Configuração de Domínios**

Cada tenant pode ter configurações diferentes de domínios RAG:

```javascript
// api/services/ragService.js
function getRagDomains(tenantId) {
  const tenantConfig = tenantsConfig[tenantId];
  
  if (tenantConfig && tenantConfig.domains) {
    return tenantConfig.domains;  // ← Domínios específicos do tenant
  }
  
  return DEFAULT_DOMAINS;  // ← Domínios padrão
}
```

## 🔍 Exemplo Prático

### **Cenário: Dois Tenants**

**Tenant A (`tenant-abc`):**
- Documentos: `doc-1`, `doc-2`, `doc-3`
- Vector Store: `rag_chunks` com `tenant_key = "tenant-abc"`

**Tenant B (`tenant-xyz`):**
- Documentos: `doc-4`, `doc-5`, `doc-6`
- Vector Store: `rag_chunks` com `tenant_key = "tenant-xyz"`

### **Consulta do Tenant A**

```javascript
// Consulta do tenant-abc
const result = await queryRag(
  "Qual é nossa política de devolução?",
  "tenant-abc",  // ← Apenas documentos do tenant-abc
  context
);
```

**O que acontece:**
1. Obtém `vector_store` para `tenant-abc`
2. Busca apenas em `rag_chunks` filtrando `tenant_key = "tenant-abc"`
3. Retorna apenas chunks de documentos do `tenant-abc`
4. **Nunca** acessa dados do `tenant-xyz`

### **Consulta do Tenant B**

```javascript
// Consulta do tenant-xyz
const result = await queryRag(
  "Qual é nossa política de devolução?",
  "tenant-xyz",  // ← Apenas documentos do tenant-xyz
  context
);
```

**O que acontece:**
1. Obtém `vector_store` para `tenant-xyz`
2. Busca apenas em `rag_chunks` filtrando `tenant_key = "tenant-xyz"`
3. Retorna apenas chunks de documentos do `tenant-xyz`
4. **Nunca** acessa dados do `tenant-abc`

## 🛡️ Segurança e Isolamento

### **1. Validação em Múltiplas Camadas**

- **Node.js**: Filtra documentos por `tenantId` antes de enviar para indexação
- **Python**: Valida `tenantId` em todas as requisições
- **Vector Store**: aplica `tenant_key` no SQL autoritativo antes da similaridade

### **2. Sem Vazamento de Dados**

- Chunks e embeddings são isolados por `tenant_key`
- Consultas são isoladas por tenant
- Não há compartilhamento de dados entre tenants

### **3. Permissões Granulares**

Além do isolamento por tenant, a mesma consulta SQL aplica `domain`,
`classification`, `sensitivity`, ACL de roles/agent e exige documento pai
ativo e indexado. Roles e `agentId` são derivados do ator autenticado no Node,
nunca aceitos como ampliação de acesso enviada pelo cliente. É proibido buscar
um conjunto amplo e pós-filtrar em Python.

## 📝 Resumo

### **Isolamento Garantido Por:**

1. ✅ **tenantId obrigatório** em todas as operações
2. ✅ **Isolamento por `tenant_key`** no Postgres/pgvector antes da similaridade
3. ✅ **Filtragem autoritativa no PostgreSQL** e cache Node apenas auxiliar
4. ✅ **Validação de tenantId** no Python
5. ✅ **Configurações específicas** por tenant (URL, capacidades e timeout)

### **Fluxo Completo:**

```
Upload de Arquivo
  ↓
tenantId extraído do agente autenticado
  ↓
Documento criado com tenantId
  ↓
Indexação no Vector Store do tenant
  ↓
Consulta RAG usa Vector Store do tenant
  ↓
Resultados isolados por tenant
```

## 🔗 Referências no Código

- **Node.js - Documentos**: `api/services/ragDocumentsService.js`
- **Node.js - Consultas**: `api/services/ragService.js`
- **Python - Vector Store**: `rag-service/services/vector_store.py`
- **Python - Indexação**: `rag-service/api/routes/index.py`
- **Python - Consultas**: `rag-service/api/routes/query.py`
- **Segurança**: `engine/security.js`
