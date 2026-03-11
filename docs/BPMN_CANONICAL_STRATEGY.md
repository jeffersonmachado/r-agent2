# BPMN Canonical Strategy

## Principle

BPMN is an interoperability format.
Canonical process is the execution core contract.
Runtime must not depend directly on BPMN XML structures.

## Mapping Direction

### Export
`Canonical -> (canonicalToEngineFlow if needed) -> engineFlowToBpmnXml`

### Import
`bpmnXmlToEngineFlow -> engineFlowToCanonical -> canonical normalize/validate/compile`

## Canonical-to-BPMN Alignment

### Direct mapping candidates
- `start` -> `bpmn:startEvent`
- `end` -> `bpmn:endEvent`
- `gateway.exclusive` -> `bpmn:exclusiveGateway`
- `task.service` -> `bpmn:serviceTask`
- `task.script` -> `bpmn:scriptTask`
- `task.user` -> `bpmn:userTask`
- `task.message.send` -> `bpmn:sendTask`
- `task.message.receive` -> `bpmn:receiveTask`
- `wait.timer` -> `bpmn:intermediateCatchEvent` + timerEventDefinition
- `call.subprocess` -> `bpmn:callActivity`

### Requires extension/degradation handling
- `task.ai`
- `fallback`
- `variable.set`
- `utility.transform`
- `utility.time`
- `utility.uuid`
- `utility.random`

These must be exported either:
1. as best-effort BPMN element + extension metadata, or
2. with explicit degradation warnings.

## Runtime Rule

Runtime executes canonical/compiled process, never raw BPMN XML.

## Incremental Plan

1. Keep existing BPMN engine-flow adapters operational.
2. Add canonical adapters around them.
3. Gradually shift import/export contracts to canonical first.
4. Keep degradation reporting mandatory.

## Compatibility Guarantees

- Existing editor and runtime behavior remains valid.
- BPMN support evolves as adapter capability, not runtime coupling.
- Canonical remains the stable core for all authoring forms.
