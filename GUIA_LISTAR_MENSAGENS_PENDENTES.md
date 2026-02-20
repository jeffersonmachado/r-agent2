# 📋 Como Listar Mensagens Pendentes de Envio e Recebimento

## 1. Mensagens Pendentes de Envio (Outbound Queue)

### Via Dashboard `/chat-humano`

O dashboard `/chat-humano` é o **Pilar 1: Cockpit de Atendimento Omnichannel**. Acesse:

```
http://localhost:3000/chat-humano
```

Selecione um dos módulos para gerenciar mensagens:

1. **Atendimento** (`/support`) - Tickets com conversas e histórico de envio/recepção
2. **Inbox** (`/inbox`) - Fila unificada de mensagens
3. **Supervisor** (`/supervisor`) - Painel de TME/TMA e status operacional
4. **Analytics** (`/analytics`) - Métricas de entrega e performance
5. **WhatsApp** (`/whatsapp-connections`) - Status das conexões QR

### Via API REST

#### **A) Listar falhas de entrega de um ticket específico**

```bash
curl -X GET "http://localhost:3001/tickets/TICKET_ID/delivery-failures" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

**Resposta:**
```json
{
  "ticketId": "ticket-1771520605108-78oze5e",
  "conversationId": "5511989752874",
  "outboundQueue": [
    {
      "id": "outq-1771537081965-443f643ac58b",
      "channel_type": "whatsapp",
      "status": "failed",
      "attempts": 4,
      "next_attempt_at": "2026-02-19T21:39:12.977Z",
      "last_error": "Cannot read properties of undefined (reading 'id')",
      "reason_code": "send_failed",
      "external_message_id": null,
      "created_at": "2026-02-19T21:38:15.123Z",
      "updated_at": "2026-02-19T21:38:36.972Z"
    }
  ],
  "channelMessages": [
    {
      "id": "msg-...",
      "conversation_id": "5511989752874",
      "channel_type": "whatsapp",
      "direction": "out",
      "type": "text",
      "body": "pode ser terreno e construção, casa ou apartamento",
      "external_message_id": null,
      "status": "failed",
      "created_at": "2026-02-19T21:38:15.123Z"
    }
  ]
}
```

#### **B) Ver contagem de mensagens pendentes/falhadas (Dashboard)**

```bash
curl -X GET "http://localhost:3001/api/support/dashboard" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Na resposta, procure por:
```json
{
  "outboundPendingCount": 0,
  "outboundFailedCount": 3,
  "recentErrors": [
    {
      "id": "outq-1771537081965-443f643ac58b",
      "channel_type": "whatsapp",
      "last_error": "Cannot read properties of undefined (reading 'id')",
      "attempts": 4,
      "next_attempt_at": "2026-02-19T21:39:12.977Z",
      "updated_at": "2026-02-19T21:38:36.972Z"
    }
  ]
}
```

---

### Via Banco de Dados (SQL)

#### **Ver todas as mensagens pendentes**
```sql
SELECT id, tenant_key, channel_type, status, attempts, 
       next_attempt_at, last_error, reason_code, 
       external_message_id, created_at, updated_at
FROM outbound_queue
WHERE status IN ('pending', 'sending')
ORDER BY next_attempt_at ASC;
```

#### **Ver mensagens com falha**
```sql
SELECT id, tenant_key, channel_type, status, attempts, 
       last_error, reason_code, next_attempt_at, updated_at
FROM outbound_queue
WHERE status = 'failed' OR last_error IS NOT NULL
ORDER BY updated_at DESC;
```

#### **Ver histórico de um número de WhatsApp específico**
```sql
SELECT id, status, attempts, last_error, reason_code, 
       message->'to' AS recipient, next_attempt_at, updated_at
FROM outbound_queue
WHERE tenant_key = 'system'
  AND channel_type = 'whatsapp'
  AND (message->'to') = '"5511989752874"'  -- Incluir aspas JSON
ORDER BY created_at DESC
LIMIT 50;
```

