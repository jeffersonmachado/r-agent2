# Requisitos para `hasValidProvider` ser `true`

Este documento explica exatamente o que é necessário para que `hasValidProvider` retorne `true` na verificação de provider de IA.

## Resumo Executivo

`hasValidProvider` será `true` se **pelo menos uma** das seguintes condições for verdadeira**:

1. ✅ **Provider Específico do Tenant** - O tenant tem configuração específica E o provider está registrado
2. ✅ **Provider Global Disponível** - Há pelo menos um provider global (OpenAI ou Anthropic) com API key configurada

---

## Cenário 1: Provider Específico do Tenant

### O que é necessário:

#### 1. Configuração no `config.json`

```json
{
  "ai": {
    "openai": {
      "apiKey": "sk-..."  // ← OBRIGATÓRIO: API key do OpenAI
    },
    "tenants": {
      "tenant-demo": {    // ← ID do tenant
        "primary": "openai"  // ← OBRIGATÓRIO: Provider primário
      }
    }
  }
}
```

#### 2. Provider deve estar registrado

O provider especificado em `primary` deve estar registrado no `providerRegistry` durante a inicialização.

**Como o provider é registrado:**
- Durante `initializeAiProviders()`, o sistema tenta criar o provider OpenAI
- Se a API key existir, o provider é registrado com `registerAiProvider('openai', provider)`
- Se a API key não existir ou for inválida, o provider **NÃO** é registrado

#### 3. Verificação no código

```javascript
// 1. Busca configuração do tenant
const cfg = tenantConfig.get(tenantId);  // Deve retornar { primary: 'openai' }

// 2. Busca provider no registry
const primary = providerRegistry.get(cfg.primary);  // Deve retornar o provider

// 3. Verifica se é válido
const hasTenantProvider = provider !== null && 
                          typeof provider === 'object' && 
                          typeof provider.generate === 'function';
```

### Checklist para Provider Específico:

- [ ] `config.json` tem `ai.openai.apiKey` (ou `ai.anthropic.apiKey`)
- [ ] `config.json` tem `ai.tenants[tenantId].primary` configurado
- [ ] O provider especificado em `primary` está registrado no `providerRegistry`
- [ ] O provider tem método `generate` implementado

**Resultado:** Se todas as condições forem verdadeiras → `hasTenantProvider = true` → `hasValidProvider = true`

---

## Cenário 2: Provider Global (Fallback)

### O que é necessário:

#### 1. Configuração no `config.json`

```json
{
  "ai": {
    "openai": {
      "apiKey": "sk-..."  // ← OBRIGATÓRIO: Pelo menos um provider com API key
    }
    // NÃO precisa de ai.tenants[tenantId]
  }
}
```

**OU**

```json
{
  "ai": {
    "anthropic": {
      "apiKey": "sk-ant-..."  // ← OBRIGATÓRIO: Pelo menos um provider com API key
    }
  }
}
```

#### 2. Verificação no código

```javascript
// Se não tiver provider específico do tenant
if (!hasTenantProvider) {
  const aiConfig = config.get('ai', {});
  
  // Verifica se há pelo menos um provider com API key
  const hasOpenAI = !!(aiConfig.openai && aiConfig.openai.apiKey);
  const hasAnthropic = !!(aiConfig.anthropic && aiConfig.anthropic.apiKey);
  
  hasValidProvider = hasOpenAI || hasAnthropic;
}
```

### Checklist para Provider Global:

- [ ] `config.json` tem `ai.openai.apiKey` **OU** `ai.anthropic.apiKey`
- [ ] A API key não está vazia (`apiKey !== ''` e `apiKey !== null`)

**Resultado:** Se pelo menos uma API key existir → `hasValidProvider = true`

---

## Fluxo de Decisão Completo

