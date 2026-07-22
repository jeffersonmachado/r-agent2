# @results/auth — Módulo de Autenticação por Token Opaco

Framework-agnostic. Adaptável a qualquer persistência via adapter pattern.
Local: `/opt/results/packages/auth/`

## Índice

1. [Por que token opaco em vez de JWT](#por-que-token-opaco-em-vez-de-jwt)
2. [Instalação em outro projeto](#instalação-em-outro-projeto)
3. [Uso rápido (Express)](#uso-rápido-express)
4. [API completa](#api-completa)
5. [Configuração](#configuração)
6. [Adapters](#adapters)
7. [Middleware (requireAuth / requirePermission)](#middleware-requireauth--requirepermission)
8. [Resolução de tenant](#resolução-de-tenant)
9. [Gerenciamento de senhas](#gerenciamento-de-senhas)
10. [Testes](#testes)
11. [Segurança](#segurança)

---

## Por que token opaco em vez de JWT

| Característica | Token opaco (`@results/auth`) | JWT |
|---|---|---|
| Validação | O(1) — lookup em Map | O(n) — verificação criptográfica |
| Revogação | Instantânea (remove do Map) | Precisa de blacklist |
| Inatividade | Detectada automaticamente | Não suporta nativamente |
| Superfície de ataque | Sem chave secreta exposta | Chave secreta é alvo |
| Estado no servidor | Sim (Map + DB) | Stateless (mas precisa de estado para revogação) |

---

## Instalação em outro projeto

No `package.json` do projeto consumidor:

```json
{
  "dependencies": {
    "@results/auth": "file:../../../packages/auth"
  }
}
```

O caminho relativo depende de onde seu projeto está. Exemplos:

| Seu projeto em | Caminho |
|---|---|
| `/opt/results/ria/r-agent2/` | `"file:../../packages/auth"` |
| `/opt/results/infra/` | `"file:../packages/auth"` |
| `/opt/results/novo-app/` | `"file:../../packages/auth"` |

Depois: `npm install`

---

## Uso rápido (Express)

```js
const { createAuth, SequelizeAdapter } = require('@results/auth');

// 1. Criar adapter
const adapter = new SequelizeAdapter({
    sequelize,     // instância Sequelize conectada
    User,          // model User (pode ser lazy: () => require('./models/User'))
    Session,       // model Session (idem)
    logger,        // opcional: { info, warn, error }
});

// 2. Criar instância auth
const auth = createAuth({
    adapter,
    tokenExpirationHours: 24,        // default: 24
    inactivityTimeoutMinutes: 30,    // default: 30
    maxSessionsPerAgent: 3,          // default: 3
    isSuperAdmin: (user) => user.role === 'super_admin',
    permissionChecker: (user, resource, action) => {
        // Sua lógica de RBAC
        if (user.role === 'super_admin') return true;
        return user.permissions?.includes(`${resource}:${action}`) ?? false;
    },
});

// 3. Inicializar (carrega sessões do banco)
await auth.initialize();

// 4. Rotas
app.post('/api/login', async (req, res) => {
    const result = await auth.login({
        username: req.body.username,
        password: req.body.password,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
    });

    if (!result.success) {
        return res.status(401).json({ error: result.error });
    }

    res.json({ token: result.token, user: result.user });
});

app.get('/api/me', (req, res) => {
    const authResult = auth.requireAuth(req);
    if (!authResult.valid) {
        return res.status(401).json({ error: authResult.error });
    }
    res.json({ user: req.agent, tenantId: req.tenantId });
});

app.get('/api/tickets', (req, res) => {
    if (!auth.requireAuth(req).valid) return res.status(401).json({ error: 'Não autenticado' });

    const perm = auth.requirePermission(req, 'tickets', 'read');
    if (!perm.allowed) return res.status(403).json({ error: perm.error });

    res.json({ tickets: [] });
});

app.post('/api/logout', async (req, res) => {
    const result = await auth.logout(auth.extractToken(req));
    res.json({ success: result.success });
});
```

---

## API completa

### `createAuth(options)` → `auth`

Função factory. Retorna objeto com todos os métodos.

```js
const auth = createAuth({
    adapter,              // obrigatório
    tokenLength,          // default: 64
    tokenExpirationHours, // default: 24
    inactivityTimeoutMinutes, // default: 30
    maxSessionsPerAgent,  // default: 3
    isSuperAdmin,         // (user) => boolean
    permissionChecker,    // (user, resource, action) => boolean
    resolveTenantId,      // (req) => string | null
    sessionStore,         // Map-like (default: Map em memória)
});
```

### `auth.login({ username, password, ipAddress?, userAgent? })` → `{ success, token?, user?, error? }`

Assíncrono. Cria sessão, limpa sessões antigas excedentes, retorna token opaco.

### `auth.validateToken(token)` → `{ valid, user?, session?, error? }`

**Síncrono O(1)**. Valida token, expiração e inatividade. Atualiza `lastActivityAt`.

### `auth.logout(token)` → `{ success, error? }`

Assíncrono. Remove sessão do Map e do banco.

### `auth.initialize()`

Assíncrono. Carrega sessões ativas do banco para o Map. Chame uma vez no boot.

### `auth.requireAuth(req)` → `{ valid, agent?, session?, error? }`

Síncrono. Extrai token do header, valida, anexa `req.agent`, `req.session`, `req.token`, `req.tenantId`.

### `auth.requirePermission(req, resource, action, checker?)` → `{ allowed, error? }`

Síncrono. Verifica permissão RBAC. Opcionalmente aceita um `checker` específico por chamada.

### `auth.extractToken(req)` → `string`

Extrai token do header `Authorization: Bearer <token>` ou `<token>` puro.

### `auth.sessionStore` — `Map`

Acesso direto ao Map de sessões em memória (útil para debug/monitoramento).

---

## Configuração

| Parâmetro | Default | Descrição |
|---|---|---|
| `tokenLength` | 64 | Comprimento hex do token (64 hex = 32 bytes) |
| `tokenExpirationHours` | 24 | Sessão expira após N horas da criação |
| `inactivityTimeoutMinutes` | 30 | Sessão expira após N minutos sem atividade |
| `maxSessionsPerAgent` | 3 | Máximo de sessões simultâneas por usuário |
| `isSuperAdmin` | `() => false` | Define se usuário é super admin |
| `permissionChecker` | (não definido = permite tudo) | `(user, resource, action) => boolean` |
| `resolveTenantId` | (usa `user.tenantId`) | Custom resolver para não-super-admins |

---

## Adapters

O pacote inclui dois adapters. Você pode criar o seu implementando a interface abaixo.

### SequelizeAdapter (produção)

```js
const { SequelizeAdapter } = require('@results/auth');

const adapter = new SequelizeAdapter({
    sequelize,  // instância Sequelize
    User,       // model ou lazy getter: () => require('./models/User')
    Session,    // model ou lazy getter
    logger,     // opcional
});
```

**Requisitos do model User:**
- Colunas: `id`, `username`, `password_hash`, `role`, `active`, `tenant_id` (ou `tenant_key`)
- Opcionais: `email`, `metadata`

**Requisitos do model Session:**
- Colunas: `token`, `user_id`, `username`, `created_at`, `expires_at`, `last_activity_at`, `ip_address`, `user_agent`

### MemoryAdapter (testes)

```js
const { MemoryAdapter } = require('@results/auth');

const adapter = new MemoryAdapter();
await adapter.seedUser({
    id: 'u1',
    username: 'admin',
    password: 'Admin123!',   // será hashado automaticamente
    role: 'super_admin',
    tenantId: 'system',
});
```

### Interface do Adapter (para criar o seu)

```js
class MeuAdapter {
    async findUserByUsername(username)            // → user object | null
    async verifyPassword(user, password)           // → boolean
    async createSession(session)                   // → void
    async destroySession(token)                    // → void
    async updateLastLogin(userId, date)            // → void
    async updateLastActivity(token, date)          // → void
    async loadAllSessions()                        // → session[]
}
```

---

## Middleware (requireAuth / requirePermission)

### Fluxo de autenticação

```
Requisição → extractToken(req)
           → validateToken(token) [O(1), síncrono]
           → req.agent = user
           → req.tenantId = resolve(agent, req)
           → requirePermission(req, resource, action)
```

### req.agent

Após `requireAuth`, `req.agent` contém o snapshot do usuário (sem `passwordHash`):

```js
{
    id, username, email, role, active, tenantId, metadata
}
```

### Tratamento de erro

`requireAuth` e `requirePermission` **não lançam exceções**. Retornam `{ valid/allowed: false, error }`. Você decide o código HTTP:

```js
const result = auth.requireAuth(req);
if (!result.valid) {
    return res.status(401).json({ error: 'unauthorized', message: result.error });
}
```

---

## Resolução de tenant

### Super admin

Super admins podem definir tenant via header `X-Tenant-Id`:

```http
GET /api/tickets
Authorization: Bearer <token>
X-Tenant-Id: tenant-demo
```

Se não informado, `req.tenantId = null` (visão global).

### Usuários normais

Herda `tenantId` do cadastro do usuário. Pode ser customizado com `resolveTenantId`:

```js
const auth = createAuth({
    adapter,
    resolveTenantId: (req) => req.subdomain || req.headers['x-tenant'],
});
```

---

## Gerenciamento de senhas

```js
const { hashPassword, verifyPassword } = require('@results/auth');

// Hash (bcrypt, 12 rounds)
const hash = await hashPassword('minha-senha');

// Verificação (bcrypt com fallback SHA-256)
const ok = await verifyPassword('minha-senha', hash);
```

---

## Testes

```bash
# Suite completa (21 testes)
npx jest /opt/results/packages/auth/__tests__/auth.test.js --no-coverage

# Apenas login
npx jest /opt/results/packages/auth/__tests__/auth.test.js -t "login"

# Apenas middleware
npx jest /opt/results/packages/auth/__tests__/auth.test.js -t "middleware"
```

Cobertura dos testes:

| Grupo | Testes |
|---|---|
| login | 4 (válido, senha inválida, usuário inexistente, campos vazios) |
| validateToken | 4 (válido, inexistente, vazio, null) |
| logout | 2 (logout normal, sem token) |
| middleware | 5 (auth, tenant, sem header, permissão, super_admin) |
| tenant resolution | 1 (operador herda tenantId) |
| password | 1 (hash + verify) |
| max sessions | 1 (limpeza de sessões antigas) |
| extractToken | 1 (Bearer, token puro, vazio) |
| createAuth | 2 (sem adapter, API pública) |

---

## Segurança

- **Senhas**: bcrypt (12 rounds) com fallback SHA-256 para compatibilidade
- **Tokens**: `crypto.randomBytes(32).toString('hex')` — 64 caracteres hex, 256 bits de entropia
- **Timing attack**: `verifyPassword` usa comparação em tempo constante
- **Sanitização**: `userSnapshot` remove `passwordHash`, `salt`, `invitationToken`, `passwordResetToken`
- **Sessão expirada**: removida do Map imediatamente na validação
- **Inatividade**: detectada a cada `validateToken`, sem necessidade de job
- **Double-store**: sessão no Map (O(1)) + DB (persistência); Map é fonte primária
- **Adapter failures**: `createSession`, `updateLastLogin`, `updateLastActivity` são best-effort (não bloqueiam login)
