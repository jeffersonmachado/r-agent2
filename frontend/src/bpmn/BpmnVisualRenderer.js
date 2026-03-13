import BaseRenderer from 'diagram-js/lib/draw/BaseRenderer';
import { attr as svgAttr } from 'tiny-svg';

const HIGH_PRIORITY = 2500;

const THEME = {
  canvas: '#111824',
  label: '#f2f5fb',
  task: {
    fill: '#1a2433',
    stroke: '#f39b32',
    strokeWidth: 2.0,
    radius: 10,
  },
  startEvent: {
    fill: '#193528',
    stroke: '#59c779',
    innerStroke: '#9ae2b3',
    strokeWidth: 2.1,
  },
  endEvent: {
    fill: '#3e1f24',
    stroke: '#eb635a',
    innerStroke: '#f79b91',
    strokeWidth: 2.2,
  },
  intermediateEvent: {
    fill: '#2a1f3d',
    stroke: '#b983ff',
    innerStroke: '#d8baff',
    strokeWidth: 2.0,
  },
  gateway: {
    fill: '#1b2431',
    stroke: '#f2a33c',
    markerStroke: '#ffe0ab',
    strokeWidth: 2.0,
  },
  sequenceFlow: {
    stroke: '#f2a33c',
    strokeWidth: 2.0,
  },
  messageFlow: {
    stroke: '#63b7f2',
    strokeWidth: 1.8,
    dash: '8,6',
  },
  dataStore: {
    fill: '#112c41',
    stroke: '#63b7f2',
    secondaryStroke: '#93cff9',
    strokeWidth: 2.0,
  },
  annotation: {
    fill: '#171f2d',
    stroke: '#7f90a6',
    strokeWidth: 1.5,
  },
  participant: {
    fill: '#121c2a',
    stroke: '#5b6e86',
    strokeWidth: 1.8,
  },
  lane: {
    fill: '#111a28',
    stroke: '#51647d',
    strokeWidth: 1.4,
  },
};

function setAttrs(element, attrs) {
  if (!element) return;
  svgAttr(element, attrs);
}

function localType(element) {
  return String(element?.type || '').replace(/^bpmn:/, '');
}

function isTaskType(type) {
  return type === 'Task'
    || type === 'UserTask'
    || type === 'ServiceTask'
    || type === 'ManualTask'
    || type === 'ScriptTask';
}

function isGatewayType(type) {
  return type === 'ExclusiveGateway'
    || type === 'ParallelGateway'
    || type === 'InclusiveGateway'
    || type === 'EventBasedGateway';
}

function firstVisualNode(parent) {
  const visual = parent?.querySelector?.('.djs-visual') || parent;
  return visual?.firstElementChild || null;
}

function visualChildren(parent) {
  const visual = parent?.querySelector?.('.djs-visual') || parent;
  return Array.from(visual?.children || []);
}

