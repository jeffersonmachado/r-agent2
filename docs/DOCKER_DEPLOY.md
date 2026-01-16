# Guia de Publicação Docker - R-Agent2

Este guia descreve como publicar e executar a plataforma R-Agent2 usando Docker.

## 📋 Índice

- [Pré-requisitos](#pré-requisitos)
- [Estrutura Docker](#estrutura-docker)
- [Publicação Rápida](#publicação-rápida)
- [Configuração](#configuração)
- [Modos de Execução](#modos-de-execução)
- [Build Manual](#build-manual)
- [Deploy em Produção](#deploy-em-produção)
- [Monitoramento e Logs](#monitoramento-e-logs)
- [Troubleshooting](#troubleshooting)
- [Otimizações](#otimizações)

## Pré-requisitos

### Software Necessário

- **Docker** (versão 20.10 ou superior)
- **Docker Compose** (versão 2.0 ou superior) ou Docker com suporte a `docker compose`
- **Git** (para clonar o repositório)

### Verificar Instalação

```bash
# Verificar Docker
docker --version

# Verificar Docker Compose
docker-compose --version
# ou
docker compose version
```

### Requisitos de Sistema

- **RAM**: Mínimo 4GB (recomendado 8GB+)
- **Disco**: Mínimo 10GB de espaço livre
- **CPU**: Mínimo 2 cores (recomendado 4+)

## Estrutura Docker

A plataforma é composta por 4 serviços principais:

1. **API** (`r-agent2-api`) - Backend Node.js
2. **Frontend** (`r-agent2-frontend`) - Interface React com Nginx
3. **RAG Service** (`r-agent2-rag-service`) - Serviço Python para RAG
4. **Redis** - Cache e rate limiting

### Arquivos Docker

```
r-agent2/
├── docker-compose.yml          # Configuração para desenvolvimento
├── docker-compose.prod.yml      # Configuração para produção
├── .dockerignore               # Arquivos ignorados no build
├── api/
│   └── Dockerfile              # Build da API
├── frontend/
│   ├── Dockerfile              # Build do Frontend
│   └── nginx.conf              # Configuração Nginx
└── rag-service/
    └── Dockerfile              # Build do RAG Service
```

## Publicação Rápida

### Opção 1: Script Automatizado (Recomendado)

```bash
# Clone o repositório (se ainda não tiver)
git clone <repository-url>
cd r-agent2

# Execute o script de deploy
./scripts/docker-deploy.sh --dev --build
```

### Opção 2: Docker Compose Manual

```bash
# 1. Configure variáveis de ambiente
cp env.example .env
# Edite o .env conforme necessário

# 2. Build e inicie os serviços
docker-compose up -d --build

# Ou para produção:
docker-compose -f docker-compose.prod.yml up -d --build
```

## Configuração

### Arquivo .env

Crie um arquivo `.env` na raiz do projeto baseado em `env.example`:

```bash
cp env.example .env
```

### Variáveis de Ambiente Principais

#### API
```env
API_PORT=3000
NODE_ENV=production
LOG_LEVEL=info
```

#### Redis
```env
REDIS_URL=redis://redis:6379
RATE_LIMIT_REDIS_URL=redis://redis:6379
REDIS_PORT=6379
```

#### Frontend
```env
FRONTEND_PORT=8080
VITE_API_BASE_URL=
```

#### RAG Service
```env
RAG_PORT=8000
RAG_DEBUG=false
RAG_EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2
RAG_CHUNK_SIZE=500
RAG_CHUNK_OVERLAP=50
OPENAI_API_KEY=your-api-key-here
```

#### Rate Limiting
```env
RATE_LIMIT_DRY_RUN_POINTS=50
RATE_LIMIT_DRY_RUN_DURATION=60
RATE_LIMIT_GENERATION_POINTS=5
RATE_LIMIT_GENERATION_DURATION=60
RATE_LIMIT_BOOTSTRAP_POINTS=1
RATE_LIMIT_BOOTSTRAP_DURATION=300
```

## Modos de Execução

### Desenvolvimento

```bash
# Usa docker-compose.yml
docker-compose up -d

# Ou com script
./scripts/docker-deploy.sh --dev
```

**Características:**
- Logs mais verbosos
- Hot reload (se configurado)
- Sem otimizações de produção
- Volumes para desenvolvimento

### Produção

```bash
# Usa docker-compose.prod.yml
docker-compose -f docker-compose.prod.yml up -d

# Ou com script
./scripts/docker-deploy.sh --prod --build
```

**Características:**
- Otimizações de build
- Healthchecks configurados
- Limites de recursos
- Restart automático
- Logs estruturados
- Rede isolada

## Build Manual

### Build Individual de Serviços

```bash
# Build da API
docker build -t r-agent2-api:latest -f api/Dockerfile .

# Build do Frontend
docker build -t r-agent2-frontend:latest -f frontend/Dockerfile ./frontend

# Build do RAG Service
docker build -t r-agent2-rag-service:latest -f rag-service/Dockerfile ./rag-service
```

### Usando Script de Build

```bash
# Build todas as imagens
./scripts/docker-build.sh --all

# Build apenas um serviço
./scripts/docker-build.sh --api
./scripts/docker-build.sh --frontend
./scripts/docker-build.sh --rag
```

## Deploy em Produção

### Passo a Passo

1. **Prepare o ambiente**
   ```bash
   # Clone o repositório
   git clone <repository-url>
   cd r-agent2
   
   # Configure variáveis de ambiente
   cp env.example .env
   nano .env  # Edite com suas configurações
   ```

2. **Build das imagens**
   ```bash
   ./scripts/docker-build.sh --all
   ```

3. **Inicie os serviços**
   ```bash
   ./scripts/docker-deploy.sh --prod --build
   ```

4. **Verifique o status**
   ```bash
   docker-compose -f docker-compose.prod.yml ps
   ```

5. **Acesse a aplicação**
   - Frontend: http://localhost:8080
   - API: http://localhost:3000
   - RAG Service: http://localhost:8000

### Com Proxy Reverso (Nginx/Traefik)

Se você estiver usando um proxy reverso, configure as portas internas e exponha apenas através do proxy:

```yaml
# No docker-compose.prod.yml, remova ou ajuste as portas expostas
ports:
  - "127.0.0.1:3000:3000"  # Apenas localhost
```

### Com SSL/TLS

Para produção com HTTPS, use um proxy reverso (Nginx, Traefik, Caddy) ou configure SSL diretamente no Nginx do frontend.

## Monitoramento e Logs

### Ver Logs

```bash
# Todos os serviços
docker-compose -f docker-compose.prod.yml logs -f

# Serviço específico
docker-compose -f docker-compose.prod.yml logs -f api
docker-compose -f docker-compose.prod.yml logs -f frontend
docker-compose -f docker-compose.prod.yml logs -f rag-service
docker-compose -f docker-compose.prod.yml logs -f redis

# Últimas 100 linhas
docker-compose -f docker-compose.prod.yml logs --tail=100
```

### Status dos Containers

```bash
# Status geral
docker-compose -f docker-compose.prod.yml ps

# Informações detalhadas
docker stats
```

### Health Checks

Os serviços incluem healthchecks automáticos:

```bash
# Verificar saúde manualmente
curl http://localhost:3000/health  # API
curl http://localhost:8080          # Frontend
curl http://localhost:8000/health   # RAG Service
redis-cli -h localhost ping         # Redis
```

## Troubleshooting

### Problema: Container não inicia

**Solução:**
```bash
# Ver logs de erro
docker-compose logs <service-name>

# Verificar se a porta está em uso
netstat -tulpn | grep :3000

# Reiniciar o serviço
docker-compose restart <service-name>
```

### Problema: Erro de conexão com Redis

**Solução:**
```bash
# Verificar se Redis está rodando
docker-compose ps redis

# Verificar logs do Redis
docker-compose logs redis

# Reiniciar Redis
docker-compose restart redis
```

### Problema: Frontend não conecta à API

**Solução:**
1. Verifique se `VITE_API_BASE_URL` está vazio no `.env` (para usar proxy nginx)
2. Verifique se o nginx.conf está correto
3. Verifique se a API está acessível: `curl http://api:3000/health`

### Problema: Build falha

**Solução:**
```bash
# Limpar cache do Docker
docker system prune -a

# Rebuild sem cache
docker-compose build --no-cache

# Verificar espaço em disco
df -h
```

### Problema: Erro de permissão

**Solução:**
```bash
# Adicionar usuário ao grupo docker
sudo usermod -aG docker $USER
newgrp docker
```

### Limpar Tudo e Recomeçar

```bash
# Parar e remover containers, volumes e redes
docker-compose -f docker-compose.prod.yml down -v

# Remover imagens
docker rmi r-agent2-api r-agent2-frontend r-agent2-rag-service

# Limpar sistema Docker
docker system prune -a
```

## Otimizações

### Cache de Build

Os Dockerfiles estão otimizados para cache de layers:
- Dependências são instaladas antes do código
- Código é copiado em camadas separadas

### Recursos

No `docker-compose.prod.yml`, os limites de recursos estão configurados:
- API: 2 CPU, 2GB RAM
- Frontend: 1 CPU, 512MB RAM
- RAG Service: 2 CPU, 4GB RAM
- Redis: 1 CPU, 512MB RAM

Ajuste conforme necessário para seu ambiente.

### Volumes Persistentes

Os seguintes volumes são criados para persistência:
- `api-data`: Dados da API (flows, conversas, etc.)
- `rag-vector-store`: Vector store do RAG
- `redis-data`: Dados do Redis

### Backup

Para fazer backup dos dados:

```bash
# Backup dos volumes
docker run --rm -v r-agent2_api-data:/data -v $(pwd):/backup alpine tar czf /backup/api-data-backup.tar.gz /data
docker run --rm -v r-agent2_rag-vector-store:/data -v $(pwd):/backup alpine tar czf /backup/rag-data-backup.tar.gz /data
docker run --rm -v r-agent2_redis-data:/data -v $(pwd):/backup alpine tar czf /backup/redis-data-backup.tar.gz /data
```

### Restauração

```bash
# Restaurar volumes
docker run --rm -v r-agent2_api-data:/data -v $(pwd):/backup alpine tar xzf /backup/api-data-backup.tar.gz -C /
```

## Comandos Úteis

```bash
# Parar serviços
docker-compose -f docker-compose.prod.yml down

# Parar e remover volumes
docker-compose -f docker-compose.prod.yml down -v

# Reiniciar um serviço
docker-compose -f docker-compose.prod.yml restart api

# Atualizar e reiniciar
docker-compose -f docker-compose.prod.yml up -d --build

# Ver uso de recursos
docker stats

# Entrar em um container
docker exec -it r-agent2-api-prod sh

# Executar comando em container
docker exec r-agent2-api-prod node --version
```

## Próximos Passos

- Configure um proxy reverso (Nginx/Traefik) para produção
- Configure SSL/TLS
- Configure monitoramento (Prometheus, Grafana)
- Configure backup automático
- Configure CI/CD para deploy automático

## Suporte

Para problemas ou dúvidas:
1. Verifique os logs: `docker-compose logs`
2. Consulte a documentação do projeto
3. Abra uma issue no repositório

---

**Última atualização:** $(date)

