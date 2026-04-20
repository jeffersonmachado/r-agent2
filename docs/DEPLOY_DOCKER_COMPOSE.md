# Deployment: Docker / Docker Compose

Guia para rodar r-agent2 em produção com Docker Compose orquestração.

---

## 1. Pré-requisitos

### Infraestrutura
- Linux host (Ubuntu 20+, Debian 11+, CentOS 8+)
- 16 GB RAM mínimo (32 GB recomendado)
- 50 GB espaço em disco
- Docker 20.10+ e Docker Compose 2.0+

### Verificação

```bash
docker --version                    # Docker 20.10+
docker-compose --version            # 2.0+

# Verificar daemon rodando
docker ps

# Aprovisionar espaço (opcional)
df -h /var/lib/docker
```

---

## 2. Setup Pré-Deployment

### 2.1. Criar Runtime Directory (Host)

```bash
# Create isolated runtime directory (fora do container)
sudo mkdir -p /var/lib/ragent2
sudo mkdir -p /var/lib/ragent2/rag
sudo mkdir -p /var/lib/ragent2/release-evidence
sudo mkdir -p /var/lib/ragent2/wa_sessions

# Set permissions (docker user/group)
sudo chown -R 1000:1000 /var/lib/ragent2
sudo chmod 755 /var/lib/ragent2
```

### 2.2. Environment File (.env.docker)

```bash
# Copy from example
cp env.example .env.docker

# Edit with production values
nano .env.docker
```

**Conteúdo .env.docker:**

```bash
# ===== Core =====
NODE_ENV=production
LOG_LEVEL=info
PORT=3000
API_SECRET=your_secret_key_here

# ===== Database =====
# Inside compose network, container name = hostname
DB_HOST=ragent2-db
DB_PORT=5432
DB_USER=ragent2
DB_PASSWORD=secure_password_here
DB_NAME=ragent2_prod

# ===== Redis =====
REDIS_HOST=ragent2-redis
REDIS_PORT=6379

# ===== Runtime (CRITICAL) =====
# Points to HOST path mounted in containers
RUNTIME_ROOT=/var/lib/ragent2

# ===== Service-Specific (cascade from RUNTIME_ROOT) =====
WWEBJS_AUTH_PATH=/var/lib/ragent2/wa_sessions
RAG_DATA_ROOT=/var/lib/ragent2/rag
VECTOR_STORE_PATH=/var/lib/ragent2/rag/vector_store
ADAPTIVE_LEARNING_DATA_PATH=/var/lib/ragent2/rag/adaptive_learning

# ===== QA / Validation =====
QA_MESH_SYSTEM_VALIDATE_DIR=/var/lib/ragent2/qa-mesh/system-validate
RELEASE_EVIDENCE_BASE_DIR=/var/lib/ragent2/release-evidence
PHYSICAL_QUEUE_EVIDENCE_PATH=/var/lib/ragent2/qa/l01-physical-queue-evidence.json

# ===== Frontend =====
VITE_API_BASE=https://api.seu-dominio.com
VITE_WS_URL=wss://api.seu-dominio.com/ws

# ===== Security =====
ENABLE_CORS=true
CORS_ORIGIN=https://seu-dominio.com
JWT_SECRET=your_jwt_secret_here
```

### 2.3. Docker Compose File

Use arquivo existente ou crie:

**docker-compose.prod.yml**