function tuneMarker(parent, markerRef, options = {}) {
  if (!markerRef || typeof markerRef !== 'string') return;
  const id = markerRef.replace(/^url\(#/, '').replace(/\)$/, '');
  if (!id) return;

  const doc = parent?.ownerDocument;
  const marker = doc?.getElementById?.(id);
  const markerPath = marker?.querySelector?.('path');
  if (!markerPath) return;

  setAttrs(markerPath, {
    stroke: options.stroke || THEME.sequenceFlow.stroke,
    fill: options.fill || options.stroke || THEME.sequenceFlow.stroke,
    strokeWidth: options.strokeWidth || 1.25,
  });
}

function extractDiAttrs(element) {
  const semantic = element?.businessObject || element?.labelTarget?.businessObject;
  const di = semantic?.di;
  const attrs = di?.$attrs || {};

  const fromKeys = (keys) => {
    for (const key of keys) {
      const value = di?.get?.(key) ?? di?.[key] ?? attrs?.[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return null;
  };

  const stroke = fromKeys([
    'bioc:stroke',
    'stroke',
    'camunda:borderColor',
    'color:border-color',
    'color:stroke',
  ]);

  const fill = fromKeys([
    'bioc:fill',
    'fill',
    'camunda:backgroundColor',
    'color:background-color',
    'color:fill',
  ]);

  return { stroke, fill };
}

function applyDiColorFallback(element, style = {}) {
  const diColors = extractDiAttrs(element);
  const resolved = { ...style };

  if (diColors.stroke) {
    resolved.stroke = diColors.stroke;
  }

  if (diColors.fill && Object.prototype.hasOwnProperty.call(resolved, 'fill')) {
    resolved.fill = diColors.fill;
  }

  return resolved;
}

function connectionStyle(type) {
  if (type === 'MessageFlow') {
    return {
      stroke: THEME.messageFlow.stroke,
      strokeWidth: THEME.messageFlow.strokeWidth,
      strokeDasharray: THEME.messageFlow.dash,
      fill: 'none',
    };
  }

  if (type === 'Association') {
    return {
      stroke: '#8a99ad',
      strokeWidth: 1.35,
      strokeDasharray: '4,4',
      fill: 'none',
    };
  }

  return {
    stroke: THEME.sequenceFlow.stroke,
    strokeWidth: THEME.sequenceFlow.strokeWidth,
    fill: 'none',
  };
}

function shapeStyle(type) {
  if (type === 'StartEvent') {
    return {
      stroke: THEME.startEvent.stroke,
      strokeWidth: THEME.startEvent.strokeWidth,
      fill: THEME.startEvent.fill,
    };
  }

  if (type === 'EndEvent') {
    return {
      stroke: THEME.endEvent.stroke,
      strokeWidth: THEME.endEvent.strokeWidth,
      fill: THEME.endEvent.fill,
    };
  }

  if (type === 'IntermediateCatchEvent' || type === 'IntermediateThrowEvent' || type === 'BoundaryEvent') {
    return {
      stroke: THEME.intermediateEvent.stroke,
      strokeWidth: THEME.intermediateEvent.strokeWidth,
      fill: THEME.intermediateEvent.fill,
    };
  }

  if (type === 'DataStoreReference') {
    return {
      stroke: THEME.dataStore.stroke,
      strokeWidth: THEME.dataStore.strokeWidth,
      fill: THEME.dataStore.fill,
    };
  }

  if (isGatewayType(type)) {
    return {
      stroke: THEME.gateway.stroke,
      strokeWidth: THEME.gateway.strokeWidth,
      fill: THEME.gateway.fill,
    };
  }

  if (isTaskType(type) || type === 'SubProcess') {
    return {
      stroke: THEME.task.stroke,
      strokeWidth: THEME.task.strokeWidth,
      fill: THEME.task.fill,
      rx: THEME.task.radius,
      ry: THEME.task.radius,
    };
  }

  if (type === 'TextAnnotation') {
    return {
      stroke: THEME.annotation.stroke,
      strokeWidth: THEME.annotation.strokeWidth,
      fill: THEME.annotation.fill,
    };
  }

  if (type === 'Participant') {
    return {
      stroke: THEME.participant.stroke,
      strokeWidth: THEME.participant.strokeWidth,
      fill: THEME.participant.fill,
    };
  }

  if (type === 'Lane') {
    return {
      stroke: THEME.lane.stroke,
      strokeWidth: THEME.lane.strokeWidth,
      fill: THEME.lane.fill,
    };
  }

  return {
    stroke: THEME.participant.stroke,
    strokeWidth: 1.65,
    fill: THEME.canvas,
  };
}

function labelThemeForTarget(targetType) {
  if (targetType === 'MessageFlow') {
    return {
      fill: '#d8ebff',
      fontSize: '12px',
      fontWeight: '600',
    };
  }

  if (targetType.includes('Intermediate') || targetType.includes('Event') || targetType === 'BoundaryEvent') {
    return {
      fill: '#ecdfff',
      fontSize: '12px',
      fontWeight: '550',
    };
  }

  return {
    fill: THEME.label,
    fontSize: '13px',
    fontWeight: '500',
  };
}

function applyLabelTypography(textNode, theme) {
  if (!textNode) return;

  setAttrs(textNode, {
    fill: theme.fill,
    fontSize: theme.fontSize,
    fontWeight: theme.fontWeight,
    letterSpacing: '0.1px',
    textRendering: 'geometricPrecision',
  });
}

function centerLabelText(textNode, width, height) {
  if (!textNode || !Number.isFinite(width) || !Number.isFinite(height)) return;

  const x = Math.max(0, width / 2);
  const y = Math.max(0, height / 2);

  setAttrs(textNode, {
    x,
    y,
    textAnchor: 'middle',
    dominantBaseline: 'middle',
  });

  const tspans = Array.from(textNode.querySelectorAll('tspan'));
  if (tspans.length > 0) {
    tspans.forEach((tspan, index) => {
      setAttrs(tspan, {
        x,
        dy: index === 0 ? '-0.1em' : '1.2em',
      });
    });
  }
}

function applyTaskTextStyle(parent, element) {
  const textNode = parent?.querySelector?.('text') || null;
  if (!textNode) return;

  const width = Number(element?.width);
  const height = Number(element?.height);

  applyLabelTypography(textNode, {
    fill: THEME.label,
    fontSize: '13px',
    fontWeight: '520',
  });

  // Visual padding effect: keep text centered with tighter multiline rhythm.
  centerLabelText(textNode, width, height);
}

export default class BpmnVisualRenderer extends BaseRenderer {
  constructor(eventBus, bpmnRenderer) {
    super(eventBus, HIGH_PRIORITY);
    this.bpmnRenderer = bpmnRenderer;
  }

  canRender(element) {
    return !!element;
  }

  drawShape(parent, element) {
    const rendered = this.bpmnRenderer.drawShape(parent, element);

    const type = localType(element);
    const mainNode = firstVisualNode(parent);
    setAttrs(mainNode, applyDiColorFallback(element, shapeStyle(type)));

    const children = visualChildren(parent);
    if (isGatewayType(type)) {
      // Keep outer diamond darker and inner marker crisp.
      setAttrs(children[0], applyDiColorFallback(element, shapeStyle(type)));
      if (children[1]) {
        setAttrs(children[1], {
          stroke: THEME.gateway.markerStroke,
          strokeWidth: 1.6,
          fill: 'none',
        });
      }
    }

    if (type.includes('Event')) {
      const eventStyle = applyDiColorFallback(element, shapeStyle(type));
      setAttrs(children[0], eventStyle);
      if (children[1]) {
        const innerStroke = type === 'StartEvent'
          ? THEME.startEvent.innerStroke
          : (type === 'EndEvent' ? THEME.endEvent.innerStroke : THEME.intermediateEvent.innerStroke);
        setAttrs(children[1], {
          stroke: innerStroke,
          strokeWidth: 1.3,
          fill: 'none',
        });
      }
      if (children[2]) {
        setAttrs(children[2], {
          stroke: THEME.intermediateEvent.innerStroke,
          strokeWidth: 1.2,
          fill: 'none',
        });
      }
    }

    if (type === 'DataStoreReference') {
      children.forEach((child, index) => {
        setAttrs(child, {
          stroke: index === 0 ? THEME.dataStore.stroke : THEME.dataStore.secondaryStroke,
          strokeWidth: index === 0 ? THEME.dataStore.strokeWidth : 1.2,
          fill: index === 0 ? THEME.dataStore.fill : 'none',
        });
      });
    }

    if ((isTaskType(type) || type === 'SubProcess') && !element?.labelTarget) {
      applyTaskTextStyle(parent, element);
    }

    const label = parent?.querySelector?.('text') || null;
    if (element?.labelTarget) {
      const targetType = localType(element.labelTarget);
      applyLabelTypography(label, labelThemeForTarget(targetType));
      centerLabelText(label, Number(element?.width), Number(element?.height));
    } else {
      setAttrs(label, { fill: THEME.label });
    }

    return rendered;
  }

  drawConnection(parent, element) {
    const rendered = this.bpmnRenderer.drawConnection(parent, element);

    const type = localType(element);
    const mainNode = firstVisualNode(parent);
    const style = applyDiColorFallback(element, connectionStyle(type));
    setAttrs(mainNode, style);

    tuneMarker(parent, mainNode?.getAttribute?.('marker-start'), {
      stroke: style.stroke,
      fill: style.stroke,
      strokeWidth: 1.25,
    });
    tuneMarker(parent, mainNode?.getAttribute?.('marker-end'), {
      stroke: style.stroke,
      fill: style.stroke,
      strokeWidth: 1.25,
    });

    const label = parent?.querySelector?.('text') || null;
    applyLabelTypography(label, labelThemeForTarget(type));

    return rendered;
  }

  getShapePath(shape) {
    return this.bpmnRenderer.getShapePath(shape);
  }
}

BpmnVisualRenderer.$inject = ['eventBus', 'bpmnRenderer'];
