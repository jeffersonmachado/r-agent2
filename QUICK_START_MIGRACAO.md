# 🚀 Quick Start - Migração para PostgreSQL

## Passo a Passo Rápido

### 1️⃣ Configurar Ambiente (2 minutos)

```bash
# Copiar .env.example
cp .env.example .env

# Gerar chave de criptografia
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# Copiar o resultado e adicionar ao .env como ENCRYPTION_KEY=

# Editar .env e configurar PostgreSQL
# DATABASE_URL=postgresql://postgres:postgres@postgres:5432/r_agent2
```

### 2️⃣ Iniciar PostgreSQL (1 minuto)

```bash
docker-compose up -d postgres

# Aguardar healthcheck (10-20 segundos)
docker-compose ps postgres
```

### 3️⃣ Executar Migrations (30 segundos)

```bash
node api/db/migrate.js
```

**Saída esperada:**
```
[Migration] Conectando ao banco de dados...
[Migration] Executando migrations pendentes...
[Migration] 7 migration(s) executada(s) com sucesso.
[Migration] Concluído com sucesso.
```

### 4️⃣ Migrar Dados (1 minuto)

```bash
node scripts/migrate_to_pg.js
```

**Saída esperada:**
```
[Migrate] Iniciando migração para PostgreSQL...
[Migrate] Conectando ao banco de dados...
[Migrate] Executando migrations...
[Migrate] Migrando 2 tenant(s)...
[Migrate] Migração de tenants concluída.
[Migrate] Migração concluída com sucesso!
```

### 5️⃣ Iniciar Aplicação (1 minuto)

```bash
docker-compose up -d
```

### 6️⃣ Validar (30 segundos)

```bash
# Verificar tenants no banco
docker-compose exec postgres psql -U postgres -d r_agent2 -c "SELECT tenant_key, name, status FROM tenants;"

# Verificar configurações de IA
docker-compose exec postgres psql -U postgres -d r_agent2 -c "SELECT t.tenant_key, ai.enabled, ai.provider FROM tenants t LEFT JOIN tenant_ai_settings ai ON t.id = ai.tenant_id;"
```

## ✅ Pronto!

A migração está completa. O sistema agora usa PostgreSQL como banco de dados principal.

## 🔍 Testar Endpoints

```bash
# Obter configuração de IA (requer autenticação)
curl -H "Authorization: Bearer SEU_TOKEN" \
  http://localhost:3000/tenants/tenant-acme/ai-config

# Salvar configuração de IA
curl -X PUT \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "provider": "openai", "model": "gpt-4"}' \
  http://localhost:3000/tenants/tenant-acme/ai-config
```

## ⚠️ Troubleshooting

### Erro: "ENCRYPTION_KEY não configurada"
```bash
# Gerar e adicionar ao .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### Erro: "Não foi possível conectar ao PostgreSQL"
```bash
# Verificar se PostgreSQL está rodando
docker-compose ps postgres

# Verificar logs
docker-compose logs postgres

# Reiniciar se necessário
docker-compose restart postgres
```

### Erro: "Migration já executada"
✅ Normal - migrations são idempotentes. Pode ignorar.

## 📚 Documentação Completa

- `docs/MIGRACAO_POSTGRESQL.md` - Guia detalhado
- `docs/FRONTEND_MIGRACAO.md` - Atualização do frontend
- `CHANGELOG_MIGRACAO.md` - Lista de mudanças

## 🎯 Próximos Passos

1. Atualizar frontend para usar novos endpoints (ver `docs/FRONTEND_MIGRACAO.md`)
2. Configurar backups do PostgreSQL
3. Monitorar logs de auditoria
4. Adicionar testes de isolamento multi-tenant