#### **Ver mensagens agendadas para reenvio (próximas horas)**
```sql
SELECT id, status, attempts, last_error, next_attempt_at,
       message->'to' AS recipient, reason_code
FROM outbound_queue
WHERE tenant_key = 'system'
  AND next_attempt_at BETWEEN NOW() AND NOW() + INTERVAL '1 hour'
  AND status IN ('pending', 'failed')
ORDER BY next_attempt_at ASC;
```

---

## 2. Mensagens Pendentes de Recebimento (Inbound)

### Via API REST

#### **Procurar por ticket aberto com inbound pendente**

```bash
curl -X GET "http://localhost:3001/tickets?status=open" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Filtre para ver tickets com `channelType: 'whatsapp'` que têm mensagens não processadas.

#### **Ver status de uma conversa WhatsApp specific**
```bash
curl -X GET "http://localhost:3001/api/support?phone=5511989752874" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### Via Banco de Dados (SQL)

#### **Ver mensagens recebidas não processadas**
```sql
SELECT id, tenant_key, channel_type, direction, type, 
       body, external_message_id, status, created_at
FROM channel_messages
WHERE tenant_key = 'system'
  AND channel_type = 'whatsapp'
  AND direction = 'in'
  AND status IN ('received', 'pending')  -- Não processadas
ORDER BY created_at DESC
LIMIT 50;
```

#### **Ver tickets com mensagens inbound pendentes**
```sql
SELECT DISTINCT t.id, t.tenant_key, t.external_id, 
       t.status, t.created_at, 
       COUNT(cm.id) AS msg_count
FROM tickets t
LEFT JOIN channel_messages cm ON cm.conversation_id = t.external_id
WHEREt.tenant_key = 'system'
  AND t.channel_type = 'whatsapp'
  AND cm.direction = 'in'
  AND cm.status = 'received'
GROUP BY t.id
ORDER BY t.created_at DESC;
```

#### **Ver histórico de inbound de um número**
```sql
SELECT id, direction, type, body, status, 
       created_at, external_message_id
FROM channel_messages
WHERE tenant_key = 'system'
  AND channel_type = 'whatsapp'
  AND conversation_id = '5511989752874'
  AND direction = 'in'
ORDER BY created_at DESC
LIMIT 50;
```

---

## 3. Pipeline de Processamento (Debug)

### Ver se mensagem foi recebida → ticket criado

```sql
-- Verificar inbound recebido
SELECT COUNT(*) AS total_inbound FROM channel_messages
WHERE tenant_key = 'system' AND channel_type = 'whatsapp' AND direction = 'in';

-- Verificar tickets criados a partir de inbound
SELECT id, external_id, status, created_at FROM tickets
WHERE tenant_key = 'system' AND channel_type = 'whatsapp'
ORDER BY created_at DESC LIMIT 10;

-- Verificar se há falha no pipeline
SELECT * FROM ticket_events
WHERE tenant_key = 'system' AND type = 'inbound_processing_error'
ORDER BY created_at DESC LIMIT 10;
```

---

## 4. Monitorar em Tempo Real (Logs)

```bash
# Ver logs de outbound (tentando enviar)
tail -f logs/api/api.log | grep -E "OutboundQueue|WA_QR_SEND|Falha ao enviar"

# Ver logs de inbound (recebendo)
tail -f logs/api/api.log | grep -E "WA_IN_PRE|WA_PIPE|WA_QR_MSG_TEXT"

# Ver logs de conflito (conta em outro dispositivo)
tail -f logs/api/api.log | grep -E "CONFLICT|WhatsApp credentials"
```

---

## 5. Forçar Reenvio Manual

### Via API (reenviar mensagem específica)
```bash
# Marcar como pending para reenviar
curl -X PATCH "http://localhost:3001/api/outbound/OUTQ_ID/retry" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "pending"}'
```

### Via SQL (direto no banco)
```sql
UPDATE outbound_queue 
SET status = 'pending', 
    next_attempt_at = NOW(),
    attempts = 0
WHERE id = 'outq-1771537081965-443f643ac58b';
```

