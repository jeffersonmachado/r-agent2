# Plano Oficial de Suporte BPMN no r-agent2

## Objetivo
Adicionar suporte BPMN no `/editor` de forma incremental, mantendo:
- editor atual baseado em Rete como authoring principal
- `FlowDefinition` como modelo canônico de execução
- import/export JSON atual sem regressão

O BPMN no MVP deve funcionar como:
- formato de interoperabilidade
- formato de importação/exportação
- notação opcional no editor
- documentação executável do fluxo

## Princípios Não Negociáveis
- Não reescrever o editor.
- Não trocar Rete por outra base.
- Não quebrar `FlowDefinition`.
- Não remover import/export JSON atual.
- Não degradar silenciosamente: toda perda semântica deve virar warning explícito.
- Sempre documentar o que é suportado, degradado e não suportado.

## Contrato de Compatibilidade
- Modelo interno principal: `Rete JSON <-> FlowDefinition`
- Modelo BPMN incremental: `FlowDefinition <-> BPMN 2.0 XML`
- Namespace padrão de extensões r-agent2: `http://r-agent2.io/bpmn/extensions`

## Subconjunto BPMN Inicial (MVP)
Elementos oficialmente suportados nesta primeira versão:
- `bpmn:startEvent`
- `bpmn:endEvent`
- `bpmn:serviceTask`
- `bpmn:scriptTask`
- `bpmn:userTask`
- `bpmn:receiveTask`
- `bpmn:sendTask`
- `bpmn:exclusiveGateway`
- `bpmn:intermediateCatchEvent` com `bpmn:timerEventDefinition`
- `bpmn:callActivity`
- `bpmn:sequenceFlow`

## Estratégia de Implementação por Fase
1. Fase 0: inventário de nós e matriz oficial de mapeamento.
2. Fase 1: contrato canônico em código (`frontend/src/bpmn/*`).
3. Fase 2: exportação `FlowDefinition -> BPMN 2.0 XML`.
4. Fase 3: importação `BPMN 2.0 XML -> FlowDefinition` com relatório de degradação.
5. Fase 4: integração de import/export BPMN na UI do editor.
6. Fase 5: validação BPMN complementar à validação estrutural atual.
7. Fase 6: visual BPMN progressivo sem trocar a base Rete.
8. Fase 7: testes e hardening (mapeamento, parser, round-trip, regressão).
9. Fase 8: documentação de uso e limitações.
10. Fase 9: preparação arquitetural para evolução BPMN avançada.

## Política de Degradação
Quando houver incompatibilidade entre o fluxo e o subconjunto BPMN:
- importar/exportar o máximo possível
- emitir warnings objetivos (sem falha silenciosa)
- registrar no relatório:
  - elementos importados
  - elementos degradados
  - elementos ignorados
  - extensões preservadas
  - extensões descartadas

## Escopo Fora do MVP
Não faz parte da primeira entrega:
- BPMN DI completo
- pools e lanes
- message flow
- boundary events
- gateways avançados (`parallel`, `inclusive`, `eventBased`)
- subprocesso expandido com round-trip sem perdas

## Critério de Sucesso do MVP
- editor atual continua funcionando com fluxos existentes
- exportação BPMN válida do subconjunto suportado
- importação BPMN válida do subconjunto suportado
- degradação controlada para itens não suportados
- UI permite importar/exportar BPMN sem remover JSON
- documentação deixa claro o escopo real de suporte

## Status de Implementação (Atual)
- Fase 0: concluída.
- Fase 1: concluída.
- Fase 2: concluída com os artefatos:
  - `frontend/src/bpmn/bpmnXmlBuilder.js`
  - `frontend/src/bpmn/engineFlowToBpmnXml.js`
- Fase 3: concluída com o artefato:
  - `frontend/src/bpmn/bpmnXmlToEngineFlow.js`
- Fase 4: concluída com integração de UI em:
  - `frontend/src/pages/FlowEditorPage.jsx`
  - `frontend/src/Toolbar.jsx`
- Fase 5: concluída com validação BPMN complementar em:
  - `frontend/src/bpmn/validateBpmnCompatibility.js`
  - `frontend/src/state/editorStore.jsx`
- Fase 6: iniciada com modo visual BPMN progressivo em:
  - `frontend/src/pages/FlowEditorPage.jsx` (toggle persistido)
  - `frontend/src/FlowEditor.jsx` e `frontend/src/editor/createEditor.js` (propagação para nós)
  - `frontend/src/ReteReactPluginShim.jsx` (chip visual por nó)
  - `frontend/src/components/SelectableConnection.jsx` e `frontend/src/index.css` (hints visuais por conexão: suportado/degradado/extensão/não mapeado)
- Fase 7: **concluída** — 101 testes passando em 6 arquivos:
  - `frontend/src/bpmn/bpmnRoundTrip.test.js` (4 testes — export simples/extensões, import com extensões, round-trip)
  - `frontend/src/bpmn/validateBpmnCompatibility.test.js` (3 testes — subset suportado, degradações, start/end)
  - `frontend/src/components/SelectableConnection.test.jsx` (7 testes — classes visuais por conexão: supported/degraded/extension/unmapped)
  - `frontend/src/bpmn/bpmnUnitContracts.test.js` (58 testes — contratos unitários de nodeMapping, extensions, supportedSubset e xmlBuilder)
  - `frontend/src/pages/FlowEditorPage.test.jsx` (3 testes — render, warnings BPMN no painel de validação, toggle BPMN)
  - `frontend/src/bpmn/bpmnEdgeCases.test.js` (26 testes — edge cases de `engineFlowToBpmnXml` e `bpmnXmlToEngineFlow`: fluxo vazio, null, chars especiais, fallback/degradation, loops, subflow, XML malformado, etc.)
