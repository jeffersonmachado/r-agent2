# Verificação de Dados - Usuário Admin

## 👤 Informações do Usuário Admin

**ID:** `admin-001`  
**Username:** `admin`  
**Email:** `admin@example.com`  
**Role:** `admin`  
**Tenant ID:** `tenant-demo`  
**Status:** `active`

---

## 📊 Estatísticas de Documentos RAG (tenant-demo)

### Banco de Dados (JSON)
- **Total de Documentos:** 33
- **Documentos Indexados:** 33
- **Documentos Não Indexados:** 0
- **Total de Chunks:** 54

### Status
- ✅ Todos os documentos estão marcados como `indexed: true` no banco de dados
- ⚠️ **INCONSISTÊNCIA DETECTADA:** O vector store mostra 0 documentos indexados

---

## 🔍 Como o Sistema Filtra os Dados

### 1. Frontend (`RAGDocumentsPage.jsx`)
```javascript
const tenantId = agent?.tenantId || null;  // "tenant-demo" para admin
```

### 2. API (`getDocumentsStats`)
```javascript
if (tenantId) {
  docs = docs.filter(doc => doc.tenantId === tenantId);
}
```

### 3. RAG Service (`/rag/health`)
```python
if tenant_id:
    # Estatísticas de um tenant específico
    vector_store = get_vector_store(tenant_id)
    stats = vector_store.get_stats()
```

---

## 🔄 Fluxo de Dados para Admin

```
Admin (tenant-demo)
    ↓
Frontend: agent.tenantId = "tenant-demo"
    ↓
GET /rag/documents/stats?tenantId=tenant-demo
    ↓
Backend: Filtra docs com tenantId = "tenant-demo"
    ├─→ BD: 33 docs indexados
    └─→ GET /rag/health?tenant_id=tenant-demo
        └─→ Vector Store: Busca índice "tenant-demo.index"
            └─→ Retorna: 0 docs (INCONSISTÊNCIA!)
```

---

## ⚠️ Problema Identificado

### Inconsistência
- **Banco de Dados:** 33 documentos marcados como indexados
- **Vector Store:** 0 documentos indexados
- **Diferença:** 33 documentos

### Causa Provável
1. Os documentos foram marcados como indexados no BD, mas a indexação no vector store falhou
2. O vector store foi limpo/resetado após a indexação
3. O índice do tenant-demo não foi criado ou foi perdido

---

## ✅ Solução Implementada

### 1. Detecção Automática
O sistema agora detecta automaticamente a inconsistência:
```javascript
if (dbIndexed > vectorIndexed) {
  stats.syncStatus = 'db_ahead';
  stats.syncDifference = dbIndexed - vectorIndexed;  // 33
}
```

### 2. Botão de Sincronização
- Aparece quando `syncStatus === 'db_ahead'`
- Texto: "🔄 Sincronizar (33)"
- Cor: Laranja (warning)

### 3. Reindexação de Inconsistentes
Quando clicado, o botão:
- Reindexa todos os 33 documentos marcados como indexados
- Usa `includeInconsistent: true`
- Sincroniza BD com Vector Store

---

## 🧪 Como Testar

### 1. Verificar Estatísticas
```bash
# No frontend, acesse:
http://localhost:5173/rag-documents

# Deve mostrar:
# - Total: 33
# - Indexados (BD): 33
# - Vector Store: 0
# - Alerta de inconsistência
```

### 2. Verificar Endpoint Diretamente
```bash
# Estatísticas do BD
curl http://localhost:3000/rag/documents/stats?tenantId=tenant-demo

# Estatísticas do Vector Store
curl http://localhost:8000/rag/health?tenant_id=tenant-demo
```

### 3. Sincronizar Documentos
1. Acesse `/rag-documents`
2. Veja o alerta de inconsistência
3. Clique em "🔄 Sincronizar (33)"
4. Confirme a ação
5. Aguarde a conclusão
6. Verifique se as estatísticas foram atualizadas

---

## 📝 Dados Esperados Após Sincronização

### Antes
- BD: 33 indexados
- Vector Store: 0 indexados
- Status: `db_ahead` (inconsistente)

### Depois
- BD: 33 indexados
- Vector Store: 33 indexados
- Status: `synced` (sincronizado)

---

## 🔧 Verificações Técnicas

### 1. Endpoint de Health com Tenant
```python
# rag-service/api/routes/health.py
@router.get("/health")
async def health_check(tenant_id: Optional[str] = Query(None)):
    if tenant_id:
        vector_store = get_vector_store(tenant_id)  # "tenant-demo"
        stats = vector_store.get_stats()
```

### 2. Filtro por Tenant no Backend
```javascript
// api/services/ragDocumentsService.js
async function getDocumentsStats(tenantId = null) {
  let docs = Array.from(documents.values());
  
  if (tenantId) {
    docs = docs.filter(doc => doc.tenantId === tenantId);  // "tenant-demo"
  }
```

### 3. Frontend Passa TenantId
```javascript
// frontend/src/pages/RAGDocumentsPage.jsx
const tenantId = agent?.tenantId || null;  // "tenant-demo"
const stats = await getDocumentsStats(tenantId);
```

---

## ✅ Checklist de Validação para Admin

- [x] Usuário admin identificado: `tenant-demo`
- [x] Documentos filtrados corretamente por tenant
- [x] Estatísticas do BD: 33 docs indexados
- [x] Estatísticas do Vector Store: 0 docs (inconsistência)
- [x] Detecção de inconsistência funcionando
- [x] Botão de sincronização aparece
- [x] Reindexação de inconsistentes implementada
- [x] Endpoint `/rag/health` aceita `tenant_id=tenant-demo`

---

## 🚀 Próximos Passos

1. **Sincronizar Documentos:**
   - Clicar no botão "🔄 Sincronizar (33)"
   - Aguardar conclusão
   - Verificar se Vector Store agora tem 33 docs

2. **Verificar Logs:**
   ```bash
   # Backend
   tail -f api/logs/*.log | grep "tenant-demo"
   
   # RAG Service
   tail -f rag-service/logs/*.log | grep "tenant-demo"
   ```

3. **Validar Sincronização:**
   - Acessar `/rag-documents`
   - Verificar se alerta desapareceu
   - Confirmar que Vector Store mostra 33 docs

---

**Data da Verificação:** 2025-01-05  
**Usuário:** admin (tenant-demo)  
**Status:** ⚠️ Inconsistência detectada - Aguardando sincronização