---

## 6. Reason Codes (Entender Por Que Falhou)

| Código | Significado |
|--------|------------|
| `send_failed` | Erro genérico de envio |
| `credentials_invalid` | Credenciais estão inválidas |
| `timeout` | Timeout na tentativa de envio |
| `outside_window_24h` | Fora da janela de 24h (WhatsApp) |
| `wa_conflict` | **Nova**: Conta conectada em outro dispositivo |
| `wa_not_connected` | **Nova**: Sessão QR não iniciada |

---

---

## 7. Dashboard `/chat-humano` - Cockpit Centralizado

### O que é?
Dashboard central que agrupa **todos os módulos de atendimento omnichannel**:

```
📧 Operação
├── Atendimento (/support) - Tickets e conversas
├── Inbox (/inbox) - Fila unificada

⚡ Produtividade
├── Respostas Rápidas (/quick-replies)

📚 Conhecimento
├── FAQ/RAG (/faq)

🧭 Analytics
├── Supervisor (/supervisor) - TME, TMA, abandono, status
├── Analytics (/analytics) - Métricas de performance

🟢 Omnichannel
├── WhatsApp (/whatsapp-connections) - Conexões e Templates

... (mais módulos)
```

### Como Usar

```bash
# Abrir o dashboard
http://localhost:3000/chat-humano

# Ou navegar diretamente para:
http://localhost:3000/support           # Atendimento (tickets)
http://localhost:3000/inbox             # Inbox (fila)
http://localhost:3000/supervisor        # Painel operacional
http://localhost:3000/analytics         # Métricas
http://localhost:3000/whatsapp-connections  # WhatsApp
```

### Onde Ver Mensagens Pendentes?

| Módulo | O Que Ver |
|--------|-----------|
| **Atendimento** | Tickets com mensagens pendentes de envio/recebimento |
| **Inbox** | Fila com prioridade de resposta |
| **Supervisor** | Painel em tempo real com TME, TMA, erros |
| **Analytics** | Taxa de entrega, falhas, retry |
| **WhatsApp** | Status das conexões (conectado, pareando, conflito) |

---

## 8. Investigar Mensagens Não Entregues

Se mensagens chegam mas não aparecem em `/support`:

```bash
# 1. Verificar se inbound chegou
grep "WA_IN_PRE\|WA_PIPE_START" logs/api/api.log | tail -n 20

# 2. Ver se ticket foi criado
SELECT * FROM tickets WHERE external_id = '5511989752874' ORDER BY created_at DESC;

# 3. Ver se ticker foi atribuído a um agente
SELECT id, status, assigned_to, assigned_group FROM tickets 
WHERE external_id = '5511989752874' ORDER BY created_at DESC;

# 4. Verificar se há "default ticket"
SELECT COUNT(*) FROM tickets WHERE tenant_key = 'system' AND id LIKE 'default-%';
```

---

## Resumo de Comandos Rápidos

### Dashboard UI
```
http://localhost:3000/chat-humano              # 💬 Cockpit centralizado
http://localhost:3000/support                  # 💬 Atendimento (tickets pendentes)
http://localhost:3000/inbox                    # 📥 Inbox (fila unificada)
http://localhost:3000/supervisor               # 🧭 Painel operacional (TME/TMA)
http://localhost:3000/whatsapp-connections     # 🟢 Status das conexões
```

### API
```bash
# Ver quantas mensagens estão pendentes
curl "http://localhost:3001/api/support/dashboard" -H "Authorization: Bearer TOKEN" | jq .outboundPendingCount

# Ver erros recentes
curl "http://localhost:3001/api/support/dashboard" -H "Authorization: Bearer TOKEN" | jq .recentErrors

# Listar falhas de um ticket
curl "http://localhost:3001/tickets/TICKET_ID/delivery-failures" -H "Authorization: Bearer TOKEN" | jq .outboundQueue
```
