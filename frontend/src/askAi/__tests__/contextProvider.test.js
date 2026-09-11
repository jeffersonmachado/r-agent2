import { describe, test, expect, beforeEach } from 'vitest';
import {
  setAskAiEntityContext,
  clearAskAiEntityContext,
  deriveScreenContext,
  buildAskAiContext,
  describeAskAiContext,
} from '../contextProvider';

describe('askAi contextProvider', () => {
  beforeEach(() => {
    clearAskAiEntityContext();
  });

  test('deriva rota, módulo e tipo de página da URL', () => {
    expect(deriveScreenContext('/fitness/students')).toEqual({
      route: '/fitness/students',
      module: 'fitness',
      pageType: 'detail',
    });
    expect(deriveScreenContext('/campaigns')).toEqual({
      route: '/campaigns',
      module: 'campaigns',
      pageType: 'index',
    });
    expect(deriveScreenContext('/')).toEqual({ route: '/', module: 'root', pageType: 'index' });
    expect(deriveScreenContext('/a/b/c').pageType).toBe('nested');
  });

  test('não aceita tipo de entidade fora do vocabulário', () => {
    setAskAiEntityContext({ entityType: 'SECRET_TABLE', entityId: '1' });
    expect(buildAskAiContext('/x')).not.toHaveProperty('entityType');
  });

  test('ignora entidade sem id', () => {
    setAskAiEntityContext({ entityType: 'FITNESS_STUDENT' });
    expect(buildAskAiContext('/x')).not.toHaveProperty('entityId');
  });

  test('combina contexto de tela com entidade declarada', () => {
    setAskAiEntityContext({ entityType: 'FITNESS_STUDENT', entityId: '42' });

    expect(buildAskAiContext('/fitness/students/42')).toEqual({
      route: '/fitness/students/42',
      module: 'fitness',
      pageType: 'nested',
      entityType: 'FITNESS_STUDENT',
      entityId: '42',
    });
  });

  test('limpar remove a entidade mas preserva o contexto de tela', () => {
    setAskAiEntityContext({ entityType: 'CUSTOMER', entityId: '7' });
    clearAskAiEntityContext();

    const context = buildAskAiContext('/crm');
    expect(context).not.toHaveProperty('entityType');
    expect(context.module).toBe('crm');
  });

  test('rótulo amigável não expõe id técnico', () => {
    expect(describeAskAiContext({ entityType: 'FITNESS_STUDENT', entityId: '42' }))
      .toBe('Considerando o aluno atual');
    expect(describeAskAiContext({ entityType: 'CAMPAIGN' })).toBe('Considerando a campanha atual');
    expect(describeAskAiContext({})).toBeNull();
    expect(describeAskAiContext(null)).toBeNull();
  });
});
