# Convenção de Nomenclatura - Sequelize Models e Migrations

## Problema Identificado

Houve uma **divergência entre models e migrations** que causou o erro:
```
column "createdAt" does not exist
```

## Causa Raiz

### Padrão das Migrations
- Todas as migrations criam colunas com **snake_case**: `created_at`, `updated_at`
- Este é o padrão PostgreSQL e SQL convencional

### Padrão dos Models (ANTES da correção)
- Model `Tenant` estava correto: `underscored: true` ✅
- Outros models estavam incorretos: `underscored: false` ❌
  - `User.js`
  - `TenantUser.js`
  - `TenantSetting.js`
  - `TenantAISetting.js`
  - `TenantAICredential.js`
  - `AuditLog.js`

### Por que aconteceu?

1. **Model Tenant foi criado primeiro** e seguiu o padrão correto (`underscored: true`)
2. **Migrations foram criadas** seguindo padrão PostgreSQL (snake_case)
3. **Outros models foram criados depois** copiando um template ou exemplo que tinha `underscored: false`
4. **Falta de configuração global** no Sequelize para definir o padrão

## Solução Aplicada

Todos os models foram corrigidos para usar `underscored: true`:

```javascript
{
  tableName: 'nome_da_tabela',
  timestamps: true,
  underscored: true, // ✅ Mapeia createdAt -> created_at, updatedAt -> updated_at
}
```

## Padrão Estabelecido

### ✅ CORRETO
- **Migrations**: Sempre usar `created_at`, `updated_at` (snake_case)
- **Models**: Sempre usar `underscored: true` para mapear automaticamente

### ❌ INCORRETO
- Models com `underscored: false` quando migrations usam snake_case
- Migrations com `createdAt` quando models usam `underscored: true`

## Recomendação Futura

Para evitar essa divergência no futuro, considere:

1. **Configuração global do Sequelize** (se possível):
   ```javascript
   const sequelize = new Sequelize(..., {
     define: {
       underscored: true, // Padrão global para todos os models
     }
   });
   ```

2. **Template/Checklist para novos models**:
   - ✅ Verificar padrão das migrations existentes
   - ✅ Usar `underscored: true` se migrations usam snake_case
   - ✅ Testar criação/leitura de registros após criar model

3. **Validação em CI/CD**:
   - Verificar consistência entre migrations e models
   - Testar que todos os models conseguem criar/ler registros

## Status Atual

✅ **Todos os models corrigidos** para usar `underscored: true`
✅ **Todas as migrations** já usam snake_case corretamente
✅ **Padrão consistente** estabelecido
