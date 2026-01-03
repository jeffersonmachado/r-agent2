# Nós de Persistência

Este documento descreve como usar os nós que acessam dados de persistência (flows.json, queues.json, config.json) durante a execução de fluxos.

## Visão Geral

A engine agora permite que nós acessem dados de persistência através de um parâmetro `deps` (dependências) que é passado automaticamente para todos os handlers de nós.

## Serviços Disponíveis

Todos os nós têm acesso a `deps.persistence` com os seguintes métodos:

### Fluxos
- `getFlows()` - Obtém todos os fluxos
- `getFlow(flowId)` - Obtém um fluxo específico por ID
- `findFlows(criteria)` - Busca fluxos por critérios (tenantId, name)

### Filas e Tickets
- `getQueuesData()` - Obtém todos os dados de filas e tickets
- `getQueueTickets(queueName, options)` - Obtém tickets de uma fila
- `getQueueInfo(queueName)` - Obtém informações sobre uma fila
- `listQueues()` - Lista todas as filas disponíveis

### Configuração
- `getConfig()` - Obtém toda a configuração do sistema
- `getConfigValue(path, defaultValue)` - Obtém um valor específico da config

## Nós Disponíveis

### 1. get_flow_info

Obtém informações de outro fluxo e salva em uma variável.

**Config:**
```json
{
  "flowId": "id-do-fluxo",
  "outputVariable": "flow_info"
}
```

**Exemplo de uso:**
- Verificar se outro fluxo existe antes de redirecionar
- Obter informações sobre um fluxo para exibir ao usuário

**Variável criada:**
```json
{
  "id": "id-do-fluxo",
  "name": "Nome do Fluxo",
  "version": 1,
  "tenantId": "tenant-demo",
  "nodeCount": 5,
  "found": true
}
```

### 2. get_queue_status

Obtém status de uma fila de atendimento.

**Config:**
```json
{
  "queueName": "suporte",
  "outputVariable": "queue_status"
}
```

**Exemplo de uso:**
- Verificar quantos tickets estão aguardando antes de fazer handoff
- Informar ao usuário o tempo estimado de espera

**Variável criada:**
```json
{
  "queueName": "suporte",
  "exists": true,
  "ticketCount": 5,
  "activeTickets": 3,
  "closedTickets": 2,
  "waitingTickets": 2,
  "inProgressTickets": 1
}
```

### 3. get_config_value

Obtém um valor da configuração do sistema.

**Config:**
```json
{
  "configPath": "api.port",
  "outputVariable": "api_port",
  "defaultValue": 3000
}
```

**Exemplo de uso:**
- Usar valores de configuração em mensagens
- Verificar configurações para tomar decisões no fluxo

**Variável criada:**
```json
3000
```

### 4. list_flows

Lista fluxos disponíveis com filtros opcionais.

**Config:**
```json
{
  "tenantId": "tenant-demo",
  "nameFilter": "suporte",
  "outputVariable": "flows_list"
}
```

**Exemplo de uso:**
- Listar fluxos disponíveis para o usuário escolher
- Filtrar fluxos por nome ou tenant

**Variável criada:**
```json
[
  {
    "id": "flow-1",
    "name": "Fluxo de Suporte",
    "version": 1,
    "tenantId": "tenant-demo"
  }
]
```

## Exemplo de Fluxo Completo

### Cenário: Verificar status da fila antes de fazer handoff

```
1. [start] → 
2. [message] "Vou verificar a disponibilidade do atendimento..." →
3. [get_queue_status] 
   config: { queueName: "suporte", outputVariable: "queue_status" } →
4. [router]
   rules: [
     { condition: { op: "equals", var: "queue_status.waitingTickets", value: 0 }, next: "message_available" },
     { condition: { op: "always" }, next: "message_wait" }
   ] →
5. [message_available] "Atendimento disponível! Transferindo..." →
6. [handoff] { queue: "suporte" } →
7. [end]
```

## Compatibilidade

- **Handlers antigos**: Continuam funcionando normalmente (o parâmetro `deps` é opcional)
- **Novos handlers**: Podem usar `deps` para acessar serviços de persistência
- **Testes**: Podem mockar `deps` para testes isolados

## Registrando Novos Nós

Para usar os novos nós, registre-os no NodeRegistry:

```javascript
const { getFlowInfoNodeHandler, getQueueStatusNodeHandler } = require('./engine/nodes/persistenceNodes');

const registry = new NodeRegistry();
// ... outros handlers ...
registry.register('get_flow_info', getFlowInfoNodeHandler);
registry.register('get_queue_status', getQueueStatusNodeHandler);
registry.register('get_config_value', getConfigValueNodeHandler);
registry.register('list_flows', listFlowsNodeHandler);
```

## Notas Importantes

1. **Performance**: Acessos a persistência são síncronos (leitura de arquivos), então use com moderação em fluxos de alta frequência
2. **Erros**: Todos os nós de persistência tratam erros graciosamente e salvam informações de erro nas variáveis
3. **Eventos**: Todos os acessos geram eventos do tipo `PERSISTENCE_ACCESS` para auditoria
4. **Segurança**: Os serviços de persistência apenas leem dados, nunca escrevem



















