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

### 3. **Isolamento em Memória**

O serviço Python mantém instâncias separadas em memória:

```python
_vector_stores: Dict[str, Any] = {}  # tenantId -> VectorStore
```

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
   vector_store = get_vector_store(document.tenantId)  # ← Obtém store específico do tenant
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
   vector_store = get_vector_store(request.tenantId)  # ← Store específico do tenant
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

**Node.js (Documentos):**
```javascript
// api/services/ragDocumentsService.js
function listDocuments(filters = {}) {
  let result = Array.from(documents.values());
  
  if (filters.tenantId) {
    result = result.filter(doc => doc.tenantId === filters.tenantId);
  }
  // ...
}
```

**Python (Vector Store):**
```python
# rag-service/services/vector_store.py
def get_vector_store(tenant_id: Optional[str] = None):
    if tenant_id not in _vector_stores:
        _vector_stores[tenant_id] = VectorStore(tenant_id)  # ← Nova instância por tenant
    return _vector_stores[tenant_id]
```

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
- **Vector Store**: Usa instâncias separadas por tenant

### **2. Sem Vazamento de Dados**

- Chunks e embeddings são isolados por `tenant_key`
- Consultas são isoladas por tenant
- Não há compartilhamento de dados entre tenants

### **3. Permissões Granulares**

Além do isolamento por tenant, há filtros adicionais:

```python
# rag-service/services/vector_store.py
def _filter_chunks(self, chunks: List[Chunk], filters: Dict):
    # Filtra por roles
    if filters.get('roles') and chunk.permissions.roles:
        if not any(role in chunk.permissions.roles for role in filters['roles']):
            continue
    
    # Filtra por agentId
    if filters.get('agentId') and chunk.permissions.agents:
        if filters['agentId'] not in chunk.permissions.agents:
            continue
```

## 📝 Resumo

### **Isolamento Garantido Por:**

1. ✅ **tenantId obrigatório** em todas as operações
2. ✅ **Isolamento por `tenant_key`** no Postgres (pgvector) e instância por tenant no serviço
3. ✅ **Filtragem de documentos** por tenant no Node.js
4. ✅ **Validação de tenantId** no Python
5. ✅ **Configurações específicas** por tenant (URL, domínios, timeout)

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

