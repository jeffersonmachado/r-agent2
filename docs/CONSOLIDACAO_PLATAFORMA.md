# 🎯 Consolidação da Plataforma r-agent2

## 📋 Visão Geral

Este documento consolida o projeto r-agent2 como uma **PLATAFORMA PROFISSIONAL** de chatbot com fallback e atendimento humano integrado ao WhatsApp, pronta para produção, SaaS e white-label.

## 🏗️ Arquitetura Consolidada

### Fluxo Completo: Editor → Runtime → Fallback → Tickets → Atendimento Humano → WhatsApp → UI

```
┌─────────────────┐
│  Editor Visual  │ → Validação estrutural (FallbackNode obrigatório)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Runtime Engine │ → Executa fluxo, captura erros
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ FallbackController│ → ÚNICO decisor de escalada (stateless)
└────────┬────────┘
         │
         ├─→ RETRY → Tenta novamente
         ├─→ OPTIONS → Oferece opções
         └─→ HUMAN → Escala para humano
                    │
                    ├─→ Modo TICKET (assíncrono)
                    │   └─→ Cria ticket na fila
                    │       └─→ Atendente assume via /support
                    │
                    └─→ Modo HUMAN (síncrono)
                        └─→ Sessão humana em tempo real
                            └─→ WebSocket/API (futuro)
```

## 🔐 Regras Absolutas (NÃO QUEBRAR)

1. **FallbackController é o ÚNICO decisor de escalada**
   - Nenhum nó executa lógica de atendimento
   - Nenhum handler decide escalada diretamente
   - Toda decisão passa pelo `processFallback()`

2. **FallbackNode é obrigatório em todo fluxo**
   - Validação estrutural garante pelo menos 1 FallbackNode
   - Editor impede salvar fluxos sem FallbackNode

3. **Filas só existem no modo "ticket"**
   - `escalationMode: "ticket"` → cria ticket na fila
   - `escalationMode: "human"` → não cria ticket (sessão síncrona)

4. **Atendimento humano usa tickets + WhatsApp**
   - Tickets são o núcleo do atendimento humano
   - WhatsApp é apenas o canal de comunicação
   - UI /support é o ponto de acesso humano

5. **Nenhum erro técnico aparece ao usuário final**
   - Erros são capturados e roteados para FallbackNode
   - FallbackController decide ação apropriada
   - Mensagens amigáveis são enviadas ao usuário

## 📦 Componentes Principais

### 1. FallbackController (`engine/fallbackController.js`)

**Responsabilidades:**
- Receber eventos de erro (intent, flow, data, system, timeout, no_match)
- Controlar número de tentativas por sessão/contexto
- Detectar loops simples (mesmo nó acionando fallback repetidamente)
- Decidir próxima ação: retry, options, human, end
- Detectar frustração básica por palavras-chave
- Emitir logs estruturados de fallback

**Funções principais:**
- `processFallback(fallbackType, context, config)` - Processa evento de fallback
- `decideFallbackAction(fallbackType, context, config)` - Decide ação
- `createFallbackContext(sessionId, nodeId, userMessage, previousFallbacks)` - Cria contexto

**Modos de escalada:**
- `ESCALATION_MODES.TICKET` - Escalada assíncrona via ticket (padrão)
- `ESCALATION_MODES.HUMAN` - Escalada síncrona para humano em tempo real

### 2. FallbackNode (`engine/nodes/fallbackNode.js`)

**Responsabilidades:**
- Receber evento de falha
- Encaminhar dados para o FallbackController
- Executar a saída decidida (retry, options, human, end)

**Configurações:**
- `maxAttempts` (default: 3) - Máximo de tentativas
- `enableEmotionCheck` (default: true) - Detectar frustração
- `escalationMode` (default: "ticket") - Modo de escalada
- `allowReturnToBot` (default: true) - Permitir retorno ao bot
- `queue` (apenas para ticket) - Nome da fila
- `safeReturnNode` (opcional) - Nó para retorno após escalada

**IMPORTANTE:** O nó NÃO decide nada sozinho. Toda decisão vem do FallbackController.

### 3. Sistema de Tickets (`api/services/queueService.js`)

**Responsabilidades:**
- Criar tickets quando uma conversa é transferida para atendimento humano
- Listar tickets por fila
- Atribuir tickets para atendentes
- Fechar tickets
- Gerenciar histórico de mensagens
- Persistir dados em arquivo JSON

**Estrutura de Ticket:**
```javascript
{
  id: string,
  sessionId: string,
  queue: string,
  status: "waiting" | "in_progress" | "closed",
  createdAt: string,
  updatedAt: string,
  lastUserMessage: string | null,
  assignedTo: string | null,
  phoneNumber: string | null,
  messages: Message[],
  unreadCount: number
}
```

