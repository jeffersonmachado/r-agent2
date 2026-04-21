# Deployment: Ambiente Desenvolvimento Local

Guia completo para setup e operação do r-agent2 em máquina de desenvolvedor.

---

## 1. Pré-requisitos

### Sistema Operacional
- Linux (Ubuntu 20+) ou macOS (M1/Intel)
- 8 GB RAM mínimo (16 GB recomendado)
- 20 GB espaço em disco

### Dependências
```bash
# Node.js 18+
node --version
npm --version

# PostgreSQL 14+ (local ou via docker)
psql --version

# Redis 6+ (local ou via docker)
redis-cli --version

# FFmpeg (para TTS/ASR local)
ffmpeg -version

# Git
git --version
```

---

## 2. Setup Inicial - Primeira Vez

### 2.1. Clone e Ambiente

```bash
# Clone repository
git clone https://github.com/r-agent2/r-agent2.git
cd r-agent2

# Define runtime directory (mutable state outside workspace)
export RUNTIME_ROOT=~/.local/share/ragent2-runtime
mkdir -p $RUNTIME_ROOT

# Copy .env.example
cp env.example .env

# Edit .env - set your local paths
nano .env
```

### 2.2. Env Vars para Desenvolvimento

**Essenciais:**
```bash
# .env file content
NODE_ENV=development
LOG_LEVEL=debug

# Runtime (mutable state fora do workspace)
RUNTIME_ROOT=~/.local/share/ragent2-runtime

# Database (local ou docker)
DB_HOST=localhost
DB_PORT=5432
DB_USER=ragent2
DB_PASSWORD=your_secure_password
DB_NAME=ragent2_dev

# Redis (local ou docker)
REDIS_HOST=localhost
REDIS_PORT=6379

# WhatsApp (auth vive em runtime, não workspace)
WWEBJS_AUTH_PATH=$RUNTIME_ROOT/wa_sessions

# RAG Service (mutable data in runtime)
RAG_DATA_ROOT=$RUNTIME_ROOT/rag
VECTOR_STORE_PATH=$RUNTIME_ROOT/rag/vector_store
ADAPTIVE_LEARNING_DATA_PATH=$RUNTIME_ROOT/rag/adaptive_learning

# QA/Testing (smoke tests output to runtime)
QA_MESH_SYSTEM_VALIDATE_DIR=$RUNTIME_ROOT/qa-mesh/system-validate
PHYSICAL_QUEUE_EVIDENCE_PATH=$RUNTIME_ROOT/qa/l01-physical-queue-evidence.json

# Frontend (development mode)
VITE_API_BASE=http://localhost:3000/api
VITE_WS_URL=ws://localhost:3000/ws
```

### 2.3. Instalar Dependências

```bash
# Clean install
npm ci

# OR dev mode with watch dependencies
npm install
```

### 2.4. Criar Banco de Dados

**Opção 1: PostgreSQL Local**
```bash
# Create database
psql -U postgres -c "CREATE DATABASE ragent2_dev;"
psql -U postgres -c "CREATE USER ragent2 WITH ENCRYPTED PASSWORD 'your_password';"
psql -U postgres -c "ALTER ROLE ragent2 SET client_encoding TO 'utf8';"
psql -U postgres -c "ALTER ROLE ragent2 SET default_transaction_isolation TO 'read committed';"
psql -U postgres -c "ALTER ROLE ragent2 SET default_transaction_deferrable TO on;"
psql -U postgres -c "ALTER ROLE ragent2 SET timezone TO 'UTC';"
psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE ragent2_dev TO ragent2;"

# Run migrations
npm run db:migrate:dev
```

**Opção 2: PostgreSQL via Docker**
```bash
# Start container
docker run -d \
  --name ragent2-db \
  -e POSTGRES_USER=ragent2 \
  -e POSTGRES_PASSWORD=your_password \
  -e POSTGRES_DB=ragent2_dev \
  -p 5432:5432 \
  postgres:14

# Run migrations
npm run db:migrate:dev
```

### 2.5. Start Services

```bash
# Terminal 1: API Server
npm run dev

# Terminal 2: Frontend (Vite)
npm run dev:frontend

# Terminal 3: Redis (se não subiu localmente)
docker run -d -p 6379:6379 redis:7

# Terminal 4: RAG Service (se separado)
npm run dev:rag
```

---

## 3. Operação Diária

### 3.1. Start Rápido

```bash
# Garantir export de RUNTIME_ROOT
export RUNTIME_ROOT=~/.local/share/ragent2-runtime

# Iniciar
npm run dev

# Em outro terminal
npm run dev:frontend
```

### 3.2. Validações Essenciais

```bash
# Verificar API health
curl http://localhost:3000/health

# Verificar database
npm run db:check

# Verificar Redis
redis-cli PING

# Verificar RAG service
npm run rag:health

# Rodar smoke test específico (ex: L-01 Physical Queue)
npm run test:l01-physical-queue

# Validação completa (DEMORADO - 10-15 min)
export RUNTIME_ROOT=~/.local/share/ragent2-runtime
npm run system:validate
```

