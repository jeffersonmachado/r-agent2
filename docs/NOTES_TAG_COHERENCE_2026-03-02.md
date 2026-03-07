# Notes - Tag Coherence Audit (2026-03-02)

## 1) Onde tags são geradas e mescladas

- Geração heurística de tags:
  - `api/support/tagRules.js`
  - Funções: `suggestTagsFromText`, `ensureRequiredTags`, `normalizeTag`
- Endpoint de sugestão:
  - `api/server.js` em `POST /api/support/tags/suggest`
  - Usa `suggestTagsFromText(text, { tenantKeywords })`
- Merge no pipeline de mensagens:
  - `api/services/messageProcessor.js`
  - Merge inicial: `previousContextTags + inboundTags` -> `ensureRequiredTags(...)`
  - Governança pós-funnel: sobrescreve `intent`/`severity` por `funnelTransition.after`

## 2) Formatos de tag atualmente aceitos/observados

- Strings:
  - `"namespace:value"` (formato oficial)
  - `"Namespace: Valor"` (humanizado)
  - Lista textual separada por `,`, `;`, `|` ou nova linha
- Arrays:
  - Array de strings (mais comum)
  - Array vindo de `normalizedEvent.tags` e `metadata.tags`
- Ponto de risco:
  - `splitTags` converte itens não-string para string (`[object Object]`), sem parse estruturado.

## 3) Cobertura de testes existente (antes da mudança)

- Arquivo: `api/support/__tests__/tagRules.test.js`
- Cenários cobertos:
  - `normalizeTag` básico
  - `ensureRequiredTags` adiciona defaults
  - `diffTags`
  - `suggestTagsFromText` com `tenantKeywords`
- Lacunas:
  - conflitos `intent:*` e `severity:*`
  - tratamento de `unknown`
  - aliases pt-BR (Intencao/Severidade/Tema)
  - lixo/entradas inválidas
  - precedência state vs inbound

## 4) Mapa de risco (consumo de tags)

- Consumidores backend críticos:
  - `api/services/messageProcessor.js` (state tags + normalized context)
  - `api/context/index.js` (applyTags + ensureRequiredTags)
  - `api/context/contextBuilder.js` (monta contexto normalizado com tags)
  - `api/services/ticketCrmIntegrationService.js` (usa `normalized_context` e funil)
  - `api/services/ragService.js` (prefixa query com sinalizadores de contexto)
- Consumidores frontend:
  - `frontend/src/pages/SupportPage.jsx` (render/aplicação automática de tags)
- Rota exposta:
  - `POST /api/support/tags/suggest` em `api/server.js`

## 5) Observação de risco funcional

- Hoje o pipeline acumula array e `ensureRequiredTags` apenas verifica presença de namespace.
- Resultado observado:
  - coexistência de `intent:unknown` com `intent:...` válido
  - coexistência de múltiplas severidades.
- Mitigação proposta:
  - consolidar por namespace (`intent`/`severity`) com precedência explícita
  - tratar `unknown` como ausência quando houver valor válido.

