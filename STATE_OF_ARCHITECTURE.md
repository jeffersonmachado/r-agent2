# State of Architecture

Data da auditoria: 2026-03-12

## Escopo auditado

Áreas analisadas com foco principal:

- `frontend/src/process-canonical/`
- `frontend/src/process-adapters/`
- `frontend/src/editor/`
- `frontend/src/pages/FlowEditorPage.jsx`
- `frontend/src/engine-mapper/`
- `api/core/process-runtime/`
- integração por `api/services/durableProcessService.js`
- rotas por `api/serverHandlers/processRuntimeRoutes.js`
- persistência Sequelize em `api/db/models/` e `api/db/migrations/`
- testes unitários e frontend relacionados ao runtime/processo/BPMN/canonical

## Resumo executivo

O repositório já possui uma base arquitetural relevante para:

- modelo canônico no frontend
- adapters `Rete <-> Canonical <-> EngineFlow`
- compilação determinística
- runtime durável no backend
- persistência de instância e event log
- replay lógico
- resume por timer, correlação, tarefa humana e evento externo
- observability básica
- idempotência básica
- adapter BPMN existente, porém centrado em `EngineFlow`, não em `CanonicalProcessDefinition`

O estado real, porém, ainda está abaixo da arquitetura alvo completa.

Hoje a arquitetura efetiva é aproximadamente:

`FlowEditor/Rete -> CanonicalProcessDefinition -> Canonical Compiler -> EngineFlowDefinition ou CompiledProcessDefinition -> Durable Runtime -> ProcessInstanceStore/Event Log`

As camadas abaixo ainda não existem de forma materializada ou estão apenas parcialmente presentes:

- analytics de processo
- simulation engine de processo
- intelligence/optimization
- observability persistente e consultável por serviço dedicado
- BPMN adapter canônico explícito (`bpmnToCanonical.js`, `canonicalToBpmn.js`)
- integração de analytics/simulation/intelligence no editor

## Arquitetura alvo vs estado real

| Camada alvo | Estado real |
| --- | --- |
| Editor / UI | Implementado |
| Canonical Process Model | Implementado |
| Compiler | Implementado |
| ExecutionGraph | Implementado |
| Durable Process Runtime | Implementado parcialmente, mas funcional |
| Process Instance Store | Implementado |
| Execution Event Log | Implementado |
| Replay Engine | Implementado parcialmente |
| Resume Engine | Implementado parcialmente |
| Observability | Implementado parcialmente |
| Process Analytics | Ausente |
| Simulation Engine | Ausente como camada arquitetural alvo |
| Process Intelligence / Optimization | Ausente |

## 1. Componentes implementados

### Frontend: canonical + adapters + editor pipeline

- `frontend/src/process-canonical/canonicalTypes.js`
  Define taxonomia canônica e mapeamentos base.
- `frontend/src/process-canonical/canonicalNormalizer.js`
  Normaliza shape de processo, nós e arestas.
- `frontend/src/process-canonical/canonicalValidator.js`
  Faz validação semântica adicional.
- `frontend/src/process-canonical/canonicalCompiler.js`
  Compila para estrutura determinística com `executionGraph`.
- `frontend/src/process-adapters/reteToCanonical.js`
  Converte o JSON do editor para canônico.
- `frontend/src/process-adapters/canonicalToEngineFlow.js`
  Converte canônico para `EngineFlow`.
- `frontend/src/process-adapters/engineFlowToCanonical.js`
  Converte `EngineFlow` para canônico.
- `frontend/src/engine-mapper/engineMapper.js`
  Mantém compatibilidade pública do editor e orquestra conversões.
- `frontend/src/state/editorStore.jsx`
  Salva e valida passando por `Rete -> Canonical -> Engine`.
- `frontend/src/pages/FlowEditorPage.jsx`
  Já injeta validação canônica no fluxo de edição.

### Backend: durable runtime

Arquivos presentes e funcionais:

