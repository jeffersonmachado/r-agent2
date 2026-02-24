# 🔧 SOLUÇÃO: Erros em Produção - API 404 e WebSocket

## 🔍 Problemas Identificados

### Erro 1: WebSocket Connection Failed (Code 1006)
```
WebSocket connection to 'wss://www.results.com.br/r-agent2/ws' failed
```

### Erro 2: CRM API 404 Not Found
```
GET https://www.results.com.br/api/crm/accounts?limit=20&offset=0 404 (Not Found)
```

**Raiz do problema**: `VITE_API_BASE_URL` está **VAZIO** em production

---

## 🎯 Causa Raiz

No arquivo `/opt/results/ria/r-agent2/frontend/.env.local`:
```dotenv
VITE_API_BASE_URL=
```

❌ Está vazio, causando:
- Frontend não sabe para onde chamar a API
- WebSocket tenta se conectar mas não consegue
- URLs ficar inconsistentes (algumas com `/r-agent2`, outras sem)

---

## ✅ Solução: Opção 1 (Recomendada - Mais Segura)

### Para produção com prefixo `/r-agent2`:

Editar `/opt/results/ria/r-agent2/frontend/.env.local`:

```dotenv
# Production - API no mesmo domínio com prefixo /r-agent2
VITE_API_BASE_URL=https://www.results.com.br/r-agent2
```

### Efeito:
- API chamará: `https://www.results.com.br/r-agent2/api/crm/accounts` ✅
- WebSocket conectará: `wss://www.results.com.br/r-agent2/ws` ✅

---

## ✅ Solução: Opção 2 (Se API está em outro servidor)

Se a API está em outro domínio:

```dotenv
# API em servidor diferente
VITE_API_BASE_URL=https://api.results.com.br
```

### Efeito:
- API chamará: `https://api.results.com.br/api/crm/accounts` ✅
- WebSocket conectará: `wss://api.results.com.br/ws` ✅

---

## ✅ Solução: Opção 3 (Se nginx/Apache está fazendo proxy)

Se está usando proxy reverso:

```dotenv
# URL relativa - nginx/apache faz proxy automaticamente
VITE_API_BASE_URL=
```

**MAS precisa configurar nginx corretamente:**

```nginx
# /etc/nginx/sites-available/r-agent2

upstream api_backend {
    server localhost:3000;  # Porta da API
}

upstream ws_backend {
    server localhost:3000;  # Mesma porta com suporte para WebSocket
}

server {
    server_name www.results.com.br;
    listen 443 ssl;

    # ====== Frontend (React) ======
    location /r-agent2/ {
        # Serve arquivos estáticos
        alias /app/frontend/dist/;
        try_files $uri $uri/ /r-agent2/index.html;
    }

    # ====== API ======
    location /r-agent2/api/ {
        proxy_pass http://api_backend/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Prefix /r-agent2;
    }

    # ====== WebSocket ======
    location /r-agent2/ws {
        proxy_pass http://ws_backend/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }

    # ====== Health Check (sem prefixo) ======
    location /health {
        proxy_pass http://api_backend/health;
    }
}
```

---

## 🚀 Passo a Passo para Corrigir

### Passo 1: Atualizar `.env.local`
```bash
cd /opt/results/ria/r-agent2/frontend
echo "VITE_API_BASE_URL=https://www.results.com.br/r-agent2" > .env.local
```

### Passo 2: Rebuildar o Frontend
```bash
cd /opt/results/ria/r-agent2/frontend
npm install
npm run build
```

### Passo 3: Deploy os arquivos estáticos
```bash
# Copiar arquivos para o servidor web
cp -r /opt/results/ria/r-agent2/frontend/dist/* /var/www/r-agent2/
```

### Passo 4: Testar
```bash
# Verificar se a API está respondendo
curl -v https://www.results.com.br/r-agent2/api/health

# Verificar se o WebSocket está respondendo
wscat -c wss://www.results.com.br/r-agent2/ws
```

---

## 🔍 Variáveis de Ambiente Importantes

| Variável | Função | Exemplo |
|----------|--------|---------|
| `VITE_API_BASE_URL` | Base URL da API (frontend) | `https://www.results.com.br/r-agent2` |
| `VITE_API_DEV_PORT` | Porta em desenvolvimento | `3000` |
| `API_PORT` | Porta da API (backend) | `3000` |

---

## 📋 Troubleshooting

### Se ainda der erro 404 na API:

1. **Verificar se a API está respondendo:**
   ```bash
   curl http://localhost:3000/api/health
   ```

2. **Verificar se o prefixo está correto:**
   ```bash
   # Logs do browser
   # Look for: "[HTTP Client] 📍 URL construída"
   ```

3. **Ver arquivo de compilação:**
   ```bash
   # Verificar se VITE_API_BASE_URL foi compilado
   grep -r "VITE_API_BASE_URL" /opt/results/ria/r-agent2/frontend/dist/
   ```

### Se WebSocket continuar falhando:

1. **Verificar configuração do nginx:**
   ```bash
   sudo nginx -t  # Testar sintaxe
   sudo systemctl restart nginx
   ```

2. **Ver logs do nginx:**
   ```bash
   sudo tail -f /var/log/nginx/error.log
   ```

3. **Verificar se WebSocket está aberto:**
   ```bash
   curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
        https://www.results.com.br/r-agent2/ws
   ```

---

## ✨ Resultado Esperado Após Correção

### Antes (❌ Errado):
```
GET https://www.results.com.br/api/crm/accounts  404
WebSocket wss://www.results.com.br/r-agent2/ws   FAILED
```

### Depois (✅ Correto):
```
GET https://www.results.com.br/r-agent2/api/crm/accounts  200 OK
WebSocket wss://www.results.com.br/r-agent2/ws           CONNECTED
```

---

## 📝 Arquivo de Configuração Completo

**`/opt/results/ria/r-agent2/frontend/.env.production`**:
```dotenv
# Production configuration
NODE_ENV=production
VITE_API_BASE_URL=https://www.results.com.br/r-agent2
```

**`/opt/results/ria/r-agent2/.env`** (Backend):
```dotenv
# Backend URL (usado para logs/debug)
API_BASE_URL=https://www.results.com.br/r-agent2
API_EXTERNAL_URL=https://www.results.com.br/r-agent2/api
```

---

## 🚀 Aplicar Solução Agora

```bash
#!/bin/bash

cd /opt/results/ria/r-agent2

# 1. Atualizar frontend .env
echo "VITE_API_BASE_URL=https://www.results.com.br/r-agent2" > frontend/.env.local

# 2. Rebuild frontend
cd frontend
npm install
npm run build

# 3. Copiar para web root
sudo cp -r dist/* /var/www/r-agent2/

# 4. Reiniciar nginx/apache
sudo systemctl restart nginx  # ou: sudo systemctl restart apache2

echo "✅ Solução aplicada! Teste em: https://www.results.com.br/r-agent2/crm"
```

---

**Status**: PRONTO PARA IMPLEMENTAR  
**Urgência**: 🔴 CRÍTICA - Bloqueia produção  
**Tempo estimado**: 5-10 minutos

