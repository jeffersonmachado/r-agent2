import BaseRenderer from 'diagram-js/lib/draw/BaseRenderer';
import { attr as svgAttr } from 'tiny-svg';

const HIGH_PRIORITY = 2500;

const COLORS = {
  stroke: '#7f90a8',
  strokeStrong: '#90a4bf',
  fill: '#131b27',
  fillMuted: '#111722',
  label: '#d9e2ef',
  accent: '#6fb0ff',
};

function setAttrs(element, attrs) {
  if (!element) return;
  svgAttr(element, attrs);
}

function localType(element) {
  return String(element?.type || '').replace(/^bpmn:/, '');
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
    stroke: options.stroke || COLORS.strokeStrong,
    fill: options.fill || COLORS.strokeStrong,
    strokeWidth: options.strokeWidth || 1.25,
  });
}

function connectionStyle(type) {
  if (type === 'MessageFlow') {
    return {
      stroke: COLORS.accent,
      strokeWidth: 1.7,
      strokeDasharray: '7,5',
      fill: 'none',
    };
  }

  if (type === 'Association') {
    return {
      stroke: '#73849a',
      strokeWidth: 1.35,
      strokeDasharray: '4,4',
      fill: 'none',
    };
  }

  return {
    stroke: COLORS.strokeStrong,
    strokeWidth: 1.75,
    fill: 'none',
  };
}

function shapeStyle(type) {
  if (type === 'DataStoreReference') {
    return {
      stroke: '#92a6bf',
      strokeWidth: 1.9,
      fill: '#1a2534',
    };
  }

  if (type.includes('Gateway')) {
    return {
      stroke: '#8ca2bf',
      strokeWidth: 1.95,
      fill: '#162131',
    };
  }

  if (type.includes('Event')) {
    return {
      stroke: '#8aa4c7',
      strokeWidth: 1.85,
      fill: '#141d2a',
    };
  }

  if (type.includes('Task') || type === 'SubProcess') {
    return {
      stroke: COLORS.strokeStrong,
      strokeWidth: 1.8,
      fill: COLORS.fill,
      rx: 8,
      ry: 8,
    };
  }

  return {
    stroke: COLORS.stroke,
    strokeWidth: 1.65,
    fill: COLORS.fillMuted,
  };
}

function labelThemeForTarget(targetType) {
  if (targetType === 'MessageFlow') {
    return {
      fill: '#d5e5ff',
      fontSize: '12px',
      fontWeight: '600',
    };
  }

  if (targetType.includes('Intermediate') || targetType.includes('Event') || targetType === 'BoundaryEvent') {
    return {
      fill: '#d8e3f2',
      fontSize: '12px',
      fontWeight: '550',
    };
  }

  return {
    fill: COLORS.label,
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
    fill: COLORS.label,
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
    setAttrs(mainNode, shapeStyle(type));

    const children = visualChildren(parent);
    if (type.includes('Gateway')) {
      // Keep outer diamond darker and inner marker crisp.
      setAttrs(children[0], shapeStyle(type));
      if (children[1]) {
        setAttrs(children[1], {
          stroke: '#d2e3ff',
          strokeWidth: 1.6,
          fill: 'none',
        });
      }
    }

    if (type.includes('Event')) {
      setAttrs(children[0], shapeStyle(type));
      if (children[1]) {
        setAttrs(children[1], {
          stroke: '#b8cdea',
          strokeWidth: 1.3,
          fill: 'none',
        });
      }
      if (children[2]) {
        setAttrs(children[2], {
          stroke: '#aac1df',
          strokeWidth: 1.2,
          fill: 'none',
        });
      }
    }

    if (type === 'DataStoreReference') {
      children.forEach((child, index) => {
        setAttrs(child, {
          stroke: index === 0 ? '#97aec9' : '#8aa2be',
          strokeWidth: index === 0 ? 1.9 : 1.2,
          fill: index === 0 ? '#1a2534' : 'none',
        });
      });
    }

    if ((type.includes('Task') || type === 'SubProcess') && !element?.labelTarget) {
      applyTaskTextStyle(parent, element);
    }

    const label = parent?.querySelector?.('text') || null;
    if (element?.labelTarget) {
      const targetType = localType(element.labelTarget);
      applyLabelTypography(label, labelThemeForTarget(targetType));
      centerLabelText(label, Number(element?.width), Number(element?.height));
    } else {
      setAttrs(label, { fill: COLORS.label });
    }

    return rendered;
  }

  drawConnection(parent, element) {
    const rendered = this.bpmnRenderer.drawConnection(parent, element);

    const type = localType(element);
    const mainNode = firstVisualNode(parent);
    const style = connectionStyle(type);
    setAttrs(mainNode, style);

    tuneMarker(parent, mainNode?.getAttribute?.('marker-start'), {
      stroke: style.stroke,
      fill: type === 'MessageFlow' ? '#1c2a3d' : style.stroke,
      strokeWidth: 1.25,
    });
    tuneMarker(parent, mainNode?.getAttribute?.('marker-end'), {
      stroke: style.stroke,
      fill: type === 'MessageFlow' ? '#1c2a3d' : style.stroke,
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
