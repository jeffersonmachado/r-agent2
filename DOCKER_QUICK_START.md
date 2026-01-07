# 🐳 Docker - Início Rápido

## Publicação Local (Desenvolvimento)

### 1. Configuração Inicial

```bash
# Copiar arquivo de ambiente
cp env.example .env

# Editar variáveis necessárias (especialmente OPENAI_API_KEY)
nano .env
```

### 2. Deploy Automatizado

```bash
# Desenvolvimento
./scripts/docker-deploy.sh --dev --build

# Produção local
./scripts/docker-deploy.sh --prod --build
```

### 3. Acessar Aplicação

- **Frontend**: http://localhost:8080
- **API**: http://localhost:3000
- **RAG Service**: http://localhost:8000

## Publicação em Servidor de Produção

### Opção 1: Docker Hub (Recomendado)

```bash
# 1. Build e push das imagens
./scripts/docker-push.sh \
  --registry docker.io/seu-usuario \
  --tag v1.0.0 \
  --latest

# 2. Deploy no servidor
./scripts/docker-deploy-remote.sh \
  --host seu-servidor.com \
  --user root \
  --registry docker.io/seu-usuario \
  --tag v1.0.0
```

### Opção 2: Build no Servidor

```bash
# Copiar código e fazer build diretamente no servidor
# (ver documentação completa)
```

## Comandos Essenciais

### Local
```bash
# Ver logs
docker-compose logs -f

# Parar serviços
docker-compose down

# Reiniciar
docker-compose restart

# Status
docker-compose ps
```

### Servidor Remoto
```bash
# Ver logs
ssh root@seu-servidor.com 'cd /opt/r-agent2 && docker-compose -f docker-compose.prod.yml logs -f'

# Status
ssh root@seu-servidor.com 'cd /opt/r-agent2 && docker-compose -f docker-compose.prod.yml ps'
```

## Documentação Completa

- **Deploy Local**: [docs/DOCKER_DEPLOY.md](docs/DOCKER_DEPLOY.md)
- **Deploy Produção**: [docs/DEPLOY_PRODUCAO.md](docs/DEPLOY_PRODUCAO.md)

