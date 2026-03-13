import BpmnVisualRenderer from './BpmnVisualRenderer';
import BpmnLabelLayoutGuard from './BpmnLabelLayoutGuard';

const bpmnVisualModule = {
  __init__: ['bpmnVisualRenderer', 'bpmnLabelLayoutGuard'],
  bpmnVisualRenderer: ['type', BpmnVisualRenderer],
  bpmnLabelLayoutGuard: ['type', BpmnLabelLayoutGuard],
};

export default bpmnVisualModule;