- `api/core/process-runtime/processRuntimeService.js`
- `api/core/process-runtime/processStateMachine.js`
- `api/core/process-runtime/processExecutionContext.js`
- `api/core/process-runtime/processEventBus.js`
- `api/core/process-runtime/processTimerService.js`
- `api/core/process-runtime/processInstanceTypes.js`
- `api/core/process-runtime/processInstanceStore.js`
- `api/core/process-runtime/processExecutionRepository.js`
- `api/core/process-runtime/processReplayService.js`
- `api/core/process-runtime/processResumeService.js`
- `api/core/process-runtime/processInstanceInspector.js`
- `api/core/process-runtime/processPayloadValidator.js`
- `api/core/process-runtime/processCompiledDefinitionRepository.js`

Capacidades efetivamente existentes:

- criação de instância persistida
- snapshot de variáveis/contexto
- status `pending/running/waiting/completed/failed/cancelled`
- waiting states duráveis para:
  - `timer`
  - `message`
  - `human`
  - `subprocess`
  - `external_event`
- event log persistido com sequência monotônica
- replay lógico por eventos ou fallback por snapshot da instância
- resume por executionId, correlationKey, timer e human task
- recuperação de timers pendentes após restart lógico do runtime
- subprocesso assíncrono com retorno ao pai
- timeout por nó
- cancelamento explícito
- validação de payload de resume via JSON Schema/AJV

### Persistência e modelos

Persistência backend identificada:

- `executions`
  usada como store de instâncias duráveis
- `process_execution_events`
  usada como event log do runtime durável
- `process_compiled_definitions`
  usada para persistir definições compiladas

Arquivos principais:

- `api/db/models/Execution.js`
- `api/db/models/ProcessExecutionEvent.js`
- `api/db/models/ProcessCompiledDefinition.js`
- `api/db/migrations/20260312120000-create-durable-process-runtime.js`

### Integração operacional

- `api/services/durableProcessService.js`
  expõe singleton do runtime e recuperação inicial
- `api/serverHandlers/processRuntimeRoutes.js`
  expõe endpoints operacionais para start/list/inspect/resume/cancel
- `frontend/src/api/processRuntime.js`
  consome a API de instâncias
- `frontend/src/pages/AutomationsPage.jsx`
  já possui inspeção/cancel/resume de instâncias

### BPMN

Existe uma implementação BPMN relevante em:

- `frontend/src/bpmn/`

Capacidades observadas:

- `engineFlowToBpmnXml.js`
- `bpmnXmlToEngineFlow.js`
- validação de compatibilidade
- round-trip com cobertura de testes
- suporte adicional a gateways paralelos, boundary events, message flows, pools/lanes e DI

Conclusão sobre BPMN:

- há adapter BPMN real
- ele é centrado em `EngineFlow`
- ele não está exposto como `bpmnToCanonical.js` / `canonicalToBpmn.js`
- portanto atende parcialmente à fase BPMN, mas não na forma arquitetural alvo pedida

## 2. Componentes parcialmente implementados

### Durable Process Runtime

O runtime durável já existe e tem boa cobertura unitária, mas ainda é parcial em termos arquiteturais:

- replay é lógico, não replay total de side effects
- resume depende de reidratação via runtime singleton ou resolução explícita de processo compilado
- timers duráveis existem, porém o mecanismo é baseado em `setTimeout` local mais recuperação posterior
- persistência real depende de Sequelize/PostgreSQL estar inicializado; caso contrário cai para memória
- waiting states estão persistidos, mas não existe scheduler distribuído

### ProcessReplayService

Já implementado, porém:

- reconstrói estado lógico
- não reexecuta efeitos
- depende da disponibilidade da definição compilada para replay completo baseado em eventos
- sem controle formal de “replay safe side effects”

### ProcessResumeService

Já implementado, porém:

- resume por tipos suportados existe
- não há camada separada de policy/retry/backoff para retomadas
- não há coordenação distribuída para eventos externos concorrentes

### ProcessTimerService

Já implementado, porém:

