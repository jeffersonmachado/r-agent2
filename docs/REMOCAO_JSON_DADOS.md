# Remoção de Arquivos JSON de Dados

## 📋 Resumo

Este documento descreve a migração de persistência em arquivos JSON para **PostgreSQL**, agora **finalizada para dados operacionais**.

Status atual:
- A plataforma usa **PostgreSQL como única fonte de verdade** para dados operacionais.
- `api/data/` fica restrito a **configuração** (`config.json`), **artefatos estáticos de RAG** (`api/data/rag/**`) e **documentação** (`api/data/docs/**`).

## ✅ Arquivos removidos / migrados (confirmado no código)

### Autenticação:
- ✅ `api/data/agents.json` → **removido do repo**; autenticação/usuários agora usam PostgreSQL (`users`)
- ✅ `api/data/sessions.json` → **removido do repo**; sessões agora usam PostgreSQL (`sessions`)

### Tenants:
- ✅ `api/data/tenants.json` → removido; tenants agora vivem em PostgreSQL (`tenants`)

### Arquivos Mantidos (Configuração):
- ✅ `api/data/config.json` - Configuração do sistema
- ✅ `api/data/config.example.json` - Exemplo de configuração

## 🔧 Serviços atualizados (parcial)

Todos os serviços foram atualizados para remover referências a arquivos JSON:

### authService.js
- ✅ Persistência em PostgreSQL (users/sessions)
- ✅ `validateToken()` funciona via cache em memória alimentado pelo PostgreSQL (necessário para middleware síncrono)

### tenantService.js
- ✅ Contexto do tenant migrado para PostgreSQL (`tenant_contexts`)

### queueService.js
- ✅ Tickets e filas em PostgreSQL (`tickets`)

### departmentsService.js
- ✅ Departments em PostgreSQL (`departments`)

### quickRepliesService.js
- ✅ Quick replies em PostgreSQL (`quick_replies`)

### webhookService.js
- ✅ Webhooks em PostgreSQL (`webhooks`)

### ragDocumentsService.js
- ✅ RAG documents em PostgreSQL (`rag_documents`)

### generationOrchestrator.js
- ✅ `saveFlowToFile()` - Desabilitada (dados no PostgreSQL)
- ✅ `removeFlowFromFile()` - Desabilitada (dados no PostgreSQL)

### rpaTestDependencyAnalyzer.js
- ✅ Referências a arquivos JSON removidas

## 📊 Estrutura de Dados no PostgreSQL (objetivo)

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

1. **PostgreSQL é o destino**: a meta é DB-only para dados operacionais.
2. **Configuração**: `api/data/config.json` permanece como configuração (sem segredos expostos via API).
3. **Migração**: scripts de migração devem ser idempotentes e podem coexistir com JSONs enquanto houver ambientes legados.
4. **Remoção gradual**: qualquer serviço que ainda use JSON/memória será migrado por etapas (com validação via `npm run system:validate`).

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

## 🎯 Próximos passos (roadmap)

1. Migrar auditoria e persistência determinística (execuções) para PostgreSQL.
2. Validar/limpar referências residuais a JSON em documentação e artefatos legados.
4. Remover dependências de runtime que apontam para `tests/` (mover para `api/` ou `lib/`).
5. Manter `api/data/test/**` e `api/data/rag/**` apenas como contratos/fixtures, não como persistência operacional.

O sistema estará **100% migrado para PostgreSQL** quando não houver mais persistência operacional em arquivos JSON/FS.
