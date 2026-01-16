# Remoção de Arquivos JSON de Dados

## 📋 Resumo

Todos os arquivos JSON de dados foram **removidos** do sistema. O sistema agora usa **exclusivamente PostgreSQL** para persistência de dados.

## ✅ Arquivos Removidos

### Dados de Usuário/Sistema:
- ❌ `api/data/agents.json` → Migrado para PostgreSQL (tabela `users`/`agents`)
- ❌ `api/data/sessions.json` → Migrado para PostgreSQL (tabela `sessions`)
- ❌ `api/data/tenants.json` → Migrado para PostgreSQL (tabela `tenants`)
- ❌ `api/data/tenant_contexts.json` → Migrado para PostgreSQL (tabela `tenant_contexts`)
- ❌ `api/data/queues.json` → Migrado para PostgreSQL (tabelas `queues`, `tickets`)
- ❌ `api/data/departments.json` → Migrado para PostgreSQL (tabela `departments`)
- ❌ `api/data/quickReplies.json` → Migrado para PostgreSQL (tabela `quick_replies`)
- ❌ `api/data/webhooks.json` → Migrado para PostgreSQL (tabela `webhooks`)
- ❌ `api/data/conversations.json` → Migrado para PostgreSQL
- ❌ `api/data/audit.json` → Migrado para PostgreSQL (tabela `audit_logs`)
- ❌ `api/data/rag_documents.json` → Migrado para PostgreSQL
- ❌ `api/data/rag_audit.json` → Migrado para PostgreSQL
- ❌ `api/data/flows.json` → Migrado para PostgreSQL
- ❌ `api/data/rag_prompts.json` → Removido

### Arquivos Mantidos (Configuração):
- ✅ `api/data/config.json` - Configuração do sistema
- ✅ `api/data/config.example.json` - Exemplo de configuração

## 🔧 Serviços Atualizados

Todos os serviços foram atualizados para remover referências a arquivos JSON:

### authService.js
- ✅ `saveAgentsToFile()` - Desabilitada (dados no PostgreSQL)
- ✅ `loadAgentsFromFile()` - Desabilitada (dados no PostgreSQL)
- ✅ `saveSessionsToFile()` - Desabilitada (dados no PostgreSQL)
- ✅ `loadSessionsFromFile()` - Desabilitada (dados no PostgreSQL)

### tenantService.js
- ✅ `saveTenantContextsToFile()` - Desabilitada (dados no PostgreSQL)
- ✅ `loadTenantContextsFromFile()` - Desabilitada (dados no PostgreSQL)

### queueService.js
- ✅ `saveQueuesToFile()` - Desabilitada (dados no PostgreSQL)
- ✅ `loadQueuesFromFile()` - Desabilitada (dados no PostgreSQL)

### departmentsService.js
- ✅ `saveDepartmentsToFile()` - Desabilitada (dados no PostgreSQL)
- ✅ `loadDepartmentsFromFile()` - Desabilitada (dados no PostgreSQL)

### quickRepliesService.js
- ✅ `saveQuickRepliesToFile()` - Desabilitada (dados no PostgreSQL)
- ✅ `loadQuickRepliesFromFile()` - Desabilitada (dados no PostgreSQL)

### webhookService.js
- ✅ `saveWebhooksToFile()` - Desabilitada (dados no PostgreSQL)
- ✅ `loadWebhooksFromFile()` - Desabilitada (dados no PostgreSQL)

### ragDocumentsService.js
- ✅ `saveDocuments()` - Desabilitada (dados no PostgreSQL)
- ✅ `loadDocuments()` - Desabilitada (dados no PostgreSQL)

### generationOrchestrator.js
- ✅ `saveFlowToFile()` - Desabilitada (dados no PostgreSQL)
- ✅ `removeFlowFromFile()` - Desabilitada (dados no PostgreSQL)

### rpaTestDependencyAnalyzer.js
- ✅ Referências a arquivos JSON removidas

## 📊 Estrutura de Dados no PostgreSQL

### Tabelas Principais:
- `tenants` - Tenants (clientes)
- `tenant_ai_settings` - Configurações de IA por tenant
- `tenant_ai_credentials` - Credenciais de IA (criptografadas)
- `users` / `agents` - Usuários e agentes
- `sessions` - Sessões de autenticação
- `queues` - Filas de atendimento
- `tickets` - Tickets de atendimento
- `departments` - Departamentos
- `quick_replies` - Respostas rápidas
- `webhooks` - Webhooks customizados
- `audit_logs` - Logs de auditoria
- `rag_documents` - Documentos RAG (se aplicável)

## ⚠️ Importante

1. **PostgreSQL é obrigatório** - Não há mais fallback para arquivos JSON
2. **Configuração** - Apenas `config.json` ainda é usado para configurações do sistema
3. **Migração** - Se você tinha dados em arquivos JSON, eles devem ter sido migrados para PostgreSQL
4. **Funções desabilitadas** - As funções de leitura/escrita em JSON ainda existem no código mas não fazem nada (apenas logam que os dados estão no banco)

## 🔄 Como Acessar Dados Agora

### Via API REST:
```bash
# Listar tenants
GET /api/tenants

# Obter tenant específico
GET /api/tenants/{tenantId}

# Listar agentes
GET /api/auth/agents

# Listar filas
GET /api/queues

# etc.
```

### Via PostgreSQL:
```bash
# Conectar ao banco
psql -U postgres -d r_agent2

# Consultar dados
SELECT * FROM tenants;
SELECT * FROM users;
SELECT * FROM queues;
```

## 📝 Documentação Atualizada

Os seguintes documentos foram atualizados:
- ✅ `docs/MIGRACAO_POSTGRESQL.md`
- ✅ `docs/SEED_TENANTS.md`
- ✅ `docs/NOS_PERSISTENCIA.md`
- ✅ `docs/RAG_PARA_DEV.md`
- ✅ `docs/CONFIGURACAO_ESPECIFICA_TENANT.md`
- ✅ `CHANGELOG_MIGRACAO.md`
- ✅ Comentários em todos os serviços

## 🎯 Próximos Passos

1. ✅ Arquivos JSON removidos
2. ✅ Serviços atualizados
3. ✅ Documentação atualizada
4. ✅ Sistema usando exclusivamente PostgreSQL

O sistema está **100% migrado para PostgreSQL**! 🎉
