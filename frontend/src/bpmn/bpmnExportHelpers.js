import {
  closeTag,
  openTag,
  selfClosingTag,
  textTag,
} from './bpmnXmlBuilder';

export function normalizeNodeId(value) {
  const raw = String(value ?? '').trim();
  return raw || null;
}

export function asNodeIdArray(raw) {
  if (Array.isArray(raw)) return raw.map(normalizeNodeId).filter(Boolean);

  const single = normalizeNodeId(raw);
  return single ? [single] : [];
}

export function buildNodeLinks(node) {
  const nodeId = normalizeNodeId(node && node.id);
  if (!nodeId) return [];

  const config = node?.config && typeof node.config === 'object' ? node.config : {};
  const links = [];
  const isParallelGateway =
    node?.type === 'router' && String(config.bpmnGatewayType || '').trim() === 'parallel';

  const conditionByOutputKey = new Map();

  if (!isParallelGateway && Array.isArray(config.rules)) {
    config.rules.forEach((rule, index) => {
      const condition = String(
        (rule && (rule.condition || rule.expression || rule.value || rule.label)) ||
          `rule_${index + 1}`
      ).trim();

      conditionByOutputKey.set(`rule_${index + 1}`, condition);
    });
  }

  if (!isParallelGateway && Array.isArray(config.schedules)) {
    config.schedules.forEach((schedule, index) => {
      const condition = String(
        (schedule && (schedule.when || schedule.label || schedule.name)) ||
          `schedule_${index + 1}`
      ).trim();

      conditionByOutputKey.set(`schedule_${index + 1}`, condition);
    });
  }

  const pushLinks = (targetIds, outputKey, condition) => {
    targetIds.forEach((targetId) => {
      links.push({
        sourceId: nodeId,
        targetId,
        outputKey,
        condition,
      });
    });
  };

  if (node?.next) {
    if (typeof node.next === 'string' || Array.isArray(node.next)) {
      pushLinks(asNodeIdArray(node.next), 'out', null);
    } else if (typeof node.next === 'object') {
      Object.entries(node.next).forEach(([outputKey, rawNext]) => {
        const normalizedOutput = normalizeNodeId(outputKey) || 'out';
        const condition = isParallelGateway
          ? null
          : conditionByOutputKey.get(normalizedOutput) || null;

        pushLinks(asNodeIdArray(rawNext), normalizedOutput, condition);
      });
    }
  }

  if (!isParallelGateway && Array.isArray(config.rules)) {
    config.rules.forEach((rule, index) => {
      pushLinks(
        asNodeIdArray(rule && rule.next),
        `rule_${index + 1}`,
        conditionByOutputKey.get(`rule_${index + 1}`) || null
      );
    });
  }

  if (!isParallelGateway && Array.isArray(config.schedules)) {
    config.schedules.forEach((schedule, index) => {
      pushLinks(
        asNodeIdArray(schedule && schedule.next),
        `schedule_${index + 1}`,
        conditionByOutputKey.get(`schedule_${index + 1}`) || null
      );
    });
  }

  pushLinks(asNodeIdArray(config.defaultNext), 'default', null);

  return links;
}

export function mappingToBpmnTag(mapping) {
  const rawElement = String(mapping?.bpmnElement || '').trim();

  if (!rawElement) {
    return {
      tag: 'bpmn:scriptTask',
      degraded: true,
    };
  }

  if (rawElement === 'bpmn:intermediateCatchEvent:timer') {
    return {
      tag: 'bpmn:intermediateCatchEvent',
      isTimerCatch: true,
    };
  }

  if (rawElement.startsWith('ragent2:')) {
    return {
      tag: 'bpmn:scriptTask',
      degraded: true,
    };
  }

  return {
    tag: rawElement,
  };
}

export function elementPrefix(tag, isTimerCatch) {
  if (isTimerCatch) return 'TimerEvent';

  const prefixByTag = {
    'bpmn:startEvent': 'StartEvent',
    'bpmn:endEvent': 'EndEvent',
    'bpmn:sendTask': 'SendTask',
    'bpmn:receiveTask': 'ReceiveTask',
    'bpmn:exclusiveGateway': 'Gateway',
    'bpmn:parallelGateway': 'Gateway',
    'bpmn:serviceTask': 'ServiceTask',
    'bpmn:scriptTask': 'ScriptTask',
    'bpmn:userTask': 'UserTask',
    'bpmn:callActivity': 'CallActivity',
    'bpmn:intermediateCatchEvent': 'IntermediateCatchEvent',
    'bpmn:boundaryEvent': 'Boundary',
    'bpmn:messageFlow': 'MessageFlow',
    'bpmn:participant': 'Participant',
    'bpmn:lane': 'Lane',
  };

  return prefixByTag[tag] || 'Node';
}

export function nodeLabel(node) {
  const candidates = [
    node?.label,
    node?.name,
    node?.title,
    node?.config?.label,
    node?.config?.name,
    node?.type,
    node?.id,
  ];

  const label = candidates
    .map((value) => String(value || '').trim())
    .find(Boolean);

  return label || 'Node';
}

export function buildNodeElementLines(descriptor) {
  const { tag, attrs, isTimerCatch, extensionLines, boundaryEventType } = descriptor;

  if (tag === 'bpmn:messageFlow') {
    return [selfClosingTag(tag, attrs)];
  }

  if (tag === 'bpmn:participant') {
    return [selfClosingTag(tag, attrs)];
  }

  const hasBoundaryChild = boundaryEventType === 'timer' || boundaryEventType === 'error';
  const hasChildren = isTimerCatch || hasBoundaryChild || extensionLines.length > 0;

  if (!hasChildren) {
    return [selfClosingTag(tag, attrs)];
  }

  const lines = [openTag(tag, attrs)];

  if (isTimerCatch) {
    lines.push('  <bpmn:timerEventDefinition />');
  }

  if (boundaryEventType === 'timer') {
    lines.push('  <bpmn:timerEventDefinition />');
  }

  if (boundaryEventType === 'error') {
    lines.push('  <bpmn:errorEventDefinition />');
  }

  extensionLines.forEach((line) => {
    lines.push(`  ${line}`);
  });

  lines.push(closeTag(tag));

  return lines;
}

export function buildSequenceFlowLines(sequenceFlow) {
  const attrs = {
    id: sequenceFlow.id,
    sourceRef: sequenceFlow.sourceRef,
    targetRef: sequenceFlow.targetRef,
  };

  if (!sequenceFlow.condition) {
    return [selfClosingTag('bpmn:sequenceFlow', attrs)];
  }

  return [
    openTag('bpmn:sequenceFlow', attrs),
    `  ${textTag('bpmn:conditionExpression', sequenceFlow.condition, { 'xsi:type': 'bpmn:tFormalExpression' })}`,
    closeTag('bpmn:sequenceFlow'),
  ];
}