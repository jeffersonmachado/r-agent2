# URA Debug

## Quando usar

- queda de `confidence`
- aumento de `fallback`
- timeout no provider de contexto/RAG

## Como validar

- consultar `/api/admin/tenant/:id/ura/audit`
- verificar `providerStatus`, `ragUsed`, `contextUsedSummary`

## Como reverter

- desligar `ura_rag_enabled` ou `ura_ai_enabled` via feature flag do tenant
- manter fallback por regras/menu ativo