### 3.3. Common Development Tasks

**Rodar testes unitários**
```bash
npm run test
npm run test:watch                    # Watch mode
npm run test:coverage                 # Com coverage report
```

**Rodar testes integração**
```bash
npm run test:integration
npm run test:integration:watch
```

**Lint e format**
```bash
npm run lint
npm run lint:fix
npm run format
```

**Build frontend**
```bash
npm run build:frontend
```

---

## 4. Paths e Volumes

### 4.1. Estrutura de Runtime Directories

```
~/.local/share/ragent2-runtime/
├── wa_sessions/                    # WhatsApp auth (WWEBJS_AUTH_PATH)
│   └── session-*.json
├── rag/                            # RAG mutable data (RAG_DATA_ROOT)
│   ├── vector_store/               # (VECTOR_STORE_PATH)
│   │   └── index/
│   └── adaptive_learning/           # (ADAPTIVE_LEARNING_DATA_PATH)
│       └── models/
├── qa-mesh/
│   └── system-validate/            # (QA_MESH_SYSTEM_VALIDATE_DIR)
│       └── meshReport.json
└── qa/                             # Smoke test artifacts
    ├── l01-physical-queue-evidence.json
    ├── l02-ura-publish-rollback-evidence.json
    └── ... (L-03 thru L-07)
```

### 4.2. NO WORKSPACE!

**Estes arquivos NUNCA devem ficar em workspace:**
```bash
# ❌ ERRADO - vai para git
workspace/api/data/wa_sessions/session*.json        # Auth sensível
workspace/qa-mesh/system-validate/meshReport.json   # Testes
workspace/rag-service/data/vector_store/index       # Dados imutáveis

# ✅ CERTO - em runtime
~/.local/share/ragent2-runtime/wa_sessions/
~/.local/share/ragent2-runtime/qa-mesh/system-validate/
~/.local/share/ragent2-runtime/rag/vector_store/
```

---

## 5. Debugging

### 5.1. Debug da API

```bash
# Start com Node debugger
node --inspect api/server.js

# Ou via npm script
npm run debug

# Abrir chrome://inspect
# Click "inspect" na lista de apps
```

### 5.2. Debug do Frontend

```bash
# Abrir DevTools (F12 no browser)
# Sources > Webpack > . > src

# Ou via VS Code
# Launch configuration já configurado em .vscode/launch.json
```

### 5.3. Debug de RAG Service

```bash
# Log RAG operations
export LOG_LEVEL=debug
export RAG_DEBUG=1
npm run dev:rag

# Verificar embed quality
curl http://localhost:3000/api/rag/debug/embeddings
```

### 5.4. Logs

```bash
# Em tempo real (todas as services)
npm run logs

# Apenas API
npm run logs:api

# Apenas Frontend
npm run logs:frontend

# Apenas RAG
npm run logs:rag
```

---

## 6. Database Management

### 6.1. Migrations

```bash
# Create new migration
npm run db:migrate:create -- --name your_migration_name

# Run pending migrations
npm run db:migrate:dev

# Rollback last migration
npm run db:migrate:rollback

# Reset database (DEV ONLY!)
npm run db:reset:dev
```

### 6.2. Seed Data

```bash
# Populate with test data
npm run db:seed:dev

# Clear and reseed
npm run db:reset:dev && npm run db:seed:dev
```

### 6.3. Direct Database Access

```bash
# psql client
psql -U ragent2 -d ragent2_dev -h localhost

# Useful queries
SELECT * FROM users LIMIT 5;
SELECT * FROM conversations ORDER BY created_at DESC LIMIT 10;
SELECT COUNT(*) FROM audit_logs;
```

---

## 7. Troubleshooting Desenvolvimento

### "Port already in use"
```bash
# Encontrar processo
lsof -i :3000

# Matar processo
kill -9 <PID>

# Ou usar porta diferente
PORT=3001 npm run dev
```

### "RUNTIME_ROOT not set / paths in workspace"

```bash
# Verificar export
echo $RUNTIME_ROOT

# Se vazio:
export RUNTIME_ROOT=~/.local/share/ragent2-runtime
npm run dev

# Persistir em ~/.bashrc
echo 'export RUNTIME_ROOT=~/.local/share/ragent2-runtime' >> ~/.bashrc
source ~/.bashrc
```

### "Database connection refused"

```bash
# Verificar postgres está rodando
psql -U postgres -c "SELECT 1"

# Se não:
# Opção A: start local postgres
# Opção B: start container
docker start ragent2-db
```

### "Redis ECONNREFUSED"

```bash
# Verificar Redis
redis-cli PING

# Se não responde:
docker run -d -p 6379:6379 redis:7

# Se porta em uso:
redis-cli shutdown
```

### "Smoke tests writing to workspace"

