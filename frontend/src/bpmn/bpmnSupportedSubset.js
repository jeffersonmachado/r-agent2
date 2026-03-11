export const BPMN_SUBSET_VERSION = 'mvp-v1';

export const BPMN_SUPPORTED_SUBSET = Object.freeze({
  events: Object.freeze([
    'bpmn:startEvent',
    'bpmn:endEvent',
    'bpmn:intermediateCatchEvent:timer',
  ]),
  activities: Object.freeze([
    'bpmn:serviceTask',
    'bpmn:scriptTask',
    'bpmn:userTask',
    'bpmn:receiveTask',
    'bpmn:sendTask',
    'bpmn:callActivity',
  ]),
  gateways: Object.freeze([
    'bpmn:exclusiveGateway',
  ]),
  flows: Object.freeze([
    'bpmn:sequenceFlow',
  ]),
});

export const BPMN_DEGRADATION_TARGETS = Object.freeze([
  'bpmn:parallelGateway',
  'bpmn:inclusiveGateway',
  'bpmn:eventBasedGateway',
  'bpmn:boundaryEvent',
  'bpmn:participant',
  'bpmn:laneSet',
  'bpmn:messageFlow',
  'bpmn:subProcess:expanded',
  'bpmn:signalEventDefinition',
  'bpmn:compensationEventDefinition',
]);

export function getSupportedBpmnElements() {
  return [
    ...BPMN_SUPPORTED_SUBSET.events,
    ...BPMN_SUPPORTED_SUBSET.activities,
    ...BPMN_SUPPORTED_SUBSET.gateways,
    ...BPMN_SUPPORTED_SUBSET.flows,
  ];
}

export function isSupportedBpmnElement(elementName) {
  return getSupportedBpmnElements().includes(String(elementName || '').trim());
}

export function isDegradationTarget(elementName) {
  return BPMN_DEGRADATION_TARGETS.includes(String(elementName || '').trim());
}
