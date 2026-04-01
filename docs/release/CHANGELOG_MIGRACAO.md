# Changelog da Migração para PostgreSQL

## [1.0.0] - 2025-01-11

### Adicionado

#### Infraestrutura
- ✅ Serviço PostgreSQL no `docker-compose.yml`
- ✅ Healthcheck para PostgreSQL
- ✅ Volumes persistentes para dados do PostgreSQL
- ✅ Script `api/wait-for-postgres.js` para aguardar banco antes de iniciar

#### Dependências
- ✅ `sequelize@^6.35.2` - ORM para PostgreSQL
- ✅ `pg@^8.11.3` - Driver PostgreSQL
- ✅ `pg-hstore@^2.3.4` - Serialização hstore
- ✅ `sequelize-cli@^6.6.2` - CLI do Sequelize (dev)
- ✅ `umzug@^3.2.1` - Gerenciador de migrations (dev)

#### Camada de Dados
- ✅ `api/db/index.js` - Gerenciador de conexão Sequelize com retry logic
- ✅ `api/utils/crypto.js` - Criptografia AES-256-GCM para segredos
- ✅ 7 Models Sequelize:
  - `Tenant` - Tenants do sistema
  - `User` - Usuários
  - `TenantUser` - RBAC (relacionamento tenant-user)
  - `TenantSetting` - Configurações dinâmicas
  - `TenantAISetting` - Configurações de IA (sem segredos)
  - `TenantAICredential` - Credenciais de IA (criptografadas)
  - `AuditLog` - Logs de auditoria

#### Migrations
- ✅ 7 migrations criadas:
  - `20250111000001-create-tenants.js`
  - `20250111000002-create-users.js`
  - `20250111000003-create-tenant-users.js`
  - `20250111000004-create-tenant-settings.js`
  - `20250111000005-create-tenant-ai-settings.js`
  - `20250111000006-create-tenant-ai-credentials.js`
  - `20250111000007-create-audit-logs.js`
- ✅ Script `api/db/migrate.js` para executar migrations manualmente

#### Scripts de Migração
- ✅ `scripts/migrate_to_pg.js` - Migra dados JSON para PostgreSQL (se necessário)
  - Migra tenants (já estão no banco de dados)
  - Migra configurações de IA (criptografadas, já estão no banco)
  - Idempotente (pode rodar múltiplas vezes)

**NOTA:** Todos os dados agora estão no banco de dados PostgreSQL. Arquivos JSON de dados foram removidos.

#### Serviços
- ✅ `api/services/tenantAIService.js` - Gerenciamento de IA por tenant
  - `getAIConfig(tenantKey)` - Obtém configuração de IA
  - `saveAIConfig(tenantKey, config)` - Salva configuração de IA
  - `saveAICredentials(tenantKey, provider, apiKey)` - Salva credenciais (criptografadas)
  - `getDecryptedAPIKey(tenantKey, provider)` - Obtém API key descriptografada (uso interno)
  - `hasCredentials(tenantKey, provider)` - Verifica se tem credenciais
- ✅ `api/services/tenantServicePg.js` - Helpers para usar PostgreSQL no tenantService

#### Endpoints
- ✅ `GET /tenants/:tenantKey/ai-config` - Obtém configuração de IA do tenant
- ✅ `PUT /tenants/:tenantKey/ai-config` - Salva configuração de IA do tenant
- ✅ `PUT /tenants/:tenantKey/ai-credentials` - Salva credenciais de IA (criptografadas)
- ✅ `GET /config` - Já não retorna segredos (mantido comportamento existente)

#### Segurança
- ✅ Criptografia AES-256-GCM para API keys
- ✅ API keys nunca retornadas via API
- ✅ Isolamento multi-tenant garantido por `tenant_id`
- ✅ RBAC implementado (owner/admin podem alterar IA)

#### Documentação
- ✅ `docs/MIGRACAO_POSTGRESQL.md` - Guia completo de migração
- ✅ `.env.example` - Exemplo de variáveis de ambiente
- ✅ `MIGRACAO_RESUMO.md` - Resumo executivo
- ✅ `CHANGELOG_MIGRACAO.md` - Este arquivo

#### Inicialização
- ✅ Servidor inicializa PostgreSQL automaticamente
- ✅ Modo fallback se PostgreSQL não estiver disponível
- ✅ Logs de warning quando usando fallback

### Modificado

#### Docker
- ✅ `api/Dockerfile` atualizado para aguardar PostgreSQL
- ✅ `docker-compose.yml` adiciona serviço PostgreSQL

#### Servidor
- ✅ `api/server.js` inicializa banco de dados na inicialização
- ✅ Endpoints de IA agora são tenant-aware

### Compatibilidade

#### Mantido
- ✅ Sistema funciona em modo fallback se PostgreSQL não estiver disponível
- ✅ Endpoints existentes continuam funcionando
- ✅ Dados JSON ainda são lidos como fallback

#### Breaking Changes
- ⚠️ Nenhum breaking change - migração é incremental e compatível

### Pendências (Não Críticas)

#### Para Versões Futuras
- ⚠️ Migrar `tenantService.js` completamente para PostgreSQL (mantendo fallback)
- ⚠️ Atualizar frontend para usar novos endpoints tenant-aware
- ⚠️ Adicionar testes de isolamento multi-tenant
- ⚠️ Otimizar lazy loading dos models

### Notas de Migração

1. **Primeira Execução:**
   ```bash
   # 1. Configurar .env
   cp .env.example .env
   # Gerar ENCRYPTION_KEY
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   
   # 2. Iniciar PostgreSQL
   docker-compose up -d postgres
   
   # 3. Executar migrations
   node api/db/migrate.js
   
   # 4. Migrar dados
   node scripts/migrate_to_pg.js
   
   # 5. Iniciar aplicação
   docker-compose up -d
   ```

2. **Rollback:**
   - Remover variáveis de ambiente do PostgreSQL
   - Sistema volta para modo JSON automaticamente

3. **Validação:**
   ```bash
   # Verificar tenants
   docker-compose exec postgres psql -U postgres -d r_agent2 -c "SELECT tenant_key, name, status FROM tenants;"
   ```

### Segurança

- ✅ API keys são criptografadas antes de serem salvas
- ✅ API keys nunca são retornadas via API
- ✅ Criptografia usa AES-256-GCM com chave de 32 bytes
- ✅ Chave de criptografia armazenada em variável de ambiente

### Performance

- ✅ Pool de conexões configurado (padrão: 2-10 conexões)
- ✅ Índices otimizados em todas as tabelas
- ✅ Queries filtradas por `tenant_id` para isolamento

### Próximos Passos

1. Validar migração em ambiente de desenvolvimento
2. Testar isolamento multi-tenant
3. Atualizar frontend para novos endpoints
4. Adicionar testes automatizados
5. Documentar processo de backup/restore
