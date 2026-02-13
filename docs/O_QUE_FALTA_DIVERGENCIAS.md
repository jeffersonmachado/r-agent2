# Divergências de Rotas (O_QUE_FALTA vs Codebase)

## Resumo por épico

Seções ordenadas por maior número de rotas faltando.

- P0.1 Inbox multiatendente (lista, assumir, transferir, tags, notas, respostas rápidas): 0 faltando / 9 total
- P0.3 RBAC completo (admin/supervisor/agente): 0 faltando / 4 total
- P0.4 MFA funcional: 0 faltando / 4 total
- P1.1 Widgets + links rastreáveis (source/campaign): 0 faltando / 4 total
- P1.2 URA WhatsApp empacotada (UI simples, departamentos): 0 faltando / 4 total
- P2.2 API pública com API Keys + rate limit: 0 faltando / 4 total
- P2.3 Automações low-code: 0 faltando / 4 total
- P2.5 Lembretes e tarefas: 0 faltando / 4 total
- P0.2 Painel supervisor com métricas (TME, TMA, abandono, por agente/fila/período): 0 faltando / 3 total
- P2.4 SLA por cliente: 0 faltando / 3 total
- P0.5 Auditoria de ações: 0 faltando / 2 total
- P0.6 Mascaramento de telefone: 0 faltando / 2 total
- P0.7 Wizard de onboarding (WhatsApp, filas, usuários): 0 faltando / 5 total
- P2.1 IA operacional (resumo, sugestão, intenção, sentimento): 0 faltando / 5 total

Checklist gerado automaticamente a partir de `docs/O_QUE_FALTA.md`.

## P0.1 Inbox multiatendente (lista, assumir, transferir, tags, notas, respostas rápidas)

Resumo: 9/9 encontradas no codebase.

### Faltando (não encontrado no codebase)
- (nenhuma)

### Encontradas
- GET /quick-replies
- POST /quick-replies
- POST /tickets/:id/tags
- DELETE /tickets/:id/tags/:tag
- GET /inbox/conversations
- GET /inbox/conversations/:id
- POST /inbox/conversations/:id/assign
- POST /inbox/conversations/:id/transfer
- POST /inbox/conversations/:id/notes

## P1.3 Conexão WhatsApp via QR (além da Cloud API)

Resumo: 5/5 encontradas no codebase.

### Faltando (não encontrado no codebase)
- (nenhuma)

### Encontradas
- POST /whatsapp/connections
- GET /whatsapp/connections
- POST /whatsapp/connections/:id/qr
- POST /whatsapp/connections/:id/disconnect
- GET /whatsapp/connections/:id/status

## P0.3 RBAC completo (admin/supervisor/agente)

Resumo: 4/4 encontradas no codebase.

### Faltando (não encontrado no codebase)
- (nenhuma)

### Encontradas
- GET /rbac/roles
- POST /rbac/roles
- GET /rbac/permissions
- POST /rbac/assign

## P0.4 MFA funcional

Resumo: 4/4 encontradas no codebase.

### Faltando (não encontrado no codebase)
- (nenhuma)

### Encontradas
- POST /auth/mfa/setup
- POST /auth/mfa/verify
- POST /auth/mfa/disable
- POST /auth/mfa/recovery

## P1.1 Widgets + links rastreáveis (source/campaign)

Resumo: 4/4 encontradas no codebase.

### Faltando (não encontrado no codebase)
- (nenhuma)

### Encontradas
- POST /api/marketing/links
- GET /api/marketing/links
- GET /mkt/l/:code
- POST /mkt/click

## P1.2 URA WhatsApp empacotada (UI simples, departamentos)

Resumo: 4/4 encontradas no codebase.

### Faltando (não encontrado no codebase)
- (nenhuma)

### Encontradas
- GET /whatsapp/ivr
- POST /whatsapp/ivr
- POST /whatsapp/ivr/department
- POST /whatsapp/ivr/rule

## P2.2 API pública com API Keys + rate limit

Resumo: 4/4 encontradas no codebase.

### Faltando (não encontrado no codebase)
- (nenhuma)

### Encontradas
- POST /developer/keys
- GET /developer/keys
- POST /public/*
- GET /developer/usage

## P2.3 Automações low-code

Resumo: 4/4 encontradas no codebase.

### Faltando (não encontrado no codebase)
- (nenhuma)

### Encontradas
- GET /automations
- POST /automations
- POST /automations/:id/publish
- POST /automations/:id/run

## P2.5 Lembretes e tarefas

Resumo: 4/4 encontradas no codebase.

### Faltando (não encontrado no codebase)
- (nenhuma)

### Encontradas
- GET /tasks
- POST /tasks
- POST /tasks/:id/complete
- POST /tasks/:id/reminder

## P0.2 Painel supervisor com métricas (TME, TMA, abandono, por agente/fila/período)

Resumo: 3/3 encontradas no codebase.

### Faltando (não encontrado no codebase)
- (nenhuma)

### Encontradas
- GET /supervisor/metrics?groupBy=agent|queue&period=day|hour&from=...&to=...
- GET /supervisor/agents/status
- GET /supervisor/queues/status

## P2.4 SLA por cliente

Resumo: 3/3 encontradas no codebase.

### Faltando (não encontrado no codebase)
- (nenhuma)

### Encontradas
- GET /sla/policies
- POST /sla/policies
- GET /sla/breaches

## P0.5 Auditoria de ações

Resumo: 2/2 encontradas no codebase.

### Faltando (não encontrado no codebase)
- (nenhuma)

### Encontradas
- GET /audit/logs?resource=...&action=...&startDate=...&endDate=...
- GET /audit/stats

## P0.6 Mascaramento de telefone

Resumo: 2/2 encontradas no codebase.

### Faltando (não encontrado no codebase)
- (nenhuma)

### Encontradas
- GET /api/tenant-settings/phone-masking
- POST /api/tenant-settings/phone-masking

## P0.7 Wizard de onboarding (WhatsApp, filas, usuários)

Resumo: 5/5 encontradas no codebase.

### Faltando (não encontrado no codebase)
- (nenhuma)

### Encontradas
- GET /onboarding/status
- POST /onboarding/start
- POST /onboarding/complete-step
- POST /onboarding/complete
- POST /onboarding/create-templates

## P2.1 IA operacional (resumo, sugestão, intenção, sentimento)

Resumo: 5/5 encontradas no codebase.

### Faltando (não encontrado no codebase)
- (nenhuma)

### Encontradas
- GET /tickets/:id/ai-summary
- POST /tickets/:id/ai-summary
- GET /tickets/:id/ai-suggestions
- GET /tickets/:id/ai-intent
- GET /tickets/:id/ai-sentiment
