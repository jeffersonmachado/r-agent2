# 🔄 Integração WhatsApp ↔ Atendimento Humano

Documentação completa da integração bidirecional entre WhatsApp e interface de atendimento humano.

## 📋 Visão Geral

O sistema permite comunicação bidirecional completa entre usuários do WhatsApp e atendentes humanos através da interface web:

- ✅ **Usuário → Atendente**: Mensagens do WhatsApp aparecem automaticamente na interface
- ✅ **Atendente → Usuário**: Atendentes enviam mensagens via interface que são entregues no WhatsApp
- ✅ **Histórico Completo**: Todas as mensagens são armazenadas e exibidas em tempo real
- ✅ **Indicadores Visuais**: Badges mostram mensagens não lidas
- ✅ **Auto-atualização**: Interface atualiza automaticamente a cada 5 segundos

---

## 🔄 Fluxo de Comunicação

### 1. Usuário Envia Mensagem no WhatsApp

```
WhatsApp → Webhook → messageProcessor → queueService → Interface
```

**Processo:**
1. Usuário envia mensagem no WhatsApp
2. Meta envia webhook para `/webhooks/whatsapp`
3. `messageProcessor` detecta ticket ativo
4. `updateLastMessage()` adiciona mensagem ao histórico
5. Contador de não lidas é incrementado
6. Interface atualiza automaticamente (polling a cada 5s)

### 2. Atendente Envia Mensagem na Interface

```
Interface → API → whatsappService → WhatsApp → Usuário
```

**Processo:**
1. Atendente digita mensagem na interface
2. Clica em "Enviar Mensagem"
3. API recebe `POST /tickets/:id/message`
4. `addAgentMessage()` adiciona ao histórico
5. `sendTextMessage()` envia via WhatsApp Cloud API
6. Mensagem aparece no WhatsApp do usuário
7. Interface atualiza para mostrar mensagem enviada

---

## 🗄️ Estrutura de Dados

### Ticket com Histórico de Mensagens

```typescript
interface Ticket {
  id: string;
  sessionId: string;
  queue: string;
  status: 'waiting' | 'in_progress' | 'closed';
  createdAt: string;
  updatedAt: string;
  lastUserMessage: string | null;
  assignedTo: string | null;
  phoneNumber: string | null;
  messages: Message[];        // ✅ NOVO: Histórico completo
  unreadCount: number;         // ✅ NOVO: Contador de não lidas
}

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'agent' | 'system';
  agentId?: string;            // ID do atendente (se sender === 'agent')
  timestamp: string;
}
```

---

## 🔌 APIs Implementadas

### GET /tickets/:id/messages

Obtém histórico completo de mensagens de um ticket.

**Resposta:**
```json
{
  "ticketId": "suporte_n1-1234567890-abc123",
  "messages": [
    {
      "id": "msg-1234567890-xyz",
      "text": "Preciso de ajuda",
      "sender": "user",
      "timestamp": "2025-12-30T10:00:00.000Z"
    },
    {
      "id": "msg-1234567891-abc",
      "text": "Olá! Como posso ajudá-lo?",
      "sender": "agent",
      "agentId": "maria.silva",
      "timestamp": "2025-12-30T10:01:00.000Z"
    }
  ]
}
```

### POST /tickets/:id/mark-read

Marca todas as mensagens do usuário como lidas.

**Resposta:**
```json
{
  "success": true,
  "ticketId": "suporte_n1-1234567890-abc123"
}
```

**Uso:**
- Chamado automaticamente quando atendente visualiza ticket
- Zera `unreadCount` do ticket

---

## 💻 Interface do Atendente

### Funcionalidades

1. **Histórico de Mensagens**
   - Exibido no painel direito quando ticket está em atendimento
   - Atualiza automaticamente a cada 5 segundos
   - Mostra remetente (usuário/atendente/sistema)
   - Formatação diferenciada por remetente

2. **Indicadores Visuais**
   - Badge vermelho com contador de não lidas
   - Aparece na lista de tickets
   - Aparece no título do ticket selecionado

3. **Envio de Mensagens**
   - Campo de texto no painel direito
   - Botão "Enviar Mensagem"
   - Mensagem aparece imediatamente no histórico
   - Enviada via WhatsApp Cloud API

### Layout

```
┌─────────────────────────────────────────┐
│  Filas  │  Tickets  │  Detalhes/Mensagens│
├─────────┼───────────┼────────────────────┤
│ suporte │ Ticket 1 │ Ticket #abc123     │
│ vendas  │ Ticket 2 │ Telefone: ...      │
│         │ Ticket 3 │ Status: in_progress│
│         │           │                    │
│         │           │ 📜 Histórico:      │
│         │           │ ┌────────────────┐ │
│         │           │ │ 👤 Usuário      │ │
│         │           │ │ Preciso ajuda  │ │
│         │           │ ├────────────────┤ │
│         │           │ │ 👨‍💼 Atendente   │ │
│         │           │ │ Como posso...   │ │
│         │           │ └────────────────┘ │
│         │           │                    │
│         │           │ [Digite mensagem] │
│         │           │ [Enviar Mensagem] │
└─────────┴───────────┴────────────────────┘
```

---

## 🔧 Implementação Técnica

### Backend

#### queueService.js

**Funções Adicionadas:**
- `addAgentMessage(ticketId, message, agentId)` - Adiciona mensagem do atendente
- `markMessagesAsRead(ticketId)` - Marca mensagens como lidas
- `getTicketMessages(ticketId)` - Obtém histórico de mensagens

**Modificações:**
- `createTicket()` - Inicializa `messages[]` e `unreadCount`
- `updateLastMessage()` - Adiciona mensagem do usuário ao histórico

#### messageProcessor.js

