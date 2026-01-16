# O que é Configuração Específica de Provider de IA?

## Definição

**Configuração específica** é quando um tenant tem sua própria configuração de provider de IA definida no banco de dados PostgreSQL (tabela `tenant_ai_settings`) ou no arquivo `config.json` na seção `ai.tenants[tenantId]` (para compatibilidade).

**NOTA:** A configuração preferencial é via banco de dados PostgreSQL. O `config.json` é usado apenas como fallback ou para configuração inicial.

## Exemplo de Configuração Específica

### ✅ COM Configuração Específica

```json
{
  "ai": {
    "openai": {
      "apiKey": "sk-proj-..."
    },
    "anthropic": {
      "apiKey": "sk-ant-..."
    },
    "tenants": {
      "tenant-demo": {
        "primary": "openai",
        "secondary": "anthropic"
      },
      "tenant-prod": {
        "primary": "anthropic"
      }
    }
  }
}
```

Neste caso:
- `tenant-demo` tem configuração específica: usa OpenAI como primário e Anthropic como secundário
- `tenant-prod` tem configuração específica: usa Anthropic como primário

### ❌ SEM Configuração Específica

```json
{
  "ai": {
    "openai": {
      "apiKey": "sk-proj-..."
    }
  }
}
```

Neste caso:
- Não há seção `ai.tenants`
- Nenhum tenant tem configuração específica
- O sistema testa os providers disponíveis quando verifica

## Como Funciona no Código

### 1. Inicialização (api/services/aiProviderService.js)

```javascript
// Configura providers por tenant
const aiConfig = config.get('ai', {});
const tenantConfig = aiConfig.tenants || {};  // ← Seção ai.tenants

// Configura tenants específicos (apenas configurações explícitas)
for (const [tenantId, tenantAiConfig] of Object.entries(tenantConfig)) {
  if (!tenantAiConfig.primary) {
    continue;
  }
  
  setTenantAiConfig(tenantId, {
    primary: tenantAiConfig.primary,
    secondary: tenantAiConfig.secondary,
  });
}
```

### 2. Verificação (api/server.js)

```javascript
const tenantConfig = aiConfig.tenants || {};
const tenantAiConfig = tenantConfig[tenantId];  // ← Busca configuração específica

// Verifica se o tenant tem configuração específica
if (!tenantAiConfig || !tenantAiConfig.primary) {
  // NÃO TEM configuração específica
  // → Testa providers disponíveis
} else {
  // TEM configuração específica
  // → Usa a configuração do tenant
}
```

## Diferença entre Configuração Específica e Provider Global

### Configuração Específica (ai.tenants[tenantId])
- **Onde**: `config.json` → `ai.tenants[tenantId]`
- **O que define**: Qual provider cada tenant deve usar
- **Exemplo**: `"tenant-demo": { "primary": "openai" }`
- **Vantagem**: Cada tenant pode usar um provider diferente
- **Obrigatório**: Não (mas recomendado)

### Provider Global (ai.openai / ai.anthropic)
- **Onde**: `config.json` → `ai.openai.apiKey` ou `ai.anthropic.apiKey`
- **O que define**: As API keys dos providers disponíveis
- **Exemplo**: `"openai": { "apiKey": "sk-..." }`
- **Vantagem**: Configuração centralizada
- **Obrigatório**: Sim (para que os providers funcionem)

## Fluxo de Verificação

```
┌─────────────────────────────────────────┐
│ Verificação de Provider                 │
└─────────────────────────────────────────┘
              │
              ▼
    ┌─────────────────────┐
    │ Tem configuração    │
    │ específica?         │
    │ ai.tenants[id]      │
    └─────────────────────┘
              │
    ┌─────────┴─────────┐
    │                   │
    ▼                   ▼
   SIM                 NÃO
    │                   │
    ▼                   ▼
┌─────────┐      ┌──────────────┐
│ Usa     │      │ Testa todos  │
│ config  │      │ os providers │
│ do      │      │ disponíveis  │
│ tenant  │      │ (OpenAI,     │
└─────────┘      │ Anthropic)   │
                 └──────────────┘
```

## Exemplos Práticos

### Cenário 1: Tenant COM configuração específica

**config.json:**
```json
{
  "ai": {
    "openai": { "apiKey": "sk-..." },
    "tenants": {
      "tenant-demo": { "primary": "openai" }
    }
  }
}
```

**Resultado:**
- ✅ Tenant tem configuração específica
- ✅ Sistema usa `getAiProviderForTenant('tenant-demo')`
- ✅ Retorna provider OpenAI registrado

### Cenário 2: Tenant SEM configuração específica

**config.json:**
```json
{
  "ai": {
    "openai": { "apiKey": "sk-..." }
  }
}
```

**Resultado:**
- ❌ Tenant não tem configuração específica
- ✅ Sistema testa token OpenAI
- ✅ Se token válido → `hasValidProvider: true`

## Resumo

**Configuração específica** = Ter configuração no banco de dados PostgreSQL (tabela `tenant_ai_settings`) ou `ai.tenants[tenantId]` no `config.json` (fallback)

- **Com configuração específica**: Sistema usa a configuração do tenant
- **Sem configuração específica**: Sistema testa todos os providers disponíveis
