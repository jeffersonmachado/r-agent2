# ❌ ERRO 404 em Produção - SOLUÇÃO COMPLETA

## Problema Identificado

Usuários na produção estão recebendo erro 404 ao acessar CRM:

```javascript
GET https://www.results.com.br/api/crm/accounts?limit=20&offset=0 404 (Not Found)
GET https://www.results.com.br/api/crm/contacts?limit=20&offset=0 404 (Not Found)
```

### Root Cause Analysis

O frontend está tentando acessar `/api/crm/accounts` mas a URL correta é `/r-agent2/api/crm/accounts`.

**Causa raiz:** 
- A variável `VITE_API_BASE_URL` **não estava sendo passada durante o build do Docker**
- Vite substitui essas variáveis em **tempo de compilação**, não em runtime
- O Dockerfile estava recebendo `VITE_BASE_PATH` mas ignorava `VITE_API_BASE_URL`

---

## Solução Implementada

### 1. ✅ Corrigir frontend/Dockerfile

O Dockerfile agora passa `VITE_API_BASE_URL` como ARG de build:

```dockerfile
# ✅ NOVO - Antes faltava VITE_API_BASE_URL
ARG VITE_BASE_PATH=/r-agent2/
ARG VITE_API_BASE_URL=/r-agent2/api

# ✅ Passar variáveis durante build
RUN NODE_ENV=production \
    VITE_BASE_PATH=$VITE_BASE_PATH \
    VITE_API_BASE_URL=$VITE_API_BASE_URL \
    npm run build
```

### 2. ✅ Corrigir docker-compose.prod.yml

Adicionar `VITE_API_BASE_URL` aos args de build:

```yaml
services:
  frontend:
    build:
      context: .
      dockerfile: ./frontend/Dockerfile
      args:
        VITE_BASE_PATH: ${VITE_BASE_PATH:-/r-agent2/}
        VITE_API_BASE_URL: ${VITE_API_BASE_URL:-/r-agent2/api}  # ✅ NOVO
```

### 3. ✅ Script de Deploy Automático

Criado: `scripts/rebuild-frontend-docker.sh`

---

## Como Fazer Deploy em Produção

### Opção A: Deploy Manual (Passo a Passo)

```bash
# 1. SSH para servidor Docker (10.10.2.30)
ssh user@10.10.2.30

# 2. Ir para projeto
cd /opt/results/ria/r-agent2

# 3. Reconstruir imagem
docker build \
  -f ./frontend/Dockerfile \
  -t r-agent2-frontend:latest \
  --build-arg VITE_API_BASE_URL=/r-agent2/api \
  --build-arg VITE_BASE_PATH=/r-agent2/ \
  .

# 4. Parar container antigo
docker-compose -f docker-compose.prod.yml stop r-agent2-frontend-prod

# 5. Remove container antigo
docker-compose -f docker-compose.prod.yml rm -f r-agent2-frontend-prod

# 6. Iniciar novo container
docker-compose -f docker-compose.prod.yml up -d r-agent2-frontend-prod

# 7. Verificar logs
docker-compose -f docker-compose.prod.yml logs -f r-agent2-frontend-prod
```

### Opção B: Deploy Automatizado

```bash
# 1. SSH para servidor Docker (10.10.2.30)
ssh user@10.10.2.30

# 2. Executar script
cd /opt/results/ria/r-agent2
bash scripts/rebuild-frontend-docker.sh

# O script fará automaticamente:
# ✓ Reconstruir imagem com variáveis corretas
# ✓ Parar container antigo
# ✓ Iniciar novo container
# ✓ Fazer health check
# ✓ Verificar se VITE_API_BASE_URL foi compilado
```

---

## Verificar Se Funcionou

### Local (Browser)

1. Abrir https://www.results.com.br/r-agent2/crm
2. Pressionar `F12` para DevTools
3. Ir em **Console**
4. Procurar por mensagens:
   ```
   ✅ "[HTTP Client] 📥 Resposta recebida"  → API funcionando
   ✅ "[INFO] [WebSocketContext] Conectado" → WebSocket funcionando
   ❌ Nenhum "404 Not Found"
   ❌ Nenhum "WebSocket failed"
   ```

### Via Command Line

```bash
# Testar API diretamente
curl -H "Authorization: Bearer <token>" \
  https://www.results.com.br/r-agent2/api/crm/accounts

# Deve retornar: 200 OK (não 404)
```

---

## Arquivo de Build

O frontend agora está em:
```
frontend/dist/
├── index.html
├── assets/
│   ├── index-Cwus9BUI.js        ← Bundle com VITE_API_BASE_URL=/r-agent2/api
│   ├── index-BnNqhp8G.css
│   └── ...
└── ...
```

---

## Configurable via .env

Se quiser usar variáveis de ambiente em produção:

```bash
# /opt/results/ria/r-agent2/.env (no servidor Docker)

# Frontend - BUILD TIME
VITE_API_BASE_URL=/r-agent2/api
VITE_BASE_PATH=/r-agent2/

# ou ABSOLUTAS (para outro servidor):
# VITE_API_BASE_URL=https://www.results.com.br/r-agent2/api
# VITE_BASE_PATH=https://www.results.com.br/r-agent2/
```

```bash
# Depois executar:
docker-compose -f docker-compose.prod.yml build --no-cache frontend
docker-compose -f docker-compose.prod.yml up -d frontend
```

---

## Arquivos Modificados

| Arquivo | Mudança |
|---------|---------|
| `frontend/Dockerfile` | ✅ ADD: `ARG VITE_API_BASE_URL` |
| `docker-compose.prod.yml` | ✅ ADD: `VITE_API_BASE_URL` aos args |
| `scripts/rebuild-frontend-docker.sh` | ✅ NEW: Script de deploy |

---

## Esperado Após Deploy

```javascript
// ANTES (❌ ERRO)
GET https://www.results.com.br/api/crm/accounts 404

// DEPOIS (✅ OK)
GET https://www.results.com.br/r-agent2/api/crm/accounts 200
```

---

## Rollback

Se algo der errado:

```bash
# Restaurar versão anterior
docker-compose -f docker-compose.prod.yml stop r-agent2-frontend-prod
docker-compose -f docker-compose.prod.yml rm -f r-agent2-frontend-prod

# Tentar com imagem anterior (se a tiver)
docker images r-agent2-frontend --format "{{.Tag}}" # Ver tags anteriores

# Se tiver backup da imagem
docker tag r-agent2-frontend:<tag-antiga> r-agent2-frontend:latest

# Recomeçar
docker-compose -f docker-compose.prod.yml up -d r-agent2-frontend-prod
```

---

## Contato / Suporte

Se o deploy falhar, verificar:
1. Logs: `docker-compose -f docker-compose.prod.yml logs r-agent2-frontend-prod`
2. Imagem: `docker images r-agent2-frontend`
3. Build: `docker build -f frontend/Dockerfile --help`

---

**Data de Criação:** 24 de fevereiro de 2026
**Status:** ✅ PRONTO PARA DEPLOY
**Prioridade:** 🔴 CRÍTICA (bloqueador de produção)