```yaml
version: '3.9'

services:
  # API Service
  ragent2-api:
    image: ragent2:latest              # Tag your build
    container_name: ragent2-api
    restart: always
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - LOG_LEVEL=info
    env_file:
      - .env.docker
    depends_on:
      - ragent2-db
      - ragent2-redis
    volumes:
      # Runtime mounted from HOST
      - /var/lib/ragent2:/var/lib/ragent2
      # Logs (optional)
      - /var/log/ragent2:/app/logs
    networks:
      - ragent2-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  # RAG Service (if separated)
  ragent2-rag:
    image: ragent2-rag:latest
    container_name: ragent2-rag
    restart: always
    environment:
      - NODE_ENV=production
      - LOG_LEVEL=info
    env_file:
      - .env.docker
    depends_on:
      - ragent2-db
    volumes:
      - /var/lib/ragent2:/var/lib/ragent2
      - /var/log/ragent2:/app/logs
    networks:
      - ragent2-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  # PostgreSQL Database
  ragent2-db:
    image: postgres:14-alpine
    container_name: ragent2-db
    restart: always
    environment:
      POSTGRES_USER: ragent2
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: ragent2_prod
    volumes:
      - ragent2-db-data:/var/lib/postgresql/data
    networks:
      - ragent2-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ragent2"]
      interval: 10s
      timeout: 5s
      retries: 5

  # Redis Cache
  ragent2-redis:
    image: redis:7-alpine
    container_name: ragent2-redis
    restart: always
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD:-}
    volumes:
      - ragent2-redis-data:/data
    networks:
      - ragent2-network
    healthcheck:
      test: ["CMD", "redis-cli", "PING"]
      interval: 10s
      timeout: 5s
      retries: 5

  # Reverse Proxy (Nginx)
  ragent2-nginx:
    image: nginx:alpine
    container_name: ragent2-nginx
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro  # SSL certs
    depends_on:
      - ragent2-api
    networks:
      - ragent2-network

networks:
  ragent2-network:
    driver: bridge

volumes:
  ragent2-db-data:
    driver: local
  ragent2-redis-data:
    driver: local
```

---

## 3. Build & Registry

### 3.1. Build Local

```bash
# Build image
docker build \
  -t ragent2:latest \
  -t ragent2:v1.0.0 \
  -f api/Dockerfile \
  .

# Build RAG service (if separated)
docker build \
  -t ragent2-rag:latest \
  -t ragent2-rag:v1.0.0 \
  -f rag-service/Dockerfile \
  .

# Verify
docker images | grep ragent2
```

### 3.2. Push to Registry (Opcional)

```bash
# Tag for registry
docker tag ragent2:latest registry.seu-host.com/ragent2:latest
docker tag ragent2:latest registry.seu-host.com/ragent2:v1.0.0

# Login
docker login registry.seu-host.com

# Push
docker push registry.seu-host.com/ragent2:latest
docker push registry.seu-host.com/ragent2:v1.0.0

# Update docker-compose.prod.yml
# image: registry.seu-host.com/ragent2:latest
```

---

## 4. Deployment - Start Production

### 4.1. Pull & Start Containers

```bash
# Verify .env.docker is present
ls -la .env.docker

# Pull latest images (if from registry)
docker-compose -f docker-compose.prod.yml pull

# Start all services
docker-compose -f docker-compose.prod.yml up -d

# Verify running
docker-compose -f docker-compose.prod.yml ps

# Expected output:
# NAME             STATUS
# ragent2-api      Up 2 minutes (healthy)
# ragent2-db       Up 3 minutes (healthy)
# ragent2-redis    Up 3 minutes (healthy)
# ragent2-nginx    Up 1 minute
```

### 4.2. Database Migration (First Time)

```bash
# Execute migration in running container
docker-compose -f docker-compose.prod.yml exec ragent2-api \
  npm run db:migrate:prod

# Seed initial data (optional)
docker-compose -f docker-compose.prod.yml exec ragent2-api \
  npm run db:seed:prod

# Verify
docker-compose -f docker-compose.prod.yml exec ragent2-api \
  npm run db:check
```

### 4.3. Health Checks

```bash
# API health
curl http://localhost:3000/health

# DB from inside container
docker-compose -f docker-compose.prod.yml exec ragent2-db \
  psql -U ragent2 -d ragent2_prod -c "SELECT COUNT(*) FROM users;"

# Redis from inside
docker-compose -f docker-compose.prod.yml exec ragent2-redis \
  redis-cli PING

# Logs
docker-compose -f docker-compose.prod.yml logs -f ragent2-api
docker-compose -f docker-compose.prod.yml logs -f ragent2-db
```

---

## 5. Operação - Maintenance

### 5.1. Container Logs

```bash
# Real-time logs (all)
docker-compose -f docker-compose.prod.yml logs -f

# Specific service
docker-compose -f docker-compose.prod.yml logs -f ragent2-api

# Last 100 lines
docker-compose -f docker-compose.prod.yml logs --tail=100 ragent2-api

# With timestamps
docker-compose -f docker-compose.prod.yml logs -f --timestamps ragent2-api
```

### 5.2. Container Management

