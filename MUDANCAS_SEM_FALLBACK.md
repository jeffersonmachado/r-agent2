# 🔄 Mudanças: Remoção de Fallbacks - PostgreSQL Obrigatório

## Resumo

Todos os fallbacks foram removidos. **PostgreSQL é agora obrigatório** para o funcionamento do sistema.

## Mudanças Implementadas

### 1. Inicialização do Servidor (`api/server.js`)

**Antes:**
```javascript
// Continua em modo fallback se PostgreSQL não disponível
if (!process.env.DATABASE_URL) {
  logger.warn('PostgreSQL não configurado, usando modo fallback');
}
```

**Depois:**
```javascript
// FALHA se PostgreSQL não configurado
if (!process.env.DATABASE_URL && !process.env.PGHOST) {
  throw new Error('PostgreSQL é obrigatório. Configure DATABASE_URL ou PGHOST/PGUSER/PGPASSWORD/PGDATABASE');
}
```

### 2. TenantService - Funções Migradas para PostgreSQL

#### `listTenants()`
- **Antes:** Síncrono, retorna do Map em memória
- **Depois:** Async, busca do PostgreSQL
- **Erro:** Lança exceção se PostgreSQL não disponível

#### `getTenant(tenantId)`
- **Antes:** Síncrono, retorna do Map em memória
- **Depois:** Async, busca do PostgreSQL
- **Erro:** Lança exceção se PostgreSQL não disponível

#### `createTenant(data)`
- **Antes:** Síncrono, salva no Map e arquivo JSON
- **Depois:** Async, salva no PostgreSQL
- **Erro:** Retorna `{success: false, error: ...}` se PostgreSQL não disponível

#### `updateTenant(tenantId, updates)`
- **Antes:** Síncrono, atualiza Map e arquivo JSON
- **Depois:** Async, atualiza no PostgreSQL
- **Erro:** Retorna `{success: false, error: ...}` se PostgreSQL não disponível

#### `deleteTenant(tenantId)`
- **Antes:** Síncrono, remove do Map e arquivo JSON
- **Depois:** Async, remove do PostgreSQL (CASCADE remove relacionamentos)
- **Erro:** Retorna `{success: false, error: ...}` se PostgreSQL não disponível

#### `ensureDemoTenantExists()`
- **Antes:** Verifica Map em memória
- **Depois:** Async, verifica no PostgreSQL
- **Erro:** Loga erro e retorna se falhar

### 3. Endpoints Atualizados (`api/server.js`)

Todos os endpoints que usam funções do TenantService foram atualizados para **async**:

- `GET /tenants` → `await listTenants()`
- `GET /tenants/:id` → `await getTenant()`
- `GET /tenants/:id/context` → `await getTenant()`
- `PUT /tenants/:id/context` → `await getTenant()`
- `PUT /tenants/:id` → `await updateTenant()`
- `DELETE /tenants/:id` → `await deleteTenant()`

### 4. Inicialização do Tenant "system"

- **Antes:** Usava `getTenant('system')` síncrono
- **Depois:** Usa `await getTenant('system')` async
- **Antes:** Chamava `loadTenantsFromFile()` após criar
- **Depois:** Não precisa mais (dados estão no PostgreSQL)

## Comportamento Atual

### ✅ Se PostgreSQL Estiver Disponível:
- Servidor inicia normalmente
- Todas as funções funcionam
- Dados são persistidos no PostgreSQL

### ❌ Se PostgreSQL NÃO Estiver Disponível:
- **Servidor NÃO inicia** (erro na inicialização)
- **Endpoints retornam erro 500** se PostgreSQL ficar indisponível durante execução
- **Nenhum fallback** para JSON

## Requisitos Obrigatórios

1. **Variáveis de Ambiente:**
   ```env
   DATABASE_URL=postgresql://postgres:postgres@postgres:5432/r_agent2
   # OU
   PGHOST=postgres
   PGUSER=postgres
   PGPASSWORD=postgres
   PGDATABASE=r_agent2
   PGPORT=5432
   ```

2. **PostgreSQL Deve Estar Rodando:**
   ```bash
   docker-compose up -d postgres
   ```

3. **Migrations Devem Estar Executadas:**
   ```bash
   node api/db/migrate.js
   ```

## Código Removido/Deprecated

### Funções que ainda existem mas são DEPRECATED:

- `saveTenantsToFile()` - Não salva mais (tenants estão no PostgreSQL)
- `loadTenantsFromFile()` - Não carrega mais (tenants estão no PostgreSQL)
- `tenants` Map - Não é mais usado (apenas para compatibilidade temporária)
- `clearTenants()` - Deprecated (tenants estão no PostgreSQL)

### Funções que ainda funcionam (não migradas ainda):

- `getTenantContext()` - Ainda usa Map/JSON (será migrado depois)
- `updateTenantContext()` - Ainda usa Map/JSON (será migrado depois)
- `saveTenantContextsToFile()` - Ainda funciona
- `loadTenantContextsFromFile()` - Ainda funciona

## Migração de Código

Se você tinha código que usava funções síncronas:

**Antes:**
```javascript
const tenants = listTenants(); // Síncrono
const tenant = getTenant('id'); // Síncrono
const result = createTenant({...}); // Síncrono
```

**Depois:**
```javascript
const tenants = await listTenants(); // Async
const tenant = await getTenant('id'); // Async
const result = await createTenant({...}); // Async
```

## Validação

Para verificar se tudo está funcionando:

```bash
# 1. Verificar se servidor inicia
docker-compose up -d

# 2. Verificar logs
docker-compose logs api | grep -i postgres

# 3. Verificar tenants no banco
docker-compose exec postgres psql -U postgres -d r_agent2 -c "SELECT tenant_key, name, status FROM tenants;"
```

## Troubleshooting

**Erro: "PostgreSQL é obrigatório"**
- ✅ Configure `DATABASE_URL` ou variáveis `PG*` no `.env`
- ✅ Certifique-se de que PostgreSQL está rodando
- ✅ Verifique se as migrations foram executadas

**Erro: "Falha ao conectar ao PostgreSQL"**
- ✅ Verifique se o serviço PostgreSQL está rodando: `docker-compose ps postgres`
- ✅ Verifique as credenciais no `.env`
- ✅ Verifique se o banco `r_agent2` existe
- ✅ Verifique logs: `docker-compose logs postgres`

**Erro: "PostgreSQL não está disponível" em endpoints**
- ✅ Verifique se o servidor iniciou corretamente
- ✅ Verifique logs do servidor para erros de conexão
- ✅ Reinicie o servidor se necessário

## Notas

- ⚠️ **Não há mais fallback** - sistema requer PostgreSQL
- ⚠️ **Servidor não inicia** se PostgreSQL não estiver disponível
- ⚠️ **Endpoints retornam erro** se PostgreSQL ficar indisponível durante execução
- ✅ **Dados são persistidos** exclusivamente no PostgreSQL
- ✅ **Migração é completa** para tenants (create, read, update, delete)
