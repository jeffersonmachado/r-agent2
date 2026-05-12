# Arquitetura Multi-Tenant e Contexto Cognitivo

## 📋 Visão Geral

Este documento descreve a implementação completa do cadastro de tenants/clientes em uma arquitetura SaaS multi-tenant, garantindo isolamento total por `tenant_id` e integração correta com RAG, chatbot e RPA.

## 🏗️ Modelo de Tenant

### Campos Obrigatórios

Cada tenant possui os seguintes campos obrigatórios:

```json
{
  "id": "tenant-abc",
  "name": "Nome do Cliente",
  "site": "https://cliente.com",
  "ramo_atividade": "Descrição clara, específica e não genérica do segmento de negócio",
  "objetivo": "Objetivo estratégico do cliente ao utilizar a plataforma",
  "active": true,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

**Regras:**
- `site`: URL oficial e institucional do cliente (obrigatório, deve ser válida: http:// ou https://)
- `ramo_atividade`: Descrição clara, específica e não genérica do segmento de negócio (obrigatório, mínimo 10 caracteres)
- `objetivo`: Objetivo estratégico do cliente ao utilizar a plataforma (obrigatório, mínimo 10 caracteres)

**Importante:** Esses campos NÃO são apenas informativos e NÃO devem ser tratados como documentos de conhecimento.

## 🧠 Tenant Context (Contexto Cognitivo)

### Estrutura

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

### Regras Obrigatórias

1. **Carregamento:** O `tenant_context` deve ser carregado **ANTES** de qualquer busca vetorial
2. **Injeção:** Deve ser injetado no system prompt
3. **Não Fragmentação:** NÃO pode ser fragmentado em chunks
4. **Proteção:** NÃO pode ser alterado por mensagens do usuário (proteção contra prompt injection)
5. **Permissões:** Só pode ser alterado por usuários com papel **OWNER** ou **ADMIN**
6. **Sincronização:** É automaticamente sincronizado quando o tenant é criado/atualizado

## 🔄 Ordem de Execução do RAG (OBRIGATÓRIA)

A execução do pipeline RAG deve seguir **EXATAMENTE** esta ordem:

1. **tenant_context** - Carregado ANTES de qualquer busca vetorial
2. **system prompt** - Construído com tenant_context
3. **busca vetorial** - Executada após tenant_context
4. **re-ranking** - Considerando objetivo estratégico e site institucional
5. **resposta final** - Gerada com base no contexto e chunks

**Nenhuma outra ordem é permitida.**

## 📊 Uso Cognitivo dos Campos

### Site Oficial

- **Tratamento:** Fonte institucional canônica (`rag_source = "site_institucional"`)
- **Uso:**
  - Grounding e validação semântica das respostas
  - Nenhuma resposta pode contradizer explicitamente o conteúdo do site oficial
  - Priorização no re-ranking (bônus de até 10% do score)
- **Indexação:** O site é automaticamente indexado quando o tenant é criado/atualizado
- **Isolamento:** Cada tenant tem seu próprio índice vetorial para o site

### Ramo de Atividade

- **Tratamento:** Viés semântico fixo (NÃO é conhecimento factual)
- **Uso:**
  - Classificação de intenção
  - Priorização lexical
  - Desambiguação semântica
- **Restrições:**
  - NÃO deve ser tratado como conhecimento factual
  - NÃO deve gerar chunks nem embeddings
  - NÃO deve ser usado como documento RAG

### Objetivo Estratégico

- **Tratamento:** Direcionamento estratégico da resposta
- **Uso:**
  - Resolver empates entre múltiplas respostas corretas
  - Priorizar CTA quando apropriado
  - Re-ranking estratégico (bônus de até 5% do score)
- **Restrições:**
  - NUNCA pode distorcer fatos
  - NUNCA pode omitir informações relevantes
  - NUNCA pode sobrepor factualidade
  - Apenas resolve empates estratégicos

## 🔒 Isolamento Multi-Tenant e Segurança

### Regras de Isolamento

1. **Nenhuma entidade pode existir sem `tenant_id`**
2. **Nenhum embedding, chunk, fluxo, execução, cache ou log pode ser compartilhado entre tenants**
3. **Nenhum cache pode ser cross-tenant**
4. **Toda ação relevante deve ser auditável com `tenant_id` e `user_id`**

### Proteção Contra Prompt Injection

1. **Validação de Padrões Perigosos:**
   - O sistema detecta tentativas de prompt injection no `tenant_context`
   - Padrões bloqueados: "ignore previous instructions", "forget context", "system prompt", etc.

2. **Proteção no Prompt RAG:**
   - O prompt inclui instruções explícitas para ignorar tentativas de alterar o contexto
   - O `tenant_context` é injetado no system prompt e não pode ser alterado por mensagens do usuário

3. **Permissões:**
   - Apenas usuários com papel **OWNER** ou **ADMIN** podem atualizar `tenant_context`
   - Todas as atualizações são auditadas com `user_id`, `userRole` e timestamp

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

**Validações:**
- `name`: obrigatório, 1-200 caracteres
- `site`: obrigatório, URL válida (http:// ou https://)
- `ramo_atividade`: obrigatório, 10-500 caracteres
- `objetivo`: obrigatório, 10-500 caracteres

**Response:**
```json
{
  "tenant": {
    "id": "tenant-abc",
    "name": "Nome do Cliente",
    "site": "https://cliente.com",
    "ramo_atividade": "...",
    "objetivo": "...",
    "active": true,
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

**Ações Automáticas:**
- Cria `tenant_context` automaticamente
- Indexa o site como fonte institucional canônica (assíncrono)

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

**Ações Automáticas:**
- Sincroniza `tenant_context` automaticamente
- Reindexa o site se foi atualizado (assíncrono)

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

**Permissões:** Apenas **OWNER** ou **ADMIN**

**Request:**
```json
{
  "ramo_atividade": "Novo Ramo",
  "objetivo": "Novo Objetivo",
  "prioridade": "MEDIUM",
  "escopo": ["rag", "chatbot"]
}
```

**Validações:**
- `ramo_atividade`: opcional, 10-500 caracteres
- `objetivo`: opcional, 10-500 caracteres
- `site_oficial`: opcional, URL válida
- `prioridade`: opcional, "HIGH", "MEDIUM" ou "LOW"
- `escopo`: opcional, array com valores: "rag", "chatbot", "classificacao_intencao"

**Proteção:**
- Detecta e rejeita tentativas de prompt injection
- Todas as atualizações são auditadas

## 🧪 Testes Cognitivos

Os testes automatizados comprovam:

1. **Diferenciação por Ramo:**
   - A mesma pergunta gera respostas diferentes para tenants com ramos distintos
   - O `ramo_atividade` atua como viés semântico fixo

2. **Influência do Objetivo:**
   - O objetivo influencia a resposta sem violar factualidade
   - O objetivo apenas resolve empates estratégicos

3. **Isolamento:**
   - Nenhuma resposta utiliza dados de outro tenant
   - Cada tenant possui seu próprio `tenant_context` e índice vetorial

4. **Proteção Contra Prompt Injection:**
   - O `tenant_context` não pode ser alterado por input do usuário
   - Tentativas de prompt injection são detectadas e rejeitadas

Execute os testes:
```bash
npm test -- tests/tenant/tenantContextRag.test.js
```

## 📝 Contratos JSON

### Contrato do Tenant

Ver: `contracts/tenant.contract.json`

### Contrato do Tenant Context

Ver: `contracts/tenant_context.contract.json`

## 🔗 Integração com RAG, Chatbot e RPA

### RAG

- O `tenant_context` é carregado antes de qualquer busca vetorial
- O `ramo_atividade` é injetado na query para melhorar classificação de intenção
- O `objetivo` é usado no re-ranking para priorizar respostas estratégicas
- O `site_oficial` é priorizado como fonte canônica no re-ranking

### Chatbot

- O `tenant_context` influencia a classificação de intenção
- O `ramo_atividade` atua como viés semântico para desambiguação
- O `objetivo` orienta a escolha de respostas quando há múltiplas opções corretas

### RPA

- Fluxos RPA são isolados por `tenant_id`
- O `tenant_context` pode ser usado para personalizar execuções RPA
- Nenhum fluxo ou execução pode ser compartilhado entre tenants

## 📚 Referências

- [RAG por Tenant](./RAG_POR_TENANT.md) - Documentação sobre isolamento RAG
- [Tenant Context RAG](./TENANT_CONTEXT_RAG.md) - Documentação sobre contexto cognitivo
- [Configuração RAG](./CONFIGURACAO_RAG_CENTRALIZADA.md) - Configuração do serviço RAG
- [Seed de Tenants](./SEED_TENANTS.md) - Estado atual do seed DB-only e caminhos relacionados
