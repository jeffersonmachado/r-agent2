# Configuração para Desenvolvimento e Produção

Este documento explica como configurar o ambiente para desenvolvimento local e produção.

## 📋 Índice

1. [Desenvolvimento Local](#desenvolvimento-local)
2. [Produção com Docker](#produção-com-docker)
3. [Variáveis de Ambiente](#variáveis-de-ambiente)
4. [Serviços Necessários](#serviços-necessários)

---

## 🛠️ Desenvolvimento Local

### Opção 1: Desenvolvimento sem Docker (Recomendado para dev)

#### Pré-requisitos
- Node.js 20.19+ ou 22.12+
- PostgreSQL 16+ (instalado localmente ou via Docker)
- Redis (opcional, mas recomendado para rate limiting)

#### Passo 1: Instalar dependências
```bash
npm install
```

#### Passo 2: Configurar PostgreSQL

**Opção A: PostgreSQL local**
```bash
# Criar banco de dados
createdb r_agent2

# Ou via psql
psql -U postgres -c "CREATE DATABASE r_agent2;"
```

**Opção B: PostgreSQL via Docker (mais fácil)**
```bash
# Iniciar apenas PostgreSQL
docker run -d \
  --name postgres-dev \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=r_agent2 \
  -p 5432:5432 \
  postgres:16-alpine
```

#### Passo 3: Configurar variáveis de ambiente

Crie um arquivo `.env` na raiz do projeto (ou exporte as variáveis):

```bash
# PostgreSQL
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/r_agent2"
# OU use variáveis individuais:
export PGHOST=localhost
export PGUSER=postgres
export PGPASSWORD=postgres
export PGDATABASE=r_agent2
export PGPORT=5432

# Redis (opcional)
export REDIS_URL="redis://localhost:6379"
export RATE_LIMIT_REDIS_URL="redis://localhost:6379"

# RAG Service (se rodando separadamente)
export RAG_SERVICE_URL="http://localhost:8000"

# OpenAI/Anthropic (opcional)
export OPENAI_API_KEY="sua-chave-aqui"
export ANTHROPIC_API_KEY="sua-chave-aqui"

# Ambiente
export NODE_ENV=development
```

#### Passo 4: Iniciar servidores

```bash
# Inicia API, Frontend e RAG Service juntos
npm run dev

# Ou iniciar separadamente:
npm run dev:api-only    # Apenas API
npm run dev:frontend    # Apenas Frontend
npm run rag:dev         # Apenas RAG Service
```

#### Passo 5: Verificar se está funcionando

- API: http://localhost:3000
- Frontend: http://localhost:5173
- RAG Service: http://localhost:8000

### Opção 2: Desenvolvimento com Docker Compose

```bash
# Inicia todos os serviços (API, Frontend, PostgreSQL, Redis, RAG)
docker-compose up -d

# Ver logs
docker-compose logs -f

# Parar
docker-compose down
```

---

## 🚀 Produção com Docker

### Opção 1: Docker Compose (Recomendado)

#### Passo 1: Configurar variáveis de ambiente

Crie um arquivo `.env` na raiz do projeto:

```bash
# PostgreSQL (use um banco de dados gerenciado em produção)
DATABASE_URL=postgresql://usuario:senha@host:5432/r_agent2
# OU
PGHOST=seu-host-postgres
PGUSER=seu-usuario
PGPASSWORD=sua-senha-segura
PGDATABASE=r_agent2
PGPORT=5432

# Redis
REDIS_URL=redis://seu-redis:6379
RATE_LIMIT_REDIS_URL=redis://seu-redis:6379

# RAG Service
RAG_SERVICE_URL=http://rag-service:8000

# API Keys
OPENAI_API_KEY=sua-chave-producao
ANTHROPIC_API_KEY=sua-chave-producao

# Criptografia (OBRIGATÓRIO em produção)
ENCRYPTION_KEY=chave-secreta-aleatoria-32-caracteres-minimo

# Ambiente
NODE_ENV=production
LOG_LEVEL=info

# Portas
API_PORT=3000
FRONTEND_PORT=8080
RAG_PORT=8000
REDIS_PORT=6379
PGPORT=5432
```

#### Passo 2: Build das imagens

```bash
# Build de todas as imagens
docker-compose -f docker-compose.prod.yml build

# Ou build individual
docker-compose -f docker-compose.prod.yml build api
docker-compose -f docker-compose.prod.yml build frontend
docker-compose -f docker-compose.prod.yml build rag-service
```

#### Passo 3: Iniciar serviços

```bash
# Inicia todos os serviços em background
docker-compose -f docker-compose.prod.yml up -d

# Ver status
docker-compose -f docker-compose.prod.yml ps

# Ver logs
docker-compose -f docker-compose.prod.yml logs -f

# Parar
docker-compose -f docker-compose.prod.yml down
```

### Opção 2: Deploy remoto via SSH

O projeto inclui scripts para deploy remoto:

```bash
# Deploy completo (build + push + deploy)
./scripts/docker-deploy.sh --prod --build

# Deploy apenas frontend
./scripts/docker-deploy.sh --prod --build --frontend-only

# Deploy apenas API
./scripts/docker-deploy.sh --prod --build --api-only
```

---

## 🔧 Variáveis de Ambiente

### Variáveis Obrigatórias (Produção)

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `DATABASE_URL` | URL completa do PostgreSQL | `postgresql://user:pass@host:5432/db` |
| `ENCRYPTION_KEY` | Chave para criptografia de segredos | `chave-aleatoria-32-chars-min` |

### Variáveis Opcionais mas Recomendadas

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `PGHOST` | Host do PostgreSQL | `localhost` |
| `PGUSER` | Usuário do PostgreSQL | `postgres` |
| `PGPASSWORD` | Senha do PostgreSQL | `postgres` |
| `PGDATABASE` | Nome do banco | `r_agent2` |
| `PGPORT` | Porta do PostgreSQL | `5432` |
| `REDIS_URL` | URL do Redis | `redis://localhost:6379` |
| `RATE_LIMIT_REDIS_URL` | URL do Redis para rate limiting | `redis://localhost:6379` |
| `RAG_SERVICE_URL` | URL do RAG Service | `http://localhost:8000` |
| `OPENAI_API_KEY` | Chave da API OpenAI | - |
| `ANTHROPIC_API_KEY` | Chave da API Anthropic | - |
| `NODE_ENV` | Ambiente (`development` ou `production`) | `development` |
| `LOG_LEVEL` | Nível de log (`debug`, `info`, `warn`, `error`) | `info` |

### Variáveis de Rate Limiting

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `RATE_LIMIT_DRY_RUN_POINTS` | Limite para dry run | `50` |
| `RATE_LIMIT_GENERATION_POINTS` | Limite para geração | `5` |
| `RATE_LIMIT_BOOTSTRAP_POINTS` | Limite para bootstrap | `1` |
| `RATE_LIMIT_SCRAPING_POINTS` | Limite para scraping | `10` |

---

## 🗄️ Serviços Necessários

### PostgreSQL

**Desenvolvimento:**
- Pode usar PostgreSQL local ou via Docker
- Banco: `r_agent2`
- Usuário: `postgres` (ou configurar via variáveis)

**Produção:**
- Use um banco de dados gerenciado (AWS RDS, Google Cloud SQL, etc.)
- Configure backups automáticos
- Use credenciais seguras
- Configure SSL/TLS
- O schema do banco é criado automaticamente pelos models do Sequelize

### Redis

**Desenvolvimento:**
- Opcional, mas recomendado para testar rate limiting
- Pode usar Redis local ou via Docker

**Produção:**
- Use Redis gerenciado (AWS ElastiCache, Redis Cloud, etc.)
- Configure persistência
- Configure senha de autenticação

**Iniciar Redis local:**
```bash
# Via Docker
docker run -d --name redis-dev -p 6379:6379 redis:7-alpine

# Ou instalar localmente
# Ubuntu/Debian: sudo apt-get install redis-server
# macOS: brew install redis
```

### RAG Service

**Desenvolvimento:**
- Roda automaticamente com `npm run dev`
- Ou manualmente: `npm run rag:dev`

**Produção:**
- Incluído no `docker-compose.prod.yml`
- Requer OpenAI API key para funcionar completamente

---

## 🔍 Verificação e Troubleshooting

### Verificar se PostgreSQL está acessível

```bash
# Testar conexão
psql -h localhost -U postgres -d r_agent2

# Ou via Docker
docker exec -it chatbot-postgres psql -U postgres -d r_agent2
```

### Verificar se Redis está acessível

```bash
# Testar conexão
redis-cli ping
# Deve retornar: PONG

# Ou via Docker
docker exec -it chatbot-redis redis-cli ping
```

### Verificar logs dos serviços

**Desenvolvimento:**
```bash
# Logs da API (nodemon)
# Aparecem no terminal onde rodou npm run dev

# Logs do RAG Service
tail -f /tmp/rag-service-dev.log
```

**Produção (Docker):**
```bash
# Todos os serviços
docker-compose -f docker-compose.prod.yml logs -f

# Serviço específico
docker-compose -f docker-compose.prod.yml logs -f api
docker-compose -f docker-compose.prod.yml logs -f frontend
docker-compose -f docker-compose.prod.yml logs -f rag-service
```

### Verificar saúde dos serviços

```bash
# API
curl http://localhost:3000/health

# RAG Service
curl http://localhost:8000/rag/health

# Frontend
curl http://localhost:5173/
```

---

## 📝 Checklist de Configuração

### Desenvolvimento
- [ ] Node.js instalado (20.19+ ou 22.12+)
- [ ] Dependências instaladas (`npm install`)
- [ ] PostgreSQL rodando e acessível
- [ ] Variáveis de ambiente configuradas (`.env` ou exportadas)
- [ ] Redis rodando (opcional)
- [ ] Servidor iniciado (`npm run dev`)

### Produção
- [ ] Docker e Docker Compose instalados
- [ ] Arquivo `.env` configurado com valores de produção
- [ ] `ENCRYPTION_KEY` definida (obrigatório)
- [ ] PostgreSQL de produção configurado e acessível
- [ ] Redis de produção configurado e acessível
- [ ] Imagens Docker buildadas
- [ ] Migrations executadas
- [ ] Serviços iniciados e saudáveis
- [ ] Backups configurados
- [ ] Monitoramento configurado

---

## 🆘 Problemas Comuns

### "PostgreSQL não está disponível"

**Solução:**
1. Verifique se PostgreSQL está rodando
2. Verifique as variáveis de ambiente (`DATABASE_URL` ou `PGHOST/PGUSER/etc`)
3. Teste a conexão manualmente com `psql`

### "Redis não configurado"

**Solução:**
- Em desenvolvimento, isso é apenas um aviso
- Para usar rate limiting, configure `REDIS_URL`
- O servidor funciona sem Redis, mas rate limiting não funcionará

### "Cannot find module 'sequelize'"

**Solução:**
```bash
npm install
```

### Porta já em uso

**Solução:**
```bash
# Verificar qual processo está usando a porta
lsof -i :3000  # Para porta 3000

# Matar processo
kill -9 <PID>
```

---

## 📚 Recursos Adicionais

- [Documentação do Docker Compose](https://docs.docker.com/compose/)
- [Documentação do Sequelize](https://sequelize.org/)
- [Documentação do PostgreSQL](https://www.postgresql.org/docs/)

---

## 📌 Nota sobre Schema do Banco

O projeto **não utiliza migrations**. O schema do banco de dados é gerenciado diretamente pelos models do Sequelize. Quando a aplicação inicia, os models são carregados e o Sequelize pode criar/atualizar as tabelas automaticamente se configurado para isso.

**Importante:** Em produção, certifique-se de que o schema do banco está sincronizado antes de iniciar a aplicação.

---

**Última atualização:** 2026-01-11
