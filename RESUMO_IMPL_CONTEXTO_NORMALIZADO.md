# Resumo — Implementação de Contexto Normalizado

Atualizado em: 25/02/2026

## Objetivo

Disponibilizar `Contexto Normalizado` (tags + entidades + funil) para consumo transversal entre módulos, sem necessidade de reprocessar texto da conversa em cada serviço.

## Escopo entregue

- Contratos e normalização:
  - `api/contracts/normalizedContext.js`
  - `api/contracts/normalizedInboundEvent.js` (extensão com `tags` e `entities`)
- Regras de tags:
  - `api/support/tagRules.js`
- Extração e merge de entidades:
  - `api/entities/entityExtractor.js`
  - `api/entities/entityMerger.js`
- Builder e store de contexto:
  - `api/context/contextBuilder.js`
  - `api/context/contextStore.js`
- Context API interna (governança + auditoria best-effort):
  - `api/context/index.js`
- Integração no pipeline:
  - `api/services/messageProcessor.js`
  - `api/services/normalizeInboundEvent.js`
  - `api/services/funnelStateService.js`

## Consumo multi-módulo entregue

- Suporte/tickets:
  - `api/services/queueService.js`
  - `api/services/conversationTicketLinkService.js`
- CRM:
  - `api/services/ticketCrmIntegrationService.js`
- RAG:
  - `api/services/ragService.js`
- Automações:
  - `api/services/automationService.js`
  - `api/server.js` (run de automação aceitando `session_id`)
  - `frontend/src/api/automations.js` (cliente com `runContext` opcional)

## Endpoints adicionados/ajustados

- `GET /debug/context/:tenant/:session` (contexto sanitizado para debug)
- `POST /api/support/tags/suggest` (sugestão heurística de tags)
- `POST /automations/:id/run` (aceita body opcional com `session_id`)

## Evidências de validação

- Smoke autenticado em `localhost:3001`:
  - `POST /api/support/tags/suggest` → `ok: true`
  - `GET /debug/context/:tenant/:session` → `ok: true` quando tenant do token confere
  - `POST /automations/:id/run` com `session_id` → retorno inclui `run.session_id` e `run.normalized_context`

## Cobertura de testes adicionada

- `api/context/__tests__/contextApi.test.js`
- `api/context/__tests__/contextBuilder.test.js`
- `api/entities/__tests__/entityExtractor.test.js`
- `api/entities/__tests__/entityMerger.test.js`
- `api/support/__tests__/tagRules.test.js`
- `api/services/__tests__/messageProcessor.normalized.smoke.test.js`
- `api/services/__tests__/messageProcessor.handoff.normalizedContext.test.js`
- `api/services/__tests__/queueService.normalizedContext.test.js`
- `api/services/__tests__/conversationTicketLinkService.normalizedContext.test.js`
- `api/services/__tests__/automationService.test.js`
- `api/services/__tests__/ticketCrmIntegrationService.normalizedContext.test.js`
- `api/services/__tests__/ragService.test.js` (caso de `normalized_context` em query/filtros)

Resultado da regressão focada final executada nesta etapa:

- 6 suítes
- 26 testes
- 100% verde

## Operação (token reutilizável)

- Script: `scripts/set-token-env.sh`
- Carrega `TOKEN` no shell atual com fallback automático de credenciais comuns de dev.
- Persistência local opcional em `.token.env` para reuso rápido.
