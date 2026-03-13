import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { BpmnPoolLaneLayer } from './BpmnPoolLaneLayer';

function getParentByClassName(element, className) {
  return element.closest(`.${className}`);
}

describe('bpmn-view/BpmnPoolLaneLayer', () => {
  const viewport = {
    minX: 0,
    minY: 0,
  };

  it('renderiza fallback vertical para labels de pool e lane sem BPMNLabel no DI', () => {
    render(
      <BpmnPoolLaneLayer
        participants={[
          {
            id: 'Participant_1',
            name: 'Pizza vendor',
            bounds: { x: 40, y: 520, width: 1333, height: 448 },
          },
        ]}
        lanes={[
          {
            id: 'Lane_1',
            name: 'clerk',
            bounds: { x: 70, y: 522, width: 1303, height: 142 },
          },
        ]}
        viewport={viewport}
        selection={null}
      />,
    );

    const participantLabel = screen.getByText('Pizza vendor');
    const laneLabel = screen.getByText('clerk');

    expect(participantLabel).toHaveClass('bpmn-pool__label--vertical');
    expect(laneLabel).toHaveClass('bpmn-lane__label--vertical');

    expect(getParentByClassName(participantLabel, 'bpmn-pool__label-band')).toHaveStyle({
      left: '40px',
      top: '520px',
      width: '30px',
      height: '448px',
    });
    expect(getParentByClassName(laneLabel, 'bpmn-lane__label-band')).toHaveStyle({
      left: '70px',
      top: '522px',
      width: '30px',
      height: '142px',
    });
  });

  it('marca labels DI estreitos e altos como verticais', () => {
    render(
      <BpmnPoolLaneLayer
        participants={[
          {
            id: 'Participant_1',
            name: 'Pizza vendor',
            bounds: { x: 40, y: 520, width: 1333, height: 448 },
            labelBounds: { x: 44, y: 540, width: 24, height: 180 },
          },
        ]}
        lanes={[]}
        viewport={viewport}
        selection={null}
      />,
    );

    const label = screen.getByText('Pizza vendor');
    expect(label).toHaveClass('bpmn-pool__label-di');
    expect(label).toHaveClass('is-vertical');
    expect(label).toHaveStyle({
      left: '44px',
      top: '540px',
      width: '24px',
      height: '180px',
    });
  });
});