# Convenção: Identificadores de Tenant

## Visão Geral

O sistema usa dois tipos de identificadores para tenants:

1. **`id` (UUID)**: Chave primária técnica no banco de dados
2. **`tenant_key` (STRING)**: Identificador legível e amigável para humanos

## Quando Usar Cada Um

### Use `tenant_key` para:
- ✅ URLs públicas e APIs REST
- ✅ Query parameters no frontend (`?tenant=<tenant-key>`)
- ✅ Logs e mensagens de erro
- ✅ Identificação por clientes
- ✅ Integrações externas (webhooks, APIs)
- ✅ Subdomínios e roteamento

### Use `id` (UUID) para:
- ✅ Foreign keys no banco de dados
- ✅ Relacionamentos internos entre tabelas
- ✅ Referências em modelos Sequelize

## Padrão de Busca

**SEMPRE** use a função helper `findTenantByIdentifier()` ao buscar tenants:

```javascript
const { findTenantByIdentifier } = require('./services/tenantService');

// Aceita tanto tenant_key quanto UUID
const tenant = await findTenantByIdentifier('tenant-acme');  // ✅
const tenant = await findTenantByIdentifier('a1b2c3d4-...'); // ✅
```

### Implementação

A função `findTenantByIdentifier()`:
1. Primeiro tenta buscar por `tenant_key` (caso mais comum)
2. Se não encontrar e o valor parecer UUID, busca por `id`
3. Retorna `null` se não encontrar

## Exemplos

### ✅ Correto: Usar tenant_key em APIs
```javascript
// GET /tenants/tenant-acme/ai-config
const tenantKey = req.params.tenantKey; // "tenant-acme"
const tenant = await findTenantByIdentifier(tenantKey);
```

### ✅ Correto: Usar tenant_key em frontend
```javascript
navigate(`/config?tab=ai&tenant=tenant-acme`);
```

### ✅ Correto: Usar id em foreign keys
```javascript
await TenantAISetting.create({
  tenant_id: tenant.id, // UUID do tenant
  primary: 'openai',
});
```

### ❌ Evitar: Misturar identificadores
```javascript
// ❌ Não faça isso
const tenant = await Tenant.findOne({ where: { id: 'tenant-acme' } });

// ✅ Faça isso
const tenant = await findTenantByIdentifier('tenant-acme');
```

## Serviços que Seguem a Convenção

- ✅ `tenantService.js` - Exporta `findTenantByIdentifier()`
- ✅ `tenantAIService.js` - Usa `findTenantByIdentifier()` internamente

## Migração

Se você encontrar código que busca tenants diretamente, migre para usar `findTenantByIdentifier()`:

```javascript
// Antes
const tenant = await Tenant.findOne({ where: { tenant_key: identifier } });

// Depois
const { findTenantByIdentifier } = require('./services/tenantService');
const tenant = await findTenantByIdentifier(identifier);
```

## Notas Importantes

1. **Agentes (JSON)**: O campo `tenantId` nos agentes armazena o `tenant_key`, não o UUID
2. **Tabelas relacionadas**: Campos como `tenant_id` em outras tabelas armazenam o UUID
3. **Consistência**: Sempre prefira `tenant_key` em interfaces públicas