```bash
# Garantir RUNTIME_ROOT exportado
echo $RUNTIME_ROOT

# Se vazio:
export RUNTIME_ROOT=~/.local/share/ragent2-runtime
npm run runtime:clean:check   # Detectar resíduos
npm run runtime:clean         # Limpar
npm run system:validate       # Validar (sem escrever em workspace)
```

### "npm run system:validate muito lento"

```bash
# Rodar apenas 1 smoke test ao invés de todos
npm run test:l01-physical-queue
npm run test:l02-ura-publish-rollback
# etc...

# Ou com timeout editado
SMOKE_TEST_TIMEOUT=60000 npm run test:l01-physical-queue
```

---

## 8. Cleanup e Housekeeping

### 8.1. Limpar Runtime Directory

```bash
# Detectar resíduos
npm run runtime:clean:check

# Remover
npm run runtime:clean

# Remover seletivamente
rm -rf ~/.local/share/ragent2-runtime/qa-mesh/*
rm -rf ~/.local/share/ragent2-runtime/rag/vector_store/*
```

### 8.2. Limpar Node Modules

```bash
# Se encontrar problemas de deps
rm -rf node_modules package-lock.json
npm ci
```

### 8.3. Limpar Database Development

```bash
# CUIDADO: Isso reseta TUDO
npm run db:reset:dev

# Reseed depois
npm run db:seed:dev
```

---

## 9. Workflow Padrão de Desenvolvimento

### 9.1. Working on Feature

```bash
# 1. Criar branch
git checkout -b feature/minha-feature

# 2. Garantir runtime
export RUNTIME_ROOT=~/.local/share/ragent2-runtime
npm run dev

# 3. Fazer changes
editor src/...

# 4. Testes locais
npm run test
npm run test:integration

# 5. Validação pré-commit
npm run lint
npm run format

# 6. Commit
git add .
git commit -m "feat: descrição"

# 7. Push
git push origin feature/minha-feature
```

### 9.2. Before Merge to Main

```bash
# 1. Limpar runtime
npm run runtime:clean:check

# 2. Rodar validação completa
export RUNTIME_ROOT=~/.local/share/ragent2-runtime
npm run system:validate    # Deve passar

# 3. Check verde
npm run check:green        # Deve retornar GO

# 4. Code review
# Enviar PR, aprovar

# 5. Merge
git merge feature/minha-feature
```

---

## 10. Environment Variables - Quick Reference

| Variável | Desenvolvimento | Valor Exemplo | Cascata |
|----------|-----------------|---------------|---------|
| `NODE_ENV` | Required | `development` | N/A |
| `LOG_LEVEL` | Required | `debug` | N/A |
| `RUNTIME_ROOT` | **Importante** | `~/.local/share/ragent2-runtime` | Base |
| `DB_HOST` | Required | `localhost` | N/A |
| `WWEBJS_AUTH_PATH` | Cascata | `$RUNTIME_ROOT/wa_sessions` | Explicit > RUNTIME_ROOT |
| `RAG_DATA_ROOT` | Cascata | `$RUNTIME_ROOT/rag` | Explicit > RUNTIME_ROOT |
| `VECTOR_STORE_PATH` | Cascata | `$RUNTIME_ROOT/rag/vector_store` | Explicit > RUNTIME_ROOT |
| `QA_MESH_SYSTEM_VALIDATE_DIR` | Cascata | `$RUNTIME_ROOT/qa-mesh/system-validate` | Explicit > RUNTIME_ROOT |

---

## 11. Atalhos Úteis (shell functions)

Adicione ao `~/.bashrc` ou `~/.zshrc`:

```bash
# Start dev com RUNTIME_ROOT automático
ragent2-dev() {
  export RUNTIME_ROOT=~/.local/share/ragent2-runtime
  cd ~/projects/r-agent2  # ou seu path
  npm run dev
}

# Clean runtime
ragent2-clean() {
  export RUNTIME_ROOT=~/.local/share/ragent2-runtime
  npm run runtime:clean:check
  npm run runtime:clean
}

# Validar sistema
ragent2-validate() {
  export RUNTIME_ROOT=~/.local/share/ragent2-runtime
  npm run system:validate
}

# Reset DB completo
ragent2-db-reset() {
  npm run db:reset:dev && npm run db:seed:dev && echo "✅ DB reset complete"
}

# Usage:
# ragent2-dev
# ragent2-clean  
# ragent2-validate
# ragent2-db-reset
```

---

## 12. Contato / Suporte

**Troubleshooting mais complexo?**
- Ver [DOUTRINA_OPERACIONAL.md](./DOUTRINA_OPERACIONAL.md#9-troubleshooting-operacional)
- Ver [OPERACIONAL_CHEATSHEET.md](./OPERACIONAL_CHEATSHEET.md#troubleshooting-rápido)

**Perguntas sobre paths?**
- Ver [runtime-paths.md](./runtime-paths.md)

**Antes de release?**
- Ver [release-checklist.md](./release-checklist.md)