- timers em execução vivem em memória do processo Node
- durabilidade é viabilizada por `waitingState.resumeAt` + recuperação/reagendamento
- não existe fila/scheduler persistente dedicado
- não existe lock para múltiplas instâncias do servidor

### ProcessExecutionContext

Já implementado e serializável, porém:

- snapshot é suficiente para contexto básico
- não há versionamento explícito do schema do contexto
- não há separação formal entre contexto mutável, metadata operacional e telemetry

### ProcessIdempotencyService

Arquivo já existe: `api/core/process-runtime/processIdempotencyService.js`

Mas está apenas parcialmente implementado:

- somente backend em memória
- chave atual usa `executionId + nodeId + attempt`
- a arquitetura alvo pede `executionId + nodeId + sequence`
- não há persistência nem coordenação cross-restart/cross-instance
- não há ledger explícito por side effect

### ProcessObservabilityService

Arquivo já existe: `api/core/process-runtime/processObservabilityService.js`

Mas está parcial:

- guarda registros em memória
- calcula duração simples a partir de `NODE_ENTER`/`NODE_EXIT`
- não persiste visão agregada
- não expõe consultas analíticas
- não materializa todos os campos desejados da fase de observability

### BPMN Adapter

Parcial porque:

- há import/export BPMN robusto
- mas o alvo pedido é adapter canônico explícito
- não há pasta `frontend/src/bpmn-adapter/`
- o contrato atual é `BPMN <-> EngineFlow`, não `BPMN <-> Canonical`

### Editor integration

Parcial porque:

- `FlowEditorPage.jsx` já exibe validação canônica
- ainda não exibe:
  - complexidade
  - nós inalcançáveis como seção dedicada de analytics
  - gargalos
  - insights de simulation/intelligence

## 3. Componentes ausentes

### Process Analytics

Ausente como módulo arquitetural.

Não existe:

- `api/core/process-analytics/`
- `processAnalyticsService.js`
- `processBottleneckService.js`
- `processVersionComparisonService.js`

Também não há API dedicada de métricas por processo/nó/gateway construída sobre `process_execution_events`.

### Process Simulation

Ausente como módulo backend alvo.

Não existe:

- `api/core/process-simulation/`
- `processSimulationService.js`
- `processComplexityService.js`

Observação:

- existe `frontend/src/simulator/`, mas trata simulação/conversa de UI, não engine arquitetural de análise estática/dinâmica de processos.

### Process Intelligence / Optimization

Ausente.

Não existe:

- `api/core/process-intelligence/`
- `processOptimizationService.js`
- `processGapAnalysisService.js`
- `processRecommendationService.js`

### Observability persistente/consultável

Apesar de existir serviço básico em memória, faltam:

- armazenamento estruturado de observability
- API/consultas especializadas
- materialização de duração, erro, fallback e metadata com foco analítico

### Adapter canônico BPMN explícito

Faltam exatamente os artefatos pedidos:

- `bpmnToCanonical.js`
- `canonicalToBpmn.js`

### Integração de analytics no editor

Falta acoplar ao `FlowEditorPage.jsx`:

- warnings analíticos
- score de complexidade
- unreachable nodes como relatório estruturado
- gargalos

### Documentação alvo

Já existe `docs/DURABLE_PROCESS_RUNTIME_ARCHITECTURE.md`, mas faltam:

- `docs/PROCESS_ANALYTICS.md`
- `docs/PROCESS_SIMULATION.md`
- `docs/PROCESS_INTELLIGENCE.md`

## 4. Dependências técnicas

### Backend

Dependências identificadas em `package.json`:

- `sequelize`
- `pg`
- `pg-hstore`
- `umzug`
- `ajv`
- `uuid`
- `ws`
- `ioredis`

Dependências arquiteturais do runtime:

- PostgreSQL via Sequelize para persistência real
- fallback in-memory para execução sem DB
- JSONB como formato dominante de snapshot/event payload
- AJV para schema validation de resume

### Frontend

Dependências identificadas em `frontend/package.json`:

- `react`
- `vite`
- `vitest`
- `rete` e plugins do ecossistema Rete

