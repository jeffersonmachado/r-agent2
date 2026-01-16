# Migração PostgreSQL - Finalizada ✅

## Resumo das Alterações

Esta migração finaliza a padronização do acesso ao banco de dados PostgreSQL, garantindo que:
- ✅ Configuração centralizada em `config.json` (com fallback para env vars)
- ✅ Sequelize como padrão único de acesso ao banco
- ✅ Remoção de duplicidades (pg pool mantido apenas para compatibilidade)
- ✅ Scripts atualizados para usar config.js
- ✅ Endpoint de diagnóstico `/health/db`
- ✅ Testes unitários para configuração de banco

## Arquivos Modificados

### Configuração
1. **api/data/config.json**
   - Adicionado bloco `database` com `url`, `pool`, `ssl`

2. **api/utils/config.js**
   - Adicionados getters: `getDatabaseUrl()`, `getDatabasePool()`, `getDatabaseSsl()`
   - Adicionado `parseDatabaseUrlSafe()` para logs
   - Prioridade: config.json > env vars (fallback)

### Camada de Banco de Dados
3. **api/db/sequelize.js**
   - Atualizado para usar `config.getDatabaseUrl()` ao invés de env vars diretas
   - Pool e SSL configurados via config.js

4. **api/db/init.js**
   - Atualizado para usar config.js
   - Adicionadas funções helper: `getDatabaseConfigForCreation()`, `getDatabaseName()`
   - `syncDatabase()` agora bloqueia execução em produção (usa migrations)

5. **api/db/index.js**
   - Refatorado para ser wrapper de compatibilidade sobre Sequelize
   - Mantém interface antiga para código legado
   - Marca funções deprecated (getPool, initDb)

### Servidor e Scripts
6. **api/server.js**
   - Removida validação obrigatória de env vars de banco
   - Adicionado endpoint `GET /health/db` para diagnóstico
   - Atualizado para usar Sequelize diretamente

7. **api/wait-for-postgres.js**
   - Atualizado para usar `db/sequelize` ao invés de `db/index`

8. **scripts/create-database.js**
   - Atualizado para usar `config.js` como fonte principal
   - Fallback para env vars mantido

9. **scripts/migrate_to_pg.js**
   - Atualizado para usar `db/sequelize` ao invés de `db/index`

### Testes
10. **api/utils/__tests__/config.test.js** (NOVO)
    - Testes para `getDatabaseUrl()` com prioridade config.json > env
    - Testes para `getDatabasePool()` e `getDatabaseSsl()`
    - Testes para `parseDatabaseUrlSafe()`

## Como Testar Localmente

### 1. Configuração Inicial

```bash
# 1. Edite api/data/config.json e configure o banco:
{
  "database": {
    "url": "postgres://postgres:postgres@localhost:5432/r_agent2",
    "pool": { "min": 0, "max": 10 },
    "ssl": false
  }
}

# 2. Crie o banco de dados (se não existir)
node scripts/create-database.js

# 3. Execute migrations
npm run migrate

# 4. (Opcional) Migre dados de JSON para PostgreSQL
node scripts/migrate_to_pg.js
```

### 2. Testar Backend

```bash
# Inicie o servidor
npm run dev

# Em outro terminal, teste o healthcheck do banco
curl http://localhost:3000/health/db

# Deve retornar:
# {
#   "status": "ok",
#   "db_host": "localhost",
#   "db_name": "r_agent2",
#   "db_port": 5432,
#   "db_user": "postgres",
#   "response_time_ms": <tempo>
# }
```

### 3. Testar Configuração

```bash
# Execute testes unitários de config
npm test -- api/utils/__tests__/config.test.js
```

### 4. Testar Sem Variáveis de Ambiente

```bash
# Limpe todas as env vars de banco
unset DATABASE_URL PGHOST PGUSER PGPASSWORD PGDATABASE PGPORT

# O servidor deve funcionar usando apenas config.json
npm run dev
```

## Como Testar no Docker

### 1. Docker Compose (Desenvolvimento)

```bash
# O docker-compose.yml já está configurado com env vars como fallback
docker-compose up -d

# Verifique logs
docker-compose logs api

# Teste healthcheck
curl http://localhost:3000/health/db
```

### 2. Docker Compose (Produção)

```bash
# O docker-compose.prod.yml também usa env vars como fallback
docker-compose -f docker-compose.prod.yml up -d

# Verifique logs
docker-compose -f docker-compose.prod.yml logs api

# Teste healthcheck
curl http://localhost:3001/health/db
```

### 3. Configuração via Volume (Opcional)

Para usar `config.json` no Docker ao invés de env vars:

```yaml
# docker-compose.yml
services:
  api:
    volumes:
      - ./api/data/config.json:/app/api/data/config.json:ro
    # Env vars ainda funcionam como fallback
```

## Validação da Migração

### ✅ Checklist

- [x] Config.json tem bloco `database`
- [x] Config.js tem getters de database
- [x] Sequelize usa config.js
- [x] Scripts usam config.js
- [x] Runtime não usa env vars diretamente (apenas fallback)
- [x] api/db/index.js é wrapper de compatibilidade
- [x] Endpoint /health/db funciona
- [x] Testes unitários criados
- [x] Sync bloqueado em produção
- [x] Docker funciona com env vars (fallback)

### Testes de Integração

```bash
# 1. Teste conexão Sequelize
node -e "const {connect} = require('./api/db/sequelize'); connect().then(() => console.log('OK')).catch(e => console.error('ERRO:', e))"

# 2. Teste healthcheck
curl http://localhost:3000/health/db

# 3. Teste criação de tenant (deve persistir no PostgreSQL)
curl -X POST http://localhost:3000/api/tenants \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"id": "test", "name": "Test Tenant"}'

# 4. Verifique no banco
psql -U postgres -d r_agent2 -c "SELECT * FROM tenants WHERE tenant_key = 'test';"
```

## Notas Importantes

1. **Prioridade de Configuração:**
   - 1º: `config.json` (database.url, database.pool, etc)
   - 2º: Env vars (DATABASE_URL ou PGHOST/PGUSER/etc) - **FALLBACK**

2. **Sequelize como Padrão:**
   - Use `api/db/sequelize.js` diretamente para novas implementações
   - `api/db/index.js` é apenas para compatibilidade com código legado

3. **Migrations vs Sync:**
   - **Produção:** Use migrations (`npm run migrate`)
   - **Desenvolvimento:** Sync pode ser usado (mas migrations são preferíveis)

4. **Docker:**
   - Env vars no docker-compose funcionam como fallback
   - Para usar config.json no Docker, monte o volume

## Breaking Changes

⚠️ **Nenhum breaking change** - A migração mantém compatibilidade:
- Código que usa `api/db/index.js` continua funcionando (wrapper)
- Env vars ainda funcionam como fallback
- Frontend não é afetado

## Próximos Passos (Opcional)

1. Remover completamente `api/db/index.js` após migrar todo código legado
2. Adicionar mais testes de integração
3. Documentar padrões de uso do Sequelize no projeto
