# Tenant Context e Integração com RAG

## 📋 Visão Geral

O sistema implementa um **contexto cognitivo por tenant** que é integrado ao RAG (Retrieval-Augmented Generation), garantindo que cada tenant tenha seu próprio contexto de negócio que influencia as respostas do sistema.

## 🏗️ Arquitetura

### 1. **Modelo de Tenant**

Cada tenant possui os seguintes campos obrigatórios:

```json
{
  "id": "tenant-abc",
  "name": "Nome do Cliente",
  "site": "https://cliente.com",
  "ramo_atividade": "Descrição textual do segmento de negócio",
  "objetivo": "Objetivo estratégico do cliente com o uso da plataforma",
  "active": true,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

**Campos Obrigatórios:**
- `site`: URL oficial do cliente (deve ser válida: http:// ou https://)
- `ramo_atividade`: Descrição textual do segmento de negócio
- `objetivo`: Objetivo estratégico do cliente com o uso da plataforma

### 2. **Tenant Context (Contexto Cognitivo)**

O `tenant_context` é uma estrutura persistida vinculada ao `tenant_id` que contém o contexto cognitivo do tenant:

```json
{
  "tenantId": "tenant-abc",
  "ramo_atividade": "Descrição do segmento de negócio",
  "objetivo": "Objetivo estratégico",
  "site_oficial": "https://cliente.com",
  "prioridade": "HIGH",
  "escopo": ["rag", "chatbot", "classificacao_intencao"],
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

**Campos:**
- `ramo_atividade`: Descrição do segmento de negócio (usado como contexto fixo no RAG)
- `objetivo`: Objetivo estratégico (influencia a escolha final da resposta)
- `site_oficial`: URL oficial do cliente
- `prioridade`: Prioridade do contexto (HIGH, MEDIUM, LOW) - padrão: HIGH
- `escopo`: Escopos onde o contexto se aplica (rag, chatbot, classificacao_intencao)

**Regras:**
- O `tenant_context` é criado/atualizado automaticamente quando um tenant é criado/atualizado
- O contexto **NÃO é fragmentado em chunks** - é injetado como contexto fixo no system prompt
- O contexto é carregado **antes** de qualquer busca vetorial

## 🔄 Integração com RAG

### 1. **Injeção de Contexto na Query**

O contexto do tenant é injetado na query **antes** da busca vetorial:

```javascript
// api/services/ragService.js
if (tenantContext && tenantContext.ramo_atividade) {
  const contextPrefix = `[Contexto do negócio: ${tenantContext.ramo_atividade}] `;
  processedQuery = contextPrefix + processedQuery;
}
```

Isso garante que a busca vetorial seja influenciada pelo ramo de atividade do tenant.

### 2. **Contexto no System Prompt**

O contexto é adicionado ao system prompt **antes** dos chunks encontrados:

```python
# rag-service/api/routes/query.py
system_context_parts = []

if tenant_context:
    if tenant_context.get('ramo_atividade'):
        system_context_parts.append(f"Ramo de Atividade: {tenant_context['ramo_atividade']}")
    
    if tenant_context.get('objetivo'):
        system_context_parts.append(f"Objetivo Estratégico: {tenant_context['objetivo']}")

system_context = "\n".join(system_context_parts)
```

O contexto é inserido no prompt como:

```
Ramo de Atividade: [ramo_atividade]
Objetivo Estratégico: [objetivo]

Contexto relevante extraído da base de conhecimento...
```

### 3. **Priorização Estratégica**

O `objetivo` do tenant influencia a escolha final da resposta através do prompt:

```
- Use o contexto do negócio (ramo de atividade e objetivo) para priorizar e contextualizar suas respostas
- O objetivo estratégico do cliente deve influenciar a escolha final da resposta (priorização estratégica)
```

## 🌐 Site como Fonte Institucional Canônica

### 1. **Indexação Automática**

Quando um tenant é criado ou atualizado, o `site` é automaticamente indexado como fonte institucional canônica:

```javascript
// api/services/tenantService.js
async function indexSiteAsInstitutionalSource(tenantId, site) {
  const scrapeResult = await webScrapingService.scrapeUrl(site, {
    source: 'site_institucional',
    category: 'institucional',
    tenantId,
    autoIndex: true,
    tags: ['site_oficial', 'fonte_canonica'],
  });
}
```

### 2. **Metadados do Documento**

O documento indexado possui os seguintes metadados:

```json
{
  "metadata": {
    "source": "site_institucional",
    "site_oficial": "https://cliente.com",
    "rag_source": "site_institucional",
    "canonical": true
  }
}
```

### 3. **Isolamento por Tenant**

O site é indexado **apenas para o tenant específico**, garantindo isolamento completo:

- Cada tenant tem seus próprios chunks/embeddings no Postgres (pgvector), isolados por `tenant_key`
- Documentos são filtrados por `tenantId` antes da busca
- Nenhum embedding, chunk ou resposta utiliza dados de outro tenant

## 🔒 Regras de Isolamento

### 1. **Isolamento de Dados**

- **Tenants**: Cada tenant possui seus próprios dados (agentes, fluxos, documentos)
- **Vector Store**: Chunks/embeddings no Postgres (pgvector), isolados por `tenant_key`
- **Tenant Context**: Cada tenant possui seu próprio contexto cognitivo
- **Documentos RAG**: Todos os documentos possuem `tenantId` e são filtrados antes da busca

### 2. **Persistência autoritativa e cache leve**

Objetos `VectorStore` em memória são apenas wrappers vinculados ao tenant.
Chunks, embeddings e metadados vivem no PostgreSQL/pgvector; não há fallback de
persistência em Maps ou dicionários. O cache Node também é auxiliar e nunca
substitui a fonte autoritativa.

### 3. **Validação de Isolamento**

Todas as operações RAG validam o `tenantId`:

```python
# rag-service/api/routes/query.py
if not request.tenantId:
    raise HTTPException(status_code=400, detail="tenantId é obrigatório")

vector_store = get_vector_store(request.tenantId)  # wrapper vinculado ao tenant
```

Na recuperação, o SQL aplica `tenant_key`, domínio, classificação,
sensibilidade, ACL de roles/agent e documento pai ativo/indexado antes do
cálculo de similaridade.

## 📝 Contratos JSON

### Contrato do Tenant

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Tenant",
  "type": "object",
  "required": ["id", "name", "site", "ramo_atividade", "objetivo"],
  "properties": {
    "id": {
      "type": "string",
      "description": "ID único do tenant"
    },
    "name": {
      "type": "string",
      "description": "Nome do tenant/cliente"
    },
    "site": {
      "type": "string",
      "format": "uri",
      "description": "URL oficial do cliente (obrigatório)"
    },
    "ramo_atividade": {
      "type": "string",
      "minLength": 1,
      "description": "Descrição textual do segmento de negócio (obrigatório)"
    },
    "objetivo": {
      "type": "string",
      "minLength": 1,
      "description": "Objetivo estratégico do cliente com o uso da plataforma (obrigatório)"
    },
    "active": {
      "type": "boolean",
      "default": true
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    },
    "updatedAt": {
      "type": "string",
      "format": "date-time"
    }
  }
}
```

### Contrato do Tenant Context

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Tenant Context",
  "type": "object",
  "required": ["tenantId", "ramo_atividade", "objetivo", "site_oficial", "prioridade", "escopo"],
  "properties": {
    "tenantId": {
      "type": "string",
      "description": "ID do tenant (chave única)"
    },
    "ramo_atividade": {
      "type": "string",
      "description": "Descrição do segmento de negócio"
    },
    "objetivo": {
      "type": "string",
      "description": "Objetivo estratégico"
    },
    "site_oficial": {
      "type": "string",
      "format": "uri",
      "description": "URL oficial do cliente"
    },
    "prioridade": {
      "type": "string",
      "enum": ["HIGH", "MEDIUM", "LOW"],
      "default": "HIGH",
      "description": "Prioridade do contexto"
    },
    "escopo": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": ["rag", "chatbot", "classificacao_intencao"]
      },
      "description": "Escopos onde o contexto se aplica"
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    },
    "updatedAt": {
      "type": "string",
      "format": "date-time"
    }
  }
}
```

