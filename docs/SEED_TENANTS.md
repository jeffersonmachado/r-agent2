# Como Usar o Seed de Tenants

## 📋 Visão Geral

O script de seed (`scripts/seed.js`) agora inclui a criação automática de **tenants** e **tenant contexts** com dados de exemplo para desenvolvimento e testes.

## 🚀 Como Executar

### 1. Seed Básico (Preserva dados existentes)

```bash
npm run seed
# ou
node scripts/seed.js
```

**O que faz:**
- Cria tenants de exemplo se não existirem
- Cria tenant contexts automaticamente
- Preserva dados existentes (não sobrescreve)

### 2. Seed com Reset (Sobrescreve tudo)

```bash
npm run seed:reset
# ou
node scripts/seed.js --reset
```

**O que faz:**
- **⚠️ ATENÇÃO**: Sobrescreve todos os dados existentes
- Cria tenants e contexts do zero
- Útil para resetar o ambiente de desenvolvimento

### 3. Seed com Tenant Customizado

```bash
node scripts/seed.js --tenant=meu-tenant-id
```

**O que faz:**
- Cria dados para um tenant específico
- Útil para criar dados de teste para um tenant novo

### 4. Ver Ajuda

```bash
node scripts/seed.js --help
```

## 📦 O que é Criado

### 🏢 Tenants (3)

1. **Tenant Demo** (`tenant-demo`)
   - Site: `https://example.com`
   - Ramo: Tecnologia e Software
   - Objetivo: Automatizar atendimento com IA

2. **E-commerce Store** (`tenant-ecommerce`)
   - Site: `https://ecommerce-example.com`
   - Ramo: E-commerce e Varejo Online
   - Objetivo: Melhorar experiência de compra online

3. **Clínica de Saúde** (`tenant-saude`)
   - Site: `https://clinica-saude-example.com`
   - Ramo: Saúde e Bem-estar
   - Objetivo: Agilizar agendamentos e comunicação

### 🧠 Tenant Contexts (3)

Cada tenant recebe automaticamente um **tenant context** com:
- `ramo_atividade`: Descrição do segmento
- `objetivo`: Objetivo estratégico
- `site_oficial`: URL do site
- `prioridade`: `HIGH`
- `escopo`: `["rag", "chatbot", "classificacao_intencao"]`

### 📁 Arquivos Criados

- `api/data/tenants.json` - Lista de tenants
- `api/data/tenant_contexts.json` - Contextos cognitivos dos tenants

## 🔍 Verificar Dados Criados

### Via Terminal

```bash
# Ver tenants criados
cat api/data/tenants.json | jq

# Ver tenant contexts
cat api/data/tenant_contexts.json | jq

# Ver apenas IDs dos tenants
cat api/data/tenants.json | jq '.[].id'
```

### Via Interface Web

1. Acesse: `http://localhost:5173/tenants` (ou sua URL do frontend)
2. Faça login como **admin** (username: `admin`, password: `admin123`)
3. Você verá todos os tenants criados pelo seed

## 📝 Estrutura dos Dados

### Exemplo de Tenant

```json
{
  "id": "tenant-demo",
  "name": "Tenant Demo",
  "site": "https://example.com",
  "ramo_atividade": "Tecnologia e Software - Desenvolvimento de soluções...",
  "objetivo": "Automatizar o atendimento ao cliente com IA...",
  "active": true,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

### Exemplo de Tenant Context

```json
{
  "tenantId": "tenant-demo",
  "ramo_atividade": "Tecnologia e Software - Desenvolvimento...",
  "objetivo": "Automatizar o atendimento ao cliente com IA...",
  "site_oficial": "https://example.com",
  "prioridade": "HIGH",
  "escopo": ["rag", "chatbot", "classificacao_intencao"],
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

## 🔄 Fluxo de Execução

Quando você executa o seed:

1. **Cria Tenants** → `createTenants()`
   - Cria 3 tenants de exemplo
   - Salva em `api/data/tenants.json`

2. **Cria Tenant Contexts** → `createTenantContexts()`
   - Cria contexto cognitivo para cada tenant
   - Salva em `api/data/tenant_contexts.json`

3. **Cria Agentes** → `createAgents(tenantId)`
   - Cria agentes para o tenant especificado
   - Por padrão: `tenant-demo`

4. **Cria Outros Dados** → Fluxos, Filas, Departamentos, etc.

## ⚠️ Importante

### Sincronização Automática

Quando você cria ou atualiza um tenant via API ou interface:
- O `tenant_context` é **automaticamente sincronizado**
- O `site` é **automaticamente indexado** como fonte institucional canônica

### Isolamento por Tenant

- Cada tenant possui seus próprios dados
- Agentes, fluxos, documentos RAG são isolados por `tenantId`
- Vector stores são separados por tenant

## 🧪 Exemplos de Uso

### Desenvolvimento Inicial

```bash
# Reset completo do ambiente
npm run seed:reset

# Verificar tenants criados
cat api/data/tenants.json | jq '.[].name'
```

### Criar Dados para Novo Tenant

```bash
# Criar dados para tenant específico
node scripts/seed.js --tenant=tenant-novo-cliente

# Verificar
cat api/data/tenants.json | jq '.[] | select(.id == "tenant-novo-cliente")'
```

### Testar Isolamento

```bash
# Criar tenant de teste
node scripts/seed.js --tenant=tenant-teste

# Verificar que context foi criado
cat api/data/tenant_contexts.json | jq '.[] | select(.tenantId == "tenant-teste")'
```

## 🔗 Integração com RAG

Os tenants criados pelo seed já estão prontos para uso com RAG:

1. **Contexto Cognitivo**: O `tenant_context` é automaticamente carregado nas consultas RAG
2. **Site Institucional**: O site é indexado como fonte canônica (se web scraping estiver disponível)
3. **Isolamento**: Cada tenant tem seu próprio índice vetorial FAISS

## 📚 Referências

- [Documentação de Tenant Context](./TENANT_CONTEXT_RAG.md)
- [Script de Seed](./scripts/README_SEED.md)
- [RAG por Tenant](./RAG_POR_TENANT.md)

