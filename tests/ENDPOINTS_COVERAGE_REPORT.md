# Relatório de Cobertura de Testes - Endpoints da API

## 📊 Resumo Executivo

- **Total de Endpoints**: 271
- **Endpoints com Testes**: 12
- **Endpoints sem Testes**: 259
- **Cobertura**: 4.4%

## 📋 Endpoints por Método HTTP

| Método | Quantidade |
|--------|------------|
| GET | 114 |
| POST | 105 |
| DELETE | 29 |
| PUT | 23 |

## ✅ Endpoints com Testes Identificados

### Configuração
- ✅ `GET /config` - Obter configuração
- ✅ `PUT /config` - Atualizar configuração
- ✅ `POST /config/validate-provider-token` - Validar token de provider

### Tenants
- ✅ `GET /tenants/:id/ai-provider-status` - Verificar status de provider de IA

### Rate Limiting
- ✅ `POST /admin/rate-limit/clear` - Limpar rate limit
- ✅ `POST /admin/rate-limit/clear-cache` - Limpar cache

### Outros
- ✅ Alguns testes de isolamento de tenant
- ✅ Alguns testes de segurança SaaS

## ❌ Principais Categorias Sem Testes

### Autenticação (17 endpoints sem testes)
- `POST /auth/login`
- `POST /auth/logout`
- `POST /auth/logout-all`
- `GET /auth/me`
- `POST /auth/invite`
- `POST /auth/accept-invitation`
- `POST /auth/request-password-reset`
- `POST /auth/reset-password`
- `GET /auth/agents`
- `POST /auth/agents`
- `GET /auth/agents/:id`
- `PUT /auth/agents/:id`
- `DELETE /auth/agents/:id`
- `POST /auth/rpa/login`
- `GET /auth/rpa/token`

### Tenants (11 endpoints sem testes)
- `GET /tenants`
- `POST /tenants`
- `GET /tenants/:id`
- `PUT /tenants/:id`
- `DELETE /tenants/:id`
- `GET /tenants/:id/context`
- `PUT /tenants/:id/context`
- `GET /tenants/:id/usage`
- `POST /tenants/:id/suspend`
- `POST /tenants/:id/reactivate`
- `POST /tenants/:id/change-plan`
- `POST /tenants/generate-by-ai`

### Tickets (17 endpoints sem testes)
- `GET /tickets`
- `POST /tickets`
- `GET /tickets/:id`
- `GET /tickets/:id/messages`
- `GET /tickets/session/:sessionId`
- `POST /tickets/:id/assign`
- `POST /tickets/:id/close`
- `POST /tickets/:id/message`
- `POST /tickets/:id/mark-read`
- `POST /tickets/:id/tags`
- `DELETE /tickets/:id/tags/:tag`
- `PUT /tickets/:id/category`

### Flows (16 endpoints sem testes)
- `GET /flows`
- `GET /flows/:id`
- `POST /flows`
- `PUT /flows/:id`
- `DELETE /flows/:id`
- `POST /flows/validate`
- `POST /flows/simulate`
- `POST /flows/generate`
- `POST /flows/:id/generate-rpa`
- `POST /flows/:id/preview-rpa`
- `POST /flows/:id/resolve-dependencies`
- `POST /flows/:flowId/generate-rpa-test`

### RAG (30 endpoints sem testes)
- `GET /rag/documents`
- `POST /rag/documents`
- `GET /rag/documents/:id`
- `PUT /rag/documents/:id`
- `DELETE /rag/documents/:id`
- `POST /rag/documents/:id/reindex`
- `POST /rag/documents/reindex-all`
- `GET /rag/documents/stats`
- `POST /rag/query`
- `GET /rag/domains`
- `GET /rag/learning/metrics/:tenantId`
- `GET /rag/learning/full-data/:tenantId`
- `POST /rag/learning/trigger-learning/:tenantId`
- `POST /rag/learning/update-synonyms`
- `POST /rag/learning/validation-rules/adapt/:tenantId`
- `GET /rag/learning/validation-rules`
- `PUT /rag/learning/synonyms`
- `DELETE /rag/learning/synonyms/:tenantId/:term`
- `GET /rag/deduplication/stats`

