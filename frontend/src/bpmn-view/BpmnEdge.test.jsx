import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

import { BpmnEdge } from './BpmnEdge';

describe('bpmn-view/BpmnEdge', () => {
  it('renders polyline using original BPMN waypoint coordinates', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <svg>
        <BpmnEdge
          edge={{
            id: 'Flow_1',
            sourceRef: 'Task_A',
            targetRef: 'Task_B',
            waypoints: [
              { x: 100, y: 200 },
              { x: 160, y: 200 },
              { x: 180, y: 220 },
            ],
          }}
          viewport={{ minX: 0, minY: 0 }}
          selected={false}
          onSelect={onSelect}
          kind="sequenceFlow"
        />
      </svg>
    );

    const line = container.querySelector('polyline.bpmn-edge__line');
    const hitbox = container.querySelector('polyline.bpmn-edge__hitbox');

    expect(line).toBeTruthy();
    expect(hitbox).toBeTruthy();
    expect(line?.getAttribute('points')).toBe('100,200 160,200 180,220');
    expect(hitbox?.getAttribute('points')).toBe('100,200 160,200 180,220');
  });

  it('does not render edge when there are fewer than 2 waypoints', () => {
    const { container } = render(
      <svg>
        <BpmnEdge
          edge={{
            id: 'Flow_1',
            waypoints: [{ x: 100, y: 200 }],
          }}
          viewport={{ minX: 0, minY: 0 }}
          selected={false}
          onSelect={() => {}}
          kind="sequenceFlow"
        />
      </svg>
    );

    expect(container.querySelector('polyline.bpmn-edge__line')).toBeNull();
  });

  it('uses DI labelBounds for edge label position', () => {
    const { container } = render(
      <svg>
        <BpmnEdge
          edge={{
            id: 'Flow_2',
            name: 'money',
            sourceRef: 'Task_A',
            targetRef: 'Task_B',
            waypoints: [
              { x: 420, y: 220 },
              { x: 520, y: 220 },
            ],
            labelBounds: { x: 448, y: 192, width: 54, height: 18 },
          }}
          viewport={{ minX: 0, minY: 0 }}
          selected={false}
          onSelect={() => {}}
          kind="sequenceFlow"
        />
      </svg>
    );

    const label = container.querySelector('text.bpmn-edge__label');
    expect(label).toBeTruthy();
    expect(label?.textContent).toBe('money');
    expect(label?.getAttribute('x')).toBe('475');
    expect(label?.getAttribute('y')).toBe('201');
  });
});
