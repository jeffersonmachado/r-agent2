import { shouldAttachExtension } from './bpmnExtensions';

export const BPMN_COMPATIBILITY_STATUS = Object.freeze({
  SUPPORTED: 'suportado',
  SUPPORTED_WITH_DEGRADATION: 'suportado com degradacao',
  SUPPORTED_VIA_EXTENSION: 'suportado via extensao do r-agent2',
  NOT_SUPPORTED: 'nao suportado',
});

export const BPMN_NODE_MAPPING = Object.freeze({
  start: {
    bpmnElement: 'bpmn:startEvent',
    status: BPMN_COMPATIBILITY_STATUS.SUPPORTED,
  },
  end: {
    bpmnElement: 'bpmn:endEvent',
    status: BPMN_COMPATIBILITY_STATUS.SUPPORTED,
  },
  message: {
    bpmnElement: 'bpmn:sendTask',
    alternatives: ['bpmn:intermediateThrowEvent:message'],
    status: BPMN_COMPATIBILITY_STATUS.SUPPORTED_WITH_DEGRADATION,
  },
  user_input: {
    bpmnElement: 'bpmn:receiveTask',
    alternatives: ['bpmn:intermediateCatchEvent:message'],
    status: BPMN_COMPATIBILITY_STATUS.SUPPORTED_WITH_DEGRADATION,
  },
  router: {
    bpmnElement: 'bpmn:exclusiveGateway',
    status: BPMN_COMPATIBILITY_STATUS.SUPPORTED,
  },
  schedule_router: {
    bpmnElement: 'bpmn:exclusiveGateway',
    status: BPMN_COMPATIBILITY_STATUS.SUPPORTED_VIA_EXTENSION,
  },
  options: {
    bpmnElement: 'bpmn:exclusiveGateway',
    status: BPMN_COMPATIBILITY_STATUS.SUPPORTED_WITH_DEGRADATION,
  },
  api: {
    bpmnElement: 'bpmn:serviceTask',
    status: BPMN_COMPATIBILITY_STATUS.SUPPORTED_VIA_EXTENSION,
  },
  ai_task: {
    bpmnElement: 'bpmn:serviceTask',
    status: BPMN_COMPATIBILITY_STATUS.SUPPORTED_VIA_EXTENSION,
  },
  ai: {
    bpmnElement: 'bpmn:serviceTask',
    status: BPMN_COMPATIBILITY_STATUS.SUPPORTED_VIA_EXTENSION,
  },
  set_variable: {
    bpmnElement: 'bpmn:scriptTask',
    status: BPMN_COMPATIBILITY_STATUS.SUPPORTED,
  },
  format_date: {
    bpmnElement: 'bpmn:scriptTask',
    status: BPMN_COMPATIBILITY_STATUS.SUPPORTED,
  },
  generate_uuid: {
    bpmnElement: 'bpmn:scriptTask',
    status: BPMN_COMPATIBILITY_STATUS.SUPPORTED,
  },
  random_number: {
    bpmnElement: 'bpmn:scriptTask',
    status: BPMN_COMPATIBILITY_STATUS.SUPPORTED,
  },
  get_current_time: {
    bpmnElement: 'bpmn:scriptTask',
    status: BPMN_COMPATIBILITY_STATUS.SUPPORTED,
  },
  get_user_info: {
    bpmnElement: 'bpmn:scriptTask',
    alternatives: ['bpmn:serviceTask'],
    status: BPMN_COMPATIBILITY_STATUS.SUPPORTED_WITH_DEGRADATION,
  },
  handoff: {
    bpmnElement: 'bpmn:userTask',
    status: BPMN_COMPATIBILITY_STATUS.SUPPORTED_VIA_EXTENSION,
  },
  subflow: {
    bpmnElement: 'bpmn:callActivity',
    status: BPMN_COMPATIBILITY_STATUS.SUPPORTED,
  },
  delay: {
    bpmnElement: 'bpmn:intermediateCatchEvent:timer',
    status: BPMN_COMPATIBILITY_STATUS.SUPPORTED,
  },
  fallback: {
    bpmnElement: 'ragent2:fallbackPolicy',
    status: BPMN_COMPATIBILITY_STATUS.SUPPORTED_WITH_DEGRADATION,
  },
  get_flow_info: {
    bpmnElement: 'bpmn:scriptTask',
    status: BPMN_COMPATIBILITY_STATUS.SUPPORTED_VIA_EXTENSION,
  },
  get_queue_status: {
    bpmnElement: 'bpmn:serviceTask',
    status: BPMN_COMPATIBILITY_STATUS.SUPPORTED_VIA_EXTENSION,
  },
  get_config_value: {
    bpmnElement: 'bpmn:scriptTask',
    status: BPMN_COMPATIBILITY_STATUS.SUPPORTED_VIA_EXTENSION,
  },
  list_flows: {
    bpmnElement: 'bpmn:serviceTask',
    status: BPMN_COMPATIBILITY_STATUS.SUPPORTED_VIA_EXTENSION,
  },
});

export function getNodeBpmnMapping(nodeType) {
  return BPMN_NODE_MAPPING[String(nodeType || '').trim()] || null;
}

export function isNodeTypeMapped(nodeType) {
  return !!getNodeBpmnMapping(nodeType);
}

export function isNodeTypeSupported(nodeType) {
  const mapping = getNodeBpmnMapping(nodeType);
  if (!mapping) return false;
  return mapping.status !== BPMN_COMPATIBILITY_STATUS.NOT_SUPPORTED;
}

export function requiresExtension(nodeType) {
  const mapping = getNodeBpmnMapping(nodeType);
  if (!mapping) return false;

  if (mapping.status === BPMN_COMPATIBILITY_STATUS.SUPPORTED_VIA_EXTENSION) {
    return true;
  }

  return shouldAttachExtension(nodeType);
}

export function getAllMappedNodeTypes() {
  return Object.keys(BPMN_NODE_MAPPING);
}

export function getMappingsByStatus(status) {
  const statusKey = String(status || '').trim();
  return Object.entries(BPMN_NODE_MAPPING)
    .filter(([, mapping]) => mapping.status === statusKey)
    .map(([nodeType, mapping]) => ({ nodeType, ...mapping }));
}
