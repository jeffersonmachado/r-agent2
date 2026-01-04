# Rate Limiting - Sistema de Controle de Taxa

## 📋 Visão Geral

Sistema completo de rate limiting para proteger o sistema contra abuso, controlar custos e garantir conformidade legal (especialmente em scraping).

## 🏗️ Arquitetura

```
┌─────────────────────────────────────────┐
│         Frontend (UI)                    │
│  - Exibe erro 429 com retryAfter        │
│  - Desabilita botão temporariamente     │
└──────────────┬──────────────────────────┘
               │ HTTP 429
┌──────────────▼──────────────────────────┐
│         API (server.js)                  │
│  - Trata erro de rate limit             │
│  - Retorna HTTP 429                      │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│    Orquestrador (generate-and-validate) │
│  - ETAPA 0: Rate Limiting               │
│  - Bloqueia ANTES de qualquer execução  │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│    Rate Limiting Engine                  │
│  - infra/rate-limit/index.js            │
│  - Aplica políticas                     │
│  - Registra auditoria                   │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│         Redis                            │
│  - Armazena contadores                  │
│  - Prefixo: rl:                         │
└─────────────────────────────────────────┘
```

## 📁 Estrutura de Arquivos

```
infra/
├── redis/
│   └── rateLimitClient.js      # Cliente Redis dedicado
└── rate-limit/
    ├── index.js                 # Engine genérica
    ├── policies.js              # Políticas configuráveis
    ├── scraping.js              # Rate limiting específico para scraping
    └── README.md                # Este arquivo
```

## 🔧 Configuração

### Config.json (Recomendado)

A configuração principal está em `api/data/config.json`:

```json
{
  "rateLimit": {
    "redis": {
      "url": "redis://localhost:6379"
    },
    "policies": {
      "dryRun": {
        "points": 50,
        "duration": 60
      },
      "generation": {
        "points": 5,
        "duration": 60
      },
      "bootstrap": {
        "points": 1,
        "duration": 300
      },
      "scraping": {
        "points": 10,
        "duration": 300,
        "requestsPerSecond": 3,
        "pagesPerExecution": 20
      },
      "systemValidate": {
        "points": 10,
        "duration": 60
      }
    }
  }
}
```

### Variáveis de Ambiente (Fallback)

As variáveis de ambiente são usadas apenas como fallback se não estiverem no `config.json`:

```bash
# Redis (obrigatório em produção)
RATE_LIMIT_REDIS_URL=redis://localhost:6379
REDIS_URL=redis://localhost:6379

# Políticas (opcional, valores padrão abaixo)
RATE_LIMIT_DRY_RUN_POINTS=50
RATE_LIMIT_DRY_RUN_DURATION=60
RATE_LIMIT_GENERATION_POINTS=5
RATE_LIMIT_GENERATION_DURATION=60
RATE_LIMIT_BOOTSTRAP_POINTS=1
RATE_LIMIT_BOOTSTRAP_DURATION=300
RATE_LIMIT_SCRAPING_POINTS=10
RATE_LIMIT_SCRAPING_DURATION=300
RATE_LIMIT_SCRAPING_RPS=3
RATE_LIMIT_SCRAPING_PAGES=20
```

**Ordem de precedência:**
1. `config.json` (prioridade)
2. Variáveis de ambiente (fallback)
3. Valores padrão (hardcoded)

### Docker Compose

Redis já configurado em `docker-compose.yml`:

```yaml
redis:
  image: redis:7-alpine
  container_name: chatbot-redis
  ports:
    - "6379:6379"
  volumes:
    - redis-data:/data
```

## 📊 Políticas Padrão

| Tipo de Operação | Pontos | Duração | Descrição |
|------------------|--------|---------|-----------|
| DRY_RUN | 50 | 60s | Testes (mais permissivo) |
| GENERATION_REAL | 5 | 60s | Execuções reais (restritivo) |
| BOOTSTRAP | 1 | 300s | Operações críticas (muito restritivo) |
| SCRAPING | 10 | 300s | Requisições de scraping |
| SCRAPING_DOMAIN | 3 | 1s | Requisições por segundo por domínio |
| SCRAPING_EXECUTION | 20 | 3600s | Páginas por execução |

## 🔄 Fluxo de Execução

### 1. Geração e Validação

```javascript
// ETAPA 0: Rate Limiting (ANTES de tudo)
const operationType = isDryRun ? 'DRY_RUN' : isBootstrap ? 'BOOTSTRAP' : 'GENERATION_REAL';
await enforceRateLimit({ userId, operationType });

// ETAPA 1: Validação de contrato
// ETAPA 2: Validação de governança
// ETAPA 3: Execução de IA
// ...
```

### 2. Scraping

```javascript
// Rate limiting por domínio e execução
await enforceScrapingRateLimit({
  url,
  executionId,
  userId,
});
```

## 🚨 Tratamento de Erros

### Backend

```javascript
// Erro padronizado
{
  code: 'RATE_LIMIT_EXCEEDED',
  retryAfter: 120, // segundos
  statusCode: 429
}
```

### Frontend

```javascript
// HTTP 429
{
  error: 'rate_limit_exceeded',
  message: 'Rate limit excedido',
  retryAfter: 120
}
```

### UI

- Mensagem clara: "Limite de execuções atingido. Tente novamente em X segundos."
- Botão desabilitado temporariamente
- Sem retry automático

## 📝 Auditoria

Todos os eventos são registrados em `reports/rate-limit-events.json`:

```json
{
  "timestamp": "2025-01-01T12:00:00.000Z",
  "userId": "user-123",
  "operationType": "GENERATION_REAL",
  "policy": { "points": 5, "duration": 60 },
  "blocked": false,
  "retryAfter": null,
  "remainingPoints": 4,
  "totalPoints": 5
}
```

## 🔍 Monitoramento

### Verificar Status do Redis

```bash
docker exec -it chatbot-redis redis-cli ping
```

### Ver Chaves de Rate Limiting

```bash
docker exec -it chatbot-redis redis-cli KEYS "rl:*"
```

### Ver Contador Específico

```bash
docker exec -it chatbot-redis redis-cli GET "rl:GENERATION_REAL:user-123:GENERATION_REAL"
```

## ⚠️ Regras Críticas

1. ❌ **Nenhuma execução sem rate limit**
2. ❌ **Nenhum scraping sem rate limit**
3. ❌ **Nenhum retry automático silencioso**
4. ✅ **Tudo auditável**

## 🧪 Testes

### Testar Rate Limiting

```javascript
// Exceder limite
for (let i = 0; i < 10; i++) {
  try {
    await enforceRateLimit({ userId: 'test', operationType: 'GENERATION_REAL' });
  } catch (err) {
    console.log('Rate limit excedido:', err.retryAfter);
  }
}
```

## 📚 Referências

- [rate-limiter-flexible](https://github.com/animir/node-rate-limiter-flexible)
- [ioredis](https://github.com/redis/ioredis)
- [PROJECT_RULES.md](../../PROJECT_RULES.md#rate-limiting)