- Fase 8: **concluída** com documentação de uso e limitações em:
  - `docs/BPMN_USAGE_LIMITATIONS.md`
- Fase 9: **concluída** com preparação arquitetural incremental para BPMN avançado (sem alterar comportamento MVP):
  - `frontend/src/bpmn/bpmnFeatureFlags.js` (feature flags explícitas para capacidades avançadas)
  - `frontend/src/bpmn/bpmnElementRegistry.js` (registry de handlers de import/export por elemento)
  - `frontend/src/bpmn/bpmnPhase9Architecture.test.js` (7 testes de contrato da arquitetura de extensão)
  - `docs/BPMN_PHASE9_ARCHITECTURE_PREPARATION.md` (diretrizes de evolução, fases futuras e critérios de segurança)
- Fase 9.1: **concluída** com primeiro slice avançado (`parallelGateway`) atrás de flag:
  - `frontend/src/bpmn/bpmnAdvancedGatewayHandlers.js` (handler de import/export para `bpmn:parallelGateway`)
  - `frontend/src/bpmn/engineFlowToBpmnXml.js` (exporta `router` como `parallelGateway` quando `ADVANCED_GATEWAYS=true` e `config.bpmnGatewayType='parallel'`)
  - `frontend/src/bpmn/bpmnXmlToEngineFlow.js` (importa `parallelGateway` como `router` com `config.bpmnGatewayType='parallel'` quando a flag está ativa)
  - `frontend/src/bpmn/bpmnPhase91ParallelGateway.test.js` (testes de contrato com flag OFF/ON em import e export)
- Fase 9.2: **concluída** com primeiro slice de `boundaryEvent` em modo degradado atrás de flag:
  - `frontend/src/bpmn/bpmnBoundaryEventHandlers.js` (handlers para import/export de `bpmn:boundaryEvent` com `timerEventDefinition` e `errorEventDefinition`)
  - `frontend/src/bpmn/engineFlowToBpmnXml.js` (exporta boundary timer quando `BOUNDARY_EVENTS=true`, com `attachedToRef` resolvido)
  - `frontend/src/bpmn/bpmnXmlToEngineFlow.js` (importa boundary timer/error como nós degradados e resolve vínculo `bpmnAttachedToNodeId`)
  - `frontend/src/bpmn/bpmnPhase92BoundaryEvents.test.js` (testes de contrato com flag OFF/ON em import e export)
- Fase 9.3: **concluída** com support para `messageFlow` e `participant`/`lane` em modo degradado atrás de flag:
  - `frontend/src/bpmn/bpmnMessageFlowHandlers.js` (handlers para import/export de `bpmn:messageFlow` com sourceRef/targetRef)
  - `frontend/src/bpmn/bpmnPoolLaneHandlers.js` (handlers para import/export de `bpmn:participant` pools e `bpmn:lane` nodes)
  - `frontend/src/bpmn/engineFlowToBpmnXml.js` (exporta messageFlow quando `MESSAGE_FLOW=true`, com sourceRef/targetRef resolvidos; exporta participant quando `MESSAGE_FLOW=true`)
  - `frontend/src/bpmn/bpmnXmlToEngineFlow.js` (importa messageFlow/participant/lane como nós degradados com flag `MESSAGE_FLOW=true` e resolve vínculo de source/target via `bpmnToEngineNodeId`)
  - `frontend/src/bpmn/bpmnPhase93MessageFlowPoolLanes.test.js` (6 testes de contrato: export simples com flag OFF, export BPMN com flag ON, import com flag OFF, import como degraded com flag ON, cross-ref resolution, round-trip)
- Fase 9.4: **concluída** com BPMN DI (Diagram Interchange) para preservação visual atrás de flag:
  - Features: preservação de layout visual (`bounds` e `waypoints`)
  - Flag: `BPMN_DI` (default `false`)
  - Handler file: `frontend/src/bpmn/bpmnDiagramInterchangeHandlers.js`
  - `frontend/src/bpmn/engineFlowToBpmnXml.js` (gera `bpmn:diagram`/`bpmn:plane` com `di:shape` e `di:edge` quando `BPMN_DI=true`)
  - `frontend/src/bpmn/bpmnXmlToEngineFlow.js` (extrai `di:*` e persiste em `node.config.bpmnDiShape`/`node.config.bpmnDiEdges` quando `BPMN_DI=true`)
  - `frontend/src/bpmn/bpmnPhase94DiagramInterchange.test.js` (5 testes de contrato)
  - Status: slice entregue com comportamento backward-compatible (flag OFF ignora DI)

Observação:
- As Fases 2, 3 e 4 atuais cobrem round-trip incremental `FlowDefinition <-> BPMN 2.0 XML` com ações disponíveis na UI, mantendo import/export JSON existente e warnings/degradação explícitos.
- A Fase 5 adiciona warnings de compatibilidade BPMN no resultado de validação sem alterar a aplicação visual de erros estruturais/backend por nó.
- O preparo da Fase 9 foi validado sem regressão: suíte BPMN atual em `108/108` testes passando.
- O slice da Fase 9.1 mantém default seguro (flag OFF), preservando o comportamento MVP quando nenhuma flag avançada é informada.
- O slice da Fase 9.2 também mantém default seguro (flag OFF) e só ativa boundary events com `flags.BOUNDARY_EVENTS=true`.
- O slice da Fase 9.3 também mantém default seguro (flag OFF) e só ativa messageFlow/participant/lane com `flags.MESSAGE_FLOW=true`.
