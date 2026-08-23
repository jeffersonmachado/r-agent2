# Requisitos para `hasValidProvider` ser `true`

Este documento explica exatamente o que é necessário para que `hasValidProvider` retorne `true` na verificação de provider de IA.

> ⚠️ **Atualizado (2026-08):** a seleção de provider é decisão da engine (roteamento engine-wide). Não existe mais `primary`/`secondary` obrigatório. Veja `docs/CONFIGURACAO_IA.md`.

## Resumo Executivo

`hasValidProvider` será `true` quando:

1. ✅ **Há ao menos um provider registrado no runtime** (a engine consegue resolver um provider para o tenant), E
2. ✅ **Ao menos um provider tem credencial salva para o tenant** (`tenant_ai_credentials`).

## Como funciona agora

`getTenantAiProviderStatus` (`api/modules/tenant/aiWorkflows.js`):

1. `getAiProviderForTenant(tenantId)` — com providers registrados, a engine devolve um provider composto que roteia entre todos.
2. `tenantAIService.getCredentialStatusMap(tenantId)` — retorna `{ providerId: boolean }` (quais providers têm chave salva).
3. `hasValidProvider = hasRegisteredProvider && hasAnyCredential`.

## Roteamento da engine

Sem config explícita por tenant, o provider composto tenta os providers registrados em ordem:
- pula provider sem credencial (`AI_PROVIDER_NOT_CONFIGURED`);
- continua em falha transitória/rate-limit/timeout;
- para em bloqueios duros (policy denial, modelo aposentado, budget).

## Exemplos

### ✅ Tenant com credencial em ao menos um provider

Providers OpenAI e DeepSeek registrados; o tenant tem chave do DeepSeek salva.

**Resultado:** `hasValidProvider = true` (a engine roteia e usa o DeepSeek).

### ❌ Nenhum provider com credencial para o tenant

Providers registrados, mas o tenant não tem nenhuma API key salva.

**Resultado:** `hasValidProvider = false`.

### ❌ Nenhum provider registrado

Nenhum provider no runtime (ex.: boot sem providers).

**Resultado:** `hasValidProvider = false` (a engine devolve `null`).

## Resumo Final

Para `hasValidProvider = true`:
- ao menos um provider registrado no runtime;
- ao menos um provider com credencial salva para o tenant (DB).