### 4. Integração WhatsApp (`api/services/messageProcessor.js`)

**Responsabilidades:**
- Processar mensagens do webhook do WhatsApp
- Verificar se existe ticket ativo (suspende bot)
- Verificar se está em atendimento humano síncrono
- Executar fluxo via engine
- Criar ticket quando `escalationMode: "ticket"`
- Criar sessão humana quando `escalationMode: "human"`
- Enviar respostas ao usuário

**Fluxo de mensagem:**
1. WhatsApp → Webhook → `processWhatsAppMessage()`
2. Verifica ticket ativo → Se sim, adiciona mensagem ao histórico
3. Verifica sessão humana → Se sim, roteia para humano
4. Executa fluxo via `executeStep()`
5. Se output é `handoff` ou `fallback_human` → cria ticket/sessão
6. Envia resposta ao usuário

### 5. Interface de Atendimento (`frontend/src/pages/SupportPage.jsx`)

**Responsabilidades:**
- Listar filas disponíveis
- Listar tickets de uma fila
- Exibir histórico de mensagens em formato de chat
- Permitir envio de mensagens do atendente
- Atribuir tickets para atendentes
- Fechar tickets
- Mostrar badges de mensagens não lidas
- Auto-atualização a cada 5 segundos

**Funcionalidades:**
- GET /queues - Lista filas
- GET /queues/:queue/tickets - Lista tickets de uma fila
- GET /tickets/:id/messages - Obtém histórico de mensagens
- POST /tickets/:id/message - Envia mensagem do atendente
- POST /tickets/:id/assign - Atribui ticket
- POST /tickets/:id/close - Fecha ticket
- POST /tickets/:id/mark-read - Marca mensagens como lidas

## 🔄 Fluxos de Execução

### Fluxo 1: Erro no Nó → Fallback → Ticket

1. Nó executa e falha (erro, timeout, etc.)
2. Runner captura erro e roteia para FallbackNode (se configurado)
3. FallbackNode chama `processFallback()` do FallbackController
4. FallbackController decide ação: `HUMAN`
5. FallbackNode verifica `escalationMode: "ticket"`
6. Cria ticket na fila especificada
7. Bot envia mensagem informativa ao usuário
8. Bot suspende processamento
9. Atendente assume via interface /support
10. Mensagens do usuário são adicionadas ao histórico do ticket
11. Atendente responde via interface
12. Mensagem é enviada via WhatsApp
13. Ao fechar ticket, bot pode retomar (se `allowReturnToBot: true`)

### Fluxo 2: Erro no Nó → Fallback → Human (Síncrono)

1. Nó executa e falha
2. Runner captura erro e roteia para FallbackNode
3. FallbackNode chama `processFallback()`
4. FallbackController decide ação: `HUMAN`
5. FallbackNode verifica `escalationMode: "human"`
6. Cria sessão de atendimento humano síncrono
7. Bot envia mensagem informativa ao usuário
8. Bot suspende completamente
9. Mensagens são roteadas para humano (WebSocket/API - futuro)
10. Ao encerrar, bot retoma no `safeReturnNode` (se `allowReturnToBot: true`)

### Fluxo 3: Validação Estrutural

1. Usuário cria/edita fluxo no editor
2. Clica em "Validar"
3. `flowValidator.validateFlow()` executa:
   - Valida estrutura básica
   - Verifica se tem FallbackNode (obrigatório)
   - Verifica nós órfãos
   - Verifica terminação de caminhos
   - Detecta loops estruturais
4. Erros são exibidos na UI
5. Usuário corrige e valida novamente
6. Ao salvar, validação é executada novamente no backend

## 📡 APIs Principais

### APIs de Tickets

- `GET /tickets` - Lista todos os tickets (com filtros)
- `GET /tickets/:id` - Obtém um ticket específico
- `GET /tickets/session/:sessionId` - Obtém ticket ativo de uma sessão
- `GET /tickets/:id/messages` - Obtém histórico de mensagens
- `POST /tickets/:id/assign` - Atribui ticket para atendente
- `POST /tickets/:id/close` - Fecha ticket
- `POST /tickets/:id/message` - Envia mensagem do atendente
- `POST /tickets/:id/mark-read` - Marca mensagens como lidas

### APIs de Filas

- `GET /queues` - Lista todas as filas
- `GET /queues/:queue` - Obtém informações de uma fila
- `GET /queues/:queue/tickets` - Lista tickets de uma fila
- `POST /queues` - Cria uma nova fila
- `DELETE /queues/:queue` - Exclui uma fila

