# 🚀 Guia de Publicação em Servidor de Produção

Este guia descreve como publicar a plataforma R-Agent2 em um servidor Docker de produção remoto.

## 📋 Índice

- [Visão Geral](#visão-geral)
- [Pré-requisitos](#pré-requisitos)
- [Opções de Publicação](#opções-de-publicação)
- [Opção 1: Docker Hub (Recomendado)](#opção-1-docker-hub-recomendado)
- [Opção 2: Registry Privado](#opção-2-registry-privado)
- [Opção 3: Build no Servidor](#opção-3-build-no-servidor)
- [Configuração do Servidor](#configuração-do-servidor)
- [Deploy Automatizado](#deploy-automatizado)
- [Verificação e Monitoramento](#verificação-e-monitoramento)
- [Troubleshooting](#troubleshooting)

## Visão Geral

O processo de publicação em servidor de produção envolve:

1. **Build** das imagens Docker (na máquina de desenvolvimento)
2. **Push** das imagens para um registry (Docker Hub ou privado)
3. **Pull** das imagens no servidor de produção
4. **Deploy** dos serviços usando docker-compose

## Pré-requisitos

### Na Máquina de Desenvolvimento

- Docker instalado e funcionando
- Acesso ao registry (Docker Hub ou registry privado)
- SSH configurado para acesso ao servidor de produção

### No Servidor de Produção

- Docker instalado (versão 20.10+)
- Docker Compose instalado (ou Docker com suporte a `docker compose`)
- Acesso SSH configurado
- Portas abertas no firewall (3000, 8000, 8080, 6379)
- Espaço em disco suficiente (mínimo 20GB recomendado)

## Opções de Publicação

### Comparação das Opções

| Opção | Prós | Contras | Quando Usar |
|-------|------|---------|-------------|
| **Docker Hub** | Fácil, gratuito, rápido | Público (ou pago para privado) | Projetos pequenos/médios |
| **Registry Privado** | Seguro, controle total | Requer infraestrutura | Empresas, projetos sensíveis |
| **Build no Servidor** | Sem registry necessário | Mais lento, requer código no servidor | Ambientes isolados |

## Opção 1: Docker Hub (Recomendado)

### Passo 1: Configurar Docker Hub

1. **Criar conta no Docker Hub** (se não tiver): https://hub.docker.com

2. **Fazer login localmente:**
   ```bash
   docker login
   ```

3. **Criar repositórios no Docker Hub:**
   - `seu-usuario/r-agent2-api`
   - `seu-usuario/r-agent2-frontend`
   - `seu-usuario/r-agent2-rag-service`

### Passo 2: Build e Push das Imagens

```bash
# Build e push com tag específica
./scripts/docker-push.sh \
  --registry docker.io/seu-usuario \
  --tag v1.0.0 \
  --latest

# Ou usando variáveis de ambiente
export DOCKER_REGISTRY="docker.io/seu-usuario"
export DOCKER_TAG="v1.0.0"
./scripts/docker-push.sh --latest
```

**O script irá:**
- Construir as 3 imagens (api, frontend, rag-service)
- Fazer tag com a versão especificada
- Fazer tag como `latest` (opcional)
- Fazer push para o Docker Hub

### Passo 3: Deploy no Servidor

```bash
# Deploy automatizado
./scripts/docker-deploy-remote.sh \
  --host seu-servidor.com \
  --user root \
  --registry docker.io/seu-usuario \
  --tag v1.0.0

# Ou usando variáveis de ambiente
export DEPLOY_HOST="seu-servidor.com"
export DEPLOY_USER="root"
export DOCKER_REGISTRY="docker.io/seu-usuario"
export DOCKER_TAG="v1.0.0"
./scripts/docker-deploy-remote.sh
```

**O script irá:**
- Conectar ao servidor via SSH
- Copiar arquivos necessários (docker-compose.prod.yml, .env)
- Criar script de deploy no servidor
- Fazer pull das imagens do registry
- Iniciar os serviços

## Opção 2: Registry Privado

### Passo 1: Configurar Registry Privado

Exemplos de registries privados:
- **Harbor**: https://goharbor.io
- **GitLab Container Registry**: Integrado ao GitLab
- **AWS ECR**: Amazon Elastic Container Registry
- **Azure Container Registry**: Azure ACR
- **Google Container Registry**: GCR

### Passo 2: Build e Push

```bash
# Exemplo com Harbor
./scripts/docker-push.sh \
  --registry harbor.empresa.com/r-agent2 \
  --tag v1.0.0 \
  --latest

# Exemplo com GitLab
./scripts/docker-push.sh \
  --registry registry.gitlab.com/empresa/r-agent2 \
  --tag v1.0.0 \
  --latest

# Exemplo com AWS ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin 123456789.dkr.ecr.us-east-1.amazonaws.com

./scripts/docker-push.sh \
  --registry 123456789.dkr.ecr.us-east-1.amazonaws.com/r-agent2 \
  --tag v1.0.0 \
  --latest
```

### Passo 3: Deploy no Servidor

```bash
# Deploy com registry privado
./scripts/docker-deploy-remote.sh \
  --host seu-servidor.com \
  --user root \
  --registry harbor.empresa.com/r-agent2 \
  --tag v1.0.0
```

**Nota:** O servidor precisa ter acesso ao registry privado. Configure autenticação conforme necessário.

## Opção 3: Build no Servidor

Esta opção faz o build diretamente no servidor de produção.

### Passo 1: Copiar Código para o Servidor

```bash
# Criar arquivo .tar.gz com o código
tar --exclude='node_modules' \
    --exclude='.git' \
    --exclude='coverage' \
    --exclude='dist' \
    -czf r-agent2.tar.gz .

# Copiar para o servidor
scp r-agent2.tar.gz root@seu-servidor.com:/opt/

# No servidor, extrair
ssh root@seu-servidor.com
cd /opt
tar -xzf r-agent2.tar.gz
cd r-agent2
```

### Passo 2: Build e Deploy no Servidor

```bash
# No servidor
cd /opt/r-agent2

# Configurar .env
cp env.example .env
nano .env  # Editar configurações

# Build e deploy
docker-compose -f docker-compose.prod.yml up -d --build
```

## Configuração do Servidor

### Preparação Inicial

```bash
# Conectar ao servidor
ssh root@seu-servidor.com

# Atualizar sistema
apt update && apt upgrade -y

# Instalar Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Instalar Docker Compose
apt install docker-compose -y
# ou
pip install docker-compose

# Adicionar usuário ao grupo docker (se não for root)
usermod -aG docker $USER
newgrp docker

# Verificar instalação
docker --version
docker-compose --version
```

### Configurar Firewall

```bash
# UFW (Ubuntu)
ufw allow 22/tcp    # SSH
ufw allow 3000/tcp  # API
ufw allow 8000/tcp  # RAG Service
ufw allow 8080/tcp  # Frontend
ufw allow 6379/tcp  # Redis (se exposto)
ufw enable
```

### Criar Diretório de Deploy

```bash
mkdir -p /opt/r-agent2
chmod 755 /opt/r-agent2
```

## Deploy Automatizado

### Usando Scripts

O método mais simples é usar os scripts fornecidos:

```bash
# 1. Build e push (na máquina de desenvolvimento)
./scripts/docker-push.sh --registry docker.io/seu-usuario --tag v1.0.0 --latest

# 2. Deploy no servidor
./scripts/docker-deploy-remote.sh \
  --host seu-servidor.com \
  --user root \
  --registry docker.io/seu-usuario \
  --tag v1.0.0
```

### Deploy Manual

Se preferir fazer manualmente:

```bash
# 1. Na máquina de desenvolvimento - Build e push
docker build -t seu-usuario/r-agent2-api:v1.0.0 -f api/Dockerfile .
docker push seu-usuario/r-agent2-api:v1.0.0

docker build -t seu-usuario/r-agent2-frontend:v1.0.0 -f frontend/Dockerfile ./frontend
docker push seu-usuario/r-agent2-frontend:v1.0.0

docker build -t seu-usuario/r-agent2-rag-service:v1.0.0 -f rag-service/Dockerfile ./rag-service
docker push seu-usuario/r-agent2-rag-service:v1.0.0

# 2. No servidor - Pull e deploy
ssh root@seu-servidor.com

cd /opt/r-agent2

# Editar docker-compose.prod.yml para usar as imagens corretas
nano docker-compose.prod.yml

# Fazer pull
docker pull seu-usuario/r-agent2-api:v1.0.0
docker pull seu-usuario/r-agent2-frontend:v1.0.0
docker pull seu-usuario/r-agent2-rag-service:v1.0.0

# Deploy
docker-compose -f docker-compose.prod.yml up -d
```

## Verificação e Monitoramento

### Verificar Status

```bash
# No servidor
cd /opt/r-agent2
docker-compose -f docker-compose.prod.yml ps

# Ver logs
docker-compose -f docker-compose.prod.yml logs -f

# Ver logs de um serviço específico
docker-compose -f docker-compose.prod.yml logs -f api
```

### Testar Endpoints

```bash
# API
curl http://seu-servidor.com:3000/health

# Frontend
curl http://seu-servidor.com:8080

# RAG Service
curl http://seu-servidor.com:8000/health
```

### Monitoramento de Recursos

```bash
# Uso de recursos
docker stats

# Espaço em disco
df -h
docker system df

# Logs do sistema
journalctl -u docker -f
```

## Troubleshooting

### Problema: Erro de autenticação no registry

**Solução:**
```bash
# Fazer login novamente
docker login seu-registry.com

# Verificar credenciais
cat ~/.docker/config.json
```

### Problema: Imagens não encontradas no pull

**Solução:**
```bash
# Verificar se as imagens foram publicadas
docker search seu-usuario/r-agent2-api

# Verificar tags
curl https://hub.docker.com/v2/repositories/seu-usuario/r-agent2-api/tags/
```

### Problema: Servidor não consegue fazer pull

**Solução:**
```bash
# No servidor, fazer login no registry
docker login seu-registry.com

# Verificar conectividade
ping seu-registry.com
curl https://seu-registry.com/v2/
```

### Problema: Porta já em uso

**Solução:**
```bash
# Verificar o que está usando a porta
netstat -tulpn | grep :3000

# Parar processo ou mudar porta no docker-compose.prod.yml
```

### Problema: Containers não iniciam

**Solução:**
```bash
# Ver logs detalhados
docker-compose -f docker-compose.prod.yml logs

# Verificar recursos
docker stats

# Verificar volumes
docker volume ls
docker volume inspect r-agent2_api-data
```

## Atualização de Versão

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

O script automaticamente:
- Para os containers antigos
- Faz pull das novas imagens
- Inicia os novos containers

## Backup e Restauração

### Backup

```bash
# No servidor
cd /opt/r-agent2

# Backup dos volumes
docker run --rm \
  -v r-agent2_api-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/api-data-$(date +%Y%m%d).tar.gz /data
```

### Restauração

```bash
# Parar serviços
docker-compose -f docker-compose.prod.yml down

# Restaurar volume
docker run --rm \
  -v r-agent2_api-data:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/api-data-20240101.tar.gz -C /

# Reiniciar serviços
docker-compose -f docker-compose.prod.yml up -d
```

## Segurança

### Recomendações

1. **Use HTTPS**: Configure um proxy reverso (Nginx/Traefik) com SSL
2. **Autenticação**: Configure autenticação no registry privado
3. **Firewall**: Restrinja acesso às portas
4. **Secrets**: Use Docker secrets ou variáveis de ambiente seguras
5. **Updates**: Mantenha Docker e imagens atualizados

### Exemplo com Nginx + SSL

```nginx
server {
    listen 443 ssl;
    server_name seu-servidor.com;

    ssl_certificate /etc/ssl/certs/cert.pem;
    ssl_certificate_key /etc/ssl/private/key.pem;

    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /api/ {
        proxy_pass http://localhost:3000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Próximos Passos

- Configure CI/CD para deploy automático
- Configure monitoramento (Prometheus, Grafana)
- Configure alertas
- Configure backup automático
- Configure escalabilidade horizontal (se necessário)

---

**Última atualização:** $(date)

