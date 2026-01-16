# Migração para PostgreSQL

Este documento descreve a migração da plataforma r-agent2 de armazenamento em arquivos JSON para PostgreSQL.

**STATUS:** ✅ Migração concluída. Todos os arquivos JSON de dados foram removidos. O sistema agora usa exclusivamente PostgreSQL.

## Visão Geral

A migração centraliza todos os dados persistentes no PostgreSQL, incluindo:
- Tenants (clientes)
- Usuários e RBAC
- Configurações por tenant (principalmente IA)
- Logs/auditoria essenciais

## Pré-requisitos

1. Docker e Docker Compose instalados
2. Node.js 20+ (para desenvolvimento local)
3. PostgreSQL 16+ (via Docker ou instalação local)

## Passo a Passo

### 1. Configurar Variáveis de Ambiente

Copie `.env.example` para `.env` e configure:

```bash
cp .env.example .env
```

**Variáveis obrigatórias:**

```env
# PostgreSQL
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/r_agent2
# OU
PGHOST=postgres
PGUSER=postgres
PGPASSWORD=postgres
PGDATABASE=r_agent2
PGPORT=5432

# Criptografia (gere uma chave de 32 bytes em base64)
ENCRYPTION_KEY=<gerar com: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))">
```

**Gerar ENCRYPTION_KEY:**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 2. Iniciar PostgreSQL

Com Docker Compose:

```bash
docker-compose up -d postgres
```

Aguarde o healthcheck confirmar que o PostgreSQL está pronto:

```bash
docker-compose ps postgres
```

### 3. Executar Migrations

As migrations criam todas as tabelas necessárias:

```bash
# Via script Node.js
node api/db/migrate.js

# OU via Sequelize CLI (se instalado)
npx sequelize-cli db:migrate
```

### 4. Migrar Dados Existentes

Execute o script de migração para copiar dados de JSON para PostgreSQL:

```bash
node scripts/migrate_to_pg.js
```

Este script é **idempotente**: pode ser executado múltiplas vezes sem duplicar dados.

**O que é migrado:**
- Tenants (já estão no banco de dados PostgreSQL)
- Configurações de IA por tenant (já estão no banco de dados PostgreSQL)
- Credenciais de IA são criptografadas antes de serem salvas

**NOTA:** Todos os dados agora estão no banco de dados PostgreSQL. Arquivos JSON de dados foram removidos.

**NOTA:** API keys globais (em `config.json`) NÃO são migradas para tenant "system". Elas devem ser configuradas via `OPENAI_API_KEY` (variável de ambiente) para uso do servidor.

### 5. Iniciar a Aplicação

```bash
# Com Docker Compose (recomendado)
docker-compose up -d

# OU localmente
npm install
npm start
```

O servidor aguardará automaticamente o PostgreSQL estar disponível antes de iniciar.

## Estrutura do Banco de Dados

### Tabelas Principais

- **tenants**: Informações dos tenants
- **users**: Usuários do sistema
- **tenant_users**: Relacionamento tenant-user com roles (RBAC)
- **tenant_settings**: Configurações dinâmicas por tenant
- **tenant_ai_settings**: Configurações de IA (sem segredos)
- **tenant_ai_credentials**: Credenciais de IA (criptografadas)
- **audit_logs**: Logs de auditoria

### Índices

Todas as tabelas têm índices otimizados:
- `tenant_id` em tabelas tenantadas
- `tenant_id + created_at` para queries temporais
- `email` único em users
- `tenant_key` único em tenants

## Novos Endpoints

### GET /tenants/:tenantKey/ai-config

Obtém configurações de IA de um tenant (sem segredos).

**Autenticação:** Requerida  
**Permissão:** Acesso ao tenant ou super-admin

**Resposta:**
```json
{
  "enabled": true,
  "provider": "openai",
  "model": "gpt-4",
  "temperature": 0.7,
  "max_tokens": 2000,
  "quota_monthly": 100000
}
```

### PUT /tenants/:tenantKey/ai-config

Salva configurações de IA de um tenant.

