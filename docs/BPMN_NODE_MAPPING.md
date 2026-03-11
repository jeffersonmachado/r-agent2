# Matriz Oficial de Mapeamento de Nós para BPMN

Este documento define o mapeamento entre tipos de nó do editor e BPMN 2.0.

## Legenda de Status
- `suportado`: mapeamento direto no subconjunto BPMN MVP.
- `suportado com degradação`: mapeamento parcial; pode haver perda semântica controlada.
- `suportado via extensão do r-agent2`: semântica completa depende de `extensionElements`.
- `não suportado`: sem mapeamento no MVP (deve gerar warning/ignorar com segurança).

## Mapeamento Completo dos Nós Atuais
| Nó do editor | BPMN principal | Status | Observações |
|---|---|---|---|
| `start` | `bpmn:startEvent` | `suportado` | Mapeamento direto. |
| `end` | `bpmn:endEvent` | `suportado` | Mapeamento direto. |
| `message` | `bpmn:sendTask` | `suportado com degradação` | Pode degradar para `intermediateThrowEvent` em import/export externo. |
| `user_input` | `bpmn:receiveTask` | `suportado com degradação` | Pode degradar para `intermediateCatchEvent` de mensagem. |
| `router` | `bpmn:exclusiveGateway` | `suportado` | Regras viram condições em `sequenceFlow`. |
| `schedule_router` | `bpmn:exclusiveGateway` | `suportado via extensão do r-agent2` | Política de agenda/horário em extensão. |
| `options` | `bpmn:exclusiveGateway` | `suportado com degradação` | Semântica de UI de opções pode ser reduzida a condições/saídas. |
| `api` | `bpmn:serviceTask` | `suportado via extensão do r-agent2` | URL, método, headers, auth e timeout em extensão. |
| `ai_task` | `bpmn:serviceTask` | `suportado via extensão do r-agent2` | Provider/model/prompt/guardrails em extensão. |
| `ai` | `bpmn:serviceTask` | `suportado via extensão do r-agent2` | Nó legado; preferir `ai_task` para round-trip mais fiel. |
| `set_variable` | `bpmn:scriptTask` | `suportado` | Mapeamento direto para transformação/atribuição. |
| `format_date` | `bpmn:scriptTask` | `suportado` | Mapeamento direto para transformação. |
| `generate_uuid` | `bpmn:scriptTask` | `suportado` | Mapeamento direto para geração local. |
| `random_number` | `bpmn:scriptTask` | `suportado` | Mapeamento direto para geração local. |
| `get_current_time` | `bpmn:scriptTask` | `suportado` | Mapeamento direto para utilitário temporal. |
| `get_user_info` | `bpmn:scriptTask` | `suportado com degradação` | Pode virar `serviceTask` em cenários externos; padrão MVP: `scriptTask`. |
| `handoff` | `bpmn:userTask` | `suportado via extensão do r-agent2` | Fila/agente/SLA/retomada em extensão. |
| `subflow` | `bpmn:callActivity` | `suportado` | Referência do subfluxo em `calledElement` ou extensão. |
| `delay` | `bpmn:intermediateCatchEvent` + `bpmn:timerEventDefinition` | `suportado` | Mapeamento direto de espera temporizada. |
| `fallback` | extensão r-agent2 | `suportado com degradação` | Pode virar rota alternativa nomeada; semântica completa depende de extensão. |
| `get_flow_info` | `bpmn:scriptTask` | `suportado via extensão do r-agent2` | Leitura de metadados internos do r-agent2. |
| `get_queue_status` | `bpmn:serviceTask` | `suportado via extensão do r-agent2` | Consulta operacional interna/externa via extensão. |
| `get_config_value` | `bpmn:scriptTask` | `suportado via extensão do r-agent2` | Consulta de configuração do r-agent2. |
| `list_flows` | `bpmn:serviceTask` | `suportado via extensão do r-agent2` | Operação de catálogo interno via extensão. |

## Mapeamentos Fortes Obrigatórios (MVP)
- `start` -> Start Event
- `end` -> End Event
- `api` -> Service Task
- `ai_task` -> Service Task com extensões
- `subflow` -> Call Activity
- `delay` -> Intermediate Catch Event com Timer
- `handoff` -> User Task
- `set_variable` -> Script Task
- `format_date` -> Script Task
- `generate_uuid` -> Script Task
- `random_number` -> Script Task
- `get_current_time` -> Script Task
- `get_user_info` -> Script Task (padrão) / Service Task (alternativo)
- `router` -> Exclusive Gateway
- `schedule_router` -> Exclusive Gateway
- `options` -> Exclusive Gateway

## Mapeamentos Parciais Obrigatórios (MVP)
- `message` -> Send Task ou Intermediate Throw Message Event
- `user_input` -> Receive Task ou Intermediate Catch Message Event
- `fallback` -> política de exceção/degradação/rota alternativa do r-agent2

## Situação Atual de Nós Não Suportados
No inventário atual de tipos de nó do editor, não há tipos classificados como `não suportado` nesta fase.

Elementos BPMN externos fora do subconjunto MVP (ex.: `parallelGateway`, `laneSet`, `messageFlow`) continuam fora de suporte e devem ser importados com degradação e warning explícito.
