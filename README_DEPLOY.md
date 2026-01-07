# 🚀 Guia Rápido de Deploy em Produção

## Fluxo Completo

### 1. Na Máquina de Desenvolvimento

```bash
# 1.1. Build e Push das Imagens para Docker Hub
./scripts/docker-push.sh \
  --registry docker.io/seu-usuario \
  --tag v1.0.0 \
  --latest

# Isso irá:
# - Construir as 3 imagens (api, frontend, rag-service)
# - Fazer tag com a versão
# - Fazer push para o Docker Hub
```

### 2. No Servidor de Produção

```bash
# 2.1. Deploy Automatizado (da máquina de desenvolvimento)
./scripts/docker-deploy-remote.sh \
  --host seu-servidor.com \
  --user root \
  --registry docker.io/seu-usuario \
  --tag v1.0.0

# Isso irá:
# - Conectar ao servidor via SSH
# - Copiar arquivos necessários
# - Fazer pull das imagens do registry
# - Iniciar os serviços
```

## Alternativa: Deploy Manual

### Na Máquina de Desenvolvimento

```bash
# Build e push
docker build -t seu-usuario/r-agent2-api:v1.0.0 -f api/Dockerfile .
docker push seu-usuario/r-agent2-api:v1.0.0

docker build -t seu-usuario/r-agent2-frontend:v1.0.0 -f frontend/Dockerfile ./frontend
docker push seu-usuario/r-agent2-frontend:v1.0.0

docker build -t seu-usuario/r-agent2-rag-service:v1.0.0 -f rag-service/Dockerfile ./rag-service
docker push seu-usuario/r-agent2-rag-service:v1.0.0
```

### No Servidor

```bash
# Conectar ao servidor
ssh root@seu-servidor.com

# Criar diretório
mkdir -p /opt/r-agent2
cd /opt/r-agent2

# Copiar arquivos (da máquina de desenvolvimento)
# scp docker-compose.prod.yml root@seu-servidor.com:/opt/r-agent2/
# scp env.example root@seu-servidor.com:/opt/r-agent2/

# Configurar .env
cp env.example .env
nano .env  # Editar configurações

# Editar docker-compose.prod.yml para usar as imagens do registry
nano docker-compose.prod.yml
# Alterar:
#   image: r-agent2-api:latest
# Para:
#   image: seu-usuario/r-agent2-api:v1.0.0

# Fazer pull das imagens
docker pull seu-usuario/r-agent2-api:v1.0.0
docker pull seu-usuario/r-agent2-frontend:v1.0.0
docker pull seu-usuario/r-agent2-rag-service:v1.0.0

# Iniciar serviços
docker-compose -f docker-compose.prod.yml up -d

# Verificar status
docker-compose -f docker-compose.prod.yml ps
docker-compose -f docker-compose.prod.yml logs -f
```

## Verificação

```bash
# Testar endpoints
curl http://seu-servidor.com:3000/health  # API
curl http://seu-servidor.com:8080          # Frontend
curl http://seu-servidor.com:8000/health   # RAG Service
```

## Atualização

Para atualizar para uma nova versão:

```bash
# 1. Build e push da nova versão
./scripts/docker-push.sh --registry docker.io/seu-usuario --tag v1.1.0 --latest

# 2. Deploy no servidor
./scripts/docker-deploy-remote.sh \
  --host seu-servidor.com \
  --user root \
  --registry docker.io/seu-usuario \
  --tag v1.1.0
```

## Documentação Completa

- **Deploy Local**: [docs/DOCKER_DEPLOY.md](docs/DOCKER_DEPLOY.md)
- **Deploy Produção**: [docs/DEPLOY_PRODUCAO.md](docs/DEPLOY_PRODUCAO.md)