Dependências arquiteturais do editor:

- Rete como editor visual
- adapters locais para canonical/engine
- import/export BPMN local no frontend

### Storage efetivamente usado

Storage encontrado:

- PostgreSQL/Sequelize
  - `executions`
  - `process_execution_events`
  - `process_compiled_definitions`
  - `flows`
  - `flow_executions`
  - `node_executions`
- JSONB como payload principal
- memória local como fallback do runtime
- Redis aparece no projeto, mas não é dependência direta do runtime durável atual

## 5. Padrões de service / repository identificados

### Padrão no runtime novo

Padrão predominante:

- service orquestrador
- stores/repositories separados
- fallback in-memory + implementação Sequelize
- injeção opcional de executores
- singleton operacional via `durableProcessService`

Exemplos:

- `ProcessRuntimeService`
  coordena execução
- `ProcessInstanceStore`
  abstrai instâncias
- `ProcessExecutionRepository`
  abstrai event log
- `ProcessCompiledDefinitionRepository`
  abstrai definição compilada

### Padrão no resto do sistema

O projeto é híbrido:

- partes novas seguem serviço/repositório razoavelmente limpo
- partes legadas concentram muita lógica em `api/server.js`
- existe runtime legado em `engine/`
- existe execution ledger paralelo em `flow_executions/node_executions`

Conclusão:

- o runtime novo está arquiteturalmente mais organizado que o backend legado
- a aplicação como um todo ainda não está completamente convergida para esse padrão

## 6. Estrutura de eventos identificada

Eventos persistidos/usados no runtime:

- `PROCESS_STARTED`
- `PROCESS_RESUMED`
- `PROCESS_COMPLETED`
- `PROCESS_FAILED`
- `PROCESS_CANCELLED`
- `PROCESS_TIMEOUT`
- `NODE_ENTER`
- `NODE_EXIT`
- `NODE_WAITING`
- `NODE_RESUMED`
- `NODE_ERROR`
- `NODE_TIMEOUT`
- `GATEWAY_DECISION`
- `HUMAN_HANDOFF`
- `SUBPROCESS_ENTER`
- `SUBPROCESS_EXIT`
- `NODE_FALLBACK`

Shape persistido em `process_execution_events`:

- `event_id`
- `execution_id`
- `sequence`
- `process_id`
- `process_version`
- `node_id`
- `node_type`
- `event_type`
- `timestamp`
- `payload`
- `metadata`

Conclusão:

- há estrutura suficiente para analytics futuro
- a taxonomia de eventos já cobre boa parte da observability alvo
- ainda falta serviço analítico que materialize essas informações

## 7. Integração com runtime atual

### Coexistência com runtime legado

Há coexistência clara entre:

- runtime legado em `engine/`
- runtime novo em `api/core/process-runtime/`

O runtime novo aceita:

- `CompiledProcessDefinition`
- `CanonicalProcessDefinition`
- `EngineFlow`, via adapter híbrido

### Caminho de adoção atual

No frontend:

- editor salva `EngineFlow`
- validação passa por canônico

No backend:

- `durableProcessService` resolve `Flow.data`
- tenta usar definição compilada persistida
- se necessário recompila a partir do fluxo salvo

Conclusão:

- já existe compatibilidade retroativa com o runtime atual
- a migração está em modo híbrido, não em substituição total

## 8. Testes existentes

### Backend runtime

Testes encontrados:

- `tests/unit/processRuntime.test.js`
- `tests/unit/processDurableRuntime.test.js`
- `tests/unit/processReplayService.test.js`
- `tests/unit/processResumeService.test.js`
- `tests/unit/processInstanceStore.test.js`
- `tests/unit/processExecutionRepository.test.js`
- `tests/unit/processStateMachine.test.js`
- `tests/unit/processExecutionContext.test.js`

Cobertura funcional observada nesses testes:

- start process
- timer wait
- message wait
- human resume
- replay
- restart lógico com reidratação
- idempotência básica
- cancelamento
- timeout
- resume schema validation
- subprocess assíncrono
- não duplicação de eventos transitórios
- compatibilidade com engine flow

