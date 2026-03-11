# Fase 9 - Preparacao Arquitetural para BPMN Avancado

## Objetivo
Preparar a base tecnica para evoluir o suporte BPMN alem do subset MVP, sem quebrar:
- editor Rete atual
- `FlowDefinition` como modelo canonico
- import/export JSON existente
- comportamento atual de import/export BPMN MVP

## Principio da Fase 9
Esta fase NAO adiciona novos elementos BPMN no runtime MVP.
Ela apenas cria pontos de extensao seguros para crescimento incremental.

## Artefatos Implementados
- `frontend/src/bpmn/bpmnFeatureFlags.js`
- `frontend/src/bpmn/bpmnElementRegistry.js`
- `frontend/src/bpmn/bpmnPhase9Architecture.test.js`
- `frontend/src/bpmn/index.js` (exports dos novos modulos)

## Decisoes Arquiteturais
1. Feature flags explicitas para recursos avancados
- Flags atuais: `ADVANCED_GATEWAYS`, `POOLS_AND_LANES`, `MESSAGE_FLOW`, `BOUNDARY_EVENTS`, `EXPANDED_SUBPROCESS`, `BPMN_DI`.
- Todas com default `false` para garantir compatibilidade com MVP.
- Overrides permitidos por opcao sem mutar o baseline.

2. Registry de handlers por elemento BPMN
- Registro por nome de elemento (ex.: `bpmn:parallelGateway`).
- Handlers opcionais por direcao:
  - `onExport(context)`
  - `onImport(context)`
- Execucao segura: se nao existir handler, retorna `null` e o fluxo segue no comportamento atual.

3. Preservacao do comportamento atual
- Nenhum switch existente de import/export foi removido.
- Nenhuma semantica MVP foi alterada.
- Todas as adicoes sao opt-in e isoladas.

## Contrato de Evolucao
Ao adicionar suporte novo em fases seguintes:
1. Introduzir a capacidade atras de flag `false` por padrao.
2. Implementar handler no registry para import/export.
3. Integrar no parser/exporter principal somente como fallback controlado.
4. Emitir warning explicito em degradacao ou perda semantica.
5. Adicionar testes de contrato e regressao.

## Roadmap Tecnico Sugerido
1. Fase 9.1 - Gateways avancados
- `parallelGateway`, `inclusiveGateway`, `eventBasedGateway`.
- Comecar com importacao degradada + warning; evoluir para round-trip parcial.

2. Fase 9.2 - Boundary events
- Tratar ao menos `timer` e `error` em modo degradado inicial.

3. Fase 9.3 - Pools/Lanes e message flow
- Suporte de interoperabilidade documental (import/export) antes de semantica de execucao.

4. Fase 9.4 - BPMN DI
- Preservar DI no XML para interoperabilidade visual, sem acoplar ao canvas MVP no primeiro passo.

## Riscos e Mitigacoes
- Risco: regressao silenciosa no subset MVP.
  - Mitigacao: defaults sempre `false`, testes de regressao obrigatorios.
- Risco: proliferacao de logica condicional no parser/exporter.
  - Mitigacao: encapsular novas regras em handlers no registry.
- Risco: incompatibilidade com ferramentas BPMN externas.
  - Mitigacao: manter modo `simple` como baseline e warnings claros.

## Estado Atual
- Preparacao arquitetural implementada e validada.
- Suite BPMN atual validada sem regressao apos a Fase 9.

## Fase 9.1 (Primeiro Slice Entregue)
Implementacao inicial de gateway avancado atras de feature flag:
- Elemento: `bpmn:parallelGateway`
- Flag: `ADVANCED_GATEWAYS`
- Comportamento com flag OFF (default): preserva o MVP atual (elemento segue fora do subset suportado).
- Comportamento com flag ON:
  - Export: `router` com `config.bpmnGatewayType='parallel'` vira `bpmn:parallelGateway`.
  - Import: `bpmn:parallelGateway` vira `router` com `config.bpmnGatewayType='parallel'`.

Artefatos do slice 9.1:
- `frontend/src/bpmn/bpmnAdvancedGatewayHandlers.js`
- `frontend/src/bpmn/engineFlowToBpmnXml.js`
- `frontend/src/bpmn/bpmnXmlToEngineFlow.js`
- `frontend/src/bpmn/bpmnPhase91ParallelGateway.test.js`

