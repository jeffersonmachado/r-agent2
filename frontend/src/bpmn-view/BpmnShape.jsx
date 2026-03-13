import React from 'react';

import { MessageEventIcon } from './icons/MessageEventIcon';
import { TimerEventIcon } from './icons/TimerEventIcon';
import { GatewayMarker } from './icons/GatewayMarker';
import { DataStoreShape } from './icons/DataStoreShape';
import { DataObjectShape } from './icons/DataObjectShape';

const TASK_TYPES = new Set([
  'task',
  'userTask',
  'serviceTask',
  'manualTask',
  'scriptTask',
  'receiveTask',
  'sendTask',
  'callActivity',
]);

const EVENT_TYPES = new Set([
  'startEvent',
  'endEvent',
  'intermediateCatchEvent',
  'intermediateThrowEvent',
  'boundaryEvent',
]);

const GATEWAY_TYPES = new Set([
  'exclusiveGateway',
  'eventBasedGateway',
  'parallelGateway',
  'inclusiveGateway',
]);

function toStageBounds(bounds, _viewport) {
  return {
    left: bounds.x,
    top: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}

function hasLabelBounds(labelBounds) {
  if (!labelBounds) return false;
  return Number.isFinite(labelBounds.x)
    && Number.isFinite(labelBounds.y)
    && Number.isFinite(labelBounds.width)
    && Number.isFinite(labelBounds.height);
}

function toLabelBoundsStyle(labelBounds) {
  return {
    left: labelBounds.x,
    top: labelBounds.y,
    width: labelBounds.width,
    height: labelBounds.height,
  };
}

function getShapeClass(node) {
  const type = String(node?.bpmnType || 'task');

  if (type === 'dataStoreReference') return 'bpmn-shape--data-store';
  if (type === 'dataObjectReference') return 'bpmn-shape--data-object';

  if (GATEWAY_TYPES.has(type)) {
    return `bpmn-shape--gateway bpmn-shape--gateway-${type}`;
  }

  if (EVENT_TYPES.has(type)) {
    const classes = ['bpmn-shape--event'];
    if (type === 'startEvent') classes.push('bpmn-shape--start-event');
    else if (type === 'endEvent') classes.push('bpmn-shape--end-event');
    else if (type === 'boundaryEvent') classes.push('bpmn-shape--boundary-event');
    else classes.push('bpmn-shape--intermediate-event');

    if (node?.eventDefinitionType === 'message') classes.push('bpmn-shape--message-event');
    if (node?.eventDefinitionType === 'timer') classes.push('bpmn-shape--timer-event');
    return classes.join(' ');
  }

  if (TASK_TYPES.has(type)) {
    return `bpmn-shape--task bpmn-shape--task-${type}`;
  }

  return 'bpmn-shape--task';
}

function getVisibleLabel(node) {
  const rawName = String(node?.name || '').trim();
  if (!rawName) return '';
  if (rawName === String(node?.id || '')) return '';
  return rawName;
}

function getHoverTitle(node) {
  const visibleLabel = getVisibleLabel(node);
  const lines = [];
  if (visibleLabel) {
    lines.push(visibleLabel);
  }
  if (node?.bpmnType) {
    lines.push(`Tipo: ${node.bpmnType}`);
  }
  if (node?.id) {
    lines.push(`ID: ${node.id}`);
  }
  return lines.join('\n');
}

function renderShapeGlyph(node) {
  const type = String(node?.bpmnType || 'task');

  if (GATEWAY_TYPES.has(type)) {
    return (
      <>
        <span className="bpmn-shape__gateway-diamond" aria-hidden="true" />
        <span className="bpmn-shape__gateway-marker" aria-hidden="true">
          <GatewayMarker bpmnType={type} className="bpmn-shape__gateway-marker-svg" />
        </span>
      </>
    );
  }

  if (type === 'dataStoreReference') {
    return <DataStoreShape className="bpmn-shape__data-store-svg" />;
  }

  if (type === 'dataObjectReference') {
    return <DataObjectShape className="bpmn-shape__data-object-svg" />;
  }

  if (EVENT_TYPES.has(type)) {
    if (node?.eventDefinitionType === 'message') {
      return <MessageEventIcon className="bpmn-shape__event-icon" />;
    }

    if (node?.eventDefinitionType === 'timer') {
      return <TimerEventIcon className="bpmn-shape__event-icon" />;
    }
  }

  return null;
}

export function BpmnShape({ node, viewport, selected, onSelect }) {
  if (!node?.bounds) return null;

  const style = toStageBounds(node.bounds, viewport);
  const shapeClass = getShapeClass(node);
  const visibleLabel = getVisibleLabel(node);
  const usesDiLabel = hasLabelBounds(node?.labelBounds);
  const glyph = renderShapeGlyph(node);

  return (
    <>
      <button
        type="button"
        className={`bpmn-shape ${shapeClass} ${selected ? 'is-selected' : ''}`}
        style={style}
        onClick={() => onSelect?.({ kind: 'node', id: node.id })}
        title={getHoverTitle(node)}
      >
        {glyph}
        {visibleLabel && !usesDiLabel ? <span className="bpmn-shape__label">{visibleLabel}</span> : null}
      </button>
      {visibleLabel && usesDiLabel ? (
        <div className="bpmn-shape__label-di" style={toLabelBoundsStyle(node.labelBounds)}>
          {visibleLabel}
        </div>
      ) : null}
    </>
  );
}

export default BpmnShape;