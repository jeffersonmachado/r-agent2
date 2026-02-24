# 🔴 Erro 403 Tenant em Produção - Root Cause Analysis

## Problema

Frontend em produção recebe erro 403 ao tentar fazer login:

```
POST https://www.results.com.br/r-agent2/api/auth/login 403 (Forbidden)
{
  "error": "tenant_validation_failed",
  "message": "tenant_id é obrigatório. Forneça via JWT, header X-Tenant-Id ou query parameter tenant_id"
}
```

Erro vem do middleware `tenantValidation.js` linha 77.

WebSocket também falha com code 1006 (conexão fechada) - mesma causa.

---

## Root Cause

### Bug Localizado: `/api/server.js` linha 4114

O código verifica se uma rota é uma "auth route" (rotas públicas que não precisam de tenant):

```javascript
// Lines 4107-4114
const authRoutes = ['/auth/login', '/auth/rpa/login', '/auth/accept-invitation', '/auth/request-password-reset', '/auth/reset-password'];
const isAuthRoute = authRoutes.some(route => pathname === route || pathname.startsWith(route + '/'));
```

### O Problema

Quando o frontend faz requisição via **nginx/apache com prefixo `/r-agent2`**:

- **Request URL fornecida**: `POST /r-agent2/api/auth/login`
- **`pathname` extraído em `server.js`**: `/r-agent2/api/auth/login` ❌
- **Esperado em `authRoutes`**: `/auth/login`

| Verificação | Resultado |
|------------|-----------|
| `/r-agent2/api/auth/login === /auth/login` | FALSE ❌ |
| `/r-agent2/api/auth/login`.startsWith('/auth/login/') | FALSE ❌ |

**Resultado**: `isAuthRoute = FALSE`

### Cascata de Erros

1. `isAuthRoute` = FALSE
2. Middleware `tenantRateLimitMiddleware` é chamado (linha 4124)
3. `tenantRateLimitMiddleware` chama `requireTenant()` do `tenantValidation.js`
4. `requireTenant()` não encontra `tenant_id` (usuário não autenticado ainda)
5. Retorna 403 com mensagem: "tenant_id é obrigatório"

---

## Solução

### Opção A: Remover Prefixo do URL (RECOMENDADO)

**Arquivo**: `api/server.js` linha 4100-4114

Antes do processamento:

```javascript
async function requestHandler(req, res) {
  const method = (req.method || 'GET').toUpperCase();
  const url = new URL(req.url || '/', 'http://localhost');
  const { pathname } = url;

  // ... resto do código
```

**Corrigir para**:

```javascript
async function requestHandler(req, res) {
  const method = (req.method || 'GET').toUpperCase();
  const url = new URL(req.url || '/', 'http://localhost');
  let { pathname } = url;

  // Remove prefixo /r-agent2 se presente (quando servido via nginx/apache)
  if (pathname.startsWith('/r-agent2/')) {
    pathname = pathname.substring('/r-agent2/length); // Remove "/r-agent2/"
    pathname = `/${pathname}`; // Garante que começa com /
  }

  // ... resto do código
```

### Opção B: Atualizar Listas de Rotas

Adicionar `/r-agent2` aos prefixos nas linhas 4108-4112:

```javascript
const publicRoutes = [
  '/health', '/health/db', '/version', '/system/status', '/system/websocket',
  '/r-agent2/health', '/r-agent2/health/db', '/r-agent2/version', // ❌ NÃO RECOMENDADO
  // ... resto
];
const authRoutes = [
  '/auth/login', '/auth/rpa/login', '/auth/accept-invitation', '/auth/request-password-reset', '/auth/reset-password',
  '/r-agent2/auth/login', '/r-agent2/auth/rpa/login', // ❌ NÃO RECOMENDADO
  // ... resto
];
```

⚠️ **Problema**: Duplica código, dificulta manutenção, quebra se outro prefixo for usado (ex: `/crm` em outro deploy).

---

## Implementação Recomendada

Usar Opção A porque:
- ✅ Clean - centraliza lógica de prefixo em um lugar
- ✅ Escalável - funciona com qualquer prefixo (`/crm`, `/api`, etc)
- ✅ Único source of truth - não duplica rotas
- ✅ Mantém compatibilidade - ainda funciona sem prefixo (localhost)

---

## Verificação Após Fix

Após aplicar a correção em `/api/server.js`:

1. **Rebuild/redeploy**:
   ```bash
   npm run deploy:remote:ssh -- --api-only
   ```

2. **Testar login**:
   ```bash
   curl -X POST https://www.results.com.br/r-agent2/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"admin","password":"Admin123!"}'
   ```

3. **Resultado esperado**: 200 OK com token (não 403)

4. **WebSocket no browser**: 
   - DevTools → Console
   - Procurar por: `[INFO] [WebSocketContext] Conectado`

---

## Arquivos Afetados

| Arquivo | Linhas | Ação |
|---------|--------|------|
| `api/server.js` | 4101-4114 | Remover prefixo de `pathname` antes de usar |
| `frontend/.env.local` | N/A | ✅ Já corrigido (VITE_API_BASE_URL=/r-agent2/api) |
| `frontend/Dockerfile` | 18-20 | ✅ Já corrigido (ADD VITE_API_BASE_URL arg) |
| `docker-compose.prod.yml` | 109-120 | ✅ Já corrigido (VITE_API_BASE_URL arg) |
| `scripts/docker-deploy.sh` | 683 | ✅ Já corrigido (ADD VITE_API_BASE_URL build arg) |

---

## Timeline

| Data | Hora | Evento |
|------|------|--------|
| 24/02/2026 | 09:28 | Frontend em produção tenta login → Error 403 |
| 24/02/2026 | 09:39 | Logs mostram: "tenant_id é obrigatório" |
| 24/02/2026 | 10:XX | Root cause identificado: prefixo /r-agent2 não é removido do pathname |
| 24/02/2026 | 10:XX | **Solução pronta para implementar** |

---

## Prioridade

🔴 **CRÍTICA** - Bloqueador de produção (usuários não conseguem fazer login)

---

## Próximas Ações

1. Implementar fix em `api/server.js` (Opção A)
2. Fazer rebuild da API:
   ```bash
   npm run deploy:remote:ssh -- --api-only
   ```
3. Aguardar redeploy (~5 minutos)
4. Testar login em produção
5. Monitorar logs por 30 minutos para confirmar estabilidade
