# Guia de Manutenção de Filas

Este documento descreve como realizar manutenção no sistema de filas e tickets de atendimento do r-agent2.

## Visão Geral

O sistema de filas gerencia tickets de atendimento humano criados quando uma conversa é transferida do bot para um atendente. O sistema atual utiliza **armazenamento em memória** (Map), o que significa que:

- ⚠️ **Dados são perdidos ao reiniciar o servidor**
- ⚠️ **Tickets acumulam na memória indefinidamente**
- ⚠️ **Não há persistência entre reinicializações**

> **Nota**: Para produção, considere migrar para banco de dados (PostgreSQL, MongoDB, etc.)

## Estrutura de Dados

### Ticket

```javascript
{
  id: string,              // Identificador único (ex: "suporte-1234567890-abc123")
  sessionId: string,       // ID da sessão (ex: "whatsapp_5511999999999")
  queue: string,           // Nome da fila (ex: "suporte", "vendas")
  status: string,          // "waiting" | "in_progress" | "closed"
  createdAt: string,       // Data de criação (ISO string)
  updatedAt: string,       // Data da última atualização (ISO string)
  lastUserMessage: string, // Última mensagem do usuário antes do handoff
  assignedTo: string,      // ID/nome do atendente atribuído (null se não atribuído)
  phoneNumber: string      // Número de telefone extraído do sessionId
}
```

### Status dos Tickets

- **waiting**: Ticket aguardando atendimento
- **in_progress**: Ticket atribuído e em atendimento
- **closed**: Ticket fechado (removido da fila, mas mantido no histórico)

## Endpoints da API

### Listar Filas

```bash
GET /queues
```

Retorna array com nomes de todas as filas disponíveis.

**Exemplo:**
```bash
curl http://localhost:3000/queues
# Resposta: ["suporte", "vendas", "financeiro"]
```

### Listar Tickets de uma Fila

```bash
GET /queues/:queue/tickets?status=waiting
```

**Parâmetros:**
- `queue`: Nome da fila (URL encoded)
- `status` (opcional): Filtrar por status (`waiting`, `in_progress`, `closed`)

**Exemplo:**
```bash
# Listar todos os tickets da fila "suporte"
curl http://localhost:3000/queues/suporte/tickets

# Listar apenas tickets aguardando
curl http://localhost:3000/queues/suporte/tickets?status=waiting
```

### Listar Todos os Tickets

```bash
GET /tickets?status=closed&queue=suporte
```

**Parâmetros de query (opcionais):**
- `status`: Filtrar por status
- `queue`: Filtrar por fila

**Exemplo:**
```bash
# Listar todos os tickets fechados da fila suporte
curl http://localhost:3000/tickets?status=closed&queue=suporte
```

### Obter Ticket Específico

```bash
GET /tickets/:id
```

**Exemplo:**
```bash
curl http://localhost:3000/tickets/suporte-1234567890-abc123
```

### Atribuir Ticket

```bash
POST /tickets/:id/assign
Content-Type: application/json

{
  "assignedTo": "atendente-001"
}
```

**Exemplo:**
```bash
curl -X POST http://localhost:3000/tickets/suporte-1234567890-abc123/assign \
  -H "Content-Type: application/json" \
  -d '{"assignedTo": "maria.silva"}'
```

### Fechar Ticket

```bash
POST /tickets/:id/close
```

**Exemplo:**
```bash
curl -X POST http://localhost:3000/tickets/suporte-1234567890-abc123/close
```

## Operações de Manutenção

### 1. Monitorar Estado das Filas

#### Verificar Filas Ativas

```bash
# Listar todas as filas
curl http://localhost:3000/queues
```

#### Verificar Tickets por Status

```bash
# Tickets aguardando em todas as filas
curl http://localhost:3000/tickets?status=waiting

# Tickets em atendimento
curl http://localhost:3000/tickets?status=in_progress

# Tickets fechados
curl http://localhost:3000/tickets?status=closed
```

#### Contar Tickets por Fila

```bash
# Contar tickets aguardando na fila "suporte"
curl http://localhost:3000/queues/suporte/tickets?status=waiting | jq 'length'

# Contar todos os tickets (incluindo fechados)
curl http://localhost:3000/tickets | jq 'length'
```