## 🔌 APIs

### POST /tenants

Cria um novo tenant.

**Request:**
```json
{
  "name": "Nome do Cliente",
  "site": "https://cliente.com",
  "ramo_atividade": "Descrição do segmento",
  "objetivo": "Objetivo estratégico"
}
```

**Response:**
```json
{
  "tenant": {
    "id": "tenant-abc",
    "name": "Nome do Cliente",
    "site": "https://cliente.com",
    "ramo_atividade": "Descrição do segmento",
    "objetivo": "Objetivo estratégico",
    "active": true,
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### PUT /tenants/:id

Atualiza um tenant existente.

**Request:**
```json
{
  "name": "Novo Nome",
  "ramo_atividade": "Novo Ramo",
  "objetivo": "Novo Objetivo"
}
```

### GET /tenants/:id/context

Obtém o contexto cognitivo do tenant.

**Response:**
```json
{
  "context": {
    "tenantId": "tenant-abc",
    "ramo_atividade": "...",
    "objetivo": "...",
    "site_oficial": "https://cliente.com",
    "prioridade": "HIGH",
    "escopo": ["rag", "chatbot", "classificacao_intencao"]
  }
}
```

### PUT /tenants/:id/context

Atualiza o contexto cognitivo do tenant.

**Request:**
```json
{
  "ramo_atividade": "Novo Ramo",
  "objetivo": "Novo Objetivo",
  "prioridade": "MEDIUM"
}
```

## ✅ Validações

### Validações de Tenant

- `site` deve ser uma URL válida (http:// ou https://)
- `ramo_atividade` não pode ser vazio
- `objetivo` não pode ser vazio
- Não pode existir outro tenant com o mesmo `site`

### Validações de Tenant Context

- `prioridade` deve ser HIGH, MEDIUM ou LOW
- `escopo` deve ser um array contendo apenas valores válidos: "rag", "chatbot", "classificacao_intencao"
- `site_oficial` deve ser uma URL válida (se fornecido)

## 🧪 Testes

Os testes validam:

1. **Isolamento**: Cada tenant possui seu próprio contexto e dados
2. **Sincronização**: Tenant context é sincronizado quando tenant é atualizado
3. **Integração RAG**: Contexto é carregado e injetado no RAG
4. **Site Institucional**: Site é indexado como fonte canônica

Execute os testes:

```bash
npm test -- tests/tenant/tenantIsolation.test.js
```

## 📚 Referências

- [RAG por Tenant](./RAG_POR_TENANT.md) - Documentação sobre isolamento RAG
- [Configuração RAG](./CONFIGURACAO_RAG_CENTRALIZADA.md) - Configuração do serviço RAG
