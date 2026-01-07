# Script de Seed Completo

Este script popula o sistema r-agent2 com dados iniciais completos para desenvolvimento e produção.

## Uso

### Seed básico (preserva dados existentes)
```bash
npm run seed
# ou
node scripts/seed.js
```

### Seed com reset (sobrescreve dados existentes)
```bash
npm run seed:reset
# ou
node scripts/seed.js --reset
```

### Seed com tenant customizado
```bash
node scripts/seed.js --tenant=meu-tenant-id
```

### Ajuda
```bash
node scripts/seed.js --help
```

## O que é criado

### 🏢 Tenants (3)
- **tenant-demo**: Tenant Demo (Tecnologia e Software)
- **tenant-ecommerce**: E-commerce Store (E-commerce e Varejo Online)
- **tenant-saude**: Clínica de Saúde (Saúde e Bem-estar)

Cada tenant possui:
- Site oficial (URL)
- Ramo de atividade (descrição do segmento)
- Objetivo estratégico
- Contexto cognitivo (tenant_context) para RAG

### 🧠 Tenant Contexts (3)
Contextos cognitivos criados automaticamente para cada tenant:
- Ramo de atividade
- Objetivo estratégico
- Site oficial
- Prioridade: HIGH
- Escopo: ["rag", "chatbot", "classificacao_intencao"]

### 👤 Agentes (4)
- **admin** (admin@example.com) - Senha: `admin123`
- **supervisor** (supervisor@example.com) - Senha: `supervisor123`
- **atendente1** (atendente1@example.com) - Senha: `atendente123`
- **atendente2** (atendente2@example.com) - Senha: `atendente123`

### 🔄 Fluxos (2)
- **flow-welcome**: Fluxo básico de boas-vindas com roteamento
- **flow-support**: Fluxo de suporte com escalação para humano

### 📋 Filas (4)
- **suporte**: Fila de atendimento geral
- **vendas**: Fila de vendas
- **tecnico**: Fila de suporte técnico
- **financeiro**: Fila financeira

### 🏢 Departamentos (4)
- **Atendimento Geral**: Departamento principal
- **Vendas**: Departamento comercial
- **Suporte Técnico**: Departamento técnico
- **Financeiro**: Departamento financeiro

### 💬 Respostas Rápidas (6)
- Saudação Inicial
- Despedida
- Transferindo para Especialista
- Aguardando Informações
- Problema Resolvido
- Solicitar Mais Informações

### ⚙️ Configurações
- Configurações padrão da API
- Configurações do chatbot
- Configurações de filas
- Features habilitadas/desabilitadas

### 🔗 Webhooks (1)
- Webhook de notificações (exemplo)

### 📁 Arquivos Criados
- `tenants.json` - Tenants/clientes do sistema
- `tenant_contexts.json` - Contextos cognitivos dos tenants
- `agents.json` - Agentes do sistema
- `flows.json` - Fluxos de conversa
- `queues.json` - Filas e tickets
- `departments.json` - Departamentos
- `quickReplies.json` - Respostas rápidas
- `config.json` - Configurações
- `webhooks.json` - Webhooks
- `sessions.json` - Sessões (vazio)
- `audit.json` - Log de auditoria (vazio)
- `rag_documents.json` - Documentos RAG (vazio)
- `rag_prompts.json` - Prompts RAG (vazio)
- `rag_audit.json` - Audit RAG (vazio)

## Credenciais Padrão

### Administrador
- **Username**: `admin`
- **Password**: `admin123`
- **Role**: `admin`

### Supervisor
- **Username**: `supervisor`
- **Password**: `supervisor123`
- **Role**: `supervisor`

### Atendente
- **Username**: `atendente1` ou `atendente2`
- **Password**: `atendente123`
- **Role**: `agent`

## Notas

- Por padrão, o seed **não sobrescreve** dados existentes. Use `--reset` para forçar.
- **Tenants são criados sempre** (não dependem do parâmetro `--tenant`).
- **Tenant contexts são criados automaticamente** para cada tenant.
- Todos os **outros dados** (agentes, fluxos, etc.) são criados para o tenant especificado (padrão: `tenant-demo`).
- As senhas são hasheadas usando SHA256 + salt.
- Os IDs são gerados automaticamente com timestamp.
- Os sites dos tenants são **automaticamente indexados** como fonte institucional canônica (se web scraping estiver disponível).

## Exemplos

### Desenvolvimento inicial
```bash
npm run seed:reset
```

### Adicionar dados para novo tenant
```bash
node scripts/seed.js --tenant=tenant-novo
```

### Verificar dados criados
```bash
# Listar todos os arquivos JSON
ls -la api/data/*.json

# Ver tenants criados
cat api/data/tenants.json | jq

# Ver tenant contexts
cat api/data/tenant_contexts.json | jq
```

## 📚 Documentação Adicional

Para mais detalhes sobre tenants e contexto cognitivo, consulte:
- [Como Usar o Seed de Tenants](../docs/SEED_TENANTS.md)
- [Tenant Context e Integração com RAG](../docs/TENANT_CONTEXT_RAG.md)

