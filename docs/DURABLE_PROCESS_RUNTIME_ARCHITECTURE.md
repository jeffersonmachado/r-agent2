# Durable Process Runtime Architecture

O runtime canônico agora evolui de execução efêmera para execução durável baseada em instâncias persistidas.

## Visão geral

```text
CompiledProcessDefinition
  -> ProcessRuntimeService
  -> ProcessInstanceStore
  -> ProcessExecutionRepository
  -> Replay / Resume / Recovery
  -> EventBus / Observability
```

## Componentes principais

- `processInstanceStore.js`
  Persiste `ProcessInstance` com status, snapshot de variáveis, `waitingState` e sequência do último evento processado.
  Agora possui backend em memória e backend em banco via `executions`.

- `processExecutionRepository.js`
  Persiste `ProcessExecutionEvent` com sequência monotônica por `executionId`.
  Agora possui backend em memória e backend em banco via `process_execution_events`.

- `processCompiledDefinitionRepository.js`
  Persiste `CompiledProcessDefinition` fora da memória do runtime via `process_compiled_definitions`, com fallback de leitura para `flows.data`.

- `processExecutionContext.js`
  Agora é serializável e reconstituível via `toSnapshot()` e `fromSnapshot()`.

- `processRuntimeService.js`
  Orquestra start, persistência incremental, waiting durável, replay, resume e transição híbrida opcional de `EngineFlow -> Canonical -> Compiled`.
  Também registra definições compiladas por `processId:processVersion`, suporta `compiledProcessResolver` para restart/recovery e expõe `recoverRuntimeState()` para reidratar timers persistidos.
  Agora também suporta:
  - cancelamento explícito de instância
  - timeout policy por nó
  - subprocesso assíncrono com filho durável e retomada do pai
  - validação de payload de resume por schema

- `processReplayService.js`
  Reconstrói o estado lógico da execução a partir de eventos persistidos ou do snapshot da instância.

- `processResumeService.js`
  Centraliza retomadas por timer, correlação, tarefa humana e evento externo.

- `processTimerService.js`
  Agenda timers, persiste waiting state, dispara `PROCESS_TIMEOUT` e suporta recuperação de timers pendentes após restart.

- `processIdempotencyService.js`
  Implementa idempotência para nós com side effects usando `executionId + nodeId + sequence`, com persistência do registro junto da instância para sobreviver à reidratação/restart lógico.

- `processInstanceInspector.js`
  Expõe utilidades de inspeção para debug e auditoria.

## Waiting states duráveis

Os seguintes tipos já são tratados explicitamente:

- `timer`
- `message`
- `human`
- `subprocess`
- `external_event`

Ao entrar em waiting, o runtime:

1. atualiza `ProcessInstance.status = waiting`
2. persiste `waitingState`
3. registra `NODE_WAITING`
4. interrompe o loop mantendo contexto e sequência

Ao retomar, o runtime:

1. carrega a instância
2. reconstrói o contexto
3. registra `PROCESS_RESUMED` e `NODE_RESUMED`
4. limpa o `waitingState`
5. continua a execução

## Híbrido com runtime atual

O runtime durável aceita:

- `CanonicalProcessDefinition`
- `CompiledProcessDefinition`
- `EngineFlow`, via adapter `EngineFlow -> Canonical -> CompiledProcessDefinition`

Isso permite adoção gradual sem remover o runtime legado de `engine/`.

## Replay

O replay atual é lógico:

- reconstrói `currentNodeId`
- reconstrói `variables`
- reconstrói `status`
- reconstrói `waitingState`
- reconstrói trilha resumida

Ele não reexecuta side effects externos.

Quando o `CompiledProcessDefinition` estiver disponível, a reidratação prioriza o event log persistido. Se o processo compilado ainda não tiver sido re-registrado, o runtime consegue ao menos reconstruir o contexto a partir do snapshot da instância.

## Persistência vs broadcast

- eventos críticos de execução são persistidos no `ProcessExecutionRepository`
- o `ProcessEventBus` continua publicando eventos para observabilidade em tempo real
- emissões transitórias internas do `ProcessStateMachine` são broadcast-only e não duplicam o event log

## API operacional

Endpoints expostos:

- `GET /api/process-instances`
- `GET /api/process-instances/:executionId`
- `GET /api/process-instances/:executionId/history`
- `POST /api/process-instances/:executionId/cancel`
- `POST /api/process-instances/:executionId/resume`
- `POST /api/process-instances/resume/external`
- `POST /api/process-runtime/start`

## Limitações atuais

- persistência real disponível quando Sequelize/PostgreSQL estiver inicializado; fallback em memória continua existindo
- idempotência básica, ainda sem coordenação distribuída
- idempotência já sobrevive a restart lógico do runtime, mas ainda não possui coordenação distribuída/multi-réplica
- replay lógico, não replay total de efeitos
- recovery automático de timers ainda depende da aplicação chamar `recoverRuntimeState()` ou `recoverPendingTimers()`
