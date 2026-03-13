import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { BpmnShape } from './BpmnShape';

describe('bpmn-view/BpmnShape', () => {
  const viewport = {
    minX: 0,
    minY: 0,
  };

  it('não mostra ID como label quando o nome visível é apenas o ID', () => {
    render(
      <BpmnShape
        node={{
          id: 'Task_1',
          name: 'Task_1',
          bpmnType: 'task',
          category: 'task',
          bounds: { x: 100, y: 120, width: 120, height: 70 },
        }}
        viewport={viewport}
        selected={false}
      />,
    );

    expect(screen.queryByText('Task_1')).not.toBeInTheDocument();
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('title', expect.stringContaining('ID: Task_1'));
  });

  it('mostra nome amigável quando nome difere do ID', () => {
    render(
      <BpmnShape
        node={{
          id: 'Task_1',
          name: 'Qualificar Lead',
          bpmnType: 'task',
          category: 'task',
          bounds: { x: 100, y: 120, width: 120, height: 70 },
        }}
        viewport={viewport}
        selected={false}
      />,
    );

    expect(screen.getByText('Qualificar Lead')).toBeInTheDocument();
  });

  it('aplica bounds do BPMN DI sem offset adicional', () => {
    render(
      <BpmnShape
        node={{
          id: 'Task_1',
          name: 'Qualificar Lead',
          bpmnType: 'task',
          category: 'task',
          bounds: { x: 100, y: 120, width: 120, height: 70 },
        }}
        viewport={viewport}
        selected={false}
      />,
    );

    const button = screen.getByRole('button');
    expect(button).toHaveStyle({
      left: '100px',
      top: '120px',
      width: '120px',
      height: '70px',
    });
  });

  it('renderiza icone de messageEventDefinition em evento intermediario', () => {
    const { container } = render(
      <BpmnShape
        node={{
          id: 'Catch_1',
          name: 'Wait Message',
          bpmnType: 'intermediateCatchEvent',
          category: 'event',
          eventDefinitionType: 'message',
          bounds: { x: 220, y: 180, width: 44, height: 44 },
        }}
        viewport={viewport}
        selected={false}
      />,
    );

    expect(container.querySelector('.bpmn-shape__event-icon')).toBeTruthy();
  });

  it('renderiza dataStoreReference com shape dedicado', () => {
    const { container } = render(
      <BpmnShape
        node={{
          id: 'DataStore_1',
          name: 'Database',
          bpmnType: 'dataStoreReference',
          category: 'data',
          bounds: { x: 600, y: 260, width: 72, height: 90 },
        }}
        viewport={viewport}
        selected={false}
      />,
    );

    expect(container.querySelector('.bpmn-shape--data-store')).toBeTruthy();
    expect(container.querySelector('.bpmn-shape__data-store-svg')).toBeTruthy();
  });

  it('usa labelBounds do DI quando disponivel', () => {
    render(
      <BpmnShape
        node={{
          id: 'Task_1',
          name: 'pizza order',
          bpmnType: 'task',
          category: 'task',
          bounds: { x: 280, y: 160, width: 140, height: 80 },
          labelBounds: { x: 300, y: 250, width: 100, height: 20 },
        }}
        viewport={viewport}
        selected={false}
      />,
    );

    const diLabel = screen.getByText('pizza order');
    expect(diLabel).toHaveClass('bpmn-shape__label-di');
    expect(diLabel).toHaveStyle({
      left: '300px',
      top: '250px',
      width: '100px',
      height: '20px',
    });
  });
});
