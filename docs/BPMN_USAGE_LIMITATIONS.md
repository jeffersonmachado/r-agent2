# Guia de Uso e Limitacoes BPMN (MVP)

## Objetivo
Este guia descreve o que o BPMN do r-agent2 suporta hoje no editor, o que pode degradar e o que ainda esta fora de escopo no MVP.

## Como usar no editor
No editor (`/editor`), a barra superior oferece tres acoes BPMN:
- Importar BPMN XML
- Exportar BPMN (simples)
- Exportar BPMN (com extensoes r-agent2)

Tambem existe o botao `BPMN` para ligar/desligar hints visuais de compatibilidade nos nos e conexoes.

## Modo de exportacao
- `BPMN simples`: melhor para interoperabilidade com ferramentas BPMN externas.
- `BPMN com extensoes`: preserva semantica especifica do r-agent2 via `extensionElements`.

Recomendacao pratica:
- Use `simples` quando o destino e uma ferramenta BPMN de terceiros.
- Use `com extensoes` para round-trip mais fiel dentro do ecossistema r-agent2.

## Subconjunto BPMN suportado (MVP)
Elementos suportados oficialmente:
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

## Nos do editor e comportamento
Resumo por categoria:
- `suportado` (mapeamento direto): `start`, `end`, `router`, `set_variable`, `format_date`, `generate_uuid`, `random_number`, `get_current_time`, `subflow`, `delay`.
- `suportado com degradacao` (pode perder semantica): `message`, `user_input`, `options`, `get_user_info`, `fallback`.
- `suportado via extensao do r-agent2` (fidelidade depende de extensionElements): `api`, `ai_task`, `ai`, `schedule_router`, `handoff`, `get_flow_info`, `get_queue_status`, `get_config_value`, `list_flows`.

Referencia detalhada: `docs/BPMN_NODE_MAPPING.md`.

## Politica de degradacao e warnings
Quando o fluxo ou XML usa recursos fora do subset:
- o sistema importa/exporta o maximo possivel;
- gera warnings explicitos no relatorio;
- evita perda silenciosa.

Na pratica, o relatorio informa itens como:
- elementos degradados;
- elementos ignorados;
- extensoes preservadas;
- extensoes descartadas.

## Limitacoes conhecidas no MVP
Fora de escopo nesta fase:
- BPMN DI completo
- pools e lanes
- message flow
- boundary events
- gateways avancados (`parallel`, `inclusive`, `eventBased`)
- subprocesso expandido com round-trip sem perdas

## Observacoes de round-trip
- Round-trip mais fiel ocorre com `Exportar BPMN (com extensoes)` + `Importar BPMN XML` no r-agent2.
- Em importacao BPMN, IDs internos de nos podem ser remapeados para IDs sequenciais do engine; o ID original BPMN fica preservado em metadados do no (`config.bpmnElementId`).
- Quando um elemento BPMN nao e suportado diretamente, ele pode ser degradado para um alvo compativel (com warning).

## Checklist rapido para interoperabilidade
- Garanta pelo menos um `start` e um `end`.
- Prefira `exclusiveGateway` para roteamento.
- Evite elementos fora do subset MVP.
- Se precisar preservar semantica r-agent2 (`api`, `ai_task`, `handoff`, etc.), exporte com extensoes.
- Revise warnings apos importar/exportar antes de publicar em producao.

## Evolucao planejada
Para detalhes da preparacao tecnica da proxima etapa (BPMN avancado sem regressao no MVP), consulte:
- `docs/BPMN_PHASE9_ARCHITECTURE_PREPARATION.md`

## Flags avancadas (experimental)
O MVP continua como default. Recursos avancados exigem flag explicita em codigo.

Slices atualmente disponiveis:
- `ADVANCED_GATEWAYS`: habilita import/export incremental de `bpmn:parallelGateway`.
- `BOUNDARY_EVENTS`: habilita import/export incremental de `bpmn:boundaryEvent` (timer/error) em modo degradado.
- `MESSAGE_FLOW`: habilita import/export incremental de `bpmn:messageFlow`, `bpmn:participant` e `bpmn:lane` em modo degradado.

Exemplo de uso via API:
- `engineFlowToBpmnXml(flow, { mode: 'simple', flags: { ADVANCED_GATEWAYS: true } })`
- `bpmnXmlToEngineFlow(xml, { flags: { ADVANCED_GATEWAYS: true } })`
- `engineFlowToBpmnXml(flow, { mode: 'simple', flags: { BOUNDARY_EVENTS: true } })`
- `bpmnXmlToEngineFlow(xml, { flags: { BOUNDARY_EVENTS: true } })`
- `engineFlowToBpmnXml(flow, { mode: 'simple', flags: { MESSAGE_FLOW: true } })`
- `bpmnXmlToEngineFlow(xml, { flags: { MESSAGE_FLOW: true } })`

Exemplo BPMN DI (preservacao de layout visual):
```javascript
// Enable BPMN DI to preserve visual layout (coordinates, bounds)
const flow = bpmnXmlToEngineFlow(bpmnXml, { flags: { BPMN_DI: true } });
// Layout information stored in node.config.bpmnDiShape
// When exporting: engineFlowToBpmnXml(flow, { flags: { BPMN_DI: true } })
// generates proper di:shape and di:edge elements
```

Sem essa flag, o comportamento padrao do MVP permanece inalterado.