```
┌─────────────────────────────────────────────────────────┐
│ Verificação de Provider                                 │
└─────────────────────────────────────────────────────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │ getAiProviderForTenant│
        │      (tenantId)       │
        └───────────────────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │ Tem configuração      │
        │ específica do tenant? │
        └───────────────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
        ▼                       ▼
   ┌─────────┐            ┌─────────┐
   │   SIM   │            │   NÃO   │
   └─────────┘            └─────────┘
        │                       │
        ▼                       ▼
┌───────────────┐      ┌──────────────────┐
│ Provider está │      │ Verifica globais │
│ registrado?   │      │                  │
└───────────────┘      └──────────────────┘
        │                       │
   ┌────┴────┐            ┌─────┴─────┐
   │         │            │           │
   ▼         ▼            ▼           ▼
 SIM       NÃO         SIM          NÃO
   │         │            │           │
   │         │            │           │
   ▼         ▼            ▼           ▼
 TRUE     FALSE        TRUE        FALSE
```

---

## Exemplos Práticos

### ✅ Exemplo 1: Provider Específico Válido

```json
{
  "ai": {
    "openai": {
      "apiKey": "sk-proj-abc123..."
    },
    "tenants": {
      "tenant-demo": {
        "primary": "openai"
      }
    }
  }
}
```

**Resultado:** `hasValidProvider = true`
- ✅ API key do OpenAI existe
- ✅ Provider OpenAI é registrado na inicialização
- ✅ Tenant tem configuração específica
- ✅ Provider primário está no registry

---

### ✅ Exemplo 2: Provider Global Válido

```json
{
  "ai": {
    "openai": {
      "apiKey": "sk-proj-abc123..."
    }
  }
}
```

**Resultado:** `hasValidProvider = true`
- ✅ API key do OpenAI existe
- ✅ Não há configuração específica do tenant, mas há provider global

---

### ❌ Exemplo 3: Sem Provider Válido

```json
{
  "ai": {
    "openai": {
      "apiKey": ""  // ← VAZIO
    }
  }
}
```

**Resultado:** `hasValidProvider = false`
- ❌ API key está vazia
- ❌ Provider não é registrado na inicialização
- ❌ Não há configuração específica do tenant

---

### ❌ Exemplo 4: Configuração Específica, mas Provider Não Registrado

```json
{
  "ai": {
    "openai": {
      "apiKey": ""  // ← VAZIO
    },
    "tenants": {
      "tenant-demo": {
        "primary": "openai"  // ← Configurado, mas provider não registrado
      }
    }
  }
}
```

**Resultado:** `hasValidProvider = false`
- ❌ API key está vazia
- ❌ Provider OpenAI não é registrado
- ✅ Tenant tem configuração específica, mas provider não existe no registry

---

## Código de Verificação (Resumido)

```javascript
// 1. Tenta provider específico
const provider = getAiProviderForTenant(tenantId);
const hasTenantProvider = provider !== null && 
                          typeof provider === 'object' && 
                          typeof provider.generate === 'function';

// 2. Se não tiver específico, verifica globais
let hasValidProvider = hasTenantProvider;

if (!hasTenantProvider) {
  const aiConfig = config.get('ai', {});
  const hasOpenAI = !!(aiConfig.openai && aiConfig.openai.apiKey);
  const hasAnthropic = !!(aiConfig.anthropic && aiConfig.anthropic.apiKey);
  hasValidProvider = hasOpenAI || hasAnthropic;
}

// 3. Retorna resultado
return { hasValidProvider, tenantId };
```

---

## Resumo Final

Para `hasValidProvider = true`, você precisa de **UMA** das seguintes opções:

### Opção A: Provider Específico
1. `ai.openai.apiKey` ou `ai.anthropic.apiKey` no `config.json`
2. `ai.tenants[tenantId].primary` configurado
3. Provider especificado está registrado

### Opção B: Provider Global
1. `ai.openai.apiKey` **OU** `ai.anthropic.apiKey` no `config.json` (não vazio)

**Nota:** A API key deve ser válida e não vazia para que o provider seja registrado durante a inicialização.