Resultado executado na auditoria:

- 8 suítes backend do runtime executadas com sucesso
- 27 testes passando

### Frontend canonical/BPMN

Testes encontrados e executados:

- `frontend/src/process-canonical/canonicalProcess.test.js`
- `frontend/src/process-canonical/canonicalValidator.test.js`
- `frontend/src/process-adapters/reteCanonicalAdapter.test.js`
- `frontend/src/engine-mapper/engineMapper.ports.test.js`
- `frontend/src/bpmn/bpmnRoundTrip.test.js`
- `frontend/src/bpmn/validateBpmnCompatibility.test.js`

Resultado executado na auditoria:

- 6 arquivos de teste executados com sucesso
- 17 testes passando

### Lacunas de teste frente ao alvo

Ainda faltam explicitamente como suíte dedicada:

- `processAnalytics.test.js`
- `processSimulation.test.js`
- `processComplexity.test.js`

Também falta cobertura dedicada para:

- restart real com persistência em banco
- idempotência persistente após restart
- recovery multi-instância
- analytics agregados por processo/nó/gateway

## 9. Riscos arquiteturais

### Risco 1: durabilidade parcial por fallback em memória

Se o banco não estiver inicializado, o runtime funciona em memória.

Impacto:

- “durable runtime” deixa de ser realmente durável
- restart real perde execução

### Risco 2: timer durável não distribuído

O timer depende de `setTimeout` local e posterior recuperação.

Impacto:

- em ambiente com múltiplas réplicas pode haver disputa/duplicação
- não há scheduler/lock distribuído

### Risco 3: idempotência insuficiente para restart/replay distribuído

A implementação atual é in-memory e usa `attempt`, não `sequence`.

Impacto:

- replay/restart cross-process pode reexecutar side effects
- não atende ainda ao critério alvo de proteção forte

### Risco 4: observability não persistida como camada própria

Observability atual é somente uma coleção em memória assinando o event bus.

Impacto:

- perde-se ao reiniciar
- não há consulta histórica especializada
- analytics futuros terão de se apoiar diretamente no event log bruto

### Risco 5: duplicidade de modelos de execução no sistema

Existem em paralelo:

- `executions`
- `process_execution_events`
- `flow_executions`
- `node_executions`
- runtime legado em `engine/`

Impacto:

- arquitetura fragmentada
- risco de métricas inconsistentes
- maior custo de manutenção e migração

### Risco 6: `api/server.js` com erro de sintaxe

Foi encontrado erro sintático real em:

- `api/server.js` na linha próxima de `11230`

Trecho auditado:

- `logger.error('Erro ao enviar mensagem:', err);`
  aparece em posição inválida dentro de uma lista de propriedades

Impacto:

- quebra partes da suíte Jest
- indica fragilidade estrutural fora do runtime novo

### Risco 7: forte dependência de `Flow.data` como source of truth híbrido

O runtime compilado persiste definição própria, mas ainda cai em `flows.data`.

Impacto:

- pode haver divergência entre fluxo salvo, fluxo compilado e comportamento em runtime

### Risco 8: replay depende da definição compilada correta

Sem `CompiledProcessDefinition` resolvido, a reconstrução recai para snapshot da instância.

Impacto:

- replay completo e auditabilidade ficam degradados

## 10. Inconsistências encontradas

### Inconsistência 1: documentação e pedido vs código real

O pedido tratou `processIdempotencyService.js` e `processObservabilityService.js` como futuras fases, mas ambos já existem.

Conclusão:

- não estão ausentes
- estão presentes, porém incompletos

### Inconsistência 2: BPMN existe, mas em outro contrato arquitetural

O projeto já possui adapter BPMN real em `frontend/src/bpmn/`, mas não na forma pedida.

Conclusão:

- não é correto classificá-lo como ausente total
- o correto é “parcial e desalinhado ao contrato alvo”

### Inconsistência 3: nome do documento alvo

No repositório já existe:

