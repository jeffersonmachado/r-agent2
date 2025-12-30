# Por que acontece o erro 404 em tickets?

## 🔍 Causas Principais

O erro 404 (`ticket_not_found`) acontece quando um ticket existe no arquivo JSON mas não está na memória do servidor. Aqui estão as principais causas:

### 1. **Dessincronia entre Arquivo e Memória** ⚠️ (Mais Comum)

**Cenário:**
- O ticket está salvo no arquivo `api/data/queues.json`
- Mas não está no Map em memória (`tickets`)

**Por que acontece:**
- Servidor foi reiniciado e houve erro ao carregar o arquivo
- Arquivo foi editado manualmente mas servidor não foi reiniciado
- Erro durante o carregamento inicial que foi silenciado

**Solução:**
```bash
# Recarregar dados do arquivo sem reiniciar
curl -X POST http://localhost:3000/queues/reload
```

### 2. **Limpeza Automática de Tickets Fechados** 🧹

**Cenário:**
- Ticket foi fechado (`status: "closed"`)
- Limpeza automática remove tickets fechados com mais de 7 dias
- Ticket é removido da memória mas ainda está no arquivo

**Código responsável:**
```javascript
// api/services/queueService.js:670
function cleanupOldTickets(maxAgeDays = 7) {
  // Remove tickets fechados com mais de 7 dias
  if (ticket.status === 'closed' && ticketAge > maxAge) {
    tickets.delete(ticketId); // Remove da memória
  }
}
```

**Quando acontece:**
- A cada 1 hora (configurável)
- Remove tickets fechados com mais de 7 dias (configurável)

**Solução:**
- Recarregar dados: `POST /queues/reload`
- Ou ajustar configuração de limpeza no `config.json`

### 3. **Ticket Removido da Fila mas Mantido no Arquivo** 📋

**Cenário:**
- Quando um ticket é fechado, ele é removido da fila (`queueSet.delete(ticketId)`)
- Mas o ticket ainda existe no Map `tickets` (apenas removido da fila)
- Se houver inconsistência, o ticket pode não estar na fila mas estar no arquivo

**Código:**
```javascript
// api/services/queueService.js:492
function closeTicket(ticketId) {
  // Remove da fila (mas mantém no histórico)
  const queueSet = queues.get(ticket.queue);
  if (queueSet) {
    queueSet.delete(ticketId); // Remove da fila
  }
  // Ticket ainda existe em tickets Map
}
```

### 4. **Race Condition** ⚡

**Cenário:**
- Frontend carrega lista de tickets (ticket aparece)
- Entre o carregamento da lista e a busca de mensagens, o ticket é removido
- Frontend tenta buscar mensagens de um ticket que não existe mais

**Quando acontece:**
- Limpeza automática executando enquanto usuário está usando a interface
- Ticket sendo fechado por outro atendente simultaneamente

**Solução:**
- Frontend já trata isso removendo ticket da lista quando recebe 404

### 5. **Erro no Carregamento Inicial** ❌

**Cenário:**
- Servidor inicia e tenta carregar `queues.json`
- Erro de parsing JSON ou arquivo corrompido
- Erro é silenciado e servidor continua com Map vazio

**Código:**
```javascript
// api/services/queueService.js:108
function loadQueuesFromFile() {
  try {
    // ... carrega dados
  } catch (err) {
    console.error('[QueueService] Erro ao carregar dados do arquivo:', err.message);
    // Continua com Map vazio se houver erro ⚠️
  }
}
```

**Solução:**
- Verificar logs do servidor ao iniciar
- Verificar se arquivo JSON está válido
- Usar `POST /queues/reload` para recarregar

### 6. **Inconsistência na Estrutura do Arquivo** 📄

**Cenário:**
- Arquivo JSON tem ticket na lista `tickets[]`
- Mas ticket não está na fila correspondente em `queues.suporte[]`
- `listQueue()` retorna ticket porque está no arquivo
- Mas `getTicket()` retorna null porque não está na memória

**Exemplo de inconsistência:**
```json
{
  "tickets": [
    { "id": "ticket-123", "queue": "suporte" }  // ✅ Existe
  ],
  "queues": {
    "suporte": []  // ❌ Ticket não está na fila
  }
}
```

## 🔧 Como Diagnosticar

### 1. Verificar se ticket está na memória:
```bash
curl http://localhost:3000/tickets/TICKET_ID
```

### 2. Verificar se ticket está na lista:
```bash
curl "http://localhost:3000/queues/suporte/tickets?status=waiting"
```

### 3. Verificar métricas:
```bash
curl http://localhost:3000/metrics/queues
```

### 4. Verificar logs do servidor:
```bash
# Procurar por:
# - "[QueueService] Dados carregados"
# - "[QueueService] Limpeza de tickets"
# - "[QueueService] Erro ao carregar dados"
```

## ✅ Soluções

### Solução Imediata:
```bash
# Recarregar dados do arquivo
curl -X POST http://localhost:3000/queues/reload
```

### Solução Permanente:

1. **Adicionar validação no carregamento:**
   - Verificar se todos os tickets do arquivo foram carregados
   - Logar avisos se houver inconsistências

2. **Sincronizar arquivo e memória:**
   - Garantir que `saveQueuesToFile()` sempre salva estado atual
   - Garantir que `loadQueuesFromFile()` sempre carrega tudo

3. **Melhorar tratamento de erros:**
   - Não silenciar erros de carregamento
   - Alertar quando há inconsistências

4. **Adicionar endpoint de diagnóstico:**
   - Comparar tickets no arquivo vs memória
   - Identificar tickets órfãos

## 📊 Fluxo de Dados

```
┌─────────────────┐
│  queues.json    │  ← Arquivo de persistência
└────────┬────────┘
         │ loadQueuesFromFile()
         ▼
┌─────────────────┐
│  tickets Map    │  ← Memória (fonte da verdade)
│  queues Map     │
└────────┬────────┘
         │ getTicket() / listQueue()
         ▼
┌─────────────────┐
│   API Response  │
└─────────────────┘
```

**Problema:** Se houver dessincronia entre arquivo e memória, o ticket pode aparecer na lista (do arquivo) mas não ser encontrado na busca (da memória).

## 🎯 Prevenção

1. **Sempre usar `saveQueuesToFile()` após modificar tickets**
2. **Verificar logs ao iniciar servidor**
3. **Usar endpoint `/queues/reload` quando houver suspeita de dessincronia**
4. **Monitorar métricas regularmente**
5. **Considerar migrar para banco de dados para evitar dessincronias**

