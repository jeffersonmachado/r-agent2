# ⚠️ PostgreSQL é Obrigatório - Sem Fallback

## Mudanças Implementadas

A partir desta versão, **PostgreSQL é obrigatório**. Não há mais fallback para arquivos JSON.

### O que mudou:

1. **Inicialização do Servidor**
   - ❌ Se PostgreSQL não estiver configurado → **Servidor NÃO inicia**
   - ❌ Se conexão falhar → **Servidor NÃO inicia**
   - ✅ Erro claro é exibido: "PostgreSQL é obrigatório"

2. **TenantService**
   - ✅ `listTenants()` → Agora é **async** e usa PostgreSQL
   - ✅ `getTenant()` → Agora é **async** e usa PostgreSQL
   - ✅ `createTenant()` → Agora é **async** e salva no PostgreSQL
   - ❌ Não há mais fallback para Map/JSON em memória

3. **Endpoints**
   - ✅ Todos os endpoints que usam `listTenants()`/`getTenant()` foram atualizados para **async**
   - ✅ Erros são retornados se PostgreSQL não estiver disponível

### Requisitos:

1. **Variáveis de Ambiente Obrigatórias:**
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

### Comportamento:

- ✅ **Servidor inicia** → PostgreSQL conectado com sucesso
- ❌ **Servidor NÃO inicia** → PostgreSQL não configurado ou indisponível
- ❌ **Endpoints retornam erro 500** → Se PostgreSQL ficar indisponível durante execução

### Migração de Código:

Se você tinha código que usava `listTenants()` ou `getTenant()` de forma síncrona:

**Antes:**
```javascript
const tenants = listTenants(); // Síncrono
const tenant = getTenant('tenant-id'); // Síncrono
```

**Depois:**
```javascript
const tenants = await listTenants(); // Async
const tenant = await getTenant('tenant-id'); // Async
```

### Rollback:

Se precisar voltar para o modo antigo (não recomendado):

1. Reverter commits relacionados à remoção de fallback
2. Restaurar versão anterior do código
3. **NOTA:** Dados no PostgreSQL não são migrados de volta automaticamente

### Validação:

Para verificar se tudo está funcionando:

```bash
# 1. Verificar se PostgreSQL está rodando
docker-compose ps postgres

# 2. Verificar conexão
docker-compose exec postgres psql -U postgres -d r_agent2 -c "SELECT 1;"

# 3. Verificar tenants
docker-compose exec postgres psql -U postgres -d r_agent2 -c "SELECT tenant_key, name FROM tenants;"

# 4. Verificar logs do servidor
docker-compose logs api | grep -i postgres
```

### Troubleshooting:

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