### RPA (16 endpoints sem testes)
- `GET /rpa/recordings`
- `POST /rpa/record/start`
- `POST /rpa/record/stop/:recordingId`
- `GET /rpa/record/status/:recordingId`
- `POST /rpa/execute/:recordingId`
- `GET /rpa/execution/:executionId`
- `GET /rpa/execution/:executionId/report`
- `POST /rpa/execution/:executionId/cancel`
- `POST /rpa/execution/:executionId/continue`
- `POST /rpa/execution/:executionId/next`
- `DELETE /rpa/recordings/:id`

### Webhooks (15 endpoints sem testes)
- `GET /webhooks`
- `POST /webhooks`
- `GET /webhooks/:id`
- `PUT /webhooks/:id`
- `DELETE /webhooks/:id`
- `GET /webhooks/events`
- `POST /webhooks/whatsapp`
- `GET /webhooks/whatsapp`
- `POST /webhooks/instagram`
- `GET /webhooks/instagram`
- `POST /webhooks/messenger`
- `GET /webhooks/messenger`

### Quick Replies (13 endpoints sem testes)
- `GET /quick-replies`
- `POST /quick-replies`
- `GET /quick-replies/:id`
- `PUT /quick-replies/:id`
- `DELETE /quick-replies/:id`
- `GET /quick-replies/categories`
- `GET /quick-replies/tags`
- `POST /quick-replies/search`
- `POST /quick-replies/:id/use`

### Departments (11 endpoints sem testes)
- `GET /departments`
- `POST /departments`
- `GET /departments/:id`
- `PUT /departments/:id`
- `DELETE /departments/:id`
- `POST /departments/:id/agents`
- `DELETE /departments/:id/agents/:agentId`

### Queues (8 endpoints sem testes)
- `GET /queues`
- `POST /queues`
- `GET /queues/:name`
- `DELETE /queues/:name`
- `GET /queues/:queue/tickets`
- `POST /queues/reload`

### Super Admin (8 endpoints sem testes)
- `GET /super-admin/tenants`
- `GET /super-admin/tenants/:id/metrics`
- `POST /super-admin/impersonate`
- `POST /super-admin/tenants/:id/block`
- `POST /super-admin/tenants/:id/unblock`
- `POST /super-admin/tenants/:id/adjust-plan`

### Onboarding (5 endpoints sem testes)
- `GET /onboarding/status`
- `POST /onboarding/start`
- `POST /onboarding/complete-step`
- `POST /onboarding/complete`
- `POST /onboarding/create-templates`

### Analytics (6 endpoints sem testes)
- `GET /analytics/metrics`
- `GET /analytics/general`
- `GET /analytics/agents`
- `GET /analytics/departments`
- `GET /analytics/queues`
- `GET /analytics/trends`

### Outros
- Templates (6 endpoints)
- Conversas (3 endpoints)
- Export (4 endpoints)
- Segmentação (4 endpoints)
- Bulk Campaigns (12 endpoints)
- WhatsApp (5 endpoints)
- E muitos outros...

## 🎯 Recomendações

### Prioridade Alta
1. **Autenticação**: Testes críticos de segurança
2. **Tenants**: Funcionalidade core do sistema
3. **Tickets**: Funcionalidade principal do sistema
4. **Config**: Já parcialmente coberto, completar

### Prioridade Média
5. **Flows**: Funcionalidade importante
6. **RAG**: Funcionalidade importante
7. **RPA**: Funcionalidade importante
8. **Webhooks**: Integração crítica

### Prioridade Baixa
9. Analytics
10. Export
11. Templates
12. Outros endpoints auxiliares

## 📝 Notas

- Este relatório foi gerado automaticamente
- A detecção de testes pode não ser 100% precisa
- Alguns testes podem existir mas não foram detectados pelo script
- Recomenda-se revisão manual dos testes existentes

## 🔄 Como Atualizar Este Relatório

Execute:
```bash
node tests/analyze-endpoints.js
```

O relatório JSON será atualizado em `tests/endpoints-coverage-report.json`