## Fase 9.2 (Segundo Slice Entregue)
Implementacao inicial de boundary events atras de feature flag, em modo degradado:
- Elementos: `bpmn:boundaryEvent` com `timerEventDefinition` e `errorEventDefinition`
- Flag: `BOUNDARY_EVENTS`
- Comportamento com flag OFF (default): preserva o MVP atual (boundary events seguem fora do subset suportado).
- Comportamento com flag ON:
  - Export: nos marcados com `config.bpmnBoundaryEventType` sao exportados como `bpmn:boundaryEvent`.
  - Import timer: `bpmn:boundaryEvent` + timer vira `delay` degradado.
  - Import error: `bpmn:boundaryEvent` + error vira `fallback` degradado.

Artefatos do slice 9.2:
- `frontend/src/bpmn/bpmnBoundaryEventHandlers.js`
- `frontend/src/bpmn/engineFlowToBpmnXml.js`
- `frontend/src/bpmn/bpmnXmlToEngineFlow.js`
- `frontend/src/bpmn/bpmnPhase92BoundaryEvents.test.js`

## Fase 9.3 (Terceiro Slice Entregue)
Implementacao de message flows e participant pools/lanes atras de feature flag, em modo degradado:
- Elementos: `bpmn:messageFlow`, `bpmn:participant`, `bpmn:lane`
- Flag: `MESSAGE_FLOW`
- Comportamento com flag OFF (default): preserva o MVP atual (elements seguem fora do subset suportado).
- Comportamento com flag ON:
  - Export messageFlow: nos marcados com `config.bpmnMessageFlowType='messageFlow'` sao exportados como `bpmn:messageFlow` com `sourceRef` e `targetRef` resolvidos para IDs de elemento BPMN.
  - Import messageFlow: `bpmn:messageFlow` vira `degradedMessageFlow` node com `bpmnMessageFlowSource` e `bpmnMessageFlowTarget` apontando para node IDs internos (nao BPMN IDs).
  - Export participant: nos marcados com `config.bpmnPoolType=true` sao exportados como `bpmn:participant`.
  - Import participant: `bpmn:participant` vira `degradedPool` node com `bpmnPoolType=true`.
  - Import lane: `bpmn:lane` vira `degradedLane` node com `bpmnParentPoolId` apontando para o pool parent.

Estrategia de degradacao:
- Message flows nao tem semantica de execucao no engine (apenas documentacao).
- Participants/lanes sao importados como nodes simples (perdendo agrupamento visual).
- Cross-references (source/target) sao resolvidas via `bpmnToEngineNodeId` map durante import.

Artefatos do slice 9.3:
- `frontend/src/bpmn/bpmnMessageFlowHandlers.js`
- `frontend/src/bpmn/bpmnPoolLaneHandlers.js`
- `frontend/src/bpmn/engineFlowToBpmnXml.js`
- `frontend/src/bpmn/bpmnXmlToEngineFlow.js`
- `frontend/src/bpmn/bpmnPhase93MessageFlowPoolLanes.test.js`

## Fase 9.4 (Quarto Slice Entregue)
Implementacao incremental de BPMN DI (Diagram Interchange) atras de feature flag:
- Elementos: `bpmn:diagram`, `bpmn:plane`, `di:shape`, `di:edge`, `di:bounds`, `di:waypoint`
- Flag: `BPMN_DI`
- Comportamento com flag OFF (default): DI e ignorado no import e nao e emitido no export.
- Comportamento com flag ON:
  - Import: bounds e waypoints sao extraidos e persistidos no `node.config`.
  - Export: DI e reconstruido com `bpmn:diagram`/`bpmn:plane` e elementos `di:*`.

Estrategia de armazenamento:
- Shape no `node.config.bpmnDiShape`:
  - `{ id, bounds: { x, y, width, height } }`
- Edges no `node.config.bpmnDiEdges`:
  - `{ [sequenceFlowId]: { id?, waypoints: [{ x, y }, ...] } }`

Garantia de round-trip:
- Coordenadas/bounds/waypoints sao preservados sem transformacao de sistema de coordenadas.
- Ordem dos waypoints e mantida para reconstruir o path visual dos conectores.
- Elementos DI orfaos (shape sem flow node correspondente) sao ignorados silenciosamente.

Interoperabilidade:
- XML exportado inclui namespaces `di` e `dc` quando DI estiver ativo e houver dados visuais.
- Ferramentas BPMN/DMN externas podem ler o layout preservado pelos elementos `di:*`.

Artefatos do slice 9.4:
- `frontend/src/bpmn/bpmnDiagramInterchangeHandlers.js`
- `frontend/src/bpmn/engineFlowToBpmnXml.js`
- `frontend/src/bpmn/bpmnXmlToEngineFlow.js`
- `frontend/src/bpmn/bpmnPhase94DiagramInterchange.test.js`
