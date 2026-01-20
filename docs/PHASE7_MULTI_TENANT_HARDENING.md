## Fase 7 — Multi-tenant hardening + Rate limit por plano

Este documento descreve os ajustes de hardening aplicados para garantir:

- **Isolamento obrigatório por `tenantId`** (sem vazamento cross-tenant)
- **Rate limiting por tenant** com limites de acordo com o **plano**
- **Quotas por plano** (ex.: conversas/mês) com erro amigável

### Hardening de isolamento (tenantId)

Correções importantes para evitar vazamento entre tenants:

- **`GET /departments/:id`**
  - Agora valida `tenantId` antes de retornar o departamento.
  - `api/services/departmentsService.getDepartment(id, tenantId)` retorna `null` se o recurso não pertencer ao tenant.

- **`GET /analytics/metrics`**
  - Agora **obriga** `tenantId` (via helper `requireTenant`) e passa `tenantId` para `getAllMetrics`.
  - Isso evita que métricas agregadas considerem dados de outros tenants.

- **Export (`/export/*`)**
  - Endpoints de export agora passam `tenantId` nas opções e o `exportService` usa `listAllTickets({ tenantId })`.

### Rate limiting por tenant (plan-based)

O middleware `api/middleware/tenantRateLimit.js` aplica rate limiting por tenant em produção (baseado no Redis via `infra/rate-limit`).

- Planos suportados no rate limiting:
  - `free`, `trial`, `basic`, `pro`, `enterprise`

Observações:

- Em **desenvolvimento**, o rate limit é desativado.
- Para **super-admin**, o rate limit é apenas informativo (não bloqueia), mas os headers são adicionados.

### Quotas por plano (plan limits)

O serviço `api/services/planLimitsService.js` define limites por plano.

- Inclui plano `basic` (SaaS) com limites próximos ao `trial`.
- Compatibilidade:
  - `max_mensagens_mes` é tratado como alias para `max_conversas_mes`.

Aplicação (best-effort):

- `conversationTicketLinkService.resolveOrCreateTicketFromIncomingMessage` evita criar ticket quando o tenant excede `max_conversas_mes`.
- `POST /tickets` já valida quota antes de criar ticket manualmente.

