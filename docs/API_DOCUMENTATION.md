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