- `docs/DURABLE_PROCESS_RUNTIME_ARCHITECTURE.md`

O enunciado cita:

- `docs/DURABLE_RUNTIME_ARCHITECTURE.md`

Conclusão:

- há documentação próxima, mas com nome divergente

### Inconsistência 4: arquitetura canônica do frontend vs runtime consumindo EngineFlow

O frontend já opera fortemente com camada canônica, mas o backend ainda aceita e recompila `EngineFlow`.

Conclusão:

- a arquitetura está em transição
- ainda não existe alinhamento ponta a ponta totalmente canônico

### Inconsistência 5: testes do runtime existem, mas a suíte global está contaminada

Os testes relevantes do runtime passam, porém a suíte principal é afetada por erro sintático em outra área.

Conclusão:

- o estado real do runtime é melhor do que a saúde global do repositório sugere
- a baseline de CI ainda está fragilizada

## 11. Plano incremental do que falta

### Fase A: estabilização da baseline

Objetivo:

- remover ruídos antes de ampliar arquitetura

Itens:

- corrigir o erro sintático de `api/server.js`
- confirmar execução verde da suíte relevante do backend/frontend
- definir se o runtime durável exige banco obrigatório em determinados ambientes

### Fase B: fechar durable runtime de forma estrita

Itens:

- persistir idempotência em storage durável
- trocar chave para `executionId + nodeId + sequence`
- validar restart real com banco
- endurecer recovery de timer
- definir estratégia para múltiplas instâncias
- adicionar testes explícitos de restart real

### Fase C: observability de verdade

Itens:

- evoluir `ProcessObservabilityService`
- persistir atributos estruturados necessários
- expor consulta por execução/processo/nó
- decidir se observability deriva do event log ou gera tabela materializada

### Fase D: process analytics

Itens:

- criar `api/core/process-analytics/`
- implementar métricas por processo/nó/gateway
- decidir entre consulta online no event log e snapshots agregados

### Fase E: simulation engine

Itens:

- criar `api/core/process-simulation/`
- implementar análise estática do grafo compilado/canônico
- emitir:
  - `reachableNodes`
  - `unreachableNodes`
  - `terminalPaths`
  - `loops`
  - `complexityScore`

### Fase F: BPMN canônico

Itens:

- reaproveitar `frontend/src/bpmn/`
- introduzir adapter explícito:
  - `bpmnToCanonical.js`
  - `canonicalToBpmn.js`
- manter compatibilidade com `EngineFlow`

### Fase G: intelligence / optimization

Itens:

- criar `api/core/process-intelligence/`
- derivar recomendações a partir de analytics + simulation + observability

### Fase H: integração no editor

Itens:

- mostrar warnings analíticos
- mostrar complexidade
- mostrar nós inalcançáveis
- mostrar gargalos
- fazer isso sem poluir `FlowEditorPage.jsx`

## 12. Recomendação arquitetural

Direção recomendada:

1. Não reescrever o runtime atual.
2. Consolidar o runtime durável já existente.
3. Tratar analytics/simulation/intelligence como camadas derivadas do event log já implantado.
4. Reaproveitar o adapter BPMN existente, reposicionando-o em torno do modelo canônico.
5. Evitar criar uma terceira via de execução paralela ao `engine/` e ao runtime durável atual.

## Conclusão

O projeto não está no ponto zero. A base central do runtime durável e da camada canônica já foi construída e testada.

O gap principal não está mais em “criar o runtime”, e sim em:

- endurecer a durabilidade e a idempotência
- materializar observability/analytics
- adicionar simulation/intelligence
- alinhar BPMN ao modelo canônico
- consolidar a integração dessas camadas no editor

Em outras palavras:

- `Durable Runtime`: presente e funcional
- `Replay/Resume`: presentes e funcionais, porém ainda não completos para cenários distribuídos
- `Observability`: presente, mas básica
- `Analytics/Simulation/Intelligence`: ainda não implementados
- `BPMN`: presente, mas no eixo errado da arquitetura alvo