### 2. Limpeza de Tickets Antigos

⚠️ **IMPORTANTE**: O sistema atual não possui limpeza automática de tickets. Tickets fechados permanecem na memória indefinidamente.

#### Opção 1: Adicionar Limpeza Automática

Adicione uma função de limpeza periódica no arquivo `api/services/queueService.js`:

```javascript
// Limpeza periódica de tickets fechados
const TICKET_CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hora
const TICKET_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 dias

function cleanupOldTickets() {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [ticketId, ticket] of tickets.entries()) {
    if (ticket.status === 'closed') {
      const ticketAge = now - new Date(ticket.updatedAt).getTime();
      if (ticketAge > TICKET_MAX_AGE) {
        tickets.delete(ticketId);
        cleaned++;
      }
    }
  }
  
  if (cleaned > 0) {
    console.log(`Limpeza de tickets: ${cleaned} ticket(s) antigo(s) removido(s)`);
  }
}

// Inicia limpeza periódica
setInterval(cleanupOldTickets, TICKET_CLEANUP_INTERVAL);
```

#### Opção 2: Limpeza Manual via Script

Crie um script de limpeza (`scripts/cleanup-tickets.js`):

```javascript
const http = require('http');

const API_URL = process.env.API_URL || 'http://localhost:3000';
const MAX_AGE_DAYS = parseInt(process.env.MAX_AGE_DAYS || '7', 10);

async function cleanupOldTickets() {
  try {
    // Busca todos os tickets fechados
    const tickets = await fetch(`${API_URL}/tickets?status=closed`);
    const ticketsData = await tickets.json();
    
    const now = Date.now();
    const maxAge = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    
    let cleaned = 0;
    for (const ticket of ticketsData) {
      const ticketAge = now - new Date(ticket.updatedAt).getTime();
      if (ticketAge > maxAge) {
        // Nota: Seria necessário adicionar endpoint DELETE /tickets/:id
        console.log(`Ticket ${ticket.id} tem ${Math.floor(ticketAge / (24 * 60 * 60 * 1000))} dias`);
        cleaned++;
      }
    }
    
    console.log(`Encontrados ${cleaned} tickets antigos para limpeza`);
  } catch (error) {
    console.error('Erro ao limpar tickets:', error);
  }
}

cleanupOldTickets();
```

### 3. Verificar Integridade das Filas

Tickets fechados são removidos das filas, mas podem haver inconsistências. Verifique:

```bash
# Script para verificar integridade
node -e "
const http = require('http');
http.get('http://localhost:3000/tickets', (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    const tickets = JSON.parse(data);
    const queues = new Set();
    tickets.forEach(t => queues.add(t.queue));
    
    console.log('Filas encontradas:', Array.from(queues));
    console.log('Total de tickets:', tickets.length);
    console.log('Tickets aguardando:', tickets.filter(t => t.status === 'waiting').length);
    console.log('Tickets em atendimento:', tickets.filter(t => t.status === 'in_progress').length);
    console.log('Tickets fechados:', tickets.filter(t => t.status === 'closed').length);
  });
});
"
```

### 4. Migração de Tickets para Banco de Dados

Para produção, é recomendado migrar para banco de dados. Exemplo com PostgreSQL:

```javascript
// Exemplo de migração (api/services/queueServiceDB.js)
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function createTicket({ sessionId, queue, lastUserMessage }) {
  const result = await pool.query(
    `INSERT INTO tickets (session_id, queue, status, last_user_message, created_at, updated_at)
     VALUES ($1, $2, 'waiting', $3, NOW(), NOW())
     RETURNING *`,
    [sessionId, queue, lastUserMessage]
  );
  return result.rows[0];
}

async function listQueue(queue, options = {}) {
  let query = 'SELECT * FROM tickets WHERE queue = $1';
  const params = [queue];
  
  if (options.status) {
    query += ' AND status = $2';
    params.push(options.status);
  }
  
  query += ' ORDER BY created_at ASC';
  
  const result = await pool.query(query, params);
  return result.rows;
}

// ... outras funções
```

**Schema SQL:**

