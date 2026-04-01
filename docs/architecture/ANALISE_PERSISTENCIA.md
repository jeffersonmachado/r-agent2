# Análise de Persistência de Dados em Memória

## 📋 Resumo da Análise

Este documento lista todas as estruturas de dados em memória encontradas no código e avalia se precisam de persistência em arquivo JSON.

## ✅ Estruturas JÁ COM Persistência (DB-only)

### 1. **flows** (api/server.js)
- **Status**: ✅ Já tem persistência
- **Fonte de verdade**: PostgreSQL (tabela `flows`)
- **Cache**: Map em memória (carregado do DB)

### 2. **sessionEvents** (api/server.js) 
- **Status**: ⚠️ Cache em memória (sem persistência em JSON)
- **Observação**: Export ainda existe via endpoint `/export/conversations.json`, mas não há mais arquivo em `api/data/`.

### 3. **tickets** e **queues** (api/services/queueService.js)
- **Status**: ✅ Já tem persistência
- **Fonte de verdade**: PostgreSQL (tabela `tickets`)
- **Cache**: Map em memória (carregado do DB)

### 4. **agents** e **sessions** (api/services/authService.js)
- **Status**: ✅ Já tem persistência
- **Fonte de verdade**: PostgreSQL (tabelas `users`, `sessions`)
- **Cache**: Map em memória (carregado do DB)

### 5. **documents** (api/services/ragDocumentsService.js)
- **Status**: ✅ Já tem persistência
- **Fonte de verdade**: PostgreSQL (tabela `rag_documents`)
- **Cache**: Map em memória (carregado do DB)

### 6. **webhooks** (api/services/webhookService.js)
- **Status**: ✅ Já tem persistência
- **Fonte de verdade**: PostgreSQL (tabela `webhooks`)
- **Cache**: Map em memória (carregado do DB)

### 7. **campaigns** (api/services/bulkMessagingService.js)
- **Status**: ✅ Já tem persistência
- **Observação**: Este item era legado em JSON; verificar serviço/migração correspondente se ainda existir.

### 8. **departments** (api/services/departmentsService.js)
- **Status**: ✅ Já tem persistência
- **Fonte de verdade**: PostgreSQL (tabela `departments`)
- **Cache**: Map em memória (carregado do DB)

### 9. **quickReplies** (api/services/quickRepliesService.js)
- **Status**: ✅ Já tem persistência
- **Fonte de verdade**: PostgreSQL (tabela `quick_replies`)
- **Cache**: Map em memória (carregado do DB)

## ⚠️ Estruturas SEM Persistência (Avaliação)

### 1. **sessions** (api/services/messageProcessor.js)
- **Tipo**: `Map<string, ConversationState>`
- **Conteúdo**: Estado atual das conversas ativas
- **Comentário no código**: `// Sessões em memória (para produção, ideal mover para Redis/DB)`
- **Avaliação**: 
  - ⚠️ **Pode se beneficiar de persistência**
  - O estado pode ser reconstruído a partir dos `sessionEvents`, mas seria mais eficiente ter o estado direto
  - Permite continuar conversas após reinício do servidor sem perder contexto
  - **Recomendação**: Considerar implementar persistência se for crítico manter o estado exato das conversas ativas

### 2. **activeExecutions** (api/services/rpaService.js)
- **Tipo**: `Map` de execuções RPA em andamento
- **Avaliação**: 
  - ✅ **NÃO precisa persistir**
  - São execuções temporárias em andamento
  - Se o servidor reiniciar durante execução, ela será perdida mesmo (aceitável)

### 3. **activeRecordings** (api/services/rpaService.js)
- **Tipo**: `Map` de gravações manuais em andamento
- **Avaliação**: 
  - ✅ **NÃO precisa persistir**
  - São gravações temporárias em andamento
  - Se o servidor reiniciar durante gravação, ela será perdida (aceitável)

### 4. **activeSenders** (api/services/bulkMessagingService.js)
- **Tipo**: `Map<string, NodeJS.Timeout>` - Controle de envio ativo
- **Avaliação**: 
  - ✅ **NÃO precisa persistir**
  - São apenas timeouts/controles temporários
  - Não faz sentido persistir timeouts

### 5. **runningExecutions** (api/services/generate-and-validate.js)
- **Tipo**: `Map` de execuções em andamento
- **Avaliação**: 
  - ✅ **NÃO precisa persistir**
  - Execuções temporárias de geração/validação
  - Se o servidor reiniciar, a execução será perdida (aceitável)

### 6. **clients** (api/services/websocketService.js)
- **Tipo**: `Map` de conexões WebSocket ativas
- **Avaliação**: 
  - ✅ **NÃO precisa persistir**
  - São conexões ativas que serão perdidas ao reiniciar mesmo
  - Clientes se reconectam automaticamente

## 🎯 Conclusão

### Estruturas Críticas com Persistência ✅
- ✅ Fluxos (flows)
- ✅ Eventos de conversas (sessionEvents) - **RECÉM IMPLEMENTADO**
- ✅ Tickets e filas
- ✅ Agentes e sessões de autenticação
- ✅ Documentos RAG
- ✅ Webhooks
- ✅ Campanhas de mensagens em massa
- ✅ Departamentos
- ✅ Respostas rápidas

### Estruturas Temporárias (Não precisam persistir) ✅
- ✅ Execuções RPA ativas
- ✅ Gravações RPA ativas
- ✅ Controles de envio ativo
- ✅ Execuções de geração/validação
- ✅ Conexões WebSocket

### Estrutura Potencial para Persistência ⚠️
- ⚠️ **sessions** (ConversationState) em `messageProcessor.js`
  - Pode ser útil para recuperação rápida de estado após reinício
  - Mas pode ser reconstruído a partir dos eventos já persistidos
  - **Decisão**: Deixar como está por enquanto, já que os eventos estão persistidos

## 📝 Recomendações

1. **sessions (ConversationState)**: Considerar implementar persistência apenas se for crítico manter o estado exato das conversas ativas após reinício. Caso contrário, o estado pode ser reconstruído a partir dos eventos já persistidos.

2. **Monitoramento**: Todas as estruturas críticas já têm persistência implementada.

3. **Performance**: As estruturas temporárias não precisam persistir, mantendo o sistema mais leve.

