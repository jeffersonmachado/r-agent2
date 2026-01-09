# Pipeline RAG com Deduplicação

## Objetivo

Implementar um pipeline RAG robusto que elimine duplicidade de conteúdo desde a ingestão até a recuperação, garantindo consistência, versionamento, isolamento por tenant e respostas não repetitivas.

## Arquitetura Implementada

### 1. Normalização de Conteúdo

**Arquivo**: `api/utils/contentNormalization.js`

Função `normalizeContent()` que:
- Converte para lowercase
- Remove espaços duplicados
- Faz trim
- Normaliza quebras de linha (Windows, Unix, Mac)
- Preserva pontuação relevante

**Uso**: Aplicada em TODA ingestão antes de qualquer hash.

### 2. Hash Estrutural (Duplicidade Exata)

**Arquivo**: `api/utils/contentNormalization.js`

Função `generateContentHash()` que:
- Gera SHA-256 do texto normalizado
- Usado para detectar conteúdo idêntico

**Verificação**: `ragDeduplicationService.checkStructuralDuplicate()`
- Consulta storage/metadados por `content_hash`
- Se existe para o mesmo `tenant_id`: **DESCARTA ingestão**
- Não gera embedding
- Registra log de duplicidade

### 3. Chunking Determinístico

**Arquivos**: 
- `api/utils/contentNormalization.js` (Node.js)
- `rag-service/services/deduplication_service.py` (Python)
- `rag-service/services/chunking_service.py` (Python)

Função `generateChunkId()`:
```javascript
chunk_id = SHA-256(document_id + section_title + chunk_index)
```

**Características**:
- Overlap máximo: 5% a 10% (configurável)
- Reprocessar o mesmo documento NÃO gera novos chunk_ids
- Chunking é idempotente

### 4. Hash Semântico (Conteúdo Muito Parecido)

**Arquivo**: `api/utils/contentNormalization.js` e `rag-service/services/deduplication_service.py`

Função `generateSemanticHash()`:
- Normaliza embedding (L2)
- Gera hash do vetor normalizado
- Usado para detectar conteúdo semanticamente similar

**Verificação**: `ragDeduplicationService.checkSemanticDuplicate()`
- Consulta embeddings existentes do mesmo tenant
- Se similaridade cosseno > 0.97: **DESCARTA chunk**
- Não indexa
- Registra como duplicidade semântica

### 5. Metadados Obrigatórios

Todo chunk deve conter:

```javascript
{
  tenant_id: string,
  source_id: string,
  source_version: number,
  document_id: string,
  chunk_id: string,
  content_hash: string,
  semantic_hash: string,
  created_at: string,
  active: boolean
}
```

**Validação**: Nenhum embedding pode existir sem esses metadados.

### 6. Versionamento de Documentos

**Arquivo**: `api/services/ragDeduplicationService.js`

Implementação:
- `source_id` identifica o documento lógico
- `source_version` identifica a versão
- Apenas UMA versão ativa por `source_id`

**Ao ingerir nova versão**:
- Marca versões anteriores como `active = false`
- NÃO deleta embeddings antigos (preserva histórico)

### 7. Indexação no Vector Store

**Arquivos**:
- `api/services/ragService.js` (Node.js)
- `rag-service/api/routes/index.py` (Python)

Indexa apenas:
- `active = true`
- `tenant_id` correspondente
- Chunk único (por `chunk_id`)

**Nunca permite overwrite silencioso**.

### 8. Recuperação (Retrieval)

**Arquivos**:
- `api/services/ragService.js` (Node.js)
- `rag-service/api/routes/query.py` (Python)

Durante a busca:
1. Filtra obrigatoriamente por `tenant_id`
2. Filtra por `active = true`
3. Recupera `top_k` bruto
4. Aplica filtros de deduplicação: **máximo 1 chunk por `source_id`**

Função: `ragDeduplicationService.filterChunksForRetrieval()`

### 9. Proteção Contra Respostas Repetitivas

**Arquivo**: `rag-service/api/routes/query.py`

Antes de enviar contexto à LLM:
- Elimina chunks semanticamente redundantes
- Prioriza diversidade de fontes
- Garante que chunks tenham origem distinta

### 10. Logs e Auditoria

**Arquivo**: `api/services/ragDeduplicationService.js`

Registra:
- Tentativas de ingestão duplicada
- Motivo do descarte (hash estrutural ou semântico)
- Documento, chunk e tenant envolvidos
- Similaridade detectada (para semântico)

**Endpoint**: `GET /rag/deduplication/stats?tenantId=xxx`

### 11. Invariantes Garantidos

✅ Conteúdo duplicado NUNCA vira embedding
✅ Reprocessamento é idempotente
✅ Versionamento é explícito
✅ Tenant nunca vaza contexto
✅ Recuperação nunca repete fonte
✅ LLM nunca resolve duplicidade (deduplicação ocorre ANTES)

## Fluxo Completo

### Ingestão

1. **Normalização**: Conteúdo é normalizado
2. **Hash Estrutural**: Gera `content_hash`
3. **Verificação Estrutural**: Se duplicata → descarta, retorna documento existente
4. **Versionamento**: Determina `source_version`
5. **Chunking**: Gera chunks com `chunk_id` determinístico
6. **Embeddings**: Gera embeddings para chunks válidos
7. **Hash Semântico**: Gera `semantic_hash` para cada embedding
8. **Verificação Semântica**: Se similaridade > 0.97 → descarta chunk
9. **Registro**: Registra chunks válidos nos índices
10. **Indexação**: Indexa apenas chunks válidos no vector store

### Recuperação

1. **Busca Vetorial**: Busca `top_k` chunks
2. **Filtro por Score**: Remove chunks abaixo de `min_score`
3. **Filtro por Tenant**: Remove chunks de outros tenants
4. **Filtro por Active**: Remove chunks inativos
5. **Deduplicação**: Máximo 1 chunk por `source_id`
6. **Re-ranking**: Aplica re-ranking se necessário
7. **Contexto para LLM**: Envia chunks diversificados

## Arquivos Criados/Modificados

### Node.js

**Novos**:
- `api/utils/contentNormalization.js` - Utilitários de normalização e hash
- `api/services/ragDeduplicationService.js` - Serviço de deduplicação

**Modificados**:
- `api/services/ragService.js` - Integração de deduplicação na indexação e recuperação
- `api/services/ragDocumentsService.js` - Verificação de duplicidade estrutural antes de criar
- `api/services/webScrapingService.js` - Retorna informação de duplicata
- `api/server.js` - Endpoint de estatísticas de deduplicação

### Python

**Novos**:
- `rag-service/services/deduplication_service.py` - Serviço de deduplicação

**Modificados**:
- `rag-service/api/routes/index.py` - Integração de deduplicação na indexação
- `rag-service/api/routes/query.py` - Filtros de deduplicação na recuperação
- `rag-service/services/chunking_service.py` - Chunk IDs determinísticos

## Compatibilidade

✅ NÃO reindexa documentos existentes automaticamente
✅ NÃO remove dados históricos
✅ NÃO quebra compatibilidade com tenants existentes
✅ NÃO move lógica para a LLM
✅ TODA deduplicação ocorre ANTES da recuperação
✅ TODA lógica é determinística e reexecutável

## Próximos Passos (Opcional)

1. Persistir índices de deduplicação em Redis ou DB (atualmente em memória)
2. Melhorar detecção de seções para `section_title` no chunking
3. Implementar MMR (Maximum Marginal Relevance) para diversidade
4. Adicionar métricas de qualidade de deduplicação
5. Dashboard de visualização de duplicatas detectadas