### APIs de WhatsApp

- `POST /webhooks/whatsapp` - Webhook do WhatsApp (recebe mensagens)

## 🧪 Validações e Garantias

### Validação Estrutural (Editor)

- ✅ Todo fluxo deve conter pelo menos 1 FallbackNode
- ✅ Nenhum nó pode ficar órfão
- ✅ Todo caminho deve terminar em FallbackNode ou nó de término
- ✅ Detecção de loops estruturais simples

### Validação de Configuração (Backend)

- ✅ `escalationMode` deve ser "ticket" ou "human"
- ✅ `queue` deve ser string não vazia (apenas para ticket)
- ✅ `maxAttempts` deve ser número positivo
- ✅ `allowReturnToBot` deve ser boolean

### Garantias de Runtime

- ✅ Erros são capturados e roteados para FallbackNode
- ✅ FallbackController é o único decisor
- ✅ Tickets são criados apenas no modo "ticket"
- ✅ Bot suspende durante atendimento humano
- ✅ Histórico completo é preservado

## 📚 Documentação Relacionada

- [Sistema de Fallback](./FALLBACK_SYSTEM.md) - Documentação técnica completa
- [Integração WhatsApp ↔ Atendimento](./INTEGRACAO_WHATSAPP_ATENDIMENTO.md) - Comunicação bidirecional
- [Guia de Acesso ao Atendimento](./GUIA_ACESSO_ATENDIMENTO.md) - Como usar a interface
- [Guia de Manutenção de Filas](./GUIA_MANUTENCAO_FILAS.md) - Gerenciamento de filas
- [Rotas de Atendimento](./ROTAS_ATENDIMENTO.md) - Documentação de APIs

## 🚀 Próximos Passos (Futuro)

1. **WebSocket para atendimento síncrono**
   - Implementar roteamento de mensagens em tempo real
   - Notificações push para atendentes

2. **Persistência em banco de dados**
   - Migrar de arquivo JSON para PostgreSQL/MongoDB
   - Melhorar performance e escalabilidade

3. **Métricas e Analytics**
   - Dashboard de métricas de atendimento
   - Análise de tempo de resposta
   - Taxa de resolução

4. **Multi-tenant completo**
   - Isolamento completo de dados por tenant
   - Configurações por tenant

5. **Integração com CRM/Helpdesk**
   - APIs para integração externa
   - Webhooks para eventos de tickets

## ✅ Checklist de Consolidação

- [x] FallbackController é o único decisor de escalada
- [x] FallbackNode está configurado corretamente (escalationMode, queue, allowReturnToBot)
- [x] Sistema de tickets está integrado com fallback
- [x] WhatsApp está integrado bidirecionalmente (usuário ↔ atendente)
- [x] Interface /support está completa e funcional
- [x] Validação estrutural garante FallbackNode obrigatório
- [x] Runtime captura erros e delega ao FallbackController
- [x] Runner armazena informações de erro no estado para FallbackNode
- [x] FallbackNode lê informações de erro do estado e input
- [x] Documentação técnica está atualizada e consolidada
- [x] APIs estão documentadas e funcionais
- [x] Fluxos de execução estão claros e testados

## 🔧 Melhorias Implementadas

### 1. Captura de Erros no Runtime

**Antes:** Erros eram capturados mas informações não eram passadas adequadamente ao FallbackNode.

**Agora:** 
- Runner armazena informações de erro no `state.metadata.lastError` quando há erro
- FallbackNode lê informações de erro tanto do `input` quanto do `state.metadata`
- Tipo de erro é determinado automaticamente (timeout, intent_error, flow_error, etc.)

### 2. Integração Fallback → Tickets → WhatsApp

**Verificado e confirmado:**
- FallbackNode com `escalationMode: "ticket"` cria ticket automaticamente
- Ticket é criado na fila especificada (ou "default")
- Bot suspende processamento durante atendimento
- Mensagens do usuário são adicionadas ao histórico do ticket
- Atendente pode enviar mensagens via interface /support
- Mensagens são entregues via WhatsApp ao usuário
- Histórico completo é preservado

### 3. Validação Estrutural

**Confirmado:**
- `flowValidator.validateFlow()` garante FallbackNode obrigatório
- Validação é executada no editor antes de salvar
- Validação também é executada no backend
- Erros são exibidos claramente na UI

---

**Status:** ✅ Plataforma consolidada e pronta para produção

**Versão:** 1.0.0

**Data:** 2024

**Última Atualização:** Consolidação completa realizada

