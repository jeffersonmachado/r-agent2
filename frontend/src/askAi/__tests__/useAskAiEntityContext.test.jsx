import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { useAskAiEntityContext } from '../useAskAiEntityContext';
import {
  clearAskAiEntityContext,
  ENTITY_TYPES,
  getAskAiEntityContext,
} from '../contextProvider';

/**
 * O gap real (verificado no browser em 2026-09-12): o widget já enviava
 * `context` e o backend já validava posse, mas nenhuma tela publicava a
 * entidade — o mecanismo só existia nos testes. Este hook fecha o elo.
 */

function Probe({ entityType, entityId, workspaceEntityId }) {
  useAskAiEntityContext({ entityType, entityId, workspaceEntityId });
  return <span data-testid="probe" />;
}

describe('useAskAiEntityContext', () => {
  beforeEach(() => clearAskAiEntityContext());
  afterEach(() => {
    cleanup();
    clearAskAiEntityContext();
  });

  test('publica a entidade em foco para o widget', () => {
    render(<Probe entityType={ENTITY_TYPES.FITNESS_STUDENT} entityId="student-42" />);
    expect(getAskAiEntityContext()).toEqual({
      entityType: 'FITNESS_STUDENT',
      entityId: 'student-42',
    });
  });

  test('sem entityId apenas limpa (nunca herda contexto de outra tela)', () => {
    const { rerender } = render(<Probe entityType={ENTITY_TYPES.FITNESS_STUDENT} entityId="student-42" />);
    expect(getAskAiEntityContext().entityId).toBe('student-42');

    rerender(<Probe entityType={ENTITY_TYPES.FITNESS_STUDENT} entityId={null} />);
    expect(getAskAiEntityContext()).toEqual({});
  });

  test('desmontar a tela limpa o contexto', () => {
    const { unmount } = render(<Probe entityType={ENTITY_TYPES.CUSTOMER} entityId="customer-7" />);
    expect(getAskAiEntityContext().entityId).toBe('customer-7');

    unmount();
    expect(getAskAiEntityContext()).toEqual({});
  });

  test('troca de entidade substitui o contexto (não acumula)', () => {
    const { rerender } = render(<Probe entityType={ENTITY_TYPES.FITNESS_STUDENT} entityId="s-1" />);
    rerender(<Probe entityType={ENTITY_TYPES.FITNESS_STUDENT} entityId="s-2" />);
    expect(getAskAiEntityContext()).toEqual({ entityType: 'FITNESS_STUDENT', entityId: 's-2' });
  });

  test('tipo desconhecido é recusado pelo contrato (fail-closed)', () => {
    render(<Probe entityType="NAO_EXISTE" entityId="x" />);
    expect(getAskAiEntityContext()).toEqual({});
  });

  test('id com formato suspeito não é publicado', () => {
    render(<Probe entityType={ENTITY_TYPES.CUSTOMER} entityId="/etc/passwd" />);
    expect(getAskAiEntityContext()).toEqual({});
  });

  test('workspaceEntityId acompanha quando informado', () => {
    render(<Probe entityType={ENTITY_TYPES.CUSTOMER} entityId="c-1" workspaceEntityId="ws-9" />);
    expect(getAskAiEntityContext()).toEqual({
      entityType: 'CUSTOMER',
      entityId: 'c-1',
      workspaceEntityId: 'ws-9',
    });
  });
});