**Autenticação:** Requerida  
**Permissão:** Admin/Owner do tenant ou super-admin

**Body:**
```json
{
  "enabled": true,
  "provider": "openai",
  "model": "gpt-4",
  "temperature": 0.7,
  "max_tokens": 2000,
  "quota_monthly": 100000
}
```

### PUT /tenants/:tenantKey/ai-credentials

Salva credenciais de IA (API keys) de um tenant. As credenciais são criptografadas antes de serem salvas.

**Autenticação:** Requerida  
**Permissão:** Admin/Owner do tenant ou super-admin

**Body:**
```json
{
  "provider": "openai",
  "apiKey": "sk-..."
}
```

**IMPORTANTE:** API keys nunca são retornadas via API. Elas são descriptografadas apenas no backend quando necessário para chamar providers de IA.

## Segurança

### Criptografia de Segredos

- API keys são criptografadas usando AES-256-GCM
- A chave de criptografia é armazenada em `ENCRYPTION_KEY` (variável de ambiente)
- Nunca retornar API keys via API pública
- Descriptografia ocorre apenas no backend quando necessário

### Multi-tenant Isolation

- Todas as queries são filtradas por `tenant_id`
- Usuários só podem acessar dados de seus próprios tenants
- Super-admins podem acessar qualquer tenant (com header `X-Tenant-Id`)

### RBAC

- Roles: `owner`, `admin`, `member`, `support`
- Apenas `owner` e `admin` podem alterar configurações de IA
- Super-admins têm acesso total

## Modo Fallback

Se o PostgreSQL não estiver disponível, o sistema funciona em modo fallback:

- Endpoint `/config` retorna apenas configuração global (sem IA)
- Logs de warning são gerados
- Sistema continua funcionando, mas sem dados persistentes no banco

## Rollback

Para reverter para o modo JSON:

1. Pare a aplicação
2. Remova as variáveis de ambiente do PostgreSQL
3. Reinicie a aplicação

**NOTA:** Dados no PostgreSQL não são automaticamente migrados de volta para JSON. Faça backup antes de fazer rollback.

## Troubleshooting

### Erro: "ENCRYPTION_KEY não configurada"

Configure a variável `ENCRYPTION_KEY` no `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### Erro: "Não foi possível conectar ao PostgreSQL"

1. Verifique se o PostgreSQL está rodando: `docker-compose ps postgres`
2. Verifique as variáveis de ambiente: `echo $DATABASE_URL`
3. Teste a conexão: `docker-compose exec postgres psql -U postgres -d r_agent2 -c "SELECT 1;"`

### Erro: "Migration já executada"

As migrations são idempotentes. Se uma migration já foi executada, ela será pulada automaticamente.

### Dados duplicados após migração

O script de migração verifica se os dados já existem antes de criar. Se houver duplicação, verifique:

1. Se o `tenant_key` está correto
2. Se há conflitos de IDs

## Desenvolvimento

### Executar Migrations Localmente

```bash
# Conectar ao banco local
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/r_agent2

# Executar migrations
node api/db/migrate.js
```

### Seed de Dados de Teste

```bash
node scripts/migrate_to_pg.js
```

### Verificar Dados no Banco

```bash
docker-compose exec postgres psql -U postgres -d r_agent2

# Listar tenants
SELECT tenant_key, name, status FROM tenants;

# Listar configurações de IA
SELECT t.tenant_key, ai.enabled, ai.provider 
FROM tenants t 
LEFT JOIN tenant_ai_settings ai ON t.id = ai.tenant_id;
```

## Próximos Passos

Após a migração:

1. Atualize o frontend para usar os novos endpoints tenant-aware
2. Configure credenciais de IA por tenant via UI
3. Monitore logs de auditoria
4. Configure backups do PostgreSQL

## Suporte

Para problemas ou dúvidas, consulte:
- Logs da aplicação: `docker-compose logs api`
- Logs do PostgreSQL: `docker-compose logs postgres`
- Documentação do Sequelize: https://sequelize.org/