**Modificações:**
- Detecta ticket ativo antes de processar mensagem
- Chama `updateLastMessage()` para adicionar ao histórico
- Não processa mensagem do bot durante atendimento humano

#### server.js

**Rotas Adicionadas:**
- `GET /tickets/:id/messages` - Obtém histórico
- `POST /tickets/:id/mark-read` - Marca como lidas

**Modificações:**
- `POST /tickets/:id/message` - Chama `addAgentMessage()` após enviar

### Frontend

#### tickets.js (API Client)

**Funções Adicionadas:**
- `getTicketMessages(ticketId)` - Busca histórico
- `markTicketAsRead(ticketId)` - Marca como lidas

#### SupportPage.jsx

**Estados Adicionados:**
- `ticketMessages` - Array de mensagens do ticket selecionado

**Funcionalidades:**
- Carrega mensagens ao selecionar ticket
- Atualiza mensagens automaticamente (polling)
- Marca como lidas ao visualizar
- Exibe histórico formatado
- Mostra indicadores de não lidas

---

## ⚙️ Configuração

### Auto-Atualização

A interface atualiza automaticamente a cada **5 segundos** quando:
- Auto-refresh está ativado (checkbox no cabeçalho)
- Ticket está selecionado
- Ticket está em status `in_progress`

**Desativar:**
- Desmarque checkbox "Auto-atualizar (5s)"
- Atualização manual via botão "Atualizar"

### Intervalo de Atualização

**Atual:**
- Tickets: 5 segundos
- Mensagens: 5 segundos (quando ticket selecionado)

**Para Modificar:**
Edite `SupportPage.jsx`:
```javascript
const interval = setInterval(() => {
  // ...
}, 5000); // Altere para o intervalo desejado (em ms)
```

---

## 📊 Indicadores e Badges

### Contador de Não Lidas

**Onde Aparece:**
1. **Lista de Tickets**: Badge vermelho no canto superior direito
2. **Título do Ticket**: Badge ao lado do ID do ticket

**Quando Incrementa:**
- Usuário envia mensagem durante atendimento
- Ticket está em status `in_progress`
- Ticket está atribuído a um atendente

**Quando Zera:**
- Atendente visualiza ticket (chamada automática a `markTicketAsRead`)
- Atendente envia mensagem (opcional, pode ser implementado)

---

## 🔄 Sincronização em Tempo Real

### Polling vs WebSocket

**Implementação Atual: Polling**
- ✅ Simples e confiável
- ✅ Funciona sem configuração adicional
- ✅ Compatível com todos os navegadores
- ⚠️ Consome mais recursos (requisições a cada 5s)

**Futuro: WebSocket (Opcional)**
- ✅ Mais eficiente
- ✅ Atualização instantânea
- ⚠️ Requer servidor WebSocket
- ⚠️ Mais complexo de implementar

**Recomendação:**
- Manter polling para MVP
- Considerar WebSocket para produção com muitos atendentes

---

## 🐛 Troubleshooting

### Mensagens não aparecem na interface

**Causa:** Auto-refresh desativado ou erro na API

**Solução:**
1. Verifique se auto-refresh está ativado
2. Abra DevTools (F12) e veja erros no console
3. Verifique se API está respondendo:
   ```bash
   curl http://localhost:3000/tickets/TICKET_ID/messages
   ```

### Contador de não lidas não zera

**Causa:** Erro ao chamar `markTicketAsRead`

**Solução:**
1. Verifique logs do servidor
2. Teste manualmente:
   ```bash
   curl -X POST http://localhost:3000/tickets/TICKET_ID/mark-read
   ```

### Mensagens duplicadas

**Causa:** Múltiplas chamadas à API ou cache

**Solução:**
1. Limpe cache do navegador
2. Verifique se não há múltiplos intervalos rodando
3. Recarregue a página

### Mensagens não são enviadas

**Causa:** WhatsApp não configurado ou ticket fechado

**Solução:**
1. Verifique configuração do WhatsApp (`config.json`)
2. Verifique se ticket não está fechado
3. Verifique logs do servidor para erros da API do WhatsApp

---

## 📈 Melhorias Futuras

### Curto Prazo
- [ ] Notificações sonoras para novas mensagens
- [ ] Indicador de "digitando..." quando atendente está escrevendo
- [ ] Timestamps relativos ("há 2 minutos")
- [ ] Busca no histórico de mensagens

### Médio Prazo
- [ ] WebSocket para atualização em tempo real
- [ ] Suporte a mídia (imagens, áudio, documentos)
- [ ] Emojis e formatação rica
- [ ] Respostas rápidas (quick replies)

### Longo Prazo
- [ ] Chat em grupo (múltiplos atendentes)
- [ ] Transferência de ticket entre atendentes
- [ ] Análise de sentimento das mensagens
- [ ] Sugestões automáticas de respostas (IA)

---

## 📚 Referências

- **Código Backend**: `api/services/queueService.js`, `api/services/messageProcessor.js`
- **Código Frontend**: `frontend/src/pages/SupportPage.jsx`, `frontend/src/api/tickets.js`
- **Rotas API**: `docs/ROTAS_ATENDIMENTO.md`
- **Guia de Acesso**: `docs/GUIA_ACESSO_ATENDIMENTO.md`

---

## ✅ Checklist de Implementação

- [x] Histórico de mensagens no ticket
- [x] Armazenamento de mensagens do usuário
- [x] Armazenamento de mensagens do atendente
- [x] API para obter histórico
- [x] API para marcar como lidas
- [x] Interface exibe histórico
- [x] Interface atualiza automaticamente
- [x] Indicadores de não lidas
- [x] Envio de mensagens integrado
- [x] Documentação completa

**Status:** ✅ **Implementação Completa**