```bash
# Stop all
docker-compose -f docker-compose.prod.yml stop

# Stop specific
docker-compose -f docker-compose.prod.yml stop ragent2-api

# Restart all
docker-compose -f docker-compose.prod.yml restart

# Restart specific
docker-compose -f docker-compose.prod.yml restart ragent2-api

# Full removal (careful!)
docker-compose -f docker-compose.prod.yml down
# Keep volumes:
docker-compose -f docker-compose.prod.yml down -v
```

### 5.3. Update Containers

```bash
# Rebuild from latest code (if changed locally)
docker-compose -f docker-compose.prod.yml build

# Or pull from registry
docker-compose -f docker-compose.prod.yml pull

# Restart with new image
docker-compose -f docker-compose.prod.yml up -d
```

### 5.4. Resource Monitoring

```bash
# CPU/Memory usage
docker stats

# Specific container
docker stats ragent2-api ragent2-db

# Disk usage
docker system df
docker system df -v

# Network
docker network ls
docker network inspect ragent2-network
```

---

## 6. Runtime Directory Management

### 6.1. Volumes from Host

**Estrutura em `/var/lib/ragent2`:**

```
/var/lib/ragent2/
├── wa_sessions/                    # WhatsApp auth (persist across restarts)
│   └── session-*.json
├── rag/
│   ├── vector_store/               # Persist vector embeddings
│   │   └── index/
│   └── adaptive_learning/
│       └── models/
├── qa-mesh/
│   └── system-validate/
│       └── meshReport.json
└── release-evidence/
    └── v1.0.0/
        └── evidence.json
```

### 6.2. Backup Strategy

```bash
# Backup database
docker-compose -f docker-compose.prod.yml exec ragent2-db \
  pg_dump -U ragent2 ragent2_prod > backup_$(date +%Y%m%d_%H%M%S).sql

# Backup runtime directory
tar -czf backup_runtime_$(date +%Y%m%d_%H%M%S).tar.gz \
  /var/lib/ragent2/

# Backup Redis
docker-compose -f docker-compose.prod.yml exec ragent2-redis \
  redis-cli BGSAVE

# Check inside container
docker-compose -f docker-compose.prod.yml exec ragent2-redis \
  ls -la /data/
```

### 6.3. Cleanup Residues

```bash
# Inside container, cleanup
docker-compose -f docker-compose.prod.yml exec ragent2-api \
  npm run runtime:clean:check

# Remove residues
docker-compose -f docker-compose.prod.yml exec ragent2-api \
  npm run runtime:clean

# Verify cleanup
ls -la /var/lib/ragent2/qa-mesh/system-validate/
ls -la /var/lib/ragent2/rag/vector_store/
```

---

## 7. Validation in Docker

### 7.1. System Validate

```bash
# Inside container
docker-compose -f docker-compose.prod.yml exec ragent2-api \
  npm run system:validate

# Output goes to
# /var/lib/ragent2/qa-mesh/system-validate/meshReport.json

# Check result
cat /var/lib/ragent2/qa-mesh/system-validate/meshReport.json | jq
```

### 7.2. Release Gate

```bash
# Read verdicts
docker-compose -f docker-compose.prod.yml exec ragent2-api \
  npm run system:release-gate

# Make GO/NO_GO decision
docker-compose -f docker-compose.prod.yml exec ragent2-api \
  npm run system:go-no-go

# Exit codes: 0 = GO, 1 = NO_GO
echo $?
```

### 7.3. Smoke Tests (Individual)

```bash
# L-01 Physical Queue
docker-compose -f docker-compose.prod.yml exec ragent2-api \
  npm run test:l01-physical-queue

# L-02 URA Publish
docker-compose -f docker-compose.prod.yml exec ragent2-api \
  npm run test:l02-ura-publish-rollback

# L-07 RPA Replays
docker-compose -f docker-compose.prod.yml exec ragent2-api \
  npm run test:l07-rpa-replays-scale

# All (slower)
docker-compose -f docker-compose.prod.yml exec ragent2-api \
  npm run test:all-smoke
```

---

## 8. SSL/TLS Setup (via Nginx)

### 8.1. Generate Certificates (Let's Encrypt)

```bash
# Install certbot
sudo apt-get install certbot python3-certbot-nginx

# Generate certificate
sudo certbot certonly --standalone \
  -d api.seu-dominio.com \
  -d seu-dominio.com

# Certs saved to:
# /etc/letsencrypt/live/seu-dominio.com/
```

