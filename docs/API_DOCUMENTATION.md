# 📚 Documentação Completa da API

Documentação completa de todos os endpoints da API do sistema r-agent2.

## 🔐 Autenticação

A maioria dos endpoints requer autenticação via token Bearer no header `Authorization`:

```
Authorization: Bearer <token>
```

Para obter um token, faça login em `/auth/login`.

---

## 📋 Índice

1. [Autenticação](#autenticação)
2. [Fluxos](#fluxos)
3. [Tickets e Filas](#tickets-e-filas)
4. [Respostas Rápidas](#respostas-rápidas)
5. [Departamentos](#departamentos)
6. [Disparos em Massa](#disparos-em-massa)
7. [Analytics](#analytics)
8. [Exportação](#exportação)
9. [IA - Sugestões e Reescrita](#ia---sugestões-e-reescrita)
10. [Transcrição de Áudio](#transcrição-de-áudio)
11. [Facebook Messenger](#facebook-messenger)
12. [Instagram Direct](#instagram-direct)
13. [Segmentação](#segmentação)
14. [Templates WhatsApp](#templates-whatsapp)
15. [Webhooks](#webhooks)
16. [Access Control](#access-control)

---

## 🔑 Autenticação

### POST /auth/login
Faz login e retorna token de autenticação.

**Body:**
```json
{
  "username": "admin",
  "password": "senha123"
}
```

**Resposta:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "agent": {
    "id": "agent-001",
    "username": "admin",
    "name": "Administrador",
    "role": "admin"
  }
}
```

### POST /auth/logout
Faz logout invalidando o token.

**Headers:** `Authorization: Bearer <token>`

### GET /auth/me
Obtém informações do agente autenticado.

**Headers:** `Authorization: Bearer <token>`

---

## 📊 Analytics

### GET /analytics/metrics
Obtém todas as métricas consolidadas.

**Query Parameters:**
- `startDate` (opcional) - Data inicial (ISO string)
- `endDate` (opcional) - Data final (ISO string)

**Resposta:**
```json
{
  "general": {
    "totalTickets": 150,
    "openTickets": 25,
    "closedTickets": 125,
    "avgResolutionTime": 45,
    "avgFirstResponseTime": 5,
    "totalMessages": 1200
  },
  "agents": [...],
  "departments": [...],
  "queues": [...],
  "trends": [...]
}
```

### GET /analytics/general
Métricas gerais do sistema.

### GET /analytics/agents
Métricas por agente.

### GET /analytics/departments
Métricas por departamento.

### GET /analytics/queues
Métricas por fila.

### GET /analytics/trends
Tendências ao longo do tempo.

**Query Parameters:**
- `groupBy` - 'day', 'week', 'month' (padrão: 'day')

---

## 📤 Exportação

### GET /export/tickets.csv
Exporta tickets em formato CSV.

**Query Parameters:**
- `startDate`, `endDate`, `status`, `queue`

### GET /export/metrics.csv
Exporta métricas em formato CSV.

### GET /export/conversations.json
Exporta conversas em formato JSON.

### GET /export/full-report.json
Exporta relatório completo (métricas + conversas).

---

## 💬 Respostas Rápidas

### GET /quick-replies
Lista respostas rápidas.

**Query Parameters:**
- `category` - Filtrar por categoria
- `tag` - Filtrar por tag
- `activeOnly` - Apenas ativas (padrão: true)
- `search` - Busca por texto

### POST /quick-replies
Cria nova resposta rápida.

**Body:**
```json
{
  "title": "Saudação",
  "message": "Olá! Como posso ajudá-lo?",
  "tags": ["saudacao", "inicio"],
  "category": "saudacao"
}
```

### POST /quick-replies/search
Busca respostas rápidas por contexto.

**Body:**
```json
{
  "context": "Cliente pedindo ajuda",
  "limit": 5
}
```

---

## 🏢 Departamentos

### GET /departments
Lista departamentos.

### POST /departments
Cria departamento.

**Body:**
```json
{
  "name": "Suporte Técnico",
  "description": "Atendimento técnico",
  "queueNames": ["tecnico"],
  "color": "#F59E0B"
}
```

### POST /departments/:id/agents
Adiciona agente ao departamento.

**Body:**
```json
{
  "agentId": "agent-001"
}
```

---

## 📢 Disparos em Massa

### GET /bulk-campaigns
Lista campanhas de disparo.

### POST /bulk-campaigns
Cria nova campanha.

**Body:**
```json
{
  "name": "Campanha Promocional",
  "message": "Oferta especial para você!",
  "phoneNumbers": ["5511999999999", "5511888888888"],
  "rateLimit": 20
}
```

### POST /bulk-campaigns/:id/start
Inicia envio da campanha.

### POST /bulk-campaigns/:id/pause
Pausa campanha em andamento.

### POST /bulk-campaigns/:id/resume
Retoma campanha pausada.

---

## 🤖 IA - Sugestões e Reescrita

### POST /ai/suggest-response
Sugere respostas baseadas no contexto.

**Body:**
```json
{
  "userMessage": "Preciso de ajuda",
  "conversationHistory": [...],
  "ticketId": "ticket-001"
}
```

---

## 🚪 Access Control

### GET /api/access-control/devices
Lista devices de controle de acesso do tenant autenticado.

### POST /api/access-control/devices
Cria um device de controle de acesso.

**Body:**
```json
{
  "name": "Catraca Entrada A",
  "type": "turnstile",
  "vendor": "Control iD",
  "location": "Recepção",
  "unit_id": "unit-1",
  "integration_mode": "backend_decides"
}
```

### PATCH /api/access-control/devices/:id
Atualiza um device existente.

### GET /api/access-control/credentials
Lista credenciais do tenant.

### POST /api/access-control/credentials
Cria uma credencial e, quando necessário, faz o bootstrap mínimo de `AccessSubject` e `AccessMembership`.

**Body:**
```json
{
  "type": "qrcode",
  "credential_value": "qr-dinamico-123",
  "customer_id": "cust-10",
  "membership_id": "mem-10",
  "billing_status": "active",
  "vertical": "fitness"
}
```

### PATCH /api/access-control/credentials/:id
Atualiza credencial existente.

### GET /api/access-control/policies
Lista políticas de acesso.

### POST /api/access-control/policies
Cria política de acesso.

**Body:**
```json
{
  "name": "Fitness manhã",
  "vertical": "fitness",
  "days_allowed": ["mon", "tue", "wed", "thu", "fri"],
  "time_start": "06:00",
  "time_end": "12:00",
  "unit_scope": ["unit-1"],
  "anti_passback_mode": "strict",
  "max_entries_per_day": 2
}
```

### PATCH /api/access-control/policies/:id
Atualiza política de acesso.

### POST /api/access-control/decisions/resolve
Resolve uma decisão de acesso protegida por auth do painel.

**Body:**
```json
{
  "device_id": "dev-1",
  "action": "enter",
  "credential_value": "qr-dinamico-123",
  "vertical": "fitness"
}
```

### GET /api/access-control/decisions/:id/status
Consulta o status reconciliado da execução de uma `AccessDecision`.

**Resposta:**
```json
{
  "ok": true,
  "decision": {
    "id": "acdcn-1",
    "decision": "allow"
  },
  "execution_status": "executed",
  "callback_event": {
    "id": "ace-callback-1"
  }
}
```

### POST /api/access-control/events
Registra um `AccessEvent` por rota protegida.

### GET /api/access-control/events
Lista eventos de acesso com filtros por `subject_id`, `device_id`, `event_type` e `limit`.

### GET /api/access-control/decisions
Lista decisões emitidas pelo módulo com filtros por `subject_id`, `device_id`, `decision`, `reason_code`, `execution_status` e `limit`.

Quando `include_status=true` (padrão atual da UI), a resposta também pode trazer `summary` com totais por status e sinal de `pending_critical`.
Cada item reconciliado também pode trazer `pending_critical_threshold_ms` e `pending_critical_threshold_source`.

Parâmetros úteis adicionais:
- `pending_critical_only=true` para retornar apenas decisões pendentes críticas
- `device_id=<id>` para focar um ponto físico específico
- `subject_id=<id>` para troubleshooting por pessoa/credencial associada

### GET /api/access-control/health
Retorna snapshot operacional do módulo com `summary`, `threshold_ms`, `threshold_scope`, `has_incidents` e amostra de `pending_critical_items`.

Observação operacional:
- o threshold de criticidade é reconciliado por decisão com precedência de `AccessPolicy.metadata.pending_critical_age_by_unit`, `AccessPolicy.metadata.pending_critical_age_ms`, `AccessPolicy.grace_policy.pending_critical_age_ms`, `AccessDevice.metadata.pending_critical_age_ms` e fallback em `ACCESS_CONTROL_PENDING_CRITICAL_AGE_MS`.

### POST /api/access-control/visitors/qrcode
Gera QR temporário de visitante.

### POST /api/access-control/qrcode/resolve
Resolve um QR temporário e emite uma `AccessDecision`.

### POST /physical/access/resolve?token=<public_token>
Endpoint público/controlado para device integration. Requer `PublicAccessToken` do kind `access_control`.

**Body:**
```json
{
  "device_id": "dev-1",
  "action": "enter",
  "credential_value": "qr-ou-rfid-ou-pin",
  "vertical": "fitness"
}
```

**Resposta:**
```json
{
  "ok": true,
  "decision": {
    "id": "acdcn-1",
    "decision": "allow",
    "reason_code": "allowed_active"
  },
  "token": "signed-short-lived-decision",
  "execution_command": {
    "vendor": "control_id",
    "deviceId": "dev-1",
    "action": "ALLOW",
    "ttlSec": 120,
    "token": "signed-short-lived-decision"
  },
  "event": {
    "id": "ace-1"
  }
}
```

### POST /physical/access/events?token=<public_token>
Endpoint público/controlado para o hardware reportar execução operacional (`entry`, `exit`, `device_callback`, `deny`).

### POST /physical/access/ack?token=<public_token>
Endpoint público/controlado para o hardware confirmar a execução do comando emitido pelo backend.

**Body:**
```json
{
  "decision_id": "acdcn-1",
  "subject_id": "sub-1",
  "status": "executed",
  "command": "ALLOW",
  "hardware_response": {
    "relay": "opened"
  }
}
```

### POST /public-tokens
Cria token público operacional. O campo `kind` aceita:

- `storefront`
- `kiosk`
- `panel`
- `station`
- `access_control`

**Resposta:**
```json
{
  "suggestions": [
    "Claro! Estou aqui para ajudá-lo.",
    "Como posso ajudá-lo hoje?",
    "Vou verificar isso para você."
  ],
  "quickReplies": [...]
}
```

### POST /ai/rewrite-message
Reescreve mensagem de forma mais profissional.

**Body:**
```json
{
  "message": "Oi, tudo bem?",
  "tone": "professional",
  "context": "Atendimento ao cliente"
}
```

**Resposta:**
```json
{
  "original": "Oi, tudo bem?",
  "rewritten": "Olá! Como posso ajudá-lo hoje?",
  "improvements": ["Tom e clareza melhorados"]
}
```

---

## 🎤 Transcrição de Áudio

### POST /audio/transcribe
Transcreve áudio em texto.

**Body:**
```json
{
  "audioUrl": "https://example.com/audio.ogg",
  "provider": "whisper"
}
```

**Resposta:**
```json
{
  "text": "Transcrição do áudio...",
  "language": "pt",
  "provider": "whisper"
}
```

---

## 📱 Facebook Messenger

### GET /webhooks/messenger
Verificação do webhook.

### POST /webhooks/messenger
Recebe mensagens do Messenger.

### POST /messenger/send
Envia mensagem via Messenger.

**Body:**
```json
{
  "recipientId": "user-id",
  "text": "Mensagem",
  "buttons": [
    {
      "type": "postback",
      "title": "Opção 1",
      "payload": "option1"
    }
  ]
}
```

---

## 📸 Instagram Direct

### GET /webhooks/instagram
Verificação do webhook.

### POST /webhooks/instagram
Recebe mensagens do Instagram.

### POST /instagram/send
Envia mensagem via Instagram.

**Body:**
```json
{
  "recipientId": "user-id",
  "text": "Mensagem"
}
```

---

## 🏷️ Segmentação

### GET /segmentation/tags
Lista todas as tags usadas.

### GET /segmentation/categories
Lista todas as categorias.

### GET /segmentation/tickets
Filtra tickets por critérios.

**Query Parameters:**
- `tags` - Tags separadas por vírgula
- `category` - Categoria
- `status` - Status
- `queue` - Fila
- `search` - Busca por texto

### POST /tickets/:id/tags
Adiciona tag a um ticket.

**Body:**
```json
{
  "tag": "urgente"
}
```

### PUT /tickets/:id/category
Define categoria de um ticket.

**Body:**
```json
{
  "category": "suporte"
}
```

---

## 📋 Templates WhatsApp

### GET /whatsapp/templates
Lista templates aprovados.

### POST /whatsapp/templates
Cria novo template (requer aprovação do Meta).

### POST /whatsapp/send-template
Envia mensagem usando template.

**Body:**
```json
{
  "to": "5511999999999",
  "templateName": "hello_world",
  "languageCode": "pt_BR",
  "parameters": ["João", "12345"]
}
```

---

## 🔄 Webhooks

### GET /webhooks/whatsapp
Verificação do webhook do WhatsApp.

### POST /webhooks/whatsapp
Recebe mensagens do WhatsApp.

---

## 📝 Códigos de Status HTTP

- `200` - Sucesso
- `201` - Criado com sucesso
- `400` - Requisição inválida
- `401` - Não autenticado
- `403` - Sem permissão
- `404` - Não encontrado
- `500` - Erro interno

---

## 🔒 Permissões

### Admin
Acesso total a todas as funcionalidades.

### Supervisor
Acesso a leitura e algumas operações de escrita.

### Agent
Acesso básico a tickets e atendimento.

---

## 📞 Suporte

Para mais informações, consulte a documentação completa ou entre em contato com o suporte.

---

## 💄 Vertical Beauty — Endpoints

Todos os endpoints exigem header `X-Tenant-ID` ou query param `tenantId`.

| Método | Path | Descrição |
|---|---|---|
| `POST` | `/api/beauty/confirmation` | Enviar confirmação de agendamento |
| `POST` | `/api/beauty/reminder` | Enviar lembrete (24h ou 1h) |
| `POST` | `/api/beauty/no-show` | Registrar no-show de um agendamento |
| `POST` | `/api/beauty/service-completed` | Concluir serviço (concede ponto de fidelidade) |
| `POST` | `/api/beauty/follow-up` | Registrar/emitir follow-up operacional |
| `POST` | `/api/beauty/reactivation` | Enviar campanha de reativação |
| `POST` | `/api/beauty/loyalty/reverse` | Estornar pontos de fidelidade |
| `GET` | `/api/beauty/loyalty/:subjectId` | Saldo de pontos de fidelidade |
| `GET` | `/api/beauty/events/:subjectId` | Listar eventos da jornada |
| `GET` | `/api/beauty/timeline/:subjectId` | Timeline cronológica completa |
| `GET` | `/api/beauty/agenda` | Agenda operacional por dia/profissional/status |
| `GET` | `/api/beauty/customers/search` | Busca operacional de clientes |
| `GET` | `/api/beauty/customer/:subjectId/detail` | Detalhe operacional agregado de cliente |

### GET /api/beauty/loyalty/:subjectId

```
GET /api/beauty/loyalty/sub-001?tenantId=tenant-abc
200 { "points": 5, "granted": 6, "reversed": 1, "lastUpdatedAt": "2025-12-01T10:00:00.000Z" }
```

---

## 🏋️ Vertical Fitness — Endpoints

| Método | Path | Descrição |
|---|---|---|
| `POST` | `/api/fitness/attendance/check-in` | Registrar check-in (idempotente) |
| `POST` | `/api/fitness/attendance/check-out` | Fechar attendance aberto |
| `POST` | `/api/fitness/no-show` | Marcar sessão como ausente |
| `GET` | `/api/fitness/attendance/history` | Histórico de presenças + frequência |
| `GET` | `/api/fitness/attendance/open` | Listar attendances abertos |
| `GET` | `/api/fitness/membership/:membershipId` | Detalhe da membership |
| `GET` | `/api/fitness/membership/:membershipId/billing-history` | Histórico de status de cobrança |
| `GET` | `/api/fitness/memberships` | Listar memberships do tenant |
| `POST` | `/api/fitness/membership/grace` | Iniciar período de carência |
| `POST` | `/api/fitness/membership/block` | Bloquear membership |
| `POST` | `/api/fitness/membership/reactivate` | Reativar membership bloqueada |
| `POST` | `/api/fitness/membership/renewal` | Processar renovação |
| `GET` | `/api/fitness/access-status` | Verificar elegibilidade de acesso |
| `GET` | `/api/fitness/metrics` | KPIs verticais |
| `GET` | `/api/fitness/recommendations` | Recomendações heurísticas |
| `GET` | `/api/fitness/students/search` | Busca operacional de alunos |
| `GET` | `/api/fitness/student/:subjectId/detail` | Detalhe operacional agregado do aluno |

Ver [docs/VERTICALS_BEAUTY_FITNESS.md](VERTICALS_BEAUTY_FITNESS.md) para documentação técnica completa.

---

## 🧭 Operations Dashboard — Endpoints

Namespace: `GET /api/operations-dashboard/*`

Todos os endpoints exigem autenticação, `analytics:read` e escopo de tenant.

| Método | Path | Descrição |
|---|---|---|
| `GET` | `/api/operations-dashboard/summary` | Resumo executivo (Beauty/Fitness/Sistema) |
| `GET` | `/api/operations-dashboard/timeline` | Timeline operacional por sujeito/cliente/membership |
| `GET` | `/api/operations-dashboard/jobs` | Visão de scheduler/fila (execuções, erro, duração, retries) |
| `GET` | `/api/operations-dashboard/notifications` | Visão de entregas por canal (`sent/failed/skipped/provider-dependent`) |
| `GET` | `/api/operations-dashboard/insights` | Insights acionáveis (Beauty/Fitness) com score + motivo |

### Filtros suportados

- `tenantId` (override apenas para super-admin)
- `vertical` (`beauty`, `fitness`, `all`)
- `startDate`, `endDate`
- `subjectId`, `customerId`, `membershipId`
- `status`, `channel`
- `limit`, `page`

### Exemplo

```bash
GET /api/operations-dashboard/summary?vertical=all&startDate=2026-03-01&endDate=2026-03-19
GET /api/operations-dashboard/timeline?subjectId=sub-123&limit=50&page=1
GET /api/operations-dashboard/jobs?vertical=fitness&status=failed
GET /api/operations-dashboard/notifications?channel=whatsapp&status=provider-dependent
GET /api/operations-dashboard/insights?vertical=beauty&limit=30
```

Detalhes de fontes/limitações: ver `docs/OPERATIONS_DASHBOARD.md`.
