# 🔄 Sistema de Fallback - Migração PostgreSQL

Este documento lista **todas as referências a fallback** relacionadas à migração para PostgreSQL.

## 📋 Índice

1. [Inicialização do Servidor](#inicialização-do-servidor)
2. [Modo Fallback](#modo-fallback)
3. [TenantService](#tenantservice)
4. [Endpoints](#endpoints)
5. [Configuração](#configuração)
6. [Documentação](#documentação)

---

## 1. Inicialização do Servidor

### Arquivo: `api/server.js`

**Localização:** Linhas ~10750-10765

```javascript
// Inicializa banco de dados PostgreSQL (se configurado)
try {
  if (process.env.DATABASE_URL || process.env.PGHOST) {
    console.log('[Init] Conectando ao PostgreSQL...');
    logger.info('[Init] Conectando ao PostgreSQL...');
    await connect();
    defineRelationships();
    console.log('[Init] ✅ PostgreSQL conectado');
    logger.info('[Init] ✅ PostgreSQL conectado');
  } else {
    console.log('[Init] ⚠️  PostgreSQL não configurado, usando modo fallback');
    logger.warn('[Init] ⚠️  PostgreSQL não configurado, usando modo fallback');
  }
} catch (dbErr) {
  console.error('[Init] ⚠️  Erro ao conectar ao PostgreSQL, continuando em modo fallback:', dbErr.message);
  logger.warn('[Init] ⚠️  Erro ao conectar ao PostgreSQL, continuando em modo fallback:', dbErr.message);
}
```

**Comportamento:**
- ✅ Se `DATABASE_URL` ou `PGHOST` não estiverem configurados → **Modo fallback ativado**
- ✅ Se conexão falhar → **Modo fallback ativado**
- ✅ Sistema continua funcionando mesmo sem PostgreSQL
- ⚠️ Logs de warning são gerados quando em fallback

---

## 2. Modo Fallback

### Documentação: `docs/MIGRACAO_POSTGRESQL.md`

**Localização:** Seção "Modo Fallback" (linhas ~205-215)

```markdown
## Modo Fallback

Se o PostgreSQL não estiver disponível, o sistema funciona em modo fallback:

- Endpoint `/config` retorna apenas configuração global (sem IA)
- Logs de warning são gerados
- Sistema continua funcionando, mas sem dados persistentes no banco
```

**Comportamento do Fallback:**

1. **Endpoint `/config`:**
   - ✅ Retorna configuração global do `config.json`
   - ✅ **NÃO retorna** configurações de IA (já estava assim)
   - ✅ Funciona normalmente

2. **Endpoints de IA por tenant:**
   - ❌ `GET /tenants/:tenantKey/ai-config` → **Erro 500** (banco não disponível)
   - ❌ `PUT /tenants/:tenantKey/ai-config` → **Erro 500** (banco não disponível)
   - ❌ `PUT /tenants/:tenantKey/ai-credentials` → **Erro 500** (banco não disponível)

3. **Logs:**
   - ⚠️ Warning: `PostgreSQL não configurado, usando modo fallback`
   - ⚠️ Warning: `Erro ao conectar ao PostgreSQL, continuando em modo fallback`

---

## 3. TenantService

### Arquivo: `api/services/tenantService.js`

**Localização:** Linhas ~749-761

```javascript
/**
 * Lista todos os tenants.
 * Tenta usar PostgreSQL primeiro, com fallback para JSON.
 *
 * @returns {Array<Tenant>} Lista de tenants
 */
function listTenants() {
  const pgService = getTenantServicePg();
  
  // Tenta usar PostgreSQL se disponível
  if (pgService.isPostgresAvailable && pgService.isPostgresAvailable()) {
    // Retorna promise, mas para compatibilidade com código síncrono existente,
    // vamos fazer uma busca assíncrona e cachear
    // Por enquanto, retorna do JSON para manter compatibilidade
    // TODO: Migrar endpoints que usam listTenants para async
  }
  
  return Array.from(tenants.values()); // ← FALLBACK: retorna do JSON
}

/**
 * Obtém um tenant por ID.
 * Tenta usar PostgreSQL primeiro, com fallback para JSON.
 *
 * @param {string} tenantId - ID do tenant
 * @returns {Tenant|null} Tenant ou null se não encontrado
 */
function getTenant(tenantId) {
  const pgService = getTenantServicePg();
  
  // Tenta usar PostgreSQL se disponível (assíncrono, mas retorna null por enquanto para compatibilidade)
  // TODO: Migrar para async quando possível
  if (pgService.isPostgresAvailable && pgService.isPostgresAvailable()) {
    // Por enquanto, retorna do JSON para manter compatibilidade síncrona
    // Em versões futuras, isso pode ser migrado para async
  }
  
  return tenants.get(tenantId) || null; // ← FALLBACK: retorna do JSON
}
```

**Comportamento:**
- ✅ Verifica se PostgreSQL está disponível
- ✅ Se disponível → **TODO:** usar PostgreSQL (não implementado ainda)
- ✅ Se não disponível → **FALLBACK:** retorna do Map/JSON em memória
- ⚠️ **Nota:** Ainda não está totalmente migrado para PostgreSQL (mantém compatibilidade)

### Arquivo: `api/services/tenantServicePg.js`

**Localização:** Linha 5

```javascript
/**
 * Serviço de gerenciamento de Tenants usando PostgreSQL
 * 
 * Esta é uma versão que usa PostgreSQL quando disponível.
 * Usado como fallback/complemento ao tenantService.js original.
 */
```

**Funções de Fallback:**

1. **`isPostgresAvailable()`**
   ```javascript
   function isPostgresAvailable() {
     try {
       return isConnected();
     } catch (err) {
       return false; // ← FALLBACK: retorna false se houver erro
     }
   }
   ```

2. **`getTenantFromPg(tenantKey)`**
   ```javascript
   async function getTenantFromPg(tenantKey) {
     if (!isPostgresAvailable()) {
       return null; // ← FALLBACK: retorna null se PostgreSQL não disponível
     }
     // ... busca no PostgreSQL
   }
   ```

3. **`listTenantsFromPg()`**
   ```javascript
   async function listTenantsFromPg() {
     if (!isPostgresAvailable()) {
       return []; // ← FALLBACK: retorna array vazio se PostgreSQL não disponível
     }
     // ... busca no PostgreSQL
   }
   ```

4. **`saveTenantToPg(tenantData)`**
   ```javascript
   async function saveTenantToPg(tenantData) {
     if (!isPostgresAvailable()) {
       return { success: false, error: 'PostgreSQL não disponível' }; // ← FALLBACK: retorna erro
     }
     // ... salva no PostgreSQL
   }
   ```

---

## 4. Endpoints

### Arquivo: `api/server.js`

#### Endpoint: `GET /config`

**Localização:** Linhas ~6138-6197

**Comportamento:**
- ✅ **Sempre funciona** (não depende de PostgreSQL)
- ✅ Retorna configuração do `config.json`
- ✅ **NÃO retorna** segredos (API keys)
- ✅ **NÃO retorna** configurações de IA (removidas)

**Fallback:** Nenhum necessário - funciona independente do PostgreSQL

#### Endpoints de IA: `GET /tenants/:tenantKey/ai-config`

**Localização:** Linhas ~6236-6280

**Comportamento:**
- ✅ Tenta buscar do PostgreSQL
- ❌ Se PostgreSQL não disponível → **Erro 500**
- ⚠️ **Não há fallback** - endpoint requer PostgreSQL

**Código:**
```javascript
try {
  const aiConfig = await getAIConfig(tenantKey);
  // ...
} catch (err) {
  logger.error('Erro ao obter configuração de IA:', err);
  sendJson(res, 500, { error: 'Erro ao obter configuração de IA', message: err.message });
}
```

**Nota:** Estes endpoints **não têm fallback** - eles requerem PostgreSQL. Se o banco não estiver disponível, retornam erro 500.

---

## 5. Configuração

### Arquivo: `api/db/index.js`

**Localização:** Linha 23

```javascript
function getDatabaseConfig() {
  // Prioriza DATABASE_URL se disponível
  if (process.env.DATABASE_URL) {
    return {
      url: process.env.DATABASE_URL,
    };
  }
  
  // Fallback para variáveis individuais
  return {
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432', 10),
    database: process.env.PGDATABASE || 'r_agent2',
    username: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
  };
}
```

**Comportamento:**
- ✅ Prioriza `DATABASE_URL`
- ✅ **FALLBACK:** Usa variáveis individuais (`PGHOST`, `PGUSER`, etc.)
- ✅ **FALLBACK:** Valores padrão se variáveis não estiverem definidas

### Arquivo: `api/utils/config.js`

**Localização:** Linha 4

```javascript
/**
 * Gerenciador de configuração centralizado.
 * 
 * Carrega configurações de api/data/config.json com fallback para process.env.
 * Isso permite migração gradual de variáveis de ambiente para JSON.
 */
```

**Comportamento:**
- ✅ Carrega de `config.json`
- ✅ **FALLBACK:** Usa `process.env` se não encontrar no JSON
- ✅ Mapeamento de variáveis de ambiente para caminhos JSON

---

## 6. Documentação

### Arquivos que mencionam Fallback:

1. **`CHANGELOG_MIGRACAO.md`**
   - Linha 78: "Modo fallback se PostgreSQL não estiver disponível"
   - Linha 94: "Sistema funciona em modo fallback se PostgreSQL não estiver disponível"
   - Linha 96: "Dados JSON ainda são lidos como fallback"
   - Linha 104: "Migrar `tenantService.js` completamente para PostgreSQL (mantendo fallback)"

2. **`MIGRACAO_RESUMO.md`**
   - Linha 65: "Modo fallback se PostgreSQL não estiver disponível"
   - Linha 126: "Sistema funciona em modo fallback se PostgreSQL não estiver disponível"

3. **`docs/MIGRACAO_POSTGRESQL.md`**
   - Seção completa "Modo Fallback" (linhas 205-215)

4. **`docs/FRONTEND_MIGRACAO.md`**
   - Linha 371: "Fallback: Se PostgreSQL não estiver disponível, endpoints retornam erro apropriado"

---

## 📊 Resumo dos Pontos de Fallback

### ✅ Fallbacks Implementados

| Componente | Fallback | Status |
|------------|----------|--------|
| Inicialização do servidor | Continua sem PostgreSQL | ✅ Implementado |
| `GET /config` | Retorna do `config.json` | ✅ Implementado |
| `tenantService.listTenants()` | Retorna do Map/JSON | ✅ Implementado |
| `tenantService.getTenant()` | Retorna do Map/JSON | ✅ Implementado |
| Configuração de conexão | Usa variáveis individuais | ✅ Implementado |
| `config.js` | Usa `process.env` | ✅ Implementado |

### ❌ Sem Fallback (Requerem PostgreSQL)

| Componente | Comportamento | Status |
|------------|---------------|--------|
| `GET /tenants/:tenantKey/ai-config` | Erro 500 se PostgreSQL indisponível | ⚠️ Sem fallback |
| `PUT /tenants/:tenantKey/ai-config` | Erro 500 se PostgreSQL indisponível | ⚠️ Sem fallback |
| `PUT /tenants/:tenantKey/ai-credentials` | Erro 500 se PostgreSQL indisponível | ⚠️ Sem fallback |
| `tenantServicePg.*` | Retorna null/erro se PostgreSQL indisponível | ⚠️ Sem fallback |

---

## 🔍 Detalhamento por Arquivo

### `api/server.js`

**Linhas relacionadas a fallback:**
- `10760`: `logger.warn('[Init] ⚠️  PostgreSQL não configurado, usando modo fallback');`
- `10763`: `console.error('[Init] ⚠️  Erro ao conectar ao PostgreSQL, continuando em modo fallback:', dbErr.message);`
- `10764`: `logger.warn('[Init] ⚠️  Erro ao conectar ao PostgreSQL, continuando em modo fallback:', dbErr.message);`

### `api/services/tenantService.js`

**Linhas relacionadas a fallback:**
- `749-751`: `listTenants()` - retorna do JSON se PostgreSQL não disponível
- `759-761`: `getTenant()` - retorna do JSON se PostgreSQL não disponível

### `api/services/tenantServicePg.js`

**Linhas relacionadas a fallback:**
- `5`: Comentário sobre ser usado como fallback/complemento
- `12-16`: `isPostgresAvailable()` - retorna false em caso de erro
- `20-23`: `getTenantFromPg()` - retorna null se PostgreSQL não disponível
- `35-38`: `listTenantsFromPg()` - retorna array vazio se PostgreSQL não disponível
- `52-55`: `saveTenantToPg()` - retorna erro se PostgreSQL não disponível

### `api/db/index.js`

**Linhas relacionadas a fallback:**
- `23`: Comentário "Fallback para variáveis individuais"
- `25-33`: Fallback para variáveis individuais se `DATABASE_URL` não estiver definida

---

## 🎯 Recomendações

### Para Melhorar o Fallback

1. **Endpoints de IA:**
   - ⚠️ Atualmente retornam erro 500 se PostgreSQL não disponível
   - 💡 **Sugestão:** Retornar configuração vazia ou do `config.json` como fallback

2. **TenantService:**
   - ⚠️ Ainda não usa PostgreSQL mesmo quando disponível
   - 💡 **Sugestão:** Implementar uso real do PostgreSQL com fallback para JSON

3. **Logs:**
   - ✅ Já gera warnings quando em modo fallback
   - 💡 **Sugestão:** Adicionar métricas de uso de fallback

---

## 📝 Notas Finais

- O sistema foi projetado para funcionar **com ou sem PostgreSQL**
- Fallbacks garantem **zero downtime** durante a migração
- Endpoints novos de IA **requerem PostgreSQL** (sem fallback)
- Endpoints antigos continuam funcionando normalmente (com fallback)
