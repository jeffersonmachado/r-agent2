# O que é Configuração Específica de Provider de IA?

## Definição

**Configuração específica** é quando um tenant tem sua própria configuração de provider de IA definida no banco de dados PostgreSQL (tabela `tenant_ai_settings`) e credenciais criptografadas na tabela `tenant_ai_credentials`.

**NOTA:** O sistema não usa mais API keys globais em `config.json`. Toda credencial é por-tenant (DB).

## Exemplo de Configuração Específica

### ✅ COM Configuração Específica

O tenant define apenas o provider (primary/secondary). As credenciais ficam no DB e nunca são exibidas.

Neste caso:
- `tenant-acme` tem configuração específica: usa OpenAI como primário e Anthropic como secundário
- `tenant-prod` tem configuração específica: usa Anthropic como primário

### ❌ SEM Configuração Específica

Sem configuração específica por tenant: o tenant será considerado sem IA configurada.

Neste caso:
- Não há seção `ai.tenants`
- Nenhum tenant tem configuração específica
- O sistema testa os providers disponíveis quando verifica

## Como Funciona no Código

### 1. Inicialização (api/services/aiProviderService.js)

```javascript
// Configura providers por tenant
// O runtime carrega a configuração do tenant do DB para memória quando necessário
await ensureTenantAiConfigLoaded(tenantId);
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
- **Exemplo**: `"tenant-acme": { "primary": "openai" }`
- **Vantagem**: Cada tenant pode usar um provider diferente
- **Obrigatório**: Não (mas recomendado)

### Provider Global (Removido)
- Não existe mais. Credenciais são sempre por-tenant (DB).

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
      "tenant-acme": { "primary": "openai" }
    }
  }
}
```

**Resultado:**
- ✅ Tenant tem configuração específica
- ✅ Sistema usa `getAiProviderForTenant('tenant-acme')`
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
