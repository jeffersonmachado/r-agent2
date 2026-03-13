# Process Instance Lifecycle

## Estados

- `pending`
- `running`
- `waiting`
- `completed`
- `failed`
- `cancelled`

## Lifecycle típico

### 1. Start

`startProcess()`:

1. resolve `CompiledProcessDefinition`
2. cria `ProcessExecutionContext`
3. cria `ProcessInstance`
4. persiste `PROCESS_STARTED`
5. entra em `running`

### 2. Execução

Para cada nó:

1. registra `NODE_ENTER`
2. executa a lógica do nó
3. registra `NODE_EXIT`, `NODE_ERROR` ou `NODE_WAITING`
4. atualiza snapshot da instância

### 3. Waiting

Quando um nó pausa:

- `task.message.receive`
- `task.user`
- `wait.timer`
- `call.subprocess`
- espera externa

o runtime persiste:

- `status = waiting`
- `waitingState`
- `lastEventSequence`

### 4. Resume

Retomada pode ocorrer por:

- `resumeByTimer(executionId)`
- `resumeByCorrelationKey(correlationKey, payload)`
- `resumeHumanTask(executionId, payload)`
- `resumeExternalEvent(correlationKey, payload)`

Para retomada segura:

- a instância precisa estar em `waiting`
- o tipo de `waitingState` precisa ser compatível com a operação de resume
- `correlationKey` ambígua é rejeitada
- após restart, o runtime pode reidratar a definição compilada via `compiledProcessResolver`

### 5. Complete / Fail

Ao terminar:

- `PROCESS_COMPLETED`
- snapshot final persistido

Ao falhar:

- `NODE_ERROR`
- `PROCESS_FAILED`
- erro persistido na instância

### 6. Cancel

Cancelamento explícito:

- `cancelProcess(executionId, reason)`
- `POST /api/process-instances/:executionId/cancel`

Ao cancelar:

- `status = cancelled`
- `waitingState` é limpo
- timers pendentes da execução são cancelados
- `PROCESS_CANCELLED` é persistido

## Exemplo resumido

```text
PROCESS_STARTED
NODE_ENTER(start)
NODE_EXIT(start)
NODE_ENTER(receive)
NODE_WAITING(receive)
PROCESS_RESUMED
NODE_RESUMED(receive)
NODE_EXIT(receive)
NODE_ENTER(end)
PROCESS_COMPLETED
```

## Recovery após restart

Fluxo resumido:

1. a aplicação recria `ProcessRuntimeService` com o mesmo `ProcessInstanceStore` e `ProcessExecutionRepository`
2. fornece `compiledProcessResolver` para localizar `CompiledProcessDefinition` por `processId` e `processVersion`
3. chama `recoverRuntimeState()` para reidratar timers duráveis
4. o `resume` volta a operar sobre a instância persistida e o event log

## Timeout e subprocess

- `timeoutPolicy.enabled + timeoutPolicy.timeoutMs` em nível de nó faz o runtime emitir `NODE_TIMEOUT` e falhar a execução de forma explícita
- `call.subprocess` com `config.async=true` cria uma instância filha durável
- ao concluir, o filho retoma o pai via correlação persistida
