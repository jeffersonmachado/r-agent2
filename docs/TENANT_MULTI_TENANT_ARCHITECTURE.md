# Arquitetura Multi-Tenant e Contexto Cognitivo

## 📋 Visão Geral

Este documento descreve a arquitetura multi-tenant consolidada do sistema, garantindo isolamento total por `tenant_id` e integração correta com RAG, chatbot e RPA.

## 🏗️ Modelo de Tenant

### Campos Obrigatórios

O modelo de Tenant inclui os seguintes campos obrigatórios:

- **`site`**: URL oficial e institucional do cliente (obrigatório)
- **`ramo_atividade`**: Descrição clara, específica e não genérica do segmento de negócio (obrigatório)
- **`objetivo`**: Objetivo estratégico do cliente ao utilizar a plataforma (obrigatório)

**IMPORTANTE**: Esses campos NÃO são apenas informativos e NÃO devem ser tratados como documentos de conhecimento.

### Estrutura do Tenant

```json
{
  "id": "tenant-acme",
  "name": "Tenant Demo",
  "site": "https://example.com",
  "ramo_atividade": "Tecnologia e Software - Desenvolvimento de soluções...",
  "objetivo": "Automatizar o atendimento ao cliente com IA...",
  "active": true,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

## 🧠 Contexto Cognitivo do Tenant (tenant_context)

### Estrutura

O `tenant_context` é uma estrutura persistida vinculada ao `tenant_id`, contendo:

- **`site_oficial`**: URL oficial do cliente
- **`ramo_atividade`**: Descrição do segmento de negócio
- **`objetivo`**: Objetivo estratégico
- **`prioridade`**: Prioridade do contexto (HIGH, MEDIUM, LOW) - padrão: HIGH
- **`escopo`**: Escopos onde o contexto se aplica (`["rag", "chatbot", "classificacao_intencao"]`)

### Regras Obrigatórias

1. **Carregamento**: O `tenant_context` deve ser carregado **ANTES** de qualquer busca vetorial
2. **Injeção**: Deve ser injetado no system prompt
3. **Proteção**: NÃO pode ser fragmentado em chunks
4. **Segurança**: NÃO pode ser alterado por mensagens do usuário (proteção contra prompt injection)
5. **Permissões**: Só pode ser alterado por usuários com papel OWNER ou ADMIN

### Estrutura do Tenant Context

```json
{
  "tenantId": "tenant-acme",
  "ramo_atividade": "Tecnologia e Software - Desenvolvimento...",
  "objetivo": "Automatizar o atendimento ao cliente com IA...",
  "site_oficial": "https://example.com",
  "prioridade": "HIGH",
  "escopo": ["rag", "chatbot", "classificacao_intencao"],
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

## 🔄 Uso do Contexto Cognitivo

### 1. Uso do Site no RAG

- O site é tratado como **fonte institucional canônica** (`rag_source = "site_institucional"`)
- Usado para **grounding** e **validação semântica**
- Nenhuma resposta pode contradizer explicitamente o site oficial
- Scraping e atualização automática só ocorrem se explicitamente habilitados
- O site define limites de verdade institucional, não substitui outras fontes

### 2. Uso do Ramo de Atividade

- Atua como **viés semântico fixo**
- Influencia:
  - Classificação de intenção
  - Priorização lexical
  - Desambiguação semântica
- **NÃO** é tratado como conhecimento factual
- **NÃO** gera chunks nem embeddings

### 3. Uso do Objetivo

- Define direcionamento estratégico da resposta
- Usado apenas para:
  - Resolver empates entre múltiplas respostas corretas
  - Priorizar CTA quando apropriado
- **NUNCA** pode:
  - Distorcer fatos
  - Omitir informações relevantes
  - Sobrepor factualidade

## 📊 Ordem de Execução do RAG (OBRIGATÓRIA)

A execução do pipeline RAG deve seguir **EXATAMENTE** esta ordem:

1. **tenant_context** - Carregado ANTES de qualquer busca vetorial
2. **system prompt** - Construído com tenant_context injetado
3. **busca vetorial** - Busca chunks relevantes no índice vetorial do tenant
4. **re-ranking** - Considerando objetivo estratégico e site institucional
5. **resposta final** - Gerada pelo LLM com contexto completo

### Fluxo Detalhado

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Carrega tenant_context                                    │
│    - site_oficial                                            │
│    - ramo_atividade (viés semântico)                         │
│    - objetivo (direcionamento estratégico)                   │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. Constrói system prompt                                    │
│    - Injeta tenant_context (NÃO fragmentado)               │
│    - Proteção contra prompt injection                       │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. Busca vetorial                                            │
│    - Query processada com NLP (ramo_atividade como viés)     │
│    - Busca no Postgres (pgvector) do tenant específico      │
│    - Filtros por tenant_id (isolamento)                     │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. Re-ranking                                                │
│    - Prioriza chunks do site institucional (fonte canônica) │
│    - Ajusta scores baseado no objetivo (sem distorcer fatos)│
│    - Limite de bônus: 15% (não distorce factualidade)       │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. Resposta final                                            │
│    - LLM gera resposta com contexto completo                │
│    - Validação semântica contra site oficial                │
│    - Respeita factualidade e objetivo estratégico           │
└─────────────────────────────────────────────────────────────┘
```

## 🔒 Isolamento Multi-Tenant e Segurança

### Regras de Isolamento

1. **Nenhuma entidade pode existir sem `tenant_id`**
   - Todos os documentos RAG devem ter `tenantId`
   - Todos os fluxos devem ter `tenantId`
   - Todas as execuções devem ter `tenantId`
   - Todos os logs devem ter `tenantId`

2. **Nenhum dado pode ser compartilhado entre tenants**
   - Embeddings são isolados por tenant
   - Chunks são isolados por tenant
   - Fluxos são isolados por tenant
   - Execuções são isoladas por tenant
   - Cache é isolado por tenant

3. **Nenhum cache pode ser cross-tenant**
   - Cada tenant possui seu próprio cache
   - Cache é invalidado por tenant
   - Cache não pode vazar entre tenants

4. **Toda ação relevante deve ser auditável**
   - Logs incluem `tenant_id` e `user_id`
   - Auditoria completa de alterações
   - Rastreabilidade de todas as operações

### Implementação do Isolamento

#### RAG (Retrieval-Augmented Generation)

- **Vector Store**: Chunks/embeddings no Postgres (pgvector), isolados por `tenant_key`
- **Documentos**: Filtrados por `tenantId` em todas as operações
- **Busca**: Sempre inclui filtro `tenantId` na busca vetorial

#### Chatbot

- **Fluxos**: Isolados por `tenantId`
- **Sessões**: Vinculadas ao `tenantId` da sessão
- **Estado**: Cada sessão mantém seu próprio estado isolado

#### RPA

- **Fluxos RPA**: Isolados por `tenantId`
- **Execuções**: Vinculadas ao `tenantId`
- **Logs**: Incluem `tenantId` em todas as operações

## 🔐 Proteção Contra Prompt Injection

### Regras de Proteção

1. **tenant_context é FIXO**
   - Não pode ser alterado por mensagens do usuário
   - Não pode ser fragmentado em chunks
   - Não pode ser sobrescrito por input do usuário

2. **Validação de Padrões Perigosos**
   - Detecta tentativas de injeção de contexto
   - Padrões bloqueados:
     - "ignore previous instructions"
     - "forget context"
     - "system prompt"
     - "override context"
     - "new instruction"

3. **Permissões Restritas**
   - Apenas OWNER ou ADMIN podem atualizar `tenant_context`
   - Validação de permissões em todas as APIs
   - Auditoria de todas as alterações

## 📝 APIs e Contratos

### Endpoints de Tenant

- `POST /tenants` - Cria novo tenant (requer ADMIN)
- `GET /tenants` - Lista tenants (requer ADMIN)
- `GET /tenants/:id` - Obtém tenant específico
- `PUT /tenants/:id` - Atualiza tenant (requer ADMIN)
- `DELETE /tenants/:id` - Remove tenant (requer ADMIN)

### Endpoints de Tenant Context

- `GET /tenants/:id/context` - Obtém contexto do tenant
- `PUT /tenants/:id/context` - Atualiza contexto (requer OWNER ou ADMIN)

### Contratos JSON

- `contracts/tenant.contract.json` - Contrato do Tenant
- `contracts/tenant_context.contract.json` - Contrato do Tenant Context

## 🧪 Testes Cognitivos

### Testes Obrigatórios

1. **Isolamento de Respostas**
   - A mesma pergunta gera respostas diferentes para tenants com ramos distintos
   - Nenhuma resposta utiliza dados de outro tenant

2. **Influência do Objetivo**
   - O objetivo influencia a resposta sem violar factualidade
   - Respostas não distorcem fatos mesmo com objetivo definido

3. **Proteção do tenant_context**
   - O tenant_context não pode ser alterado por input do usuário
   - Tentativas de prompt injection são bloqueadas

4. **Viés Semântico do Ramo**
   - O ramo_atividade influencia classificação de intenção
   - Desambiguação semântica funciona corretamente

## 📚 Referências

- [Contrato do Tenant](./contracts/tenant.contract.json)
- [Contrato do Tenant Context](./contracts/tenant_context.contract.json)
- [RAG por Tenant](./RAG_POR_TENANT.md)
- [Seed de Tenants](./SEED_TENANTS.md)

