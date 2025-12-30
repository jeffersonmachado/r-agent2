# 🔌 Rotas de Atendimento - API Reference

Documentação completa das rotas de atendimento do sistema r-agent2.

## 📋 Índice

- [Rotas de Filas](#rotas-de-filas)
- [Rotas de Tickets](#rotas-de-tickets)
- [Rotas de Métricas](#rotas-de-métricas)
- [Exemplos de Uso](#exemplos-de-uso)

---

## 🗂️ Rotas de Filas

### GET /queues
Lista todas as filas disponíveis.

**Resposta:**
```json
["default", "suporte_n1", "vendas", "financeiro"]
```

**Exemplo:**
```bash
curl http://localhost:3000/queues
```

---

### POST /queues
Cria uma nova fila.

**Body:**
```json
{
  "name": "suporte_n1"
}
```

**Resposta:**
```json
{
  "success": true,
  "message": "Fila criada com sucesso",
  "queueName": "suporte_n1"
}
```

**Exemplo:**
```bash
curl -X POST http://localhost:3000/queues \
  -H "Content-Type: application/json" \
  -d '{"name": "suporte_n1"}'
```

**Validações:**
- Nome deve ter entre 1 e 100 caracteres
- Apenas letras, números, hífens e underscores
- Se a fila já existe, retorna sucesso (idempotente)

---

### GET /queues/:name
Obtém informações sobre uma fila específica.

**Resposta:**
```json
{
  "exists": true,
  "ticketCount": 15,
  "activeTickets": 3,
  "closedTickets": 12
}
```

**Exemplo:**
```bash
curl http://localhost:3000/queues/suporte_n1
```

---

### DELETE /queues/:name
Exclui uma fila.

**Query Parameters:**
- `force` (opcional): Se `true`, exclui mesmo com tickets ativos (fecha todos)

**Exemplo:**
```bash
# Excluir fila vazia
curl -X DELETE http://localhost:3000/queues/suporte_n1

# Forçar exclusão (fecha tickets ativos)
curl -X DELETE "http://localhost:3000/queues/suporte_n1?force=true"
```

**Resposta:**
```json
{
  "success": true,
  "message": "Fila excluída com sucesso",
  "deletedTickets": 0
}
```

---

### GET /queues/:queue/tickets
Lista tickets de uma fila específica.

**Query Parameters:**
- `status` (opcional): Filtrar por status (`waiting`, `in_progress`, `closed`)

**Exemplo:**
```bash
# Todos os tickets da fila
curl http://localhost:3000/queues/suporte_n1/tickets

# Apenas tickets aguardando
curl "http://localhost:3000/queues/suporte_n1/tickets?status=waiting"

# Apenas tickets em atendimento
curl "http://localhost:3000/queues/suporte_n1/tickets?status=in_progress"
```

**Resposta:**
```json
[
  {
    "id": "suporte_n1-1234567890-abc123",
    "sessionId": "whatsapp_5511999999999",
    "queue": "suporte_n1",
    "status": "waiting",
    "createdAt": "2025-12-30T00:00:00.000Z",
    "updatedAt": "2025-12-30T00:00:00.000Z",
    "lastUserMessage": "Preciso de ajuda",
    "assignedTo": null,
    "phoneNumber": "5511999999999"
  }
]
```

---

## 🎫 Rotas de Tickets

### GET /tickets
Lista todos os tickets com filtros opcionais e paginação.

**Query Parameters:**
- `status` (opcional): Filtrar por status (`waiting`, `in_progress`, `closed`)
- `queue` (opcional): Filtrar por fila
- `limit` (opcional): Limite de resultados (padrão: 1000, máximo: 10000)
- `offset` (opcional): Offset para paginação (padrão: 0)

**Exemplo:**
```bash
# Todos os tickets
curl http://localhost:3000/tickets

# Tickets aguardando
curl "http://localhost:3000/tickets?status=waiting"

# Tickets de uma fila específica
curl "http://localhost:3000/tickets?queue=suporte_n1"

# Com paginação
curl "http://localhost:3000/tickets?limit=100&offset=0"
```

**Resposta:**
```json
{
  "tickets": [...],
  "total": 150,
  "limit": 100,
  "offset": 0
}
```

---

### GET /tickets/:id
Obtém um ticket específico por ID.

**Exemplo:**
```bash
curl http://localhost:3000/tickets/suporte_n1-1234567890-abc123
```

**Resposta:**
```json
{
  "id": "suporte_n1-1234567890-abc123",
  "sessionId": "whatsapp_5511999999999",
  "queue": "suporte_n1",
  "status": "waiting",
  "createdAt": "2025-12-30T00:00:00.000Z",
  "updatedAt": "2025-12-30T00:00:00.000Z",
  "lastUserMessage": "Preciso de ajuda",
  "assignedTo": null,
  "phoneNumber": "5511999999999"
}
```

**Erro 404:**
```json
{
  "error": "ticket_not_found"
}
```

---

### GET /tickets/session/:sessionId
Obtém ticket ativo de uma sessão específica.

**Exemplo:**
```bash
curl http://localhost:3000/tickets/session/whatsapp_5511999999999
```

**Resposta:** Mesmo formato de `GET /tickets/:id`

**Erro 404:** Se não houver ticket ativo para a sessão

---

### POST /tickets/:id/assign
Atribui um ticket para um atendente.

**Body:**
```json
{
  "assignedTo": "atendente-001"
}
```

**Exemplo:**
```bash
curl -X POST http://localhost:3000/tickets/suporte_n1-1234567890-abc123/assign \
  -H "Content-Type: application/json" \
  -d '{"assignedTo": "maria.silva"}'
```

**Resposta:**
```json
{
  "id": "suporte_n1-1234567890-abc123",
  "status": "in_progress",
  "assignedTo": "maria.silva",
  "updatedAt": "2025-12-30T00:05:00.000Z",
  ...
}
```

**Efeitos:**
- Status muda para `in_progress`
- Campo `assignedTo` é atualizado
- `updatedAt` é atualizado

---

### POST /tickets/:id/close
Fecha um ticket.

**Exemplo:**
```bash
curl -X POST http://localhost:3000/tickets/suporte_n1-1234567890-abc123/close
```

**Resposta:**
```json
{
  "id": "suporte_n1-1234567890-abc123",
  "status": "closed",
  "updatedAt": "2025-12-30T00:10:00.000Z",
  ...
}
```

**Efeitos:**
- Status muda para `closed`
- Ticket é removido da fila (mas mantido no histórico)
- `updatedAt` é atualizado

---

### POST /tickets/:id/message
Envia mensagem do atendente para o usuário via WhatsApp.

**Body:**
```json
{
  "message": "Olá! Como posso ajudá-lo?"
}
```

**Exemplo:**
```bash
curl -X POST http://localhost:3000/tickets/suporte_n1-1234567890-abc123/message \
  -H "Content-Type: application/json" \
  -d '{"message": "Olá! Como posso ajudá-lo?"}'
```

**Resposta:**
```json
{
  "success": true,
  "ticketId": "suporte_n1-1234567890-abc123",
  "message": "Olá! Como posso ajudá-lo?"
}
```

**Validações:**
- Ticket deve existir
- Ticket não pode estar fechado
- Ticket deve ter `phoneNumber` válido
- Mensagem não pode estar vazia

**Erros:**
- `404`: Ticket não encontrado
- `400`: Ticket fechado ou número de telefone não encontrado

---

## 📊 Rotas de Métricas

### GET /metrics/queues
Obtém métricas completas do sistema de filas.

**Exemplo:**
```bash
curl http://localhost:3000/metrics/queues
```

**Resposta:**
```json
{
  "totalTickets": 150,
  "ticketsByStatus": {
    "waiting": 5,
    "in_progress": 10,
    "closed": 135
  },
  "ticketsByQueue": {
    "suporte_n1": 80,
    "vendas": 50,
    "financeiro": 20
  },
  "oldClosedTickets": {
    "olderThan7Days": 45,
    "olderThan30Days": 12
  },
  "oldestTicket": {
    "id": "suporte_n1-1234567890-abc123",
    "createdAt": "2025-12-20T00:00:00.000Z",
    "ageDays": 10
  },
  "newestTicket": {
    "id": "suporte_n1-9876543210-xyz789",
    "createdAt": "2025-12-30T00:00:00.000Z",
    "ageDays": 0
  },
  "memoryUsage": {
    "rss": 52428800,
    "heapTotal": 20971520,
    "heapUsed": 15728640,
    "external": 1048576
  }
}
```

---

## 🔄 Integração com Fallback

### Como as Rotas se Relacionam com Fallback

**Modo Ticket (Assíncrono):**
1. FallbackNode detecta necessidade de escalada
2. Sistema cria ticket via `POST /queues` (implícito)
3. Ticket aparece em `GET /queues/:queue/tickets?status=waiting`
4. Atendente atribui via `POST /tickets/:id/assign`
5. Atendente envia mensagens via `POST /tickets/:id/message`
6. Ticket é fechado via `POST /tickets/:id/close`

**Modo Human (Síncrono):**
- Não usa rotas de tickets/filas
- Usa sistema de sessões humanas (MVP implementado)
- Requer WebSocket/API adicional (a implementar)

---

## 📝 Exemplos de Uso

### Fluxo Completo de Atendimento

```bash
# 1. Criar fila (se não existir)
curl -X POST http://localhost:3000/queues \
  -H "Content-Type: application/json" \
  -d '{"name": "suporte_n1"}'

# 2. Listar tickets aguardando
curl "http://localhost:3000/queues/suporte_n1/tickets?status=waiting"

# 3. Atribuir ticket para atendente
curl -X POST http://localhost:3000/tickets/TICKET_ID/assign \
  -H "Content-Type: application/json" \
  -d '{"assignedTo": "maria.silva"}'

# 4. Enviar mensagem para o usuário
curl -X POST http://localhost:3000/tickets/TICKET_ID/message \
  -H "Content-Type: application/json" \
  -d '{"message": "Olá! Como posso ajudá-lo?"}'

# 5. Fechar ticket após atendimento
curl -X POST http://localhost:3000/tickets/TICKET_ID/close

# 6. Verificar métricas
curl http://localhost:3000/metrics/queues
```

### Monitoramento de Filas

```bash
# Ver todas as filas
curl http://localhost:3000/queues

# Ver informações de cada fila
for queue in $(curl -s http://localhost:3000/queues | jq -r '.[]'); do
  echo "=== Fila: $queue ==="
  curl -s "http://localhost:3000/queues/$queue" | jq
  echo ""
done

# Contar tickets aguardando por fila
for queue in $(curl -s http://localhost:3000/queues | jq -r '.[]'); do
  count=$(curl -s "http://localhost:3000/queues/$queue/tickets?status=waiting" | jq 'length')
  echo "$queue: $count tickets aguardando"
done
```

### Análise de Performance

```bash
# Ver métricas completas
curl http://localhost:3000/metrics/queues | jq

# Ver apenas tickets por status
curl http://localhost:3000/metrics/queues | jq '.ticketsByStatus'

# Ver distribuição por fila
curl http://localhost:3000/metrics/queues | jq '.ticketsByQueue'

# Ver tickets antigos
curl http://localhost:3000/metrics/queues | jq '.oldClosedTickets'

# Ver uso de memória
curl http://localhost:3000/metrics/queues | jq '.memoryUsage'
```

---

## 🔐 Autenticação

**Status Atual:** Nenhuma autenticação implementada.

**Recomendação para Produção:**
- Implementar autenticação/autorização
- Usar tokens JWT ou API keys
- Restringir acesso às rotas de atendimento

---

## ⚠️ Limitações Atuais

1. **Armazenamento em Memória**: Dados são perdidos ao reiniciar
2. **Sem Autenticação**: Todas as rotas são públicas
3. **Sem Rate Limiting**: Sem proteção contra abuso
4. **Sem WebSocket**: Atendimento síncrono requer implementação adicional

---

## 📚 Referências

- **Código do Serviço**: `api/services/queueService.js`
- **Código do Servidor**: `api/server.js`
- **Documentação de Manutenção**: `docs/GUIA_MANUTENCAO_FILAS.md`
- **Sistema de Fallback**: `docs/FALLBACK_SYSTEM.md`

---

## 🆘 Troubleshooting

### Erro 404 em rotas de tickets

**Causa:** Ticket não existe ou foi fechado

**Solução:**
```bash
# Verificar se ticket existe
curl http://localhost:3000/tickets/TICKET_ID

# Verificar todos os tickets da fila
curl http://localhost:3000/queues/FILA/tickets
```

### Erro ao criar fila

**Causa:** Nome inválido ou fila já existe

**Solução:**
```bash
# Verificar filas existentes
curl http://localhost:3000/queues

# Verificar informações da fila
curl http://localhost:3000/queues/NOME_DA_FILA
```

### Tickets não aparecem

**Causa:** Filtros incorretos ou tickets fechados

**Solução:**
```bash
# Listar todos os tickets (sem filtros)
curl http://localhost:3000/tickets

# Verificar métricas
curl http://localhost:3000/metrics/queues
```

