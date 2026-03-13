# Process Runtime Architecture

O `ProcessRuntime` introduz um orquestrador novo no backend para executar `CompiledProcessDefinition` sem depender diretamente do formato legado do editor.

## Fluxo de execução

```text
CanonicalProcessDefinition
  -> CompiledProcessDefinition
  -> ProcessRuntime
```

O runtime legado continua existindo em `engine/`, mas o runtime novo vive em `api/core/process-runtime/` e não depende dele para executar processos novos.

- `CanonicalProcessDefinition`: pode ser compilado e executado no runtime novo
- `CompiledProcessDefinition`: é a entrada nativa do novo orquestrador

## Componentes

- `processExecutionContext.js`
  Armazena `processId`, `executionId`, nó atual, variáveis, histórico e metadados da execução.

- `processStateMachine.js`
  Faz o dispatch por `node.type` e executa os nós suportados usando semântica canônica própria.

- `processRuntimeService.js`
  Orquestra a execução ponta a ponta. Cria contexto, executa até pausa ou conclusão e retoma timers.

- `processTimerService.js`
  Registra timers para `wait.timer`, emite `PROCESS_TIMEOUT` quando disparam e permite retomar a execução.

- `processEventBus.js`
  Emite eventos estruturados como `PROCESS_STARTED`, `NODE_ENTER`, `NODE_EXIT`, `NODE_ERROR`, `PROCESS_COMPLETED`, `PROCESS_FAILED` e `PROCESS_TIMEOUT`.

- `processObservabilityService.js`
  Escuta o event bus e registra trilha de execução com duração por nó.

- `processCanonicalAdapter.js`
  Compila `CanonicalProcessDefinition` em `CompiledProcessDefinition` com `executionGraph`.

## Compatibilidade

- O editor continua intacto.
- `engineMapper` não foi removido.
- O runner legado em `engine/runner.js` continua funcional para os fluxos antigos.
- O novo runtime aceita apenas modelos canônicos.

## Exemplo resumido

1. `startProcess(compiledProcess, input)` cria `ProcessExecutionContext`
2. `ProcessStateMachine.executeNode(start, context)` avança para o próximo nó
3. `task.service` ou `task.ai` executa via executor genérico ou handler legado
4. `gateway.exclusive` escolhe a próxima aresta
5. `wait.timer` pausa e agenda retomada
6. `end` marca a execução como concluída

## Preparação para próximos passos

- `BPMN -> Canonical -> CompiledProcess`
- IA gerando `CanonicalProcessDefinition`
- analytics e observabilidade de processo em cima do event bus
