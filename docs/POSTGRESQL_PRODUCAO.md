# 🐘 PostgreSQL em Produção

Este documento descreve a configuração e uso do PostgreSQL em produção.

## 📋 Índice

- [Configuração](#configuração)
- [Iniciar o Container](#iniciar-o-container)
- [Backup e Restore](#backup-e-restore)
- [Monitoramento](#monitoramento)
- [Segurança](#segurança)
- [Troubleshooting](#troubleshooting)

## 🔧 Configuração

### Inicialização Automática

O sistema **cria e atualiza automaticamente** o banco de dados quando inicia:

- ✅ **Cria o banco de dados** se não existir
- ✅ **Executa migrations** automaticamente no startup (via Umzug)
- ✅ **Mantém dados existentes** (não apaga dados ao atualizar)

### ⚠️ IMPORTANTE: Produção NUNCA executa `sequelize.sync()`

**Em produção (`NODE_ENV=production`):**
- ❌ `sequelize.sync()` é **BLOQUEADO ABSOLUTAMENTE** por segurança
- ✅ Schema é gerenciado **exclusivamente por migrations** (Umzug)
- ✅ Mesmo que `database.allowSync=true` no `config.json`, produção ignora e bloqueia

**Em desenvolvimento/teste:**
- ✅ `sequelize.sync()` pode ser usado se `database.allowSync=true` no `config.json`
- ✅ Útil para desenvolvimento rápido sem criar migrations

**Configuração no `api/data/config.json`:**

```json
{
  "database": {
    "url": "postgresql://postgres:senha@postgres:5432/r_agent2",
    "pool": {
      "min": 0,
      "max": 10
    },
    "ssl": false,
    "allowSync": false  // ⚠️ Em produção, sempre false (e será ignorado mesmo se true)
  }
}
```

### Migrations

As migrations são executadas automaticamente no startup do servidor. Para executar manualmente:

```bash
# Executar migrations pendentes
npm run db:migrate

# Ver status das migrations
npm run db:migrate:status
```

**Migrations são o padrão oficial** para gerenciar schema em produção.

### Arquivo docker-compose.prod.yml

O PostgreSQL está configurado no `docker-compose.prod.yml` com:

- **Imagem**: `postgres:16-alpine`
- **Container**: `r-agent2-postgres-prod`
- **Porta Externa**: `5433` (padrão, configurável via `PGPORT`)
- **Porta Interna**: `5432`
- **Volume**: `postgres-data` (persistente)
- **Network**: `r-agent2-network` (isolada)

### Variáveis de Ambiente

Configure no arquivo `.env`:

```bash
# PostgreSQL para Produção
PGHOST=postgres
PGUSER=postgres
PGPASSWORD=sua_senha_segura_aqui  # ⚠️ ALTERE EM PRODUÇÃO!
PGDATABASE=r_agent2
PGPORT=5432

# Ou use DATABASE_URL diretamente
DATABASE_URL=postgresql://postgres:sua_senha@postgres:5432/r_agent2
```

### Configurações de Performance

O PostgreSQL está configurado com otimizações para produção:

- **shared_buffers**: 512MB
- **effective_cache_size**: 1536MB
- **max_connections**: 100
- **work_mem**: 4MB
- **maintenance_work_mem**: 128MB
- **WAL**: min 1GB, max 4GB

### Recursos do Container

- **CPU**: Limite 2 cores, Reserva 0.5 cores
- **Memória**: Limite 2GB, Reserva 512MB

## 🚀 Iniciar o Container

### Iniciar todos os serviços

```bash
docker-compose -f docker-compose.prod.yml up -d
```

### Iniciar apenas PostgreSQL

```bash
docker-compose -f docker-compose.prod.yml up -d postgres
```

### Verificar status

```bash
docker-compose -f docker-compose.prod.yml ps postgres
```

### Ver logs

```bash
docker-compose -f docker-compose.prod.yml logs -f postgres
```

## 💾 Backup e Restore

### Fazer Backup

```bash
./scripts/backup-postgres.sh
```

O backup será salvo em `./backups/postgres/` com o formato:
```
backup_r_agent2_YYYYMMDD_HHMMSS.sql.gz
```

**Configurações:**
- **Diretório**: `BACKUP_DIR` (padrão: `./backups/postgres`)
- **Retenção**: `RETENTION_DAYS` (padrão: 30 dias)
- **Container**: `POSTGRES_CONTAINER` (padrão: `r-agent2-postgres-prod`)

**Exemplo com variáveis customizadas:**
```bash
BACKUP_DIR=/backups/postgres RETENTION_DAYS=60 ./scripts/backup-postgres.sh
```

### Restaurar Backup

```bash
./scripts/restore-postgres.sh ./backups/postgres/backup_r_agent2_20240101_120000.sql.gz
```

⚠️ **ATENÇÃO**: A restauração irá SOBRESCREVER o banco de dados atual!

### Backup Manual

```bash
# Fazer backup manual
docker exec -e PGPASSWORD=sua_senha r-agent2-postgres-prod \
  pg_dump -U postgres -d r_agent2 | gzip > backup_manual.sql.gz

# Restaurar backup manual
gunzip -c backup_manual.sql.gz | docker exec -i -e PGPASSWORD=sua_senha \
  r-agent2-postgres-prod psql -U postgres -d r_agent2
```

### Agendar Backups Automáticos

Adicione ao crontab:

```bash
# Backup diário às 2h da manhã
0 2 * * * cd /opt/results/ria/r-agent2 && ./scripts/backup-postgres.sh >> /var/log/postgres-backup.log 2>&1
```

## 📊 Monitoramento

### Healthchecks da API

A API fornece três endpoints de health para monitoramento:

#### 1. Liveness Probe (`/health/live`)

Verifica se o processo está vivo. Sempre retorna 200 se o processo está rodando (não consulta DB).

```bash
curl http://localhost:3000/health/live
```

Resposta:
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptimeSec": 3600
}
```

#### 2. DB Health (`/health/db`)

Verifica status detalhado do banco de dados e migrations.

```bash
curl http://localhost:3000/health/db
```

Resposta (sucesso):
```json
{
  "status": "ok",
  "environment": "production",
  "latencyMs": 15,
  "db": {
    "host": "postgres",
    "database": "r_agent2",
    "username": "postgres",
    "port": 5432
  },
  "migrations": {
    "applied": 5,
    "pending": 0,
    "pendingNames": []
  },
  "sync": {
    "allowSync": false,
    "syncBlockedInProduction": true
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

Resposta (falha):
```json
{
  "status": "fail",
  "environment": "production",
  "latencyMs": 100,
  "db": {
    "host": "postgres",
    "database": "r_agent2"
  },
  "migrations": {
    "applied": 0,
    "pending": 0,
    "pendingNames": []
  },
  "errorMessage": "Erro ao conectar ao banco de dados",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

#### 3. Readiness Probe (`/health/ready`)

Verifica se o serviço está pronto para receber tráfego. Retorna 200 apenas se:
- DB connection ok
- **E** não houver migrations pendentes

```bash
curl http://localhost:3000/health/ready
```

Resposta (pronto):
```json
{
  "status": "ready",
  "db": "ok",
  "migrationsPending": 0,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

Resposta (não pronto - migrations pendentes):
```json
{
  "status": "not_ready",
  "reason": "migrations_pending",
  "pending": 2,
  "pendingNames": ["20240115000001-example.js", "20240115000002-example.js"],
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

Resposta (não pronto - DB falhou):
```json
{
  "status": "not_ready",
  "reason": "db_connection_failed",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

**Uso em Kubernetes/Docker:**

```yaml
# docker-compose.yml ou Kubernetes deployment
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:3000/health/ready"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 40s
```

### Verificar Health Check do Container PostgreSQL

```bash
docker inspect r-agent2-postgres-prod | grep -A 10 Health
```

### Conectar ao Banco

```bash
# Via docker exec
docker exec -it -e PGPASSWORD=sua_senha r-agent2-postgres-prod \
  psql -U postgres -d r_agent2

# Via cliente externo (se porta exposta)
psql -h localhost -p 5433 -U postgres -d r_agent2
```

### Estatísticas do Banco

```sql
-- Tamanho do banco
SELECT pg_size_pretty(pg_database_size('r_agent2'));

-- Tabelas e tamanhos
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Conexões ativas
SELECT count(*) FROM pg_stat_activity;

-- Conexões por estado
SELECT state, count(*) FROM pg_stat_activity GROUP BY state;
```

### Logs do PostgreSQL

Os logs estão configurados para:
- **log_statement**: all (todas as queries)
- **log_duration**: on
- **timezone**: America/Sao_Paulo

Ver logs:
```bash
docker-compose -f docker-compose.prod.yml logs postgres | grep -i error
```

## 🔒 Segurança

### ⚠️ Checklist de Segurança

- [ ] **Alterar senha padrão** do PostgreSQL
- [ ] **Não expor porta** externamente (usar apenas na rede interna)
- [ ] **Usar ENCRYPTION_KEY** forte para criptografia de segredos
- [ ] **Configurar firewall** para bloquear acesso externo
- [ ] **Fazer backups regulares** e testar restauração
- [ ] **Monitorar logs** para atividades suspeitas
- [ ] **Atualizar imagem** do PostgreSQL regularmente
- [ ] **Verificar que `NODE_ENV=production`** está configurado (bloqueia `sequelize.sync()`)
- [ ] **Usar migrations** para alterações de schema (nunca `sequelize.sync()` em produção)
- [ ] **Configurar healthchecks** (`/health/ready`) para monitoramento

### Alterar Senha

1. Edite o `.env`:
```bash
PGPASSWORD=nova_senha_segura_aqui
```

2. Reinicie o container:
```bash
docker-compose -f docker-compose.prod.yml restart postgres
```

3. Atualize a variável `DATABASE_URL` no serviço API:
```bash
docker-compose -f docker-compose.prod.yml restart api
```

### Não Expor Porta Externa

Para maior segurança, remova a exposição da porta no `docker-compose.prod.yml`:

```yaml
postgres:
  # ... outras configurações ...
  # Remova ou comente a linha abaixo:
  # ports:
  #   - "${PGPORT:-5433}:5432"
```

O acesso será apenas via rede interna do Docker.

## 🔍 Troubleshooting

### Container não inicia

```bash
# Ver logs detalhados
docker-compose -f docker-compose.prod.yml logs postgres

# Verificar se a porta está em uso
netstat -tuln | grep 5433

# Verificar permissões do volume
docker volume inspect r-agent2_postgres-data
```

### Erro de conexão

1. Verificar se o container está rodando:
```bash
docker ps | grep postgres
```

2. Verificar health check:
```bash
docker inspect r-agent2-postgres-prod | grep -A 5 Health
```

3. Testar conexão:
```bash
docker exec -it r-agent2-postgres-prod pg_isready -U postgres
```

### Banco de dados corrompido

1. Parar o container:
```bash
docker-compose -f docker-compose.prod.yml stop postgres
```

2. Restaurar de backup:
```bash
./scripts/restore-postgres.sh ./backups/postgres/backup_mais_recente.sql.gz
```

### Performance lenta

1. Verificar conexões ativas:
```sql
SELECT count(*) FROM pg_stat_activity;
```

2. Verificar queries lentas:
```sql
SELECT pid, now() - pg_stat_activity.query_start AS duration, query 
FROM pg_stat_activity 
WHERE (now() - pg_stat_activity.query_start) > interval '5 minutes';
```

3. Verificar índices:
```sql
SELECT schemaname, tablename, indexname, idx_scan 
FROM pg_stat_user_indexes 
WHERE idx_scan = 0 
ORDER BY schemaname, tablename;
```

### Recuperar dados perdidos

Se você tem backups regulares, restaure do backup mais recente:
```bash
./scripts/restore-postgres.sh ./backups/postgres/backup_mais_recente.sql.gz
```

## 📚 Referências

- [Documentação PostgreSQL](https://www.postgresql.org/docs/)
- [PostgreSQL Docker Hub](https://hub.docker.com/_/postgres)
- [Best Practices PostgreSQL](https://wiki.postgresql.org/wiki/Don%27t_Do_This)