### 8.2. Nginx Configuration

**nginx.conf:**

```nginx
upstream ragent2_api {
  server ragent2-api:3000;
}

server {
  listen 80;
  server_name api.seu-dominio.com;
  
  # Redirect HTTP → HTTPS
  return 301 https://$server_name$request_uri;
}

server {
  listen 443 ssl http2;
  server_name api.seu-dominio.com;

  # SSL certificates
  ssl_certificate /etc/letsencrypt/live/seu-dominio.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/seu-dominio.com/privkey.pem;

  # Strong SSL config
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_ciphers HIGH:!aNULL:!MD5;
  ssl_prefer_server_ciphers on;

  # Proxy
  location / {
    proxy_pass http://ragent2_api;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    
    # WebSocket support
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

---

## 9. Troubleshooting Docker

### Container won't start

```bash
# Check logs
docker-compose -f docker-compose.prod.yml logs ragent2-api

# Common issues:
# 1. Port in use → docker ps | grep 3000
# 2. Volume mount failed → docker-compose config (validate)
# 3. Env vars missing → cat .env.docker
```

### Database connection refused

```bash
# Verify network
docker network inspect ragent2-network

# Verify DB is healthy
docker-compose -f docker-compose.prod.yml exec ragent2-db \
  pg_isready -U ragent2

# Check DB logs
docker-compose -f docker-compose.prod.yml logs ragent2-db
```

### Out of disk space

```bash
# Check Docker usage
docker system df

# Clean unused images
docker image prune -a

# Clean unused volumes
docker volume prune

# Clean build cache
docker builder prune
```

### Runtime directory permissions

```bash
# If containers can't write to /var/lib/ragent2:
sudo ls -la /var/lib/ragent2

# Fix permissions (docker UID 1000)
sudo chown -R 1000:1000 /var/lib/ragent2
sudo chmod 755 /var/lib/ragent2

# Restart containers
docker-compose -f docker-compose.prod.yml restart ragent2-api
```

---

## 10. Security Best Practices

### 10.1. Environment Variables

```bash
# ❌ Never commit .env.docker
echo ".env.docker" >> .gitignore

# ✅ Use secrets management for production
# Option A: Docker Secrets (Swarm)
# Option B: Environment variables from orchestrator (K8s)
# Option C: HashiCorp Vault integration
```

### 10.2. Image Security

```bash
# Scan for vulnerabilities
docker scan ragent2:latest

# Use minimal base images
FROM node:18-alpine   # Good (30 MB)
FROM node:18          # Bad (900 MB)

# Keep images updated
docker pull node:18-alpine
docker build -t ragent2:latest .
docker-compose -f docker-compose.prod.yml up -d
```

### 10.3. Network Security

```bash
# Use custom network (already in compose)
networks:
  ragent2-network:
    driver: bridge

# Expose only necessary ports
ports:
  - "3000:3000"    # API (behind nginx)
  # Don't expose:
  # - "5432:5432"   # DB (internal only)
  # - "6379:6379"   # Redis (internal only)
```

### 10.4. Database Security

```bash
# Strong passwords
DB_PASSWORD=$(openssl rand -base64 32)

# Restrict access (already in compose)
depends_on:
  - ragent2-db

# Backup database regularly (see section 6.2)
```

---

## 11. Quick Reference

```bash
# Startup
docker-compose -f docker-compose.prod.yml up -d

# Check status
docker-compose -f docker-compose.prod.yml ps

# Follow logs
docker-compose -f docker-compose.prod.yml logs -f

# Validate
docker-compose -f docker-compose.prod.yml exec ragent2-api npm run system:validate

# Stop
docker-compose -f docker-compose.prod.yml stop

# Restart
docker-compose -f docker-compose.prod.yml restart ragent2-api
```

---

## 12. Related Documentation

- [DOUTRINA_OPERACIONAL.md](./DOUTRINA_OPERACIONAL.md#82-cicd-github-actions--jenkins--gitlab) — Docker/Compose context
- [OPERACIONAL_CHEATSHEET.md](./OPERACIONAL_CHEATSHEET.md#produção-docker) — Quick commands
- [runtime-paths.md](./runtime-paths.md) — Path resolution details

