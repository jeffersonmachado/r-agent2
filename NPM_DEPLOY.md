# 📦 Scripts NPM para Deploy

## Scripts Disponíveis

### Build de Imagens Docker

```bash
# Build de todas as imagens
npm run deploy:build

# Build individual
npm run deploy:build:frontend
npm run deploy:build:api
npm run deploy:build:rag
```

### Gerenciamento Local de Containers

```bash
# Iniciar containers
npm run deploy:up

# Parar containers
npm run deploy:down

# Reiniciar containers
npm run deploy:restart

# Ver logs
npm run deploy:logs

# Ver status
npm run deploy:status
```

### Testes

```bash
# Testar frontend localmente
npm run deploy:test
```

### Deploy Remoto

```bash
# Deploy usando docker-compose (recomendado)
npm run deploy:remote -- --host 10.10.2.30 --user root --dir /opt/results/ria/r-agent2

# Deploy usando save/load (alternativa)
npm run deploy:remote:save-load -- --host 10.10.2.30 --user root --dir /opt/results/ria/r-agent2

# Push para registry (se configurado)
npm run deploy:push -- --registry docker.io/usuario --tag v1.0.0 --latest
```

### Deploy Completo

```bash
# Build + Deploy + Teste (tudo em um comando)
npm run deploy:full
```

## Exemplos de Uso

### 1. Build e Deploy Local

```bash
# Build das imagens
npm run deploy:build

# Iniciar containers
npm run deploy:up

# Verificar status
npm run deploy:status

# Testar
npm run deploy:test
```

### 2. Deploy Remoto com Docker Compose

```bash
# Configurar variáveis de ambiente
export SSHPASS='resu100gabao'
export DEPLOY_HOST='10.10.2.30'
export DEPLOY_USER='root'
export DEPLOY_DIR='/opt/results/ria/r-agent2'

# Executar deploy
npm run deploy:remote
```

Ou com parâmetros:

```bash
npm run deploy:remote -- \
  --host 10.10.2.30 \
  --user root \
  --dir /opt/results/ria/r-agent2
```

### 3. Deploy Remoto com Save/Load

```bash
export SSHPASS='resu100gabao'
npm run deploy:remote:save-load -- \
  --host 10.10.2.30 \
  --user root \
  --dir /opt/results/ria/r-agent2
```

### 4. Workflow Completo

```bash
# 1. Desenvolvimento local
npm run dev

# 2. Build para produção
npm run deploy:build

# 3. Teste local
npm run deploy:up
npm run deploy:test

# 4. Deploy remoto
export SSHPASS='resu100gabao'
npm run deploy:remote -- --host 10.10.2.30 --user root --dir /opt/results/ria/r-agent2

# 5. Verificar logs remotos
sshpass -p 'resu100gabao' ssh root@10.10.2.30 \
  'cd /opt/results/ria/r-agent2 && docker-compose -f docker-compose.prod.yml logs -f'
```

## Variáveis de Ambiente

Você pode configurar variáveis de ambiente para evitar passar parâmetros toda vez:

```bash
# Adicione ao seu ~/.bashrc ou ~/.zshrc
export SSHPASS='resu100gabao'
export DEPLOY_HOST='10.10.2.30'
export DEPLOY_USER='root'
export DEPLOY_DIR='/opt/results/ria/r-agent2'
export DOCKER_REGISTRY='docker.io/seu-usuario'
export DOCKER_TAG='v1.0.0'
```

## Troubleshooting

### Ver todos os scripts disponíveis

```bash
npm run
```

### Ver ajuda de um script específico

```bash
./scripts/docker-deploy-compose.sh --help
```

### Ver logs em tempo real

```bash
npm run deploy:logs
```

### Verificar status dos containers

```bash
npm run deploy:status
```

### Reiniciar um serviço específico

```bash
docker-compose -f docker-compose.prod.yml restart frontend
```

## Notas

- Os scripts `deploy:remote` e `deploy:remote:save-load` requerem `sshpass` instalado
- O script `deploy:push` requer configuração de registry Docker
- Use `--` para passar argumentos para os scripts após `npm run`