```sql
CREATE TABLE tickets (
  id SERIAL PRIMARY KEY,
  ticket_id VARCHAR(255) UNIQUE NOT NULL,
  session_id VARCHAR(255) NOT NULL,
  queue VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('waiting', 'in_progress', 'closed')),
  last_user_message TEXT,
  assigned_to VARCHAR(255),
  phone_number VARCHAR(50),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tickets_queue_status ON tickets(queue, status);
CREATE INDEX idx_tickets_session_id ON tickets(session_id);
CREATE INDEX idx_tickets_created_at ON tickets(created_at);
```

### 5. Backup de Tickets

Como o sistema atual usa memória, faça backups periódicos:

```bash
# Script de backup (scripts/backup-tickets.sh)
#!/bin/bash
API_URL=${API_URL:-http://localhost:3000}
BACKUP_DIR="./backups"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

curl -s "$API_URL/tickets" > "$BACKUP_DIR/tickets_$DATE.json"

echo "Backup criado: $BACKUP_DIR/tickets_$DATE.json"
```

### 6. Monitoramento de Performance

#### Verificar Uso de Memória

```bash
# Adicionar endpoint de métricas (api/server.js)
if (method === 'GET' && pathname === '/metrics/queues') {
  const { listAllTickets } = require('./services/queueService');
  const allTickets = listAllTickets();
  
  const metrics = {
    totalTickets: allTickets.length,
    ticketsByStatus: {
      waiting: allTickets.filter(t => t.status === 'waiting').length,
      in_progress: allTickets.filter(t => t.status === 'in_progress').length,
      closed: allTickets.filter(t => t.status === 'closed').length,
    },
    ticketsByQueue: {},
    memoryUsage: process.memoryUsage(),
  };
  
  allTickets.forEach(ticket => {
    metrics.ticketsByQueue[ticket.queue] = 
      (metrics.ticketsByQueue[ticket.queue] || 0) + 1;
  });
  
  sendJson(res, 200, metrics);
  return;
}
```

Acesse:
```bash
curl http://localhost:3000/metrics/queues | jq
```

## Troubleshooting

### Problema: Tickets não aparecem na fila

**Causas possíveis:**
1. Ticket foi fechado (removido da fila)
2. Fila não existe
3. Status do ticket não corresponde ao filtro

**Solução:**
```bash
# Verificar se o ticket existe
curl http://localhost:3000/tickets/TICKET_ID

# Verificar todos os tickets da fila (sem filtro de status)
curl http://localhost:3000/queues/FILA/tickets
```

### Problema: Muitos tickets acumulados na memória

**Sintomas:**
- Servidor lento
- Alto uso de memória
- Timeouts nas requisições

**Solução:**
1. Implementar limpeza automática (ver seção 2)
2. Fechar tickets antigos manualmente
3. Reiniciar o servidor (⚠️ perderá todos os dados em memória)

### Problema: Tickets duplicados

**Causa:** Múltiplas chamadas de `createTicket` para a mesma sessão

**Solução:**
Verificar se já existe ticket ativo antes de criar:

```javascript
// No messageProcessor.js, antes de criar ticket
const existingTicket = getTicketBySession(sessionId);
if (existingTicket && existingTicket.status !== 'closed') {
  // Reutilizar ticket existente
  return existingTicket;
}
```

### Problema: Dados perdidos após reiniciar servidor

**Causa:** Armazenamento em memória

**Solução:**
1. Implementar persistência em banco de dados
2. Ou adicionar persistência em arquivo JSON (similar ao `flows.json`)

## Boas Práticas

1. **Monitoramento Regular**: Verifique métricas de filas diariamente
2. **Limpeza Automática**: Implemente limpeza de tickets fechados antigos
3. **Backup**: Faça backups periódicos antes de limpezas
4. **Logs**: Monitore logs para identificar problemas
5. **Migração**: Planeje migração para banco de dados em produção
6. **Validação**: Valide dados antes de criar tickets
7. **Rate Limiting**: Implemente rate limiting nos endpoints de criação

## Próximos Passos

- [ ] Implementar limpeza automática de tickets
- [ ] Adicionar persistência em arquivo JSON
- [ ] Migrar para banco de dados
- [ ] Adicionar endpoint de métricas
- [ ] Implementar autenticação/autorização
- [ ] Adicionar notificações de novos tickets
- [ ] Implementar priorização de tickets
- [ ] Adicionar SLA (tempo de resposta)

