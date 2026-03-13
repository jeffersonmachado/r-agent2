# Requisitos para `hasValidProvider` ser `true`

Este documento explica exatamente o que é necessário para que `hasValidProvider` retorne `true` na verificação de provider de IA.

## Resumo Executivo

`hasValidProvider` será `true` quando:

1. ✅ **Provider do Tenant** - O tenant tem configuração específica (DB) E o provider está registrado no runtime

---

## Cenário 1: Provider Específico do Tenant

### O que é necessário:

#### 1. Configuração no banco (tenant_ai_settings)

O tenant precisa ter `primary` configurado e credenciais salvas (criptografadas) para o provider.

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

- [ ] Tenant tem `primary` configurado (DB)
- [ ] Tenant tem credenciais salvas (DB) para o provider primário
- [ ] O provider especificado em `primary` está registrado no `providerRegistry`
- [ ] O provider tem método `generate` implementado

**Resultado:** Se todas as condições forem verdadeiras → `hasTenantProvider = true` → `hasValidProvider = true`

---

## Cenário 2: Provider Global (Fallback)

**Removido.** Não há mais provider/credencial global; a configuração é sempre por tenant (DB).

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

### ✅ Exemplo: Provider do tenant válido

Tenant com `primary` configurado e credenciais salvas para esse provider (DB).

**Resultado:** `hasValidProvider = true`
- ✅ API key do OpenAI existe
- ✅ Provider OpenAI é registrado na inicialização
- ✅ Tenant tem configuração específica
- ✅ Provider primário está no registry

---

### ✅ Exemplo 2: (Removido) Provider global

Não se aplica mais.

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
      "tenant-acme": {
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
  // Fallback global removido: credenciais/configuração são por tenant (DB).
  hasValidProvider = false;
}

// 3. Retorna resultado
return { hasValidProvider, tenantId };
```

---

## Resumo Final

Para `hasValidProvider = true`, o tenant precisa ter:

- `primary` configurado (DB)
- credenciais salvas para o provider primário (DB)
- provider registrado no runtime
